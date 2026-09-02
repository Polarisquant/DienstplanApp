/**
 * Anwendung der freigegebenen Gesamtkorrektur (Schritt 5 des Korrektur-Fahrplans).
 *
 * 1. Zeitkonto: alle abgeschlossenen Wochen mit der neuen Logik neu berechnen,
 *    Buchungszeilen angleichen, Salden-Ketten je Standort neu aufbauen.
 * 2. Urlaub: je Mitarbeiter eine dokumentierte Journal-Korrektur auf den
 *    zustandsbasiert neu gezählten Zielwert; Yvonne zusätzlich +2,13
 *    Eröffnungskorrektur (Lohnbüro-Stand 31.03.2026 = 19,03).
 *
 * Aufruf: DB_URL="postgres://…" npx tsx scripts/apply-korrektur.ts --apply
 * Ohne --apply: reine Vorschau.
 */
import {
  PrismaClient,
  ShiftLayer,
  VacationLedgerKind,
  WeekStatus,
  WorkSite,
} from "@prisma/client";
import { computeWeeklyBalanceWithContracts } from "../src/lib/computeWeekly";
import type { ContractRow } from "../src/lib/employeeContract";
import {
  employeeVisibleInWeek,
  employmentBoundsFromDates,
} from "../src/lib/employmentWeekTarget";
import { countVacationDaysInWeekWithPlanActual } from "../src/lib/vacation";

const APPLY = process.argv.includes("--apply");
const KORREKTUR_NOTE = "Systemkorrektur 2026-08 · Urlaubszählung vereinheitlicht (zustandsbasierte Neuzählung aus dem Dienstplan)";
const YVONNE_NOTE = "Eröffnungskorrektur laut Lohnbüro-Stand 31.03.2026 (19,03 statt 16,90)";

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DB_URL! } } });
const iso = (d: Date) => d.toISOString().slice(0, 10);
const f2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

