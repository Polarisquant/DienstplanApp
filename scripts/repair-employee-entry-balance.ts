/**
 * Korrigiert Zeitkonto- und Urlaubs-Buchungen für einen Mitarbeiter nach Eintrittsdatum.
 *
 * Usage (Production Neon):
 *   DATABASE_URL="postgresql://..." npx tsx scripts/repair-employee-entry-balance.ts <employeeId> [site]
 *
 * Beispiel Pia Six:
 *   DATABASE_URL="..." npx tsx scripts/repair-employee-entry-balance.ts cmr0ided800s2kz04k7a1ywca CRUSH
 */
import { PrismaClient, ShiftLayer, WeekStatus, WorkSite } from "@prisma/client";
import { formatWeekStart } from "../src/lib/weekUtils";
import { addDaysISO } from "../src/lib/dateNav";
import { computeWeeklyBalanceWithContracts } from "../src/lib/computeWeekly";
import { contractRowsMapForEmployees } from "../src/lib/employeeContractLoad";
import {
  employeeVisibleInWeek,
  employmentBoundsFromDates,
} from "../src/lib/employmentWeekTarget";
import { buildHolidayMap } from "../src/lib/holidays";
import { holidayDateKeysFromMap } from "../src/lib/schoolBreaks";

const prisma = new PrismaClient();

async function main() {
  const employeeId = process.argv[2];
  const siteArg = (process.argv[3] ?? "CRUSH").toUpperCase();
  const site = siteArg === "CAPPUCONE" ? WorkSite.CAPPUCONE : WorkSite.CRUSH;

  if (!employeeId) {
    console.error("Usage: npx tsx scripts/repair-employee-entry-balance.ts <employeeId> [CRUSH|CAPPUCONE]");
    process.exit(1);
  }

  const emp = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
  const entryISO = emp.entryDate ? emp.entryDate.toISOString().slice(0, 10) : null;
  const exitISO = emp.exitDate ? emp.exitDate.toISOString().slice(0, 10) : null;
  const employment = employmentBoundsFromDates(emp.entryDate, emp.exitDate);

  console.log(`Repair: ${emp.name} (${employeeId}), Eintritt ${entryISO ?? "—"}, Standort ${site}`);

  const closedWeeks = await prisma.workWeek.findMany({
    where: { site, status: WeekStatus.CLOSED },
    orderBy: { weekStart: "asc" },
  });

  const contractMap = await contractRowsMapForEmployees([employeeId]);
  const contractRows = contractMap.get(employeeId) ?? [];

  let deleted = 0;
  for (const ww of closedWeeks) {
    const weekStartISO = formatWeekStart(ww.weekStart);
    if (!employeeVisibleInWeek(weekStartISO, entryISO, exitISO)) {
      const r = await prisma.timeAccountLine.deleteMany({
        where: { employeeId, workWeekId: ww.id },
      });
      if (r.count > 0) {
        console.log(`  Gelöscht: KW ${weekStartISO} (${r.count} Zeile)`);
        deleted += r.count;
      }
    }
  }

  const remaining = closedWeeks.filter((ww) =>
    employeeVisibleInWeek(formatWeekStart(ww.weekStart), entryISO, exitISO)
  );

  let balance = emp.startBalanceHours;
  let updated = 0;
  for (const ww of remaining) {
    const weekStartISO = formatWeekStart(ww.weekStart);
    const lastDayStr = addDaysISO(weekStartISO, 6);
    const holidayRows = await prisma.holiday.findMany({
      where: {
        includedInPlan: true,
        date: {
          gte: new Date(`${weekStartISO}T00:00:00.000Z`),
          lte: new Date(`${lastDayStr}T23:59:59.999Z`),
        },
      },
    });
    const holidayKeys = holidayDateKeysFromMap(weekStartISO, buildHolidayMap(holidayRows));

    const cellsDb = await prisma.shiftCell.findMany({
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

    await prisma.timeAccountLine.upsert({
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
    console.log(
      `  Neu: KW ${weekStartISO} delta=${deltaVsContract.toFixed(2)} balanceAfter=${balance.toFixed(2)}`
    );
    updated += 1;
  }

  if (emp.vacationDaysOpen !== 0) {
    const diff = 0 - emp.vacationDaysOpen;
    await prisma.$transaction(async (tx) => {
      await tx.vacationLedger.create({
        data: {
          employeeId,
          amount: diff,
          kind: "MANUAL_ADJUSTMENT",
          note: "Korrektur: Urlaub vor Eintritt / Fehlbuchung",
          effectiveDate: new Date(),
        },
      });
      await tx.employee.update({
        where: { id: employeeId },
        data: { vacationDaysOpen: 0 },
      });
    });
    console.log(`  Urlaub korrigiert: ${emp.vacationDaysOpen} → 0`);
  }

  console.log(`Fertig. Gelöscht: ${deleted}, neu berechnet: ${updated}, Saldo: ${balance.toFixed(2)} h`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
