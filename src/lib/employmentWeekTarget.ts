import { addDaysISO } from "@/lib/dateNav";
import type { ContractRow } from "@/lib/employeeContract";
import { contractForDate } from "@/lib/employeeContract";
import { employmentDayMark } from "@/lib/employeeEmployment";

/**
 * Betriebswoche: Mo–Sa. Der Betrieb hat sonntags immer geschlossen —
 * der Sonntag trägt nie Soll und zählt nie als Aliquotierungs-Tag.
 */
export const BUSINESS_DAYS_PER_WEEK = 6;

/** Eintritt/Austritt für Wochen-Soll und Urlaub (ISO yyyy-mm-dd). */
export type EmploymentBounds = {
  entryDateISO: string | null;
  exitDateISO: string | null;
};

export function weekEndISO(weekStartISO: string): string {
  return addDaysISO(weekStartISO, 6);
}

/** Ganze Kalenderwoche endet vor dem Eintritt. */
export function weekIsFullyBeforeEntry(
  weekStartISO: string,
  entryDateISO: string | null | undefined
): boolean {
  if (!entryDateISO) return false;
  return weekEndISO(weekStartISO) < entryDateISO.slice(0, 10);
}

/** Ganze Kalenderwoche beginnt nach dem Austritt. */
export function weekIsFullyAfterExit(
  weekStartISO: string,
  exitDateISO: string | null | undefined
): boolean {
  if (!exitDateISO) return false;
  return weekStartISO > exitDateISO.slice(0, 10);
}

/** Mitarbeiter im Dienstplan / Wochenabschluss sichtbar? */
export function employeeVisibleInWeek(
  weekStartISO: string,
  entryDateISO: string | null | undefined,
  exitDateISO: string | null | undefined
): boolean {
  if (weekIsFullyBeforeEntry(weekStartISO, entryDateISO)) return false;
  if (weekIsFullyAfterExit(weekStartISO, exitDateISO)) return false;
  return true;
}

/** Beschäftigung an diesem Kalendertag (aktiv oder letzter Austrittstag). */
export function isEmployedCalendarDay(
  dateISO: string,
  entryDateISO: string | null | undefined,
  exitDateISO: string | null | undefined
): boolean {
  const mark = employmentDayMark(dateISO, entryDateISO, exitDateISO);
  return mark === "active" || mark === "exit_last_day";
}

/**
 * Wochen-Soll — **eine** Formel für alle Mitarbeiter (Sechstel-Regel):
 * Jeder Betriebstag (Mo–Sa) innerhalb des Beschäftigungszeitraums zählt
 * `Vertragsstunden ÷ 6` des an diesem Kalendertag gültigen Vertrags.
 *
 * - Volle Beschäftigungswoche: 6 × H/6 = Vertragsstunden.
 * - Eintritt/Austritt unter der Woche: anteilig nach beschäftigten Betriebstagen
 *   (Eintritt Di → 5/6; Eintritt So → 0, da Sonntag kein Betriebstag ist).
 * - Vertragswechsel (Monatserster) mitten in der Woche: tagesgenauer Mix.
 * - Das Soll hängt nie davon ab, was eingeplant wurde — bezahlt ab Vertragsbeginn
 *   heißt Soll ab Vertragsbeginn.
 */
export function weeklyContractTargetForEmployment(
  contractRows: ContractRow[],
  weekStartISO: string,
  employment?: EmploymentBounds
): number {
  const entry = employment?.entryDateISO?.slice(0, 10) ?? null;
  const exit = employment?.exitDateISO?.slice(0, 10) ?? null;

  let t = 0;
  for (let i = 0; i < BUSINESS_DAYS_PER_WEEK; i++) {
    const dateISO = addDaysISO(weekStartISO, i);
    if (!isEmployedCalendarDay(dateISO, entry, exit)) continue;
    const c = contractForDate(contractRows, dateISO);
    t += c.contractHoursPerWeek / BUSINESS_DAYS_PER_WEEK;
  }
  return t;
}

export function employmentBoundsFromDates(
  entryDate: Date | string | null | undefined,
  exitDate: Date | string | null | undefined
): EmploymentBounds {
  const toIso = (d: Date | string | null | undefined): string | null => {
    if (d == null) return null;
    if (typeof d === "string") return d.slice(0, 10);
    return d.toISOString().slice(0, 10);
  };
  return { entryDateISO: toIso(entryDate), exitDateISO: toIso(exitDate) };
}
