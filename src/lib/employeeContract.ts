import { addDaysISO } from "@/lib/dateNav";

/** Ein Vertragsstand ab Stichtag (Kalendertag, ISO yyyy-mm-dd). */
export type ContractRow = {
  effectiveFrom: string;
  contractHoursPerWeek: number;
  workDaysPerWeek: number;
};

/**
 * Letzter Vertrag mit effectiveFrom <= dateISO (nach Sortierung).
 * Voraussetzung: mindestens eine Zeile.
 */
export function contractForDate(
  rows: ContractRow[],
  dateISO: string
): ContractRow {
  if (rows.length === 0) {
    throw new Error("Kein Vertrag hinterlegt.");
  }
  const sorted = [...rows].sort((a, b) =>
    a.effectiveFrom.localeCompare(b.effectiveFrom)
  );
  let cur = sorted[0]!;
  for (const r of sorted) {
    if (r.effectiveFrom <= dateISO) cur = r;
    else break;
  }
  return cur;
}

/**
 * Wochen-Soll für Abgleich mit Ist-Summe: Summe von (Wochenstunden/7) pro Kalendertag.
 * Bei einem Vertrag über die ganze Woche = eine Wochenvertragsstunden wie bisher.
 */
export function weeklyProRataTarget(
  rows: ContractRow[],
  weekStartISO: string
): number {
  let t = 0;
  for (let i = 0; i < 7; i++) {
    const dateISO = addDaysISO(weekStartISO, i);
    const c = contractForDate(rows, dateISO);
    t += c.contractHoursPerWeek / 7;
  }
  return t;
}
