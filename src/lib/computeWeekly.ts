import { sumParsedWeekHours, sumParsedWeekHoursWithContracts } from "./parseShiftCell";
import type { ContractRow } from "./employeeContract";
import { weeklyProRataTarget } from "./employeeContract";

/**
 * Wochenberechnung mit Vertrags-Historie (tagesgenauer Vertrag in der KW).
 */
export function computeWeeklyBalanceWithContracts(
  dayCells: string[],
  weekStartISO: string,
  contractRows: ContractRow[],
  /** Gesetzliche Feiertage in dieser Woche (YYYY-MM-DD), für FT = Feiertagsentgelt-Stunden. */
  publicHolidayDates?: ReadonlySet<string>
): {
  weeklyHours: number;
  deltaVsContract: number;
  errors: string[];
} {
  const { hours, errors } = sumParsedWeekHoursWithContracts(
    dayCells,
    weekStartISO,
    contractRows,
    publicHolidayDates
  );
  const target = weeklyProRataTarget(contractRows, weekStartISO);
  return {
    weeklyHours: hours,
    deltaVsContract: hours - target,
    errors,
  };
}

/**
 * Wochenberechnung bei **einem** Vertrag (Tests, schmale Aufrufer).
 * - **deltaVsContract:** Ist-Summe − Wochenvertragsstunden (wie bisher).
 */
export function computeWeeklyBalance(
  dayCells: string[],
  contractHoursPerWeek: number,
  workDaysPerWeek: number
): {
  weeklyHours: number;
  deltaVsContract: number;
  errors: string[];
} {
  const { hours, errors } = sumParsedWeekHours(
    dayCells,
    contractHoursPerWeek,
    workDaysPerWeek
  );
  return {
    weeklyHours: hours,
    deltaVsContract: hours - contractHoursPerWeek,
    errors,
  };
}
