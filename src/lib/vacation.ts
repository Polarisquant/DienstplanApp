/**
 * Urlaubstage-Einheiten für Ist-Zeile: nur **U** (nicht Krank **K**).
 * - `U` → 1 Tag
 * - `U(2)` → 2 / (Vertragsstunden/Arbeitstage) Tage (Teilurlaub)
 */
export function vacationDayUnitsFromCell(
  raw: string,
  contractHoursPerWeek: number,
  workDaysPerWeek: number
): number {
  const s = raw.replace(/\s+/g, " ").trim();
  if (!s.toUpperCase().startsWith("U")) return 0;

  const daily = contractHoursPerWeek / workDaysPerWeek;
  if (!(daily > 0) || !Number.isFinite(daily)) return 0;

  if (/^U\s*$/i.test(s)) return 1;

  const m = /^U\s*\(\s*([\d.,]+)\s*\)\s*$/i.exec(s);
  if (m) {
    const h = Number(m[1]!.replace(",", "."));
    if (!Number.isFinite(h) || h < 0) return 0;
    return h / daily;
  }
  return 0;
}

/** Summe Urlaubs-Tagesäquivalente in der Woche (Ist-Zeile, nur Einträge mit führendem U). */
export function countVacationDaysInWeek(
  cells: string[],
  contractHoursPerWeek: number,
  workDaysPerWeek: number
): number {
  let n = 0;
  for (const c of cells) {
    n += vacationDayUnitsFromCell(c, contractHoursPerWeek, workDaysPerWeek);
  }
  return n;
}
