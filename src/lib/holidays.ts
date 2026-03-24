import { addDaysISO } from "./dateNav";

export type HolidayEntry = { name: string; region: string };

/** ISO-Daten Mo–So für eine Woche (weekStart = Montag YYYY-MM-DD). */
export function weekDateISOs(weekStartISO: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysISO(weekStartISO, i));
}

/** Anzahl Kalendertage in der Woche, an denen mindestens ein (bereits gefilterter) Feiertag liegt. */
export function countHolidayDaysInWeek(
  weekStartISO: string,
  byDate: Map<string, HolidayEntry[]>
): number {
  let n = 0;
  for (const iso of weekDateISOs(weekStartISO)) {
    const list = byDate.get(iso) ?? [];
    if (list.length > 0) n += 1;
  }
  return n;
}

/** Normalisiert DB-Datum auf Kalendertag YYYY-MM-DD (UTC). */
export function holidayDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function buildHolidayMap(
  rows: { date: Date; name: string; region: string }[]
): Map<string, HolidayEntry[]> {
  const map = new Map<string, HolidayEntry[]>();
  for (const r of rows) {
    const key = holidayDateKey(r.date);
    const arr = map.get(key) ?? [];
    arr.push({ name: r.name, region: r.region });
    map.set(key, arr);
  }
  return map;
}
