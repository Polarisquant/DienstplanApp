import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { schoolBreakFindManySafe } from "@/lib/schoolBreakDb";

/** GET ?year=2026 — alle Ferien-Zeiträume, die das Jahr schneiden */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const yearStr = searchParams.get("year");
  const year = yearStr ? Number(yearStr) : new Date().getFullYear();
  if (!Number.isFinite(year)) {
    return NextResponse.json({ error: "Ungültiges Jahr." }, { status: 400 });
  }

  const yStart = new Date(`${year}-01-01T12:00:00.000Z`);
  const yEnd = new Date(`${year}-12-31T12:00:00.000Z`);

  const list = await schoolBreakFindManySafe(prisma, {
    where: {
      AND: [{ startDate: { lte: yEnd } }, { endDate: { gte: yStart } }],
    },
    orderBy: [{ startDate: "asc" }, { region: "asc" }, { name: "asc" }],
  });

  return NextResponse.json({
    schoolBreaks: list.map((r) => ({
      id: r.id,
      startDate: r.startDate.toISOString().slice(0, 10),
      endDate: r.endDate.toISOString().slice(0, 10),
      name: r.name,
      region: r.region,
      includedInPlan: r.includedInPlan,
    })),
  });
}
