import { sumParsedWeekHours, sumParsedWeekHoursWithContracts } from "./parseShiftCell";
import type { ContractRow } from "./employeeContract";
import {
  type EmploymentBounds,
  weeklyContractTargetForEmployment,
} from "./employmentWeekTarget";

/**
 * Wochenberechnung mit Vertrags-Historie (tagesgenauer Vertrag in der KW).
 */
export function computeWeeklyBalanceWithContracts(
  dayCells: string[],
  weekStartISO: string,
  contractRows: ContractRow[],
  /** Gesetzliche Feiertage in dieser Woche (YYYY-MM-DD), für FT = Feiertagsentgelt-Stunden. */
  publicHolidayDates?: ReadonlySet<string>,
  /** Mit Eintritt/Austritt: anteiliges Soll nur an beschäftigten Vertrags-Arbeitstagen. */
  employment?: EmploymentBounds
): {
  weeklyHours: number;
  deltaVsContract: number;
  errors: string[];
} {
  const { hours, errors } = sumParsedWeekHoursWithContracts(
    dayCells,
    weekStartISO,
    contractRows,
    publicHolidayDates,
    employment
  );
  const target = weeklyContractTargetForEmployment(
    contractRows,
    weekStartISO,
    employment
  );
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
