import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

/**
 * Liest Schulferien — bei fehlender DB-Tabelle (Schema noch nicht `db push`) leere Liste statt 500.
 * Andere Fehler werden weitergeworfen.
 */
export async function schoolBreakFindManySafe(
  prisma: PrismaClient,
  args: Prisma.SchoolBreakFindManyArgs
) {
  try {
    return await prisma.schoolBreak.findMany(args);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2021") {
      console.warn(
        "[SchoolBreak] Tabelle fehlt — leere Ferien-Liste. Bitte im Ordner web: npx prisma db push && npx prisma db seed"
      );
      return [];
    }
    throw e;
  }
}
