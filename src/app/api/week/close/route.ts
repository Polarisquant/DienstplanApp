import { NextResponse } from "next/server";
import { ShiftLayer, WeekStatus, WorkSite } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { addDaysISO } from "@/lib/dateNav";
import { buildHolidayMap } from "@/lib/holidays";
import { holidayDateKeysFromMap } from "@/lib/schoolBreaks";
import { parseWeekStartParam, formatWeekStart } from "@/lib/weekUtils";
import { computeWeeklyBalanceWithContracts } from "@/lib/computeWeekly";
import { contractRowsMapForEmployees } from "@/lib/employeeContractLoad";
import { getBalancesBeforeWeekForEmployees } from "@/lib/balance";
import { employeeWhereForWorkSite, planOrderByForWorkSite } from "@/lib/workSite";
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

    const employees = await prisma.employee.findMany({
      where: { active: true, ...employeeWhereForWorkSite(site) },
      orderBy: [...planOrderByForWorkSite(site)],
    });
    const balanceByEmp = await getBalancesBeforeWeekForEmployees(
      employees.map((e) => ({ id: e.id, startBalanceHours: e.startBalanceHours })),
      weekStart,
      site
    );

    const weekStartISO = formatWeekStart(weekStart);
    const lastDayStr = addDaysISO(weekStartISO, 6);
    const holidayRowsClose = await prisma.holiday.findMany({
      where: {
        includedInPlan: true,
        date: {
          gte: new Date(`${weekStartISO}T00:00:00.000Z`),
          lte: new Date(`${lastDayStr}T23:59:59.999Z`),
        },
      },
    });
    const holidayMapClose = buildHolidayMap(holidayRowsClose);
    const holidayKeysClose = holidayDateKeysFromMap(weekStartISO, holidayMapClose);

    const contractMapClose = await contractRowsMapForEmployees(
      employees.map((e) => e.id)
    );

    await prisma.$transaction(async (tx) => {
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
        const rows = contractMapClose.get(e.id) ?? [];
        const { deltaVsContract } = computeWeeklyBalanceWithContracts(
          arr,
          weekStartISO,
          rows,
          holidayKeysClose
        );

        const base = balanceByEmp.get(e.id) ?? e.startBalanceHours;
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
