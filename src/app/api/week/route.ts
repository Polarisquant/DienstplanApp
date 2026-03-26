import { NextResponse } from "next/server";
import { ShiftLayer, WeekStatus, WorkSite } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { addDaysISO } from "@/lib/dateNav";
import { buildHolidayMap } from "@/lib/holidays";
import { schoolBreakFindManySafe } from "@/lib/schoolBreakDb";
import {
  countHighlightedCalendarDays,
  ferienByDateForWeek,
  holidayDateKeysFromMap,
} from "@/lib/schoolBreaks";
import {
  formatWeekStart,
  isoWeekNumberUTC,
  parseWeekStartParam,
} from "@/lib/weekUtils";
import { computeWeeklyBalance } from "@/lib/computeWeekly";
import { getBalancesBeforeWeekForEmployees } from "@/lib/balance";
import { countVacationDaysInWeek } from "@/lib/vacation";
import { LABOR_LAW_DISCLAIMER_DE } from "@/lib/laborLawConfig";
import {
  employeeWhereForWorkSite,
  parseWorkSiteParam,
  workSiteToParam,
} from "@/lib/workSite";
import { z } from "zod";

type CellRow = {
  employeeId: string;
  layer: ShiftLayer;
  dayIndex: number;
  rawValue: string;
  note: string;
};

