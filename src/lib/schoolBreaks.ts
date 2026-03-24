import { addDaysISO } from "./dateNav";
import { holidayDateKey } from "./holidays";

/** Ein Tag: Start oder Ende eines Ferienblocks, „dazwischen“, oder gesamter Block an einem Kalendertag. */
export type FerienPosition = "start" | "end" | "between" | "single";

export type FerienDayInfo = {
  name: string;
  region: string;
  position: FerienPosition;
};

export type SchoolBreakRow = {
  startDate: Date;
  endDate: Date;
  name: string;
  region: string;
  includedInPlan: boolean;
};

/**
 * Pro Kalendertag (YYYY-MM-DD) der Woche: eingetragene Ferien mit Position
 * (erster/letzter Tag = stark, dazwischen = leicht).
 */
export function ferienByDateForWeek(
  weekStartISO: string,
  breaks: SchoolBreakRow[]
): Map<string, FerienDayInfo[]> {
  const map = new Map<string, FerienDayInfo[]>();
  const weekDates = Array.from({ length: 7 }, (_, i) => addDaysISO(weekStartISO, i));

  const active = breaks.filter((b) => b.includedInPlan);
  for (const dateISO of weekDates) {
    for (const b of active) {
      const s = holidayDateKey(b.startDate);
      const e = holidayDateKey(b.endDate);
      if (dateISO < s || dateISO > e) continue;

      let position: FerienPosition;
      if (s === e) {
        position = "single";
      } else if (dateISO === s) {
        position = "start";
      } else if (dateISO === e) {
        position = "end";
      } else {
        position = "between";
      }

      const list = map.get(dateISO) ?? [];
      list.push({ name: b.name, region: b.region, position });
      map.set(dateISO, list);
    }
  }
  return map;
}

/** Kalendertage in der Woche mit mindestens einem aktiven Feiertag oder Ferientag. */
export function countHighlightedCalendarDays(
  weekStartISO: string,
  holidayDates: Set<string>,
  ferienByDate: Map<string, FerienDayInfo[]>
): number {
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDaysISO(weekStartISO, i);
    if (holidayDates.has(d) || (ferienByDate.get(d)?.length ?? 0) > 0) {
      n += 1;
    }
  }
  return n;
}

/** Alle Datums-Keys (YYYY-MM-DD) an denen ein Feiertag aus der Map liegt. */
export function holidayDateKeysFromMap(
  weekStartISO: string,
  byDate: Map<string, unknown[]>
): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < 7; i++) {
    const d = addDaysISO(weekStartISO, i);
    const list = byDate.get(d);
    if (list && list.length > 0) set.add(d);
  }
  return set;
}
