import { addDaysISO } from "@/lib/dateNav";
import type { ContractRow } from "@/lib/employeeContract";
import { contractForDate } from "@/lib/employeeContract";
import {
  BUSINESS_DAYS_PER_WEEK,
  type EmploymentBounds,
  isEmployedCalendarDay,
} from "@/lib/employmentWeekTarget";

/**
 * Urlaubstage-Einheiten aus einer Zelle: nur **U** (nicht Krank **K**).
 * - `U` → 1 Tag
 * - `U(2)` → 2 / (Vertragsstunden/Arbeitstage) Tage (Teilurlaub)
 */
export function vacationDayUnitsFromCell(
  raw: string,
  contractHoursPerWeek: number,
  workDaysPerWeek: number
): number {
  const s = raw.replace(/\s+/g, " ").trim();
  if (!s.toUpperCase().startsWith("U")) return 0;

  const daily = contractHoursPerWeek / workDaysPerWeek;
  if (!(daily > 0) || !Number.isFinite(daily)) return 0;

  if (/^U\s*$/i.test(s)) return 1;

  const m = /^U\s*\(\s*([\d.,]+)\s*\)\s*$/i.exec(s);
  if (m) {
    const h = Number(m[1]!.replace(",", "."));
    if (!Number.isFinite(h) || h < 0) return 0;
    return h / daily;
  }
  return 0;
}

/** Summe Urlaubs-Tagesäquivalente über eine Zellen-Zeile (ohne Kalender-Kontext). */
export function countVacationDaysInWeek(
  cells: string[],
  contractHoursPerWeek: number,
  workDaysPerWeek: number
): number {
  let n = 0;
  for (const c of cells) {
    n += vacationDayUnitsFromCell(c, contractHoursPerWeek, workDaysPerWeek);
  }
  return n;
}

/** Hat die Ist-Zeile der Woche irgendeinen Inhalt? Dann gilt für Urlaub nur sie. */
export function actualRowHasContent(actualCells: string[]): boolean {
  return actualCells.some((c) => (c ?? "").trim() !== "");
}

/**
 * Urlaubs-Einheiten eines Kalendertags — eine Regel für alle Mitarbeiter:
 * - Sonntag (Index 6) zählt nie (Betrieb geschlossen, kein Betriebstag).
 * - Tage außerhalb des Beschäftigungszeitraums zählen nie.
 * - Sonst: `U` = 1 Tag, `U(x)` anteilig, mit dem an diesem Tag gültigen Vertrag.
 */
export function vacationDayUnitsForDate(
  raw: string,
  dateISO: string,
  dayIndexInWeek: number,
  contractRows: ContractRow[],
  employment?: EmploymentBounds
): number {
  if (dayIndexInWeek >= BUSINESS_DAYS_PER_WEEK) return 0;
  const entry = employment?.entryDateISO?.slice(0, 10) ?? null;
  const exit = employment?.exitDateISO?.slice(0, 10) ?? null;
  if (!isEmployedCalendarDay(dateISO, entry, exit)) return 0;
  const c = contractForDate(contractRows, dateISO);
  return vacationDayUnitsFromCell(raw, c.contractHoursPerWeek, c.workDaysPerWeek);
}

/**
 * Wochensumme Urlaub mit **wochenweiser Ist-Priorität**: Hat die Ist-Zeile
 * Inhalt, zählt nur sie — liegengebliebene Plan-Zellen werden ignoriert.
 * Ist die Ist-Zeile komplett leer (reine Vorausplanung), zählt der Plan.
 */
export function countVacationDaysInWeekWithPlanActual(
  planCells: string[],
  actualCells: string[],
  weekStartISO: string,
  contractRows: ContractRow[],
  employment?: EmploymentBounds
): number {
  const row = actualRowHasContent(actualCells) ? actualCells : planCells;
  let n = 0;
  for (let i = 0; i < BUSINESS_DAYS_PER_WEEK; i++) {
    const dateISO = addDaysISO(weekStartISO, i);
    n += vacationDayUnitsForDate(
      row[i] ?? "",
      dateISO,
      i,
      contractRows,
      employment
    );
  }
  return n;
}
