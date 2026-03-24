import { sumParsedWeekHours } from "./parseShiftCell";

/**
 * Wochenberechnung aus den 7 Tageszellen.
 * - **weeklyHours:** Summe der (Netto-)Arbeitsstunden in der Woche — „ab 0“, ohne Abzug der Vertragswoche.
 * - **deltaVsContract:** Differenz zur Vertragssoll-Woche (Summe − Vertragsstunden); fließt ins Zeitkonto / ZAG.
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
