/**
 * Parst eine Tageszelle wie im Excel-Tool (README / _stunden_formel_pro_tag).
 * U, K → voller Soll-Tag (**Vertragsstunden / Arbeitstage**), optional **U(2)** / **K(4)** =
 * genau die angegebenen Stunden (Komma erlaubt).
 * ZA, FT (erkennung über erstes Zeichen Z bzw. F) → 0 Arbeitsstunden
 * Zeit: "11:30-20:00" oder "11:30-20:00-30" (Pause Minuten)
 *
 * **Netto-Arbeitszeit bei Zeit-Eingaben:** Zeitraum **Start − Ende** (ggf. +24 h bei Mitternacht) **minus**
 * die Pause in Minuten (dritter Wert). Ohne dritten Wert: **0** Minuten Pause.
 */

export type ParseResult =
  | { ok: true; hours: number; kind: "time" | "uk" | "zaft" | "empty" }
  | { ok: false; error: string };

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
  workDays: number
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

  // Excel: erstes Zeichen Z oder F → 0 Arbeitsstunden (ZA, FT, ggf. nur "Z"/"F")
  if (first === "Z" || first === "F") {
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
  workDays: number
): number {
  const s = raw.replace(/\s+/g, " ").trim();
  if (!s) return 0;
  if (!s.includes("|")) {
    const r = parseShiftCell(s, contractHours, workDays);
    return r.ok ? r.hours : 0;
  }
  const segs = s
    .split("|")
    .map((p) => p.trim())
    .filter(Boolean);
  let total = 0;
  for (const seg of segs) {
    const r = parseShiftCell(seg, contractHours, workDays);
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
