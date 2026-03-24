/** Zählt Tage mit Urlaub „U“ am Anfang der Zelle (wie Excel LINKS). */
export function countVacationDaysInWeek(cells: string[]): number {
  let n = 0;
  for (const c of cells) {
    const t = c.trim().toUpperCase();
    if (t.startsWith("U")) n += 1;
  }
  return n;
}