function packShiftField(
  cells: CellRow[],
  empId: string,
  layer: ShiftLayer,
  field: "rawValue" | "note"
): string[] {
  const arr = Array(7).fill("");
  for (const c of cells) {
    if (c.employeeId === empId && c.layer === layer) arr[c.dayIndex] = c[field];
  }
  return arr;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const start = parseWeekStartParam(searchParams.get("start"));
  if (!start) {
    return NextResponse.json(
      { error: "Query start=YYYY-MM-DD (Montag der Woche) erforderlich." },
      { status: 400 }
    );
  }

  const site = parseWorkSiteParam(searchParams.get("site"));

  let week = await prisma.workWeek.findUnique({
    where: { weekStart_site: { weekStart: start, site } },
  });
  if (!week) {
    week = await prisma.workWeek.create({
      data: { weekStart: start, site, status: WeekStatus.DRAFT },
    });
  }

  const weekStartStr = formatWeekStart(start);
  const lastDayStr = addDaysISO(weekStartStr, 6);
  const weekStartD = new Date(`${weekStartStr}T12:00:00.000Z`);
  const lastDayD = new Date(`${lastDayStr}T12:00:00.000Z`);
  const prevMondayStr = addDaysISO(weekStartStr, -7);
  const prevStart = parseWeekStartParam(prevMondayStr);

  const [
    employees,
    cellsRaw,
    holidayRows,
    schoolBreakRows,
    prevSundayMaps,
  ] = await Promise.all([
    prisma.employee.findMany({
      where: { active: true, ...employeeWhereForWorkSite(site) },
      orderBy: { name: "asc" },
    }),
    prisma.shiftCell.findMany({
      where: { workWeekId: week.id },
    }),
    prisma.holiday.findMany({
      where: {
        includedInPlan: true,
        date: {
          gte: new Date(`${weekStartStr}T00:00:00.000Z`),
          lte: new Date(`${lastDayStr}T23:59:59.999Z`),
        },
      },
    }),
    schoolBreakFindManySafe(prisma, {
      where: {
        includedInPlan: true,
        AND: [{ startDate: { lte: lastDayD } }, { endDate: { gte: weekStartD } }],
      },
    }),
    (async (): Promise<{
      plan: Map<string, string | null>;
      actual: Map<string, string | null>;
    }> => {
      const plan = new Map<string, string | null>();
      const actual = new Map<string, string | null>();
      if (!prevStart) return { plan, actual };
      const prevWeek = await prisma.workWeek.findUnique({
        where: { weekStart_site: { weekStart: prevStart, site } },
      });
      if (!prevWeek) return { plan, actual };
      const prevCells = await prisma.shiftCell.findMany({
        where: { workWeekId: prevWeek.id, dayIndex: 6 },
      });
      for (const c of prevCells) {
        if (c.layer === ShiftLayer.PLAN) plan.set(c.employeeId, c.rawValue ?? null);
        if (c.layer === ShiftLayer.ACTUAL)
          actual.set(c.employeeId, c.rawValue ?? null);
      }
      return { plan, actual };
    })(),
  ]);

  const cells: CellRow[] = cellsRaw.map((c) => ({
    employeeId: c.employeeId,
    layer: c.layer,
    dayIndex: c.dayIndex,
    rawValue: c.rawValue,
    note: c.note ?? "",
  }));

  const prevSundayByEmpPlan = prevSundayMaps.plan;
  const prevSundayByEmpActual = prevSundayMaps.actual;

  const holidayMap = buildHolidayMap(holidayRows);
  const ferienMap = ferienByDateForWeek(weekStartStr, schoolBreakRows);
  const holidayKeys = holidayDateKeysFromMap(weekStartStr, holidayMap);
  const feiDaysInWeek = countHighlightedCalendarDays(
    weekStartStr,
    holidayKeys,
    ferienMap
  );

  const days = Array.from({ length: 7 }, (_, i) => {
    const dateISO = addDaysISO(weekStartStr, i);
    return {
      dayIndex: i,
      dateISO,
      holidays: holidayMap.get(dateISO) ?? [],
      ferien: ferienMap.get(dateISO) ?? [],
    };
  });

  const balanceByEmp = await getBalancesBeforeWeekForEmployees(
    employees.map((e) => ({
      id: e.id,
      startBalanceHours: e.startBalanceHours,
    })),
    start,
    site
  );

  const rows = employees.map((e) => {
    const plan = packShiftField(cells, e.id, ShiftLayer.PLAN, "rawValue");
    const actual = packShiftField(cells, e.id, ShiftLayer.ACTUAL, "rawValue");
    const planNotes = packShiftField(cells, e.id, ShiftLayer.PLAN, "note");
    const actualNotes = packShiftField(cells, e.id, ShiftLayer.ACTUAL, "note");
    const wsPlan = computeWeeklyBalance(
      plan,
      e.contractHoursPerWeek,
      e.workDaysPerWeek
    );
    const wsAct = computeWeeklyBalance(
      actual,
      e.contractHoursPerWeek,
      e.workDaysPerWeek
    );
    const base = balanceByEmp.get(e.id) ?? e.startBalanceHours;
    const zagPreview = base + wsAct.deltaVsContract;
    return {
      employee: {
        id: e.id,
        name: e.name,
        workSite: e.workSite,
        contractHoursPerWeek: e.contractHoursPerWeek,
        workDaysPerWeek: e.workDaysPerWeek,
        vacationDaysOpen: e.vacationDaysOpen,
      },
      plan,
      actual,
      planNotes,
      actualNotes,
      wsPlan: wsPlan.weeklyHours,
      wsActual: wsAct.weeklyHours,
      errorsPlan: wsPlan.errors,
      errorsActual: wsAct.errors,
      balanceBeforeWeek: base,
      zagPreview,
      /** Für Ruhezeit So→Mo: Sonntag Vorwoche (Client berechnet Hinweise live aus Grid) */
      prevSundayPlan: prevSundayByEmpPlan.get(e.id) ?? null,
      prevSundayActual: prevSundayByEmpActual.get(e.id) ?? null,
    };
  });

  return NextResponse.json({
    weekStart: weekStartStr,
    site: workSiteToParam(site),
    status: week.status,
    isoWeek: isoWeekNumberUTC(start),
    feiDaysInWeek,
    days,
    rows,
    laborLawDisclaimer: LABOR_LAW_DISCLAIMER_DE,
  });
}

const putSchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  site: z.enum(["CRUSH", "CAPPUCONE"]).optional().default("CRUSH"),
  cells: z.array(
    z.object({
      employeeId: z.string(),
      dayIndex: z.number().int().min(0).max(6),
      layer: z.enum(["PLAN", "ACTUAL"]),
      rawValue: z.string(),
      note: z.string().max(2000).optional().default(""),
    })
  ),
});

