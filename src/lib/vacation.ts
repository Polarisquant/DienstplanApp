import { addDaysISO } from "@/lib/dateNav";
import type { ContractRow } from "@/lib/employeeContract";
import { contractForDate } from "@/lib/employeeContract";

/**
 * Urlaubstage-Einheiten für Ist-Zeile: nur **U** (nicht Krank **K**).
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

/** Summe Urlaubs-Tagesäquivalente in der Woche (Ist-Zeile, nur Einträge mit führendem U). */
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

/** Pro Tag der Vertrag, der an diesem Kalendertag gilt. */
export function countVacationDaysInWeekWithContracts(
  cells: string[],
  weekStartISO: string,
  contractRows: ContractRow[]
): number {
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const dateISO = addDaysISO(weekStartISO, i);
    const c = contractForDate(contractRows, dateISO);
    n += vacationDayUnitsFromCell(
      cells[i] ?? "",
      c.contractHoursPerWeek,
      c.workDaysPerWeek
    );
  }
  return n;
}

/**
 * Urlaub fürs Konto: pro Tag zählt **Ist**, sobald die Ist-Zelle nicht leer ist
 * (auch K/ZA — dann kein Plan-Urlaub). Ist leer → **Plan**-Urlaub (nur-Plan-Pflege).
 */
export function vacationDayUnitsForDayPlanActual(
  planRaw: string,
  actualRaw: string,
  contractHoursPerWeek: number,
  workDaysPerWeek: number
): number {
  const actualTrim = actualRaw.replace(/\s+/g, " ").trim();
  if (actualTrim !== "") {
    return vacationDayUnitsFromCell(actualRaw, contractHoursPerWeek, workDaysPerWeek);
  }
  return vacationDayUnitsFromCell(planRaw, contractHoursPerWeek, workDaysPerWeek);
}

/** Wochensumme mit Plan+Ist-Logik (siehe `vacationDayUnitsForDayPlanActual`). */
export function countVacationDaysInWeekWithPlanActual(
  planCells: string[],
  actualCells: string[],
  weekStartISO: string,
  contractRows: ContractRow[]
): number {
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const dateISO = addDaysISO(weekStartISO, i);
    const c = contractForDate(contractRows, dateISO);
    n += vacationDayUnitsForDayPlanActual(
      planCells[i] ?? "",
      actualCells[i] ?? "",
      c.contractHoursPerWeek,
      c.workDaysPerWeek
    );
  }
  return n;
}
