/**
 * Gesetzliche Feiertage AT-Salzburg & DE-Bayern über date-holidays (nur type "public").
 * Jahre 2024–2033; Quelle: date-holidays / zugrunde liegende national/ländliche Regeln.
 */
import Holidays from "date-holidays";

export const HOLIDAY_SEED_YEAR_FROM = 2024;
export const HOLIDAY_SEED_YEAR_TO = 2033;

export type HolidaySeedRow = { d: string; name: string; region: string };

export function buildPublicHolidaysSeed(): HolidaySeedRow[] {
  const rows: HolidaySeedRow[] = [];
  const at = new Holidays("AT", "s");
  const de = new Holidays("DE", "by");

  for (let y = HOLIDAY_SEED_YEAR_FROM; y <= HOLIDAY_SEED_YEAR_TO; y++) {
    const ys = String(y);
    for (const h of at.getHolidays(ys)) {
      if (h.type !== "public") continue;
      const d = String(h.date).slice(0, 10);
      rows.push({ d, name: h.name, region: "AT-Salzburg" });
    }
    for (const h of de.getHolidays(ys)) {
      if (h.type !== "public") continue;
      const d = String(h.date).slice(0, 10);
      rows.push({ d, name: h.name, region: "DE-Bayern" });
    }
  }

  return rows;
}