async function main() {
  console.log(APPLY ? "== ANWENDEN ==" : "== VORSCHAU (ohne --apply wird nichts geändert) ==");

  const employees = await prisma.employee.findMany({
    include: { contracts: { orderBy: { effectiveFrom: "asc" } } },
    orderBy: { name: "asc" },
  });
  const weeks = await prisma.workWeek.findMany({ orderBy: [{ weekStart: "asc" }] });
  const closedWeeks = weeks.filter((w) => w.status === WeekStatus.CLOSED);
  const cells = await prisma.shiftCell.findMany({
    select: { workWeekId: true, employeeId: true, dayIndex: true, layer: true, rawValue: true },
  });
  const lines = await prisma.timeAccountLine.findMany();
  const holidays = await prisma.holiday.findMany({ where: { includedInPlan: true } });
  const holidaySet = new Set(holidays.map((h) => iso(h.date)));

  const cellKey = (wid: string, emp: string, layer: ShiftLayer) => `${wid}|${emp}|${layer}`;
  const cellMap = new Map<string, string[]>();
  for (const c of cells) {
    const k = cellKey(c.workWeekId, c.employeeId, c.layer);
    const arr = cellMap.get(k) ?? Array(7).fill("");
    arr[c.dayIndex] = c.rawValue;
    cellMap.set(k, arr);
  }
  const lineMap = new Map<string, (typeof lines)[number]>();
  for (const l of lines) lineMap.set(`${l.employeeId}|${l.workWeekId}`, l);

  const rowsFor = (e: (typeof employees)[number]): ContractRow[] => {
    const rows = e.contracts.map((c) => ({
      effectiveFrom: iso(c.effectiveFrom),
      contractHoursPerWeek: c.contractHoursPerWeek,
      workDaysPerWeek: c.workDaysPerWeek,
    }));
    return rows.length
      ? rows
      : [{ effectiveFrom: "2000-01-01", contractHoursPerWeek: e.contractHoursPerWeek, workDaysPerWeek: e.workDaysPerWeek }];
  };

  // ---------- TEIL A · Zeitkonto ----------
  let upserts = 0, deletions = 0;
  for (const e of employees) {
    const rows = rowsFor(e);
    const employment = employmentBoundsFromDates(e.entryDate, e.exitDate);
    const entryISO = e.entryDate ? iso(e.entryDate) : null;
    const exitISO = e.exitDate ? iso(e.exitDate) : null;

    for (const w of closedWeeks) {
      const ws = iso(w.weekStart);
      const stored = lineMap.get(`${e.id}|${w.id}`);
      const actual = cellMap.get(cellKey(w.id, e.id, ShiftLayer.ACTUAL)) ?? Array(7).fill("");
      const hasCells = actual.some((c: string) => c.trim() !== "");
      if (!stored && !hasCells) continue;

      if (!employeeVisibleInWeek(ws, entryISO, exitISO)) {
        if (stored) {
          console.log(`A  ${e.name} ${ws} ${w.site}: Zeile außerhalb Beschäftigung → löschen (${f2(stored.weeklyDeltaHours)})`);
          if (APPLY) await prisma.timeAccountLine.delete({ where: { id: stored.id } });
          deletions++;
        }
        continue;
      }

      const holidayKeys = new Set(
        Array.from({ length: 7 }, (_, i) => {
          const d = new Date(w.weekStart);
          d.setUTCDate(d.getUTCDate() + i);
          return iso(d);
        }).filter((d) => holidaySet.has(d))
      );
      const { deltaVsContract } = computeWeeklyBalanceWithContracts(actual, ws, rows, holidayKeys, employment);
      const old = stored?.weeklyDeltaHours;
      if (old === undefined || Math.abs(deltaVsContract - old) > 0.005) {
        console.log(`A  ${e.name} ${ws} ${w.site}: ${old === undefined ? "neu" : f2(old)} → ${f2(deltaVsContract)}`);
        if (APPLY) {
          await prisma.timeAccountLine.upsert({
            where: { employeeId_workWeekId: { employeeId: e.id, workWeekId: w.id } },
            create: {
              employeeId: e.id, workWeekId: w.id,
              weeklyDeltaHours: deltaVsContract, balanceAfter: 0, source: "IST_CLOSED",
            },
            update: { weeklyDeltaHours: deltaVsContract },
          });
        }
        upserts++;
      }
    }
  }

  // Salden-Ketten je Standort neu aufbauen (Startsaldo + kumulierte Deltas der Filiale)
  if (APPLY) {
    const freshLines = await prisma.timeAccountLine.findMany();
    const freshMap = new Map<string, (typeof freshLines)[number]>();
    for (const l of freshLines) freshMap.set(`${l.employeeId}|${l.workWeekId}`, l);
    for (const e of employees) {
      for (const site of [WorkSite.CRUSH, WorkSite.CAPPUCONE]) {
        let bal = e.startBalanceHours;
        for (const w of closedWeeks.filter((x) => x.site === site)) {
          const l = freshMap.get(`${e.id}|${w.id}`);
          if (!l) continue;
          bal += l.weeklyDeltaHours;
          if (Math.abs(l.balanceAfter - bal) > 0.005) {
            await prisma.timeAccountLine.update({ where: { id: l.id }, data: { balanceAfter: bal } });
          }
        }
      }
    }
    console.log("A  Salden-Ketten neu aufgebaut.");
  }

  // ---------- TEIL B · Urlaub ----------
  const ledger = await prisma.vacationLedger.findMany();
  for (const e of employees) {
    const led = ledger.filter((l) => l.employeeId === e.id);
    const already = led.some((l) => l.note === KORREKTUR_NOTE);
    if (already) {
      console.log(`B  ${e.name}: Systemkorrektur existiert bereits — übersprungen.`);
      continue;
    }
    const sumKind = (k: VacationLedgerKind) => led.filter((l) => l.kind === k).reduce((s, l) => s + l.amount, 0);
    const nonConsumption =
      sumKind(VacationLedgerKind.OPENING_MIGRATION) +
      sumKind(VacationLedgerKind.MONTHLY_CONTRACT_ACCRUAL) +
      sumKind(VacationLedgerKind.STATUTORY_ACCRUAL) +
      sumKind(VacationLedgerKind.MANUAL_ADJUSTMENT);
    const openingRow = led.find((l) => l.kind === VacationLedgerKind.OPENING_MIGRATION);
    const openingISO = openingRow ? iso(openingRow.effectiveDate) : null;

    const rows = rowsFor(e);
    const employment = employmentBoundsFromDates(e.entryDate, e.exitDate);
    let consNew = 0;
    for (const w of weeks) {
      const ws = iso(w.weekStart);
      if (openingISO && ws < openingISO.slice(0, 8) + "01") continue;
      const plan = cellMap.get(cellKey(w.id, e.id, ShiftLayer.PLAN)) ?? Array(7).fill("");
      const actual = cellMap.get(cellKey(w.id, e.id, ShiftLayer.ACTUAL)) ?? Array(7).fill("");
      if (!plan.some((c: string) => c.trim()) && !actual.some((c: string) => c.trim())) continue;
      consNew += countVacationDaysInWeekWithPlanActual(plan, actual, ws, rows, employment);
    }

    const yvonneFix = e.name.startsWith("Yvonne") ? 2.13 : 0;
    const ziel = nonConsumption - consNew;
    const korrektur = Math.round((ziel - e.vacationDaysOpen) * 10000) / 10000;
    if (Math.abs(korrektur) < 0.005 && yvonneFix === 0) continue;

    console.log(
      `B  ${e.name}: o.U. ${f2(e.vacationDaysOpen)} → ${f2(ziel + yvonneFix)}  (Korrektur ${f2(korrektur)}${yvonneFix ? ` + Eröffnung ${f2(yvonneFix)}` : ""})`
    );
    if (APPLY) {
      await prisma.$transaction(async (tx) => {
        const eff = new Date("2026-08-27T12:00:00.000Z");
        if (yvonneFix) {
          await tx.vacationLedger.create({
            data: {
              employeeId: e.id, amount: yvonneFix,
              kind: VacationLedgerKind.MANUAL_ADJUSTMENT,
              note: YVONNE_NOTE, effectiveDate: eff,
            },
          });
        }
        if (Math.abs(korrektur) >= 0.005) {
          await tx.vacationLedger.create({
            data: {
              employeeId: e.id, amount: korrektur,
              kind: VacationLedgerKind.MANUAL_ADJUSTMENT,
              note: KORREKTUR_NOTE, effectiveDate: eff,
            },
          });
        }
        await tx.employee.update({
          where: { id: e.id },
          data: { vacationDaysOpen: { increment: korrektur + yvonneFix } },
        });
      });
    }
  }

  console.log(`\nFertig. Zeitkonto: ${upserts} Zeilen angeglichen, ${deletions} gelöscht.${APPLY ? "" : " (Vorschau — nichts geändert)"}`);
}

main().finally(() => prisma.$disconnect());
