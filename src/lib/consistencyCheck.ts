import {
  type PrismaClient,
  ShiftLayer,
  VacationLedgerKind,
  WeekStatus,
  WorkSite,
} from "@prisma/client";
import { computeWeeklyBalanceWithContracts } from "@/lib/computeWeekly";
import type { ContractRow } from "@/lib/employeeContract";
import {
  employeeVisibleInWeek,
  employmentBoundsFromDates,
} from "@/lib/employmentWeekTarget";
import { countVacationDaysInWeekWithPlanActual } from "@/lib/vacation";

/** Buchungs-Notiz der einmaligen Systemkorrektur — zählt rechnerisch zur Verbrauchsseite. */
export const SYSTEMKORREKTUR_NOTE =
  "Systemkorrektur 2026-08 · Urlaubszählung vereinheitlicht (zustandsbasierte Neuzählung aus dem Dienstplan)";

export type ConsistencyIssue = {
  employee: string;
  bereich: "urlaub" | "zeitkonto";
  text: string;
};

export type ConsistencyResult = {
  checkedAt: string;
  employees: number;
  issues: ConsistencyIssue[];
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const f2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const deDate = (isoStr: string) => isoStr.split("-").reverse().join(".");

/**
 * Dauer-Abgleich: prüft für alle Mitarbeiter
 * 1. Zeitkonto: gespeicherte Wochen-Deltas und Salden-Ketten gegen die Neuberechnung aus den Ist-Zellen,
 * 2. Urlaub: Journal-Summe gegen den Saldo und die Verbrauchsseite des Journals gegen die Dienstplan-Zählung.
 * Nur lesend; dieselben Rechenfunktionen wie die App selbst.
 */
export async function runConsistencyCheck(
  prisma: PrismaClient
): Promise<ConsistencyResult> {
  const [employees, weeks, cells, lines, ledger, holidays] = await Promise.all([
    prisma.employee.findMany({
      include: { contracts: { orderBy: { effectiveFrom: "asc" } } },
      orderBy: { name: "asc" },
    }),
    prisma.workWeek.findMany({ orderBy: [{ weekStart: "asc" }] }),
    prisma.shiftCell.findMany({
      select: {
        workWeekId: true,
        employeeId: true,
        dayIndex: true,
        layer: true,
        rawValue: true,
      },
    }),
    prisma.timeAccountLine.findMany(),
    prisma.vacationLedger.findMany(),
    prisma.holiday.findMany({ where: { includedInPlan: true }, select: { date: true } }),
  ]);

  const holidaySet = new Set(holidays.map((h) => iso(h.date)));
  const closedWeeks = weeks.filter((w) => w.status === WeekStatus.CLOSED);

  const cellKey = (wid: string, emp: string, layer: ShiftLayer) =>
    `${wid}|${emp}|${layer}`;
  const cellMap = new Map<string, string[]>();
  for (const c of cells) {
    const k = cellKey(c.workWeekId, c.employeeId, c.layer);
    const arr = cellMap.get(k) ?? Array(7).fill("");
    arr[c.dayIndex] = c.rawValue;
    cellMap.set(k, arr);
  }
  const lineMap = new Map<string, (typeof lines)[number]>();
  for (const l of lines) lineMap.set(`${l.employeeId}|${l.workWeekId}`, l);

  const issues: ConsistencyIssue[] = [];

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

    // ---- Zeitkonto: Deltas ----
    for (const w of closedWeeks) {
      const ws = iso(w.weekStart);
      const stored = lineMap.get(`${e.id}|${w.id}`);
      const actual =
        cellMap.get(cellKey(w.id, e.id, ShiftLayer.ACTUAL)) ?? Array(7).fill("");
      const hasCells = actual.some((c: string) => c.trim() !== "");
      if (!stored && !hasCells) continue;

      if (!employeeVisibleInWeek(ws, entryISO, exitISO)) {
        if (stored) {
          issues.push({
            employee: e.name,
            bereich: "zeitkonto",
            text: `Buchung KW ${deDate(ws)} liegt außerhalb der Beschäftigung (${f2(stored.weeklyDeltaHours)} h).`,
          });
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
      const { deltaVsContract } = computeWeeklyBalanceWithContracts(
        actual,
        ws,
        rows,
        holidayKeys,
        employment
      );
      const storedDelta = stored?.weeklyDeltaHours;
      if (storedDelta === undefined) {
        if (Math.abs(deltaVsContract) > 0.02) {
          issues.push({
            employee: e.name,
            bereich: "zeitkonto",
            text: `KW ${deDate(ws)} (${w.site === WorkSite.CRUSH ? "Crush" : "CappuCone"}) ist abgeschlossen, aber nicht gebucht (berechnet ${f2(deltaVsContract)} h).`,
          });
        }
      } else if (Math.abs(deltaVsContract - storedDelta) > 0.02) {
        issues.push({
          employee: e.name,
          bereich: "zeitkonto",
          text: `Zeitkonto KW ${deDate(ws)} weicht ${f2(Math.abs(deltaVsContract - storedDelta))} h von der Neuberechnung ab (gebucht ${f2(storedDelta)}, berechnet ${f2(deltaVsContract)}).`,
        });
      }
    }

    // ---- Zeitkonto: Salden-Ketten je Standort ----
    for (const site of [WorkSite.CRUSH, WorkSite.CAPPUCONE]) {
      let bal = e.startBalanceHours;
      for (const w of closedWeeks.filter((x) => x.site === site)) {
        const l = lineMap.get(`${e.id}|${w.id}`);
        if (!l) continue;
        bal += l.weeklyDeltaHours;
        if (Math.abs(l.balanceAfter - bal) > 0.02) {
          issues.push({
            employee: e.name,
            bereich: "zeitkonto",
            text: `Salden-Kette ${site === WorkSite.CRUSH ? "Crush" : "CappuCone"} bricht in KW ${deDate(iso(w.weekStart))} (gespeichert ${f2(l.balanceAfter)}, erwartet ${f2(bal)}).`,
          });
          break;
        }
      }
    }

    // ---- Urlaub ----
    const led = ledger.filter((l) => l.employeeId === e.id);
    if (led.length > 0 || e.vacationDaysOpen !== 0) {
      const sumAll = led.reduce((s, l) => s + l.amount, 0);
      if (Math.abs(sumAll - e.vacationDaysOpen) > 0.01) {
        issues.push({
          employee: e.name,
          bereich: "urlaub",
          text: `Journal-Summe (${f2(sumAll)}) ≠ angezeigter Saldo (${f2(e.vacationDaysOpen)}).`,
        });
      }

      const consSide = led
        .filter(
          (l) =>
            l.kind === VacationLedgerKind.CONSUMPTION_ROTA ||
            (l.kind === VacationLedgerKind.MANUAL_ADJUSTMENT &&
              l.note === SYSTEMKORREKTUR_NOTE)
        )
        .reduce((s, l) => s + l.amount, 0);

      const openingRow = led.find(
        (l) => l.kind === VacationLedgerKind.OPENING_MIGRATION
      );
      const openingISO = openingRow ? iso(openingRow.effectiveDate) : null;

      let consNew = 0;
      for (const w of weeks) {
        const ws = iso(w.weekStart);
        if (openingISO && ws < openingISO.slice(0, 8) + "01") continue;
        const plan =
          cellMap.get(cellKey(w.id, e.id, ShiftLayer.PLAN)) ?? Array(7).fill("");
        const actual =
          cellMap.get(cellKey(w.id, e.id, ShiftLayer.ACTUAL)) ?? Array(7).fill("");
        if (
          !plan.some((c: string) => c.trim()) &&
          !actual.some((c: string) => c.trim())
        )
          continue;
        consNew += countVacationDaysInWeekWithPlanActual(
          plan,
          actual,
          ws,
          rows,
          employment
        );
      }

      const diff = consSide + consNew; // Verbrauchsseite soll −consNew sein
      if (Math.abs(diff) > 0.01) {
        issues.push({
          employee: e.name,
          bereich: "urlaub",
          text: `Urlaubs-Journal weicht ${f2(Math.abs(diff))} T von der Dienstplan-Zählung ab (Journal-Verbrauch ${f2(-consSide)}, Dienstplan ${f2(consNew)}).`,
        });
      }
    }
  }

  return {
    checkedAt: new Date().toISOString(),
    employees: employees.length,
    issues,
  };
}
