import { NextResponse } from "next/server";
import { ShiftLayer, WeekStatus, WorkSite } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { addDaysISO } from "@/lib/dateNav";
import { formatWeekStart } from "@/lib/weekUtils";
import { computeWeeklyBalanceWithContracts } from "@/lib/computeWeekly";
import { contractRowsMapForEmployees } from "@/lib/employeeContractLoad";
import {
  employeeVisibleInWeek,
  employmentBoundsFromDates,
} from "@/lib/employmentWeekTarget";
import { buildHolidayMap } from "@/lib/holidays";
import { holidayDateKeysFromMap } from "@/lib/schoolBreaks";
import { VacationLedgerKind } from "@prisma/client";

type Params = { params: { id: string } };

/**
 * Korrigiert Zeitkonto-Zeilen vor Eintritt und setzt Urlaub auf 0,
 * wenn Fehlbuchungen aus der alten Logik vorliegen.
 */
export async function POST(req: Request, context: Params) {
  try {
    const { id: employeeId } = context.params;
    const body = (await req.json().catch(() => ({}))) as { site?: string };
    const site =
      body.site === "CAPPUCONE" ? WorkSite.CAPPUCONE : WorkSite.CRUSH;

    const emp = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!emp) {
      return NextResponse.json({ error: "Mitarbeiter nicht gefunden." }, { status: 404 });
    }

    const entryISO = emp.entryDate ? emp.entryDate.toISOString().slice(0, 10) : null;
    const exitISO = emp.exitDate ? emp.exitDate.toISOString().slice(0, 10) : null;
    const employment = employmentBoundsFromDates(emp.entryDate, emp.exitDate);

    const closedWeeks = await prisma.workWeek.findMany({
      where: { site, status: WeekStatus.CLOSED },
      orderBy: { weekStart: "asc" },
    });

    const contractMap = await contractRowsMapForEmployees([employeeId]);
    const contractRows = contractMap.get(employeeId) ?? [];

    let deletedLines = 0;
    const deletedWeeks: string[] = [];

    await prisma.$transaction(async (tx) => {
      for (const ww of closedWeeks) {
        const weekStartISO = formatWeekStart(ww.weekStart);
        if (!employeeVisibleInWeek(weekStartISO, entryISO, exitISO)) {
          const r = await tx.timeAccountLine.deleteMany({
            where: { employeeId, workWeekId: ww.id },
          });
          if (r.count > 0) {
            deletedLines += r.count;
            deletedWeeks.push(weekStartISO);
          }
        }
      }

      let balance = emp.startBalanceHours;
      const recalculated: { weekStart: string; delta: number; balanceAfter: number }[] =
        [];

      for (const ww of closedWeeks) {
        const weekStartISO = formatWeekStart(ww.weekStart);
        if (!employeeVisibleInWeek(weekStartISO, entryISO, exitISO)) continue;

        const lastDayStr = addDaysISO(weekStartISO, 6);
        const holidayRows = await tx.holiday.findMany({
          where: {
            includedInPlan: true,
            date: {
              gte: new Date(`${weekStartISO}T00:00:00.000Z`),
              lte: new Date(`${lastDayStr}T23:59:59.999Z`),
            },
          },
        });
        const holidayKeys = holidayDateKeysFromMap(
          weekStartISO,
          buildHolidayMap(holidayRows)
        );

        const cellsDb = await tx.shiftCell.findMany({
          where: { workWeekId: ww.id, employeeId, layer: ShiftLayer.ACTUAL },
        });
        const arr = Array(7).fill("");
        for (const c of cellsDb) arr[c.dayIndex] = c.rawValue;

        const { deltaVsContract } = computeWeeklyBalanceWithContracts(
          arr,
          weekStartISO,
          contractRows,
          holidayKeys,
          employment
        );
        balance += deltaVsContract;

        await tx.timeAccountLine.upsert({
          where: { employeeId_workWeekId: { employeeId, workWeekId: ww.id } },
          create: {
            employeeId,
            workWeekId: ww.id,
            weeklyDeltaHours: deltaVsContract,
            balanceAfter: balance,
            source: "IST_CLOSED",
          },
          update: {
            weeklyDeltaHours: deltaVsContract,
            balanceAfter: balance,
            source: "IST_CLOSED",
          },
        });
        recalculated.push({
          weekStart: weekStartISO,
          delta: deltaVsContract,
          balanceAfter: balance,
        });
      }

      if (emp.vacationDaysOpen !== 0) {
        const diff = 0 - emp.vacationDaysOpen;
        await tx.vacationLedger.create({
          data: {
            employeeId,
            amount: diff,
            kind: VacationLedgerKind.MANUAL_ADJUSTMENT,
            note: "Korrektur Eintrittslogik (Fehlbuchung / Urlaub vor Gutschrift)",
            effectiveDate: new Date(),
          },
        });
        await tx.employee.update({
          where: { id: employeeId },
          data: { vacationDaysOpen: 0 },
        });
      }
    });

    const fresh = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });

    return NextResponse.json({
      ok: true,
      employeeId,
      name: fresh.name,
      deletedLines,
      deletedWeeks,
      vacationDaysOpen: fresh.vacationDaysOpen,
      message:
        "Zeitkonto neu berechnet (nur ab Eintrittswoche). Urlaub auf 0 gesetzt falls nötig.",
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Korrektur fehlgeschlagen." }, { status: 500 });
  }
}