export async function PUT(req: Request) {
  try {
    const body = putSchema.parse(await req.json());
    const start = parseWeekStartParam(body.start);
    if (!start) {
      return NextResponse.json({ error: "Ungültiger Wochenstart." }, { status: 400 });
    }

    const site =
      body.site === "CAPPUCONE" ? WorkSite.CAPPUCONE : WorkSite.CRUSH;

    const week = await prisma.workWeek.findUnique({
      where: { weekStart_site: { weekStart: start, site } },
    });
    if (!week) {
      return NextResponse.json({ error: "Woche nicht gefunden." }, { status: 404 });
    }
    if (week.status === WeekStatus.CLOSED) {
      return NextResponse.json(
        { error: "Woche ist abgeschlossen und nicht änderbar." },
        { status: 400 }
      );
    }

    const employees = await prisma.employee.findMany({
      where: { active: true, ...employeeWhereForWorkSite(site) },
    });
    const allowed = new Set(employees.map((e) => e.id));
    for (const c of body.cells) {
      if (!allowed.has(c.employeeId)) {
        return NextResponse.json(
          { error: "Zelle für Mitarbeiter außerhalb dieses Standorts." },
          { status: 400 }
        );
      }
    }

    const allActualBefore = await prisma.shiftCell.findMany({
      where: { workWeekId: week.id, layer: ShiftLayer.ACTUAL },
      select: { employeeId: true, dayIndex: true, rawValue: true },
    });
    const beforeWeekArrays = new Map<string, string[]>();
    for (const e of employees) {
      beforeWeekArrays.set(e.id, Array(7).fill(""));
    }
    for (const c of allActualBefore) {
      const arr = beforeWeekArrays.get(c.employeeId);
      if (arr) arr[c.dayIndex] = c.rawValue;
    }
    const beforeU = new Map<string, number>();
    for (const e of employees) {
      const arr = beforeWeekArrays.get(e.id)!;
      beforeU.set(
        e.id,
        countVacationDaysInWeek(arr, e.contractHoursPerWeek, e.workDaysPerWeek)
      );
    }

    await prisma.$transaction(
      async (tx) => {
        await Promise.all(
          body.cells.map((c) => {
            const layer = c.layer === "PLAN" ? ShiftLayer.PLAN : ShiftLayer.ACTUAL;
            return tx.shiftCell.upsert({
              where: {
                workWeekId_employeeId_dayIndex_layer: {
                  workWeekId: week.id,
                  employeeId: c.employeeId,
                  dayIndex: c.dayIndex,
                  layer,
                },
              },
              create: {
                workWeekId: week.id,
                employeeId: c.employeeId,
                dayIndex: c.dayIndex,
                layer,
                rawValue: c.rawValue,
                note: c.note ?? "",
              },
              update: { rawValue: c.rawValue, note: c.note ?? "" },
            });
          })
        );

        const allActualAfter = await tx.shiftCell.findMany({
          where: { workWeekId: week.id, layer: ShiftLayer.ACTUAL },
          select: { employeeId: true, dayIndex: true, rawValue: true },
        });
        const afterWeekArrays = new Map<string, string[]>();
        for (const e of employees) {
          afterWeekArrays.set(e.id, Array(7).fill(""));
        }
        for (const c of allActualAfter) {
          const arr = afterWeekArrays.get(c.employeeId);
          if (arr) arr[c.dayIndex] = c.rawValue;
        }

        const vacationUpdates: Promise<unknown>[] = [];
        for (const e of employees) {
          const arr = afterWeekArrays.get(e.id)!;
          const afterU = countVacationDaysInWeek(
            arr,
            e.contractHoursPerWeek,
            e.workDaysPerWeek
          );
          const before = beforeU.get(e.id) ?? 0;
          const delta = before - afterU;
          if (delta !== 0) {
            vacationUpdates.push(
              tx.employee.update({
                where: { id: e.id },
                data: { vacationDaysOpen: { increment: delta } },
              })
            );
          }
        }
        if (vacationUpdates.length > 0) {
          await Promise.all(vacationUpdates);
        }
      },
      { maxWait: 10_000, timeout: 60_000 }
    );

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Ungültige Daten." }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ error: "Speichern fehlgeschlagen." }, { status: 500 });
  }
}
