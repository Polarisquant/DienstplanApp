import { NextResponse } from "next/server";
import { EmployeeSite, ShiftLayer, WeekStatus, WorkSite } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { addDaysISO } from "@/lib/dateNav";
import { buildHolidayMap } from "@/lib/holidays";
import { holidayDateKeysFromMap } from "@/lib/schoolBreaks";
import { parseWeekStartParam, formatWeekStart } from "@/lib/weekUtils";
import { computeWeeklyBalanceWithContracts } from "@/lib/computeWeekly";
import { contractRowsMapForEmployees } from "@/lib/employeeContractLoad";
import { getBalancesBeforeWeekForEmployees } from "@/lib/balance";
import {
  employeeVisibleInWeek,
  employmentBoundsFromDates,
} from "@/lib/employmentWeekTarget";
import {
  employeeWhereForWorkSite,
  planOrderByForWorkSite,
  whereLaterClosedWeek,
  workSiteLabel,
} from "@/lib/workSite";
import { z } from "zod";

/** Soll-Verrechnungs-Marker für geteilte Mitarbeiter (Soll genau einmal pro KW). */
const SOURCE_DEFAULT = "IST_CLOSED";
const SOURCE_SOLL = "IST_CLOSED_SOLL";
const SOURCE_NOSOLL = "IST_CLOSED_NOSOLL";

const bodySchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  site: z.enum(["CRUSH", "CAPPUCONE"]).optional().default("CRUSH"),
});

