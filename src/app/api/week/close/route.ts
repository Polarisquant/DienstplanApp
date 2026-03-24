import { NextResponse } from "next/server";
import { ShiftLayer, WeekStatus, WorkSite } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseWeekStartParam, formatWeekStart } from "@/lib/weekUtils";
import { computeWeeklyBalance } from "@/lib/computeWeekly";
import { getBalanceBeforeWeek } from "@/lib/balance";
import { employeeWhereForWorkSite } from "@/lib/workSite";
import { z } from "zod";

const bodySchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  site: z.enum(["CRUSH", "CAPPUCONE"]).optional().default("CRUSH"),
});

export async function POST(req: Request) {
  try {
    const body = bodySchema.parse(await req.json());
    const weekStart = parseWeekStartParam(body.start);
    if (!weekStart) {
      return NextResponse.json({ error: "Ungültiger Wochenstart." }, { status: 400 });
    }

    const site =
      body.site === "CAPPUCONE" ? WorkSite.CAPPUCONE : WorkSite.CRUSH;

    const week = await prisma.workWeek.findUnique({
      where: { weekStart_site: { weekStart: weekStart, site } },
    });
    if (!week) {
      return NextResponse.json({ error: "Woche nicht gefunden." }, { status: 404 });
    }
    if (week.status === WeekStatus.CLOSED) {
      return NextResponse.json({
        ok: true,
        message: "Bereits abgeschlossen.",
        weekStart: formatWeekStart(weekStart),
        site: body.site,
      });
    }

    await prisma.$transaction(async (tx) => {
      const employees = await tx.employee.findMany({
        where: { active: true, ...employeeWhereForWorkSite(site) },
      });

      for (const e of employees) {
        const cellsDb = await tx.shiftCell.findMany({
          where: {
            workWeekId: week.id,
            employeeId: e.id,
            layer: ShiftLayer.ACTUAL,
          },
        });
        const arr = Array(7).fill("");
        for (const c of cellsDb) arr[c.dayIndex] = c.rawValue;
        const { deltaVsContract } = computeWeeklyBalance(
          arr,
          e.contractHoursPerWeek,
          e.workDaysPerWeek
        );

        const base = await getBalanceBeforeWeek(e.id, weekStart, site);
        const balanceAfter = base + deltaVsContract;

        await tx.timeAccountLine.upsert({
          where: {
            employeeId_workWeekId: {
              employeeId: e.id,
              workWeekId: week.id,
            },
          },
          create: {
            employeeId: e.id,
            workWeekId: week.id,
            weeklyDeltaHours: deltaVsContract,
            balanceAfter,
            source: "IST_CLOSED",
          },
          update: {
            weeklyDeltaHours: deltaVsContract,
            balanceAfter,
            source: "IST_CLOSED",
          },
        });
      }

      await tx.workWeek.update({
        where: { id: week.id },
        data: { status: WeekStatus.CLOSED },
      });
    });

    return NextResponse.json({
      ok: true,
      weekStart: formatWeekStart(weekStart),
      site: body.site,
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Ungültige Daten." }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ error: "Abschließen fehlgeschlagen." }, { status: 500 });
  }
}
