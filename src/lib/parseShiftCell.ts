/**
 * Parst eine Tageszelle wie im Excel-Tool (README / _stunden_formel_pro_tag).
 * U, K → voller Soll-Tag (**Vertragsstunden / Arbeitstage**), optional **U(2)** / **K(4)** =
 * genau die angegebenen Stunden (Komma erlaubt).
 * ZA → 0 Arbeitsstunden. **FT** / **F** / „Feiertag“ → 0, außer `treatFtAsPaidHoliday`:
 * an eingetragenem **gesetzlichen Feiertag** wie voller Soll-Tag (Feiertagsentgelt / gleiche Logik wie U-Tag).
 * Zeit: "11:30-20:00" oder "11:30-20:00-30" (Pause Minuten)
 *
 * **Netto-Arbeitszeit bei Zeit-Eingaben:** Zeitraum **Start − Ende** (ggf. +24 h bei Mitternacht) **minus**
 * die Pause in Minuten (dritter Wert). Ohne dritten Wert: **0** Minuten Pause.
 */

import { addDaysISO } from "@/lib/dateNav";
import type { ContractRow } from "@/lib/employeeContract";
import { contractForDate } from "@/lib/employeeContract";

export type ParseResult =
  | { ok: true; hours: number; kind: "time" | "uk" | "zaft" | "empty" }
  | { ok: false; error: string };

/** Optionen nur für Aufrufer mit Kalender-Kontext (Feiertag aus Stammdaten). */
export type ParseShiftCellOptions = {
  /** true: FT/F/Feiertag zählen wie ganzer Soll-Tag (Vertragsstunden/Arbeitstage). */
  treatFtAsPaidHoliday?: boolean;
};

/** Kürzel für Feiertag ohne Dienst (kein Zeitstring): F, FT, Feiertag. */
export function isFtPaidHolidayAbbreviation(raw: string): boolean {
  const t = raw.replace(/\s+/g, " ").trim();
  if (/^F(T)?$/i.test(t)) return true;
  if (/^Feiertag$/i.test(t)) return true;
  return false;
}

/** Raster-Farben: ein Abkürzungsblock ohne `|` (U, K, F/FT/Feiertag, Z…). */
export type ShiftAbbrevUiKind = "u" | "k" | "f" | "z";

export function shiftAbbrevUiKind(raw: string): ShiftAbbrevUiKind | null {
  const s = raw.replace(/\s+/g, " ").trim();
  if (!s || s.includes("|")) return null;
  const first = s.charAt(0).toUpperCase();
  if (first === "U") {
    if (/^U\s*$/i.test(s) || /^U\s*\(\s*[\d.,]+\s*\)\s*$/i.test(s)) return "u";
    return null;
  }
  if (first === "K") {
    if (/^K\s*$/i.test(s) || /^K\s*\(\s*[\d.,]+\s*\)\s*$/i.test(s)) return "k";
    return null;
  }
  if (first === "F" && isFtPaidHolidayAbbreviation(s)) return "f";
  if (first === "Z") return "z";
  return null;
}

function parseTimeToHours(hms: string): number | null {
  const t = hms.trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h + min / 60;
}

/**
 * @param raw Rohtext aus Zelle
 * @param contractHours Vertragsstunden / Woche
 * @param workDays Arbeitstage / Woche (> 0)
 */
export function parseShiftCell(
  raw: string,
  contractHours: number,
  workDays: number,
  options?: ParseShiftCellOptions
): ParseResult {
  const s = raw.replace(/\s+/g, " ").trim();
  if (!s) return { ok: true, hours: 0, kind: "empty" };

  if (workDays <= 0 || !Number.isFinite(workDays)) {
    return { ok: false, error: "Arbeitstage pro Woche muss > 0 sein." };
  }
  if (!Number.isFinite(contractHours) || contractHours < 0) {
    return { ok: false, error: "Vertragsstunden ungültig." };
  }

  const first = s.charAt(0).toUpperCase();

  // Urlaub / Krank: "U" / "K" = ganzer Soll-Tag; "U(2)" / "K(4)" = Stunden aus Klammern
  if (first === "U" || first === "K") {
    const m = /^([UK])\s*\(\s*([\d.,]+)\s*\)\s*$/i.exec(s);
    if (m) {
      const h = Number(m[2]!.replace(",", "."));
      if (!Number.isFinite(h) || h < 0 || h > 24) {
        return {
          ok: false,
          error: "Stunden in Klammern ungültig (0–24, z. B. U(2) oder K(4,5)).",
        };
      }
      return { ok: true, hours: h, kind: "uk" };
    }
    if (/^[UK]\s*$/i.test(s)) {
      const hours = contractHours / workDays;
      return { ok: true, hours, kind: "uk" };
    }
    return {
      ok: false,
      error: 'Erwarte "U", "K", "U(3)" oder "K(2)" (Stunden in Klammern).',
    };
  }

  // ZA / Abwesenheit: Z → 0
  if (first === "Z") {
    return { ok: true, hours: 0, kind: "zaft" };
  }

  // FT / F / Feiertag: an gesetzlichem Feiertag wie Soll-Tag, sonst 0
  if (first === "F") {
    if (
      options?.treatFtAsPaidHoliday &&
      isFtPaidHolidayAbbreviation(s) &&
      workDays > 0
    ) {
      return {
        ok: true,
        hours: contractHours / workDays,
        kind: "uk",
      };
    }
    return { ok: true, hours: 0, kind: "zaft" };
  }

  // Unbekanntes Einzelzeichen (z. B. "N" Nacht in rota) → 0 wie Excel-Sonstfall
  if (s.length === 1 && /[A-Za-z]/.test(s)) {
    return { ok: true, hours: 0, kind: "empty" };
  }

  const parts = s.split("-").map((p) => p.trim());
  if (parts.length < 2) {
    return {
      ok: false,
      error: 'Erwarte "HH:MM-HH:MM" oder "HH:MM-HH:MM-PauseMin" oder U/K/ZA/FT.',
    };
  }

  const start = parseTimeToHours(parts[0]!);
  const end = parseTimeToHours(parts[1]!);
  if (start === null || end === null) {
    return { ok: false, error: "Start- oder Endzeit ungültig (HH:MM)." };
  }

  let breakMin = 0;
  if (parts.length >= 3) {
    const b = Number(parts[2]!.replace(",", "."));
    if (!Number.isFinite(b) || b < 0 || b > 24 * 60) {
      return { ok: false, error: "Pausenminuten ungültig." };
    }
    breakMin = b;
  }

  let span = end - start;
  if (span < 0) span += 24; // Schicht über Mitternacht
  const hours = Math.max(0, span - breakMin / 60);
  return { ok: true, hours, kind: "time" };
}

