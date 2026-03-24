/** Wochenstart als Datum (UTC Mittag, nur Kalendertag relevant). */
export function parseWeekStartParam(s: string | null): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return new Date(`${s}T12:00:00.000Z`);
}

export function formatWeekStart(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** ISO-Kalenderwoche (ISO 8601), Montag = Wochentag 1. */
export function isoWeekNumberUTC(d: Date): number {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const y = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((+date - +y) / 86400000 + 1) / 7);
}
