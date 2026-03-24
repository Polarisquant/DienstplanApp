/**
 * Schulferien AT (Land Salzburg) & DE (Bayern) als Zeiträume.
 * Vorbehaltlich offizieller Festlegung durch Länder/KM — bei Abweichungen in der UI anpassen oder Seed ergänzen.
 * Quellen: u. a. oesterreich.gv.at / Land Salzburg, km.bayern.de Ferientermine (Stand Recherche 2025).
 */
import { PrismaClient } from "@prisma/client";

export type SchoolBreakSeedRow = {
  start: string;
  end: string;
  name: string;
  region: "AT-Salzburg" | "DE-Bayern";
};

/** Hauptferien 2025–2027 (kontinuierliche Blöcke; ggf. zusätzliche Einzeltage separat). */
export const SCHOOL_BREAK_SEED_ROWS: SchoolBreakSeedRow[] = [
  // ——— Salzburg ———
  { start: "2025-07-05", end: "2025-09-07", name: "Sommerferien", region: "AT-Salzburg" },
  { start: "2025-09-24", end: "2025-09-24", name: "Herbst (Sondertermin)", region: "AT-Salzburg" },
  { start: "2025-10-27", end: "2025-10-31", name: "Herbstferien", region: "AT-Salzburg" },
  { start: "2025-12-24", end: "2026-01-06", name: "Weihnachtsferien", region: "AT-Salzburg" },
  { start: "2026-02-09", end: "2026-02-14", name: "Semesterferien", region: "AT-Salzburg" },
  { start: "2026-03-28", end: "2026-04-06", name: "Osterferien", region: "AT-Salzburg" },
  { start: "2026-05-23", end: "2026-05-25", name: "Pfingstferien", region: "AT-Salzburg" },
  { start: "2026-07-11", end: "2026-09-13", name: "Sommerferien", region: "AT-Salzburg" },
  { start: "2026-09-24", end: "2026-09-24", name: "Herbst (Sondertermin)", region: "AT-Salzburg" },
  { start: "2026-10-27", end: "2026-10-30", name: "Herbstferien", region: "AT-Salzburg" },
  { start: "2026-12-23", end: "2027-01-06", name: "Weihnachtsferien", region: "AT-Salzburg" },
  { start: "2027-02-08", end: "2027-02-13", name: "Semesterferien", region: "AT-Salzburg" },
  { start: "2027-03-27", end: "2027-04-05", name: "Osterferien", region: "AT-Salzburg" },
  { start: "2027-05-22", end: "2027-05-24", name: "Pfingstferien", region: "AT-Salzburg" },
  { start: "2027-07-10", end: "2027-09-12", name: "Sommerferien", region: "AT-Salzburg" },

  // ——— Bayern ———
  { start: "2025-08-01", end: "2025-09-15", name: "Sommerferien", region: "DE-Bayern" },
  { start: "2025-11-03", end: "2025-11-07", name: "Herbstferien", region: "DE-Bayern" },
  { start: "2025-12-22", end: "2026-01-05", name: "Weihnachtsferien", region: "DE-Bayern" },
  { start: "2026-02-16", end: "2026-02-20", name: "Winterferien", region: "DE-Bayern" },
  { start: "2026-03-30", end: "2026-04-10", name: "Osterferien", region: "DE-Bayern" },
  { start: "2026-05-26", end: "2026-06-05", name: "Pfingstferien", region: "DE-Bayern" },
  { start: "2026-08-03", end: "2026-09-14", name: "Sommerferien", region: "DE-Bayern" },
  { start: "2026-11-02", end: "2026-11-06", name: "Herbstferien", region: "DE-Bayern" },
  { start: "2026-12-24", end: "2027-01-08", name: "Weihnachtsferien", region: "DE-Bayern" },
  { start: "2027-02-08", end: "2027-02-12", name: "Winterferien", region: "DE-Bayern" },
  { start: "2027-03-22", end: "2027-04-02", name: "Osterferien", region: "DE-Bayern" },
  { start: "2027-05-18", end: "2027-05-28", name: "Pfingstferien", region: "DE-Bayern" },
  { start: "2027-08-02", end: "2027-09-13", name: "Sommerferien", region: "DE-Bayern" },
];

function d(iso: string): Date {
  return new Date(`${iso}T12:00:00.000Z`);
}

export async function seedSchoolBreaks(prisma: PrismaClient): Promise<number> {
  let n = 0;
  for (const row of SCHOOL_BREAK_SEED_ROWS) {
    const startDate = d(row.start);
    const endDate = d(row.end);
    await prisma.schoolBreak.upsert({
      where: {
        startDate_endDate_region_name: {
          startDate,
          endDate,
          region: row.region,
          name: row.name,
        },
      },
      create: {
        startDate,
        endDate,
        name: row.name,
        region: row.region,
        includedInPlan: true,
      },
      update: {},
    });
    n += 1;
  }
  return n;
}
