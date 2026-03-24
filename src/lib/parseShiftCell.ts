/**
 * Parst eine Tageszelle wie im Excel-Tool (README / _stunden_formel_pro_tag).
 * U, K → Soll-Anteil (Vertragsstunden / Arbeitstage)
 * ZA, FT (erkennung über erstes Zeichen Z bzw. F) → 0 Arbeitsstunden
 * Zeit: "11:30-20:00" oder "11:30-20:00-30" (Pause Minuten)
 *
 * **Netto-Arbeitszeit:** Bei Zeit-Eingaben ist die berechnete Stundenzahl
 * **Anwesenheit von Start bis Ende minus Pause** — die Pause zählt **nicht** zur Arbeitszeit.
 * Ohne dritten Wert (keine Pause angegeben) wird **0** Minuten Pause abgezogen.
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

  // Urlaub / Krank: wie Excel erstes Zeichen U / K
  if (first === "U" || first === "K") {
    const hours = contractHours / workDays;
    return { ok: true, hours, kind: "uk" };
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
  // Netto: reine Arbeitszeit (Pausenzeiten in Stunden abziehen)
  const hours = Math.max(0, span - breakMin / 60);
  return { ok: true, hours, kind: "time" };
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
