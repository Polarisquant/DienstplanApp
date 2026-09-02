/**
 * Dry-Run der Gesamtkorrektur — NUR LESEND.
 *
 * Rechnet jede abgeschlossene Woche (Zeitkonto) und jedes Urlaubskonto mit den
 * neuen Regeln (Sechstel-Soll, einheitliche U-Zählung, Ist-Priorität) nach und
 * stellt die Ergebnisse den gespeicherten Buchungen gegenüber.
 *
 * Aufruf:  DB_URL="postgres://…" npx tsx scripts/dry-run-korrektur.ts
 */
import { PrismaClient, ShiftLayer, VacationLedgerKind, WeekStatus } from "@prisma/client";
import { computeWeeklyBalanceWithContracts } from "../src/lib/computeWeekly";
import type { ContractRow } from "../src/lib/employeeContract";
import { contractForDate } from "../src/lib/employeeContract";
import {
  employeeVisibleInWeek,
  employmentBoundsFromDates,
} from "../src/lib/employmentWeekTarget";
import { countVacationDaysInWeekWithPlanActual } from "../src/lib/vacation";
import { annualVacationDaysFromWorkDaysPerWeek } from "../src/lib/vacationAccrualAT";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DB_URL! } },
});

const iso = (d: Date) => d.toISOString().slice(0, 10);
const f2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

