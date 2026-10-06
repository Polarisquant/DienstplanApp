/**
 * Geteilte Mitarbeiter (Crush + CappuCone): Regeln pro **Person und Kalendertag**.
 *
 * - **U/K/FT nur einmal:** Steht am selben Tag an beiden Filialen U/K/FT, zählt der
 *   Crush-Eintrag; der CappuCone-Eintrag zählt 0 (Stunden und Urlaubstage). Die Regel ist
 *   zustandslos — gleiches Ergebnis egal welche Filiale zuerst speichert/abschließt.
 * - **Mischtag gesperrt:** U/K an einer Filiale und Dienst (Zeiteintrag) an der anderen am
 *   selben Tag ist nicht erlaubt. FT neben Dienst ist erlaubt (Feiertag: eine Filiale
 *   arbeitet, die andere trägt meist gar nichts ein).
 *
 * Client-tauglich (keine Server-Imports).
 */
import { addDaysISO } from "@/lib/dateNav";
import type { ContractRow } from "@/lib/employeeContract";
import type { EmploymentBounds } from "@/lib/employmentWeekTarget";
import { shiftAbbrevUiKind } from "@/lib/parseShiftCell";
import { actualRowHasContent, countVacationDaysInWeekWithPlanActual } from "@/lib/vacation";

export type SiteKey = "CRUSH" | "CAPPUCONE";

export const siteKeyLabel = (s: SiteKey) => (s === "CRUSH" ? "Crush" : "CappuCone");
export const otherSiteKey = (s: SiteKey): SiteKey => (s === "CRUSH" ? "CAPPUCONE" : "CRUSH");

/** U, K oder FT (auch U(2)/K(4)) als ganzer Zelleninhalt. */
export function isAbsenceCell(raw: string): boolean {
  const k = shiftAbbrevUiKind(raw ?? "");
  return k === "u" || k === "k" || k === "f";
}

/** Nur Urlaub/Krank (FT zählt nicht — Feiertag neben Dienst ist erlaubt). */
export function isUrlaubKrankCell(raw: string): boolean {
  const k = shiftAbbrevUiKind(raw ?? "");
  return k === "u" || k === "k";
}

/** Zelle mit Arbeitszeit (mindestens ein Zeitblock HH:MM). */
export function isWorkTimeCell(raw: string): boolean {
  return /\d{1,2}:\d{2}/.test(raw ?? "");
}

/** Zählt diese Zelle? CappuCone-Abwesenheit entfällt, wenn Crush am selben Tag auch U/K/FT hat. */
export function countedCellForSite(raw: string, site: SiteKey, otherRaw: string | undefined): string {
  if (site !== "CAPPUCONE" || !otherRaw) return raw;
  return isAbsenceCell(raw) && isAbsenceCell(otherRaw) ? "" : raw;
}

/** Wochenzeile mit der „nur einmal“-Regel; `otherCells` = gleiche Ebene der anderen Filiale. */
export function countedCellsForSite(
  cells: string[],
  site: SiteKey,
  otherCells: string[] | null | undefined
): string[] {
  if (site !== "CAPPUCONE" || !otherCells) return cells;
  return Array.from({ length: 7 }, (_, i) =>
    countedCellForSite(cells[i] ?? "", site, otherCells[i])
  );
}

/** Tage (0–6) mit U/K an einer und Dienst an der anderen Filiale. */
export function mixedDayIndexes(ownCells: string[], otherCells: string[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < 7; i++) {
    const a = ownCells[i] ?? "";
    const b = otherCells[i] ?? "";
    if ((isUrlaubKrankCell(a) && isWorkTimeCell(b)) || (isWorkTimeCell(a) && isUrlaubKrankCell(b))) {
      out.push(i);
    }
  }
  return out;
}

/** Tage (0–6), an denen beide Filialen U/K/FT eingetragen haben. */
export function duplicateAbsenceDayIndexes(ownCells: string[], otherCells: string[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < 7; i++) {
    if (isAbsenceCell(ownCells[i] ?? "") && isAbsenceCell(otherCells[i] ?? "")) out.push(i);
  }
  return out;
}

export type PlanActual = { plan: string[]; actual: string[] };

const vacationRow = (pa: PlanActual) =>
  actualRowHasContent(pa.actual) ? pa.actual : pa.plan;

/**
 * Urlaubstage einer **Kalenderwoche** über beide Filialen (Ist-Priorität je Filiale,
 * U am selben Tag nur einmal — Crush zählt).
 */
export function countVacationDaysCalendarWeek(
  crush: PlanActual | null,
  cappucone: PlanActual | null,
  weekStartISO: string,
  contractRows: ContractRow[],
  employment?: EmploymentBounds
): number {
  const crushRow = crush ? vacationRow(crush) : null;
  let n = 0;
  if (crushRow) {
    n += countVacationDaysInWeekWithPlanActual(crushRow, crushRow, weekStartISO, contractRows, employment);
  }
  if (cappucone) {
    const capRow = countedCellsForSite(vacationRow(cappucone), "CAPPUCONE", crushRow);
    n += countVacationDaysInWeekWithPlanActual(capRow, capRow, weekStartISO, contractRows, employment);
  }
  return n;
}

const SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const dayLabel = (weekStartISO: string, i: number) =>
  `${SHORT[i]} ${addDaysISO(weekStartISO, i).split("-").reverse().slice(0, 2).join(".")}.`;

/** Hinweise/Fehler für die Eingabe im Dienstplan (eine Ebene, live). */
export function sharedDayMessages(
  ownCells: string[],
  otherCells: string[],
  site: SiteKey,
  weekStartISO: string
): { errors: string[]; warnings: string[] } {
  const other = siteKeyLabel(otherSiteKey(site));
  return {
    errors: mixedDayIndexes(ownCells, otherCells).map(
      (i) =>
        `${dayLabel(weekStartISO, i)}: Urlaub/Krank und Dienst am selben Tag (Dienst bzw. U/K bei ${other}) — nicht möglich.`
    ),
    warnings: duplicateAbsenceDayIndexes(ownCells, otherCells).map(
      (i) => `${dayLabel(weekStartISO, i)}: U/K/FT steht auch bei ${other} — zählt nur einmal (bei Crush).`
    ),
  };
}
