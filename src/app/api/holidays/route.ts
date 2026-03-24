import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/** GET: Liste aller Feiertage, optional ?year=2026 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const yearStr = searchParams.get("year");
  const year = yearStr ? Number(yearStr) : null;

  const list = await prisma.holiday.findMany({
    where:
      year !== null && Number.isFinite(year)
        ? {
            date: {
              gte: new Date(`${year}-01-01T00:00:00.000Z`),
              lt: new Date(`${year + 1}-01-01T00:00:00.000Z`),
            },
          }
        : undefined,
    orderBy: [{ date: "asc" }, { region: "asc" }],
  });

  return NextResponse.json({ holidays: list });
}