export async function POST(req: Request) {
  try {
    const body = bodySchema.parse(await req.json());
    const weekStart = parseWeekStartParam(body.start);
    if (!weekStart) {
      return NextResponse.json({ error: "Ungültiger Wochenstart." }, { status: 400 });
    }

    const site =
      body.site === "CAPPUCONE" ? WorkSite.CAPPUCONE : WorkSite.CRUSH;

    const week = await prisma.workWeek.findUnique({
      where: { weekStart_site: { weekStart: weekStart, site } },
    });
    if (!week) {
      return NextResponse.json({ error: "Woche nicht gefunden." }, { status: 404 });
    }
    if (week.status === WeekStatus.CLOSED) {
      return NextResponse.json({
        ok: true,
        message: "Bereits abgeschlossen.",
        weekStart: formatWeekStart(weekStart),
        site: body.site,
      });
    }

    // Reihenfolge-Guard (Spiegel des Reopen-Guards): Wochen werden von vorne
    // nach hinten abgeschlossen — sonst werden gespeicherte Salden-Ketten
    // (balanceAfter) späterer Wochen unbemerkt falsch.
    const laterClosed = await prisma.workWeek.findFirst({
      where: whereLaterClosedWeek(weekStart, site),
      orderBy: [{ weekStart: "asc" }],
    });
    if (laterClosed) {
      const de = formatWeekStart(laterClosed.weekStart)
        .split("-")
        .reverse()
        .join(".");
      return NextResponse.json(
        {
          error: `Am Standort „${workSiteLabel(site)}“ ist bereits die spätere Woche ab ${de} abgeschlossen. Bitte Wochen der Reihe nach abschließen (sonst zuerst die späteren Wochen wieder öffnen).`,
        },
        { status: 409 }
      );
    }

    // Auch deaktivierte Mitarbeiter: wer in dieser Woche beschäftigt war und
    // Ist-Zellen hat, muss gebucht werden — sonst verschwinden seine Stunden
    // (Sichtbarkeit regelt employeeVisibleInWeek über Ein-/Austritt).
    const employees = await prisma.employee.findMany({
      where: { ...employeeWhereForWorkSite(site) },
      orderBy: [...planOrderByForWorkSite(site)],
    });
    const balanceByEmp = await getBalancesBeforeWeekForEmployees(
      employees.map((e) => ({ id: e.id, startBalanceHours: e.startBalanceHours })),
      weekStart,
      site
    );

    const weekStartISO = formatWeekStart(weekStart);
    const lastDayStr = addDaysISO(weekStartISO, 6);
    const holidayRowsClose = await prisma.holiday.findMany({
      where: {
        includedInPlan: true,
        date: {
          gte: new Date(`${weekStartISO}T00:00:00.000Z`),
          lte: new Date(`${lastDayStr}T23:59:59.999Z`),
        },
      },
    });
    const holidayMapClose = buildHolidayMap(holidayRowsClose);
    const holidayKeysClose = holidayDateKeysFromMap(weekStartISO, holidayMapClose);

    const contractMapClose = await contractRowsMapForEmployees(
      employees.map((e) => e.id)
    );

    // Blocker: Wochen mit Parse-Fehlern oder Einträgen außerhalb der
    // Beschäftigung dürfen nicht abgeschlossen werden (sonst bucht das
    // Zeitkonto stillschweigend falsche Werte).
    const allActualCells = await prisma.shiftCell.findMany({
      where: { workWeekId: week.id, layer: ShiftLayer.ACTUAL },
      select: { employeeId: true, dayIndex: true, rawValue: true },
    });
    const actualByEmp = new Map<string, string[]>();
    for (const e of employees) actualByEmp.set(e.id, Array(7).fill(""));
    for (const c of allActualCells) {
      const arr = actualByEmp.get(c.employeeId);
      if (arr) arr[c.dayIndex] = c.rawValue;
    }
    const blockers: string[] = [];
    for (const e of employees) {
      const entryISO = e.entryDate ? e.entryDate.toISOString().slice(0, 10) : null;
      const exitISO = e.exitDate ? e.exitDate.toISOString().slice(0, 10) : null;
      if (!employeeVisibleInWeek(weekStartISO, entryISO, exitISO)) continue;
      const { errors } = computeWeeklyBalanceWithContracts(
        actualByEmp.get(e.id) ?? Array(7).fill(""),
        weekStartISO,
        contractMapClose.get(e.id) ?? [],
        holidayKeysClose,
        employmentBoundsFromDates(e.entryDate, e.exitDate)
      );
      for (const err of errors) blockers.push(`${e.name}: ${err}`);
    }
    if (blockers.length > 0) {
      return NextResponse.json(
        {
          error: `Abschluss nicht möglich — bitte zuerst korrigieren:\n${blockers.join("\n")}`,
        },
        { status: 400 }
      );
    }

    // Für geteilte Mitarbeiter: Wochensoll genau einmal pro Kalenderwoche
    // verrechnen — hat der andere Standort das Soll schon gebucht, zählt
    // hier nur das Ist.
    const otherSite = site === WorkSite.CRUSH ? WorkSite.CAPPUCONE : WorkSite.CRUSH;
    const otherWeek = await prisma.workWeek.findUnique({
      where: { weekStart_site: { weekStart: weekStart, site: otherSite } },
    });

    await prisma.$transaction(async (tx) => {
      for (const e of employees) {
        const entryISO = e.entryDate ? e.entryDate.toISOString().slice(0, 10) : null;
        const exitISO = e.exitDate ? e.exitDate.toISOString().slice(0, 10) : null;
        if (!employeeVisibleInWeek(weekStartISO, entryISO, exitISO)) {
          await tx.timeAccountLine.deleteMany({
            where: { employeeId: e.id, workWeekId: week.id },
          });
          continue;
        }

        const arr = actualByEmp.get(e.id) ?? Array(7).fill("");
        const rows = contractMapClose.get(e.id) ?? [];
        const employment = employmentBoundsFromDates(e.entryDate, e.exitDate);
        const { weeklyHours, deltaVsContract } = computeWeeklyBalanceWithContracts(
          arr,
          weekStartISO,
          rows,
          holidayKeysClose,
          employment
        );

        let delta = deltaVsContract;
        let source = SOURCE_DEFAULT;
        if (e.workSite === EmployeeSite.SHARED) {
          const otherLine =
            otherWeek && otherWeek.status === WeekStatus.CLOSED
              ? await tx.timeAccountLine.findUnique({
                  where: {
                    employeeId_workWeekId: {
                      employeeId: e.id,
                      workWeekId: otherWeek.id,
                    },
                  },
                })
              : null;
          const sollBereitsVerrechnet = otherLine?.source === SOURCE_SOLL;
          if (sollBereitsVerrechnet) {
            delta = weeklyHours;
            source = SOURCE_NOSOLL;
          } else {
            source = SOURCE_SOLL;
          }
        }

        const base = balanceByEmp.get(e.id) ?? e.startBalanceHours;
        const balanceAfter = base + delta;

        await tx.timeAccountLine.upsert({
          where: {
            employeeId_workWeekId: {
              employeeId: e.id,
              workWeekId: week.id,
            },
          },
          create: {
            employeeId: e.id,
            workWeekId: week.id,
            weeklyDeltaHours: delta,
            balanceAfter,
            source,
          },
          update: {
            weeklyDeltaHours: delta,
            balanceAfter,
            source,
          },
        });
      }

      await tx.workWeek.update({
        where: { id: week.id },
        data: { status: WeekStatus.CLOSED },
      });
    });

    return NextResponse.json({
      ok: true,
      weekStart: formatWeekStart(weekStart),
      site: body.site,
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Ungültige Daten." }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ error: "Abschließen fehlgeschlagen." }, { status: 500 });
  }
}