/**
 * Mehrere Schichtblöcke in einer Zelle, getrennt durch **|** (z. B. `11:00-14:00-30 | 15:00-20:00-0`).
 * Urlaub/Krank/ZA/FT nur als **ein** Block ohne `|` (sonst Segment für Segment parsen).
 */
export function parseShiftCellTotalHours(
  raw: string,
  contractHours: number,
  workDays: number,
  options?: ParseShiftCellOptions
): number {
  const s = raw.replace(/\s+/g, " ").trim();
  if (!s) return 0;
  if (!s.includes("|")) {
    const r = parseShiftCell(s, contractHours, workDays, options);
    return r.ok ? r.hours : 0;
  }
  const segs = s
    .split("|")
    .map((p) => p.trim())
    .filter(Boolean);
  let total = 0;
  for (const seg of segs) {
    const r = parseShiftCell(seg, contractHours, workDays, options);
    if (r.ok) total += r.hours;
  }
  return total;
}

/** Summe Pausen-Minuten aus allen Zeit-Segmenten (dritter `-`-Teil pro Segment). */
export function pauseMinutesFromRaw(raw: string): number {
  const s = raw.replace(/\s+/g, " ").trim();
  if (!s) return 0;
  const segs = s.includes("|")
    ? s.split("|").map((p) => p.trim()).filter(Boolean)
    : [s];
  let total = 0;
  for (const seg of segs) {
    const t = seg.trim();
    const first = t.charAt(0).toUpperCase();
    if (first === "U" || first === "K" || first === "Z" || first === "F") continue;
    const parts = t.split("-").map((p) => p.trim());
    if (parts.length >= 3) {
      const b = Number(parts[2]!.replace(",", "."));
      if (Number.isFinite(b) && b >= 0 && b <= 24 * 60) total += b;
    }
  }
  return total;
}

export function sumParsedWeekHours(
  cells: string[],
  contractHours: number,
  workDays: number
): { hours: number; errors: string[] } {
  const errors: string[] = [];
  let total = 0;
  for (let i = 0; i < cells.length; i++) {
    const r = parseShiftCell(cells[i] ?? "", contractHours, workDays);
    if (!r.ok) errors.push(`Tag ${i + 1}: ${r.error}`);
    else total += r.hours;
  }
  return { hours: total, errors };
}

/** Pro Kalendertag der Vertrag, der an diesem Tag gilt (Wechsel mitten in der Woche möglich). */
export function sumParsedWeekHoursWithContracts(
  cells: string[],
  weekStartISO: string,
  contractRows: ContractRow[],
  /** Kalendertage (YYYY-MM-DD) mit mindestens einem gesetzlichen Feiertag (nicht Schulferien). */
  publicHolidayDates?: ReadonlySet<string>
): { hours: number; errors: string[] } {
  const errors: string[] = [];
  let total = 0;
  for (let i = 0; i < 7; i++) {
    const dateISO = addDaysISO(weekStartISO, i);
    const c = contractForDate(contractRows, dateISO);
    const treatFt =
      publicHolidayDates != null && publicHolidayDates.has(dateISO);
    const r = parseShiftCell(cells[i] ?? "", c.contractHoursPerWeek, c.workDaysPerWeek, {
      treatFtAsPaidHoliday: treatFt,
    });
    if (!r.ok) errors.push(`Tag ${i + 1}: ${r.error}`);
    else total += r.hours;
  }
  return { hours: total, errors };
}

export function parseShiftCellTotalHoursForDate(
  raw: string,
  contractRows: ContractRow[],
  dateISO: string,
  publicHolidayDates?: ReadonlySet<string>
): number {
  const c = contractForDate(contractRows, dateISO);
  const opts: ParseShiftCellOptions | undefined =
    publicHolidayDates?.has(dateISO) ? { treatFtAsPaidHoliday: true } : undefined;
  return parseShiftCellTotalHours(
    raw,
    c.contractHoursPerWeek,
    c.workDaysPerWeek,
    opts
  );
}
