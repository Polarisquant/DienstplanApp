/**
 * Jahresurlaub in **Arbeitstagen** nach der Regel **5 Wochen Urlaub × Arbeitstage/Woche**.
 *
 * - 5-Tage-Woche → 25 Tage/Jahr, 6-Tage-Woche → 30 Tage/Jahr, 2 Tage/Woche → 10 Tage/Jahr usw.
 * - **Formel:** `min(Arbeitstage/Woche, 6) × 5` (Werte >6 wie 6-Tage-Vollzeit = 30 Tage).
 * - **Wochenstunden** steuern **nicht** die Anzahl der Urlaubstage (nur Lohn je Urlaubstag im Payroll).
 *
 * Keine Rechtsberatung — Sonderfälle (unregelmäßige Wochen, 6. Urlaubswoche ab 25 J.) sind nicht modelliert.
 * Monatliche Gutschrift anteilig nach Kalendertagen siehe `vacationLedger.ts`.
 */

function roundVacationDays(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Jahresurlaub in Tagen nur aus **Arbeitstagen pro Woche** (5 Urlaubswochen).
 */
export function annualVacationDaysFromWorkDaysPerWeek(workDaysPerWeek: number): number {
  const wd = workDaysPerWeek;
  if (wd <= 0) return 0;
  return roundVacationDays(Math.min(wd, 6) * 5);
}

/**
 * Wie `annualVacationDaysFromWorkDaysPerWeek` — Parameter `contractHoursPerWeek` wird für die **Tagesanzahl**
 * nicht verwendet (API-/Stammdaten-Kompatibilität).
 */
export function annualVacationDaysProportional(
  workDaysPerWeek: number,
  _contractHoursPerWeek: number
): number {
  return annualVacationDaysFromWorkDaysPerWeek(workDaysPerWeek);
}

/** Synonym für `annualVacationDaysFromWorkDaysPerWeek` (Legacy-Name). */
export function defaultAnnualVacationDays(workDaysPerWeek: number): number {
  return annualVacationDaysFromWorkDaysPerWeek(workDaysPerWeek);
}

/** Jahresurlaub ÷ 12 (Monatsabschluss). */
export function monthlyVacationAccrualFromAnnual(annualVacationDays: number): number {
  if (annualVacationDays <= 0) return 0;
  return annualVacationDays / 12;
}

/** ISO-Datum des Kalendertags (UTC) aus Prisma @db.Date */
export function prismaDateToISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Heute als YYYY-MM-DD (UTC). */
export function utcTodayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
