/** Nächster Montag relativ zu lokalem Datum (vereinfachtes MVP). */
export function mondayOfLocalDate(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
  const day = x.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + offset);
  return x;
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function defaultWeekStartISO(): string {
  return toISODate(mondayOfLocalDate(new Date()));
}

export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const x = new Date(y!, m! - 1, d!, 12, 0, 0, 0);
  x.setDate(x.getDate() + days);
  return toISODate(x);
}

/** Montag der Kalenderwoche, die den Tag `isoDate` (YYYY-MM-DD) enthält. */
export function weekStartISOContainingDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const local = new Date(y!, m! - 1, d!, 12, 0, 0, 0);
  return toISODate(mondayOfLocalDate(local));
}

/** Alle Kalendertage von `fromISO` bis `toISO` einschließlich (YYYY-MM-DD). */
export function enumerateDatesInclusive(fromISO: string, toISO: string): string[] {
  if (fromISO > toISO) return [];
  const out: string[] = [];
  let cur = fromISO;
  for (;;) {
    out.push(cur);
    if (cur === toISO) break;
    cur = addDaysISO(cur, 1);
  }
  return out;
}

/** 0 = Montag … 6 = Sonntag relativ zu `weekStartISO`. */
export function dayIndexInWeek(weekStartISO: string, dayISO: string): number {
  const [ys, ms, ds] = weekStartISO.split("-").map(Number);
  const [yd, md, dd] = dayISO.split("-").map(Number);
  const s = new Date(ys!, ms! - 1, ds!, 12, 0, 0, 0).getTime();
  const e = new Date(yd!, md! - 1, dd!, 12, 0, 0, 0).getTime();
  return Math.round((e - s) / 86400000);
}

const DAY_MS = 86400000;

export function dayLabelsForWeek(weekStartISO: string): string[] {
  const [y, m, d] = weekStartISO.split("-").map(Number);
  const start = new Date(y!, m! - 1, d!, 12, 0, 0, 0);
  const names = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
  return names.map((n, i) => {
    const dt = new Date(start.getTime() + i * DAY_MS);
    const ds = toISODate(dt).split("-").reverse().join(".");
    return `${n} ${ds}`;
  });
}
