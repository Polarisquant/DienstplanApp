import { WorkSite } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { employeeWhereForWorkSite } from "@/lib/workSite";

const bodySchema = z.object({
  site: z.enum(["CRUSH", "CAPPUCONE"]),
  employeeIds: z.array(z.string()).min(1),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }

  const { site: siteParam, employeeIds } = parsed.data;
  const site =
    siteParam === "CAPPUCONE" ? WorkSite.CAPPUCONE : WorkSite.CRUSH;

  const where = { active: true, ...employeeWhereForWorkSite(site) };
  const all = await prisma.employee.findMany({
    where,
    select: { id: true },
  });
  const expected = new Set(all.map((e) => e.id));

  if (employeeIds.length !== expected.size) {
    return NextResponse.json(
      {
        error:
          "Die Liste muss genau alle aktiven Mitarbeiter dieses Standorts enthalten.",
      },
      { status: 400 }
    );
  }

  const seen = new Set<string>();
  for (const id of employeeIds) {
    if (seen.has(id) || !expected.has(id)) {
      return NextResponse.json(
        { error: "Doppelte oder ungültige Mitarbeiter-ID in der Reihenfolge." },
        { status: 400 }
      );
    }
    seen.add(id);
  }

  await prisma.$transaction(
    employeeIds.map((id, index) =>
      prisma.employee.update({
        where: { id },
        data:
          site === WorkSite.CRUSH
            ? { planSortOrderCrush: index }
            : { planSortOrderCappucone: index },
      })
    )
  );

  return NextResponse.json({ ok: true });
}
