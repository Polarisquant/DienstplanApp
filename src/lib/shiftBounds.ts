/**
 * Extrahiert Start/Ende einer Zeit-Schicht aus rawValue (wie parseShiftCell, nur Zeit-Muster).
 * Über-Mitternacht: end liegt am Folgetag.
 */

function parseHM(s: string): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return { h, m: min };
}

export type ShiftBounds = {
  /** Brutto-Stunden: Ende − Start (+24h wenn über Mitternacht), vor Abzug Pause */
  grossHours: number;
  breakMinutes: number;
  /** UTC-ms für Schichtbeginn (Kalendertag dateISO, lokale Uhrzeit als UTC-Zahlen gesetzt — konsistent mit reiner Differenz) */
  startMs: number;
  /** UTC-ms Schichtende (Folgetag bei Über-Mitternacht) */
  endMs: number;
};

/**
 * Parst nur Muster "HH:MM-HH:MM" / mit Pause-Drittwert.
 * @returns null bei U/K/ZA/FT oder ungültig
 */
export function parseShiftBounds(dateISO: string, raw: string): ShiftBounds | null {
  const s = raw.replace(/\s+/g, " ").trim();
  if (!s) return null;

  const first = s.charAt(0).toUpperCase();
  if (first === "U" || first === "K" || first === "Z" || first === "F") return null;
  if (s.length === 1 && /[A-Za-z]/.test(s)) return null;

  const parts = s.split("-").map((p) => p.trim());
  if (parts.length < 2) return null;

  const startT = parseHM(parts[0]!);
  const endT = parseHM(parts[1]!);
  if (!startT || !endT) return null;

  let breakMin = 0;
  if (parts.length >= 3) {
    const b = Number(parts[2]!.replace(",", "."));
    if (!Number.isFinite(b) || b < 0 || b > 24 * 60) return null;
    breakMin = b;
  }

  const [y, mo, d] = dateISO.split("-").map(Number);
  if (!y || !mo || !d) return null;

  const startMin = startT.h * 60 + startT.m;
  const endMin = endT.h * 60 + endT.m;
  let endDayOffset = 0;
  let spanMin = endMin - startMin;
  if (spanMin <= 0) {
    spanMin += 24 * 60;
    endDayOffset = 1;
  }
  const grossHours = spanMin / 60;

  const startMs = Date.UTC(y, mo - 1, d, startT.h, startT.m, 0);
  const endMs = Date.UTC(y, mo - 1, d + endDayOffset, endT.h, endT.m, 0);

  return { grossHours, breakMinutes: breakMin, startMs, endMs };
}