async function main() {
  const employees = await prisma.employee.findMany({
    include: { contracts: { orderBy: { effectiveFrom: "asc" } } },
    orderBy: { name: "asc" },
  });
  const weeks = await prisma.workWeek.findMany({ orderBy: [{ weekStart: "asc" }] });
  const cells = await prisma.shiftCell.findMany({
    select: { workWeekId: true, employeeId: true, dayIndex: true, layer: true, rawValue: true },
  });
  const lines = await prisma.timeAccountLine.findMany();
  const ledger = await prisma.vacationLedger.findMany({ orderBy: { createdAt: "asc" } });
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

  console.log("════════ TEIL A · ZEITKONTO (abgeschlossene Wochen, neue Sechstel-Regel) ════════\n");

  for (const e of employees) {
    const rows: ContractRow[] = e.contracts.map((c) => ({
      effectiveFrom: iso(c.effectiveFrom),
      contractHoursPerWeek: c.contractHoursPerWeek,
      workDaysPerWeek: c.workDaysPerWeek,
    }));
    if (rows.length === 0) {
      rows.push({
        effectiveFrom: "2000-01-01",
        contractHoursPerWeek: e.contractHoursPerWeek,
        workDaysPerWeek: e.workDaysPerWeek,
      });
    }
    const employment = employmentBoundsFromDates(e.entryDate, e.exitDate);
    const entryISO = e.entryDate ? iso(e.entryDate) : null;
    const exitISO = e.exitDate ? iso(e.exitDate) : null;

    const diffs: string[] = [];
    let totalCorrection = 0;
    for (const w of weeks) {
      if (w.status !== WeekStatus.CLOSED) continue;
      const ws = iso(w.weekStart);
      const stored = lineMap.get(`${e.id}|${w.id}`);
      const visible = employeeVisibleInWeek(ws, entryISO, exitISO);
      if (!visible) {
        if (stored) {
          diffs.push(
            `  ${ws} ${w.site}: Buchung ${f2(stored.weeklyDeltaHours)} h außerhalb der Beschäftigung → LÖSCHEN (${f2(-stored.weeklyDeltaHours)} h)`
          );
          totalCorrection += -stored.weeklyDeltaHours;
        }
        continue;
      }
      const actual = cellMap.get(cellKey(w.id, e.id, ShiftLayer.ACTUAL)) ?? Array(7).fill("");
      const hasLine = stored !== undefined;
      const hasCells = actual.some((c: string) => c.trim() !== "");
      if (!hasLine && !hasCells) continue;
      const holidayKeys = new Set(
        Array.from({ length: 7 }, (_, i) => {
          const d = new Date(w.weekStart);
          d.setUTCDate(d.getUTCDate() + i);
          return iso(d);
        }).filter((d) => holidaySet.has(d))
      );
      const { deltaVsContract } = computeWeeklyBalanceWithContracts(
        actual, ws, rows, holidayKeys, employment
      );
      const storedDelta = stored?.weeklyDeltaHours ?? null;
      if (storedDelta === null) {
        if (Math.abs(deltaVsContract) > 0.01) {
          diffs.push(`  ${ws} ${w.site}: keine Buchung, neu wäre ${f2(deltaVsContract)} h`);
          totalCorrection += deltaVsContract;
        }
        continue;
      }
      const d = deltaVsContract - storedDelta;
      if (Math.abs(d) > 0.01) {
        diffs.push(
          `  ${ws} ${w.site}: gebucht ${f2(storedDelta)} → neu ${f2(deltaVsContract)} (Δ ${f2(d)})`
        );
        totalCorrection += d;
      }
    }
    if (diffs.length > 0 || Math.abs(totalCorrection) > 0.01) {
      console.log(`${e.name}${e.active ? "" : " (inaktiv)"} — Zeitkonto-Korrektur gesamt: ${f2(totalCorrection)} h`);
      for (const d of diffs) console.log(d);
      console.log("");
    }
  }

  console.log("\n════════ TEIL B · URLAUB (Journal vs. zustandsbasierte Neuzählung) ════════\n");

  for (const e of employees) {
    const rows: ContractRow[] = e.contracts.map((c) => ({
      effectiveFrom: iso(c.effectiveFrom),
      contractHoursPerWeek: c.contractHoursPerWeek,
      workDaysPerWeek: c.workDaysPerWeek,
    }));
    if (rows.length === 0) {
      rows.push({
        effectiveFrom: "2000-01-01",
        contractHoursPerWeek: e.contractHoursPerWeek,
        workDaysPerWeek: e.workDaysPerWeek,
      });
    }
    const employment = employmentBoundsFromDates(e.entryDate, e.exitDate);
    const led = ledger.filter((l) => l.employeeId === e.id);
    if (led.length === 0 && e.vacationDaysOpen === 0) continue;

    const KORREKTUR_NOTE =
      "Systemkorrektur 2026-08 · Urlaubszählung vereinheitlicht (zustandsbasierte Neuzählung aus dem Dienstplan)";
    const sumKind = (k: VacationLedgerKind) =>
      led.filter((l) => l.kind === k).reduce((s, l) => s + l.amount, 0);
    const opening = sumKind(VacationLedgerKind.OPENING_MIGRATION);
    const openingRow = led.find((l) => l.kind === VacationLedgerKind.OPENING_MIGRATION);
    const openingISO = openingRow ? iso(openingRow.effectiveDate) : null;
    const accr = sumKind(VacationLedgerKind.MONTHLY_CONTRACT_ACCRUAL);
    const statutory = sumKind(VacationLedgerKind.STATUTORY_ACCRUAL);
    // Die Systemkorrektur gehört rechnerisch zur Verbrauchsseite, nicht zu „Manuell“
    const manual = led
      .filter(
        (l) =>
          l.kind === VacationLedgerKind.MANUAL_ADJUSTMENT &&
          l.note !== KORREKTUR_NOTE
      )
      .reduce((s, l) => s + l.amount, 0);
    const consBooked =
      sumKind(VacationLedgerKind.CONSUMPTION_ROTA) +
      led
        .filter(
          (l) =>
            l.kind === VacationLedgerKind.MANUAL_ADJUSTMENT &&
            l.note === KORREKTUR_NOTE
        )
        .reduce((s, l) => s + l.amount, 0);

    // Zustandsbasierte Neuzählung des Verbrauchs aus allen Wochen ab Eröffnung
    let consNew = 0;
    const consDetail: string[] = [];
    for (const w of weeks) {
      const ws = iso(w.weekStart);
      if (openingISO && ws < openingISO.slice(0, 8) + "01") continue; // Wochen vor Eröffnungsmonat
      const plan = cellMap.get(cellKey(w.id, e.id, ShiftLayer.PLAN)) ?? Array(7).fill("");
      const actual = cellMap.get(cellKey(w.id, e.id, ShiftLayer.ACTUAL)) ?? Array(7).fill("");
      if (!plan.some((c: string) => c.trim()) && !actual.some((c: string) => c.trim())) continue;
      const u = countVacationDaysInWeekWithPlanActual(plan, actual, ws, rows, employment);
      if (u > 0) {
        consNew += u;
        consDetail.push(`${ws} ${w.site}: ${u}`);
      }
    }

    const current = e.vacationDaysOpen;
    const ziel = opening + accr + statutory + manual - consNew;
    const korrektur = ziel - current;

    // Gutschrift-Nachprüfung: erwarteter Betrag je gebuchtem Monat (Vertrag des Monats)
    const accrChecks: string[] = [];
    for (const l of led) {
      if (l.kind !== VacationLedgerKind.MONTHLY_CONTRACT_ACCRUAL || !l.accrualPeriod) continue;
      const [y, m] = l.accrualPeriod.split("-").map(Number);
      const lastDay = new Date(Date.UTC(y!, m!, 0));
      const n = contractForDate(rows, iso(lastDay)).workDaysPerWeek;
      const expectedFull = Math.round((annualVacationDaysFromWorkDaysPerWeek(n) / 12) * 10000) / 10000;
      if (l.amount > expectedFull + 0.0001) {
        accrChecks.push(
          `  Gutschrift ${l.accrualPeriod}: gebucht ${l.amount} > erwartet ≤ ${expectedFull} (Vertrag ${n} AT/Wo)`
        );
      }
    }

    if (Math.abs(korrektur) > 0.005 || accrChecks.length > 0) {
      console.log(
        `${e.name}${e.active ? "" : " (inaktiv)"} — o.U. jetzt ${f2(current)} | Ziel ${f2(ziel)} | KORREKTUR ${f2(korrektur)}`
      );
      console.log(
        `  Journal: Eröffnung ${f2(opening)}${openingISO ? ` (${openingISO})` : ""} + Gutschriften ${f2(accr)}${statutory ? ` + Legacy ${f2(statutory)}` : ""} + Manuell ${f2(manual)} + Verbrauchs-Buchungen ${f2(consBooked)}`
      );
      console.log(`  Verbrauch neu gezählt (Ist-Priorität, Mo–Sa): ${f2(consNew)}  [${consDetail.join(" · ")}]`);
      for (const a of accrChecks) console.log(a);
      console.log("");
    }
  }

  console.log("Dry-Run beendet — es wurde nichts verändert.");
}

main().finally(() => prisma.$disconnect());
