import { NextResponse } from "next/server";
import { ShiftLayer, WeekStatus, WorkSite } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { addDaysISO } from "@/lib/dateNav";
import { buildHolidayMap, countHolidayDaysInWeek } from "@/lib/holidays";
import {
  formatWeekStart,
  isoWeekNumberUTC,
  parseWeekStartParam,
} from "@/lib/weekUtils";
import { computeWeeklyBalance } from "@/lib/computeWeekly";
import { getBalanceBeforeWeek } from "@/lib/balance";
import { countVacationDaysInWeek } from "@/lib/vacation";
import { austrianLaborHintsForWeek } from "@/lib/austrianLaborHints";
import { LABOR_LAW_DISCLAIMER_DE } from "@/lib/laborLawConfig";
import {
  employeeWhereForWorkSite,
  parseWorkSiteParam,
  workSiteToParam,
} from "@/lib/workSite";
import { z } from "zod";

type CellRow = {
  employeeId: string;
  layer: ShiftLayer;
  dayIndex: number;
  rawValue: string;
  note: string;
};

function packShiftField(
  cells: CellRow[],
  empId: string,
  layer: ShiftLayer,
  field: "rawValue" | "note"
): string[] {
  const arr = Array(7).fill("");
  for (const c of cells) {
    if (c.employeeId === empId && c.layer === layer) arr[c.dayIndex] = c[field];
  }
  return arr;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const start = parseWeekStartParam(searchParams.get("start"));
  if (!start) {
    return NextResponse.json(
      { error: "Query start=YYYY-MM-DD (Montag der Woche) erforderlich." },
      { status: 400 }
    );
  }

  const site = parseWorkSiteParam(searchParams.get("site"));

  let week = await prisma.workWeek.findUnique({
    where: { weekStart_site: { weekStart: start, site } },
  });
  if (!week) {
    week = await prisma.workWeek.create({
      data: { weekStart: start, site, status: WeekStatus.DRAFT },
    });
  }

  const employees = await prisma.employee.findMany({
    where: { active: true, ...employeeWhereForWorkSite(site) },
    orderBy: { name: "asc" },
  });

  const cellsRaw = await prisma.shiftCell.findMany({
    where: { workWeekId: week.id },
  });
  const cells: CellRow[] = cellsRaw.map((c) => ({
    employeeId: c.employeeId,
    layer: c.layer,
    dayIndex: c.dayIndex,
    rawValue: c.rawValue,
    note: c.note ?? "",
  }));

  const weekStartStr = formatWeekStart(start);
  const prevMondayStr = addDaysISO(weekStartStr, -7);
  const prevStart = parseWeekStartParam(prevMondayStr);
  let prevSundayByEmpPlan = new Map<string, string | null>();
  let prevSundayByEmpActual = new Map<string, string | null>();
  if (prevStart) {
    const prevWeek = await prisma.workWeek.findUnique({
      where: { weekStart_site: { weekStart: prevStart, site } },
    });
    if (prevWeek) {
      const prevCells = await prisma.shiftCell.findMany({
        where: { workWeekId: prevWeek.id, dayIndex: 6 },
      });
      for (const e of employees) {
        const p = prevCells.find(
          (x) => x.employeeId === e.id && x.layer === ShiftLayer.PLAN
        );
        const a = prevCells.find(
          (x) => x.employeeId === e.id && x.layer === ShiftLayer.ACTUAL
        );
        prevSundayByEmpPlan.set(e.id, p?.rawValue ?? null);
        prevSundayByEmpActual.set(e.id, a?.rawValue ?? null);
      }
    }
  }

  const lastDayStr = addDaysISO(weekStartStr, 6);
  const holidayRows = await prisma.holiday.findMany({
    where: {
      includedInPlan: true,
      date: {
        gte: new Date(`${weekStartStr}T00:00:00.000Z`),
        lte: new Date(`${lastDayStr}T23:59:59.999Z`),
      },
    },
  });
  const holidayMap = buildHolidayMap(holidayRows);
  const feiDaysInWeek = countHolidayDaysInWeek(weekStartStr, holidayMap);

  const days = Array.from({ length: 7 }, (_, i) => {
    const dateISO = addDaysISO(weekStartStr, i);
    return {
      dayIndex: i,
      dateISO,
      holidays: holidayMap.get(dateISO) ?? [],
    };
  });

  const weekDatesISO = days.map((d) => d.dateISO);

  const rows = await Promise.all(
    employees.map(async (e) => {
      const plan = packShiftField(cells, e.id, ShiftLayer.PLAN, "rawValue");
      const actual = packShiftField(cells, e.id, ShiftLayer.ACTUAL, "rawValue");
      const planNotes = packShiftField(cells, e.id, ShiftLayer.PLAN, "note");
      const actualNotes = packShiftField(cells, e.id, ShiftLayer.ACTUAL, "note");
      const wsPlan = computeWeeklyBalance(
        plan,
        e.contractHoursPerWeek,
        e.workDaysPerWeek
      );
      const wsAct = computeWeeklyBalance(
        actual,
        e.contractHoursPerWeek,
        e.workDaysPerWeek
      );
      const base = await getBalanceBeforeWeek(e.id, start, site);
      const zagPreview = base + wsAct.deltaVsContract;
      const laborHintsPlan = austrianLaborHintsForWeek(
        weekDatesISO,
        plan,
        prevSundayByEmpPlan.get(e.id) ?? null
      );
      const laborHintsActual = austrianLaborHintsForWeek(
        weekDatesISO,
        actual,
        prevSundayByEmpActual.get(e.id) ?? null
      );
      return {
        employee: {
          id: e.id,
          name: e.name,
          workSite: e.workSite,
          contractHoursPerWeek: e.contractHoursPerWeek,
          workDaysPerWeek: e.workDaysPerWeek,
          vacationDaysOpen: e.vacationDaysOpen,
        },
        plan,
        actual,
        planNotes,
        actualNotes,
        wsPlan: wsPlan.weeklyHours,
        wsActual: wsAct.weeklyHours,
        errorsPlan: wsPlan.errors,
        errorsActual: wsAct.errors,
        balanceBeforeWeek: base,
        zagPreview,
        laborHintsPlan,
        laborHintsActual,
      };
    })
  );

  return NextResponse.json({
    weekStart: weekStartStr,
    site: workSiteToParam(site),
    status: week.status,
    isoWeek: isoWeekNumberUTC(start),
    feiDaysInWeek,
    days,
    rows,
    laborLawDisclaimer: LABOR_LAW_DISCLAIMER_DE,
  });
}

const putSchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  site: z.enum(["CRUSH", "CAPPUCONE"]).optional().default("CRUSH"),
  cells: z.array(
    z.object({
      employeeId: z.string(),
      dayIndex: z.number().int().min(0).max(6),
      layer: z.enum(["PLAN", "ACTUAL"]),
      rawValue: z.string(),
      note: z.string().max(2000).optional().default(""),
    })
  ),
});

async function actualArrayForEmployee(
  weekId: string,
  employeeId: string
): Promise<string[]> {
  const cells = await prisma.shiftCell.findMany({
    where: { workWeekId: weekId, employeeId, layer: ShiftLayer.ACTUAL },
  });
  const arr = Array(7).fill("");
  for (const c of cells) arr[c.dayIndex] = c.rawValue;
  return arr;
}

export async function PUT(req: Request) {
  try {
    const body = putSchema.parse(await req.json());
    const start = parseWeekStartParam(body.start);
    if (!start) {
      return NextResponse.json({ error: "Ungültiger Wochenstart." }, { status: 400 });
    }

    const site =
      body.site === "CAPPUCONE" ? WorkSite.CAPPUCONE : WorkSite.CRUSH;

    const week = await prisma.workWeek.findUnique({
      where: { weekStart_site: { weekStart: start, site } },
    });
    if (!week) {
      return NextResponse.json({ error: "Woche nicht gefunden." }, { status: 404 });
    }
    if (week.status === WeekStatus.CLOSED) {
      return NextResponse.json(
        { error: "Woche ist abgeschlossen und nicht änderbar." },
        { status: 400 }
      );
    }

    const employees = await prisma.employee.findMany({
      where: { active: true, ...employeeWhereForWorkSite(site) },
    });
    const allowed = new Set(employees.map((e) => e.id));
    for (const c of body.cells) {
      if (!allowed.has(c.employeeId)) {
        return NextResponse.json(
          { error: "Zelle für Mitarbeiter außerhalb dieses Standorts." },
          { status: 400 }
        );
      }
    }

    const beforeU = new Map<string, number>();
    for (const e of employees) {
      const arr = await actualArrayForEmployee(week.id, e.id);
      beforeU.set(e.id, countVacationDaysInWeek(arr));
    }

    await prisma.$transaction(async (tx) => {
      for (const c of body.cells) {
        const layer = c.layer === "PLAN" ? ShiftLayer.PLAN : ShiftLayer.ACTUAL;
        await tx.shiftCell.upsert({
          where: {
            workWeekId_employeeId_dayIndex_layer: {
              workWeekId: week.id,
              employeeId: c.employeeId,
              dayIndex: c.dayIndex,
              layer,
            },
          },
          create: {
            workWeekId: week.id,
            employeeId: c.employeeId,
            dayIndex: c.dayIndex,
            layer,
            rawValue: c.rawValue,
            note: c.note ?? "",
          },
          update: { rawValue: c.rawValue, note: c.note ?? "" },
        });
      }

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
        const afterU = countVacationDaysInWeek(arr);
        const before = beforeU.get(e.id) ?? 0;
        const delta = before - afterU;
        if (delta !== 0) {
          await tx.employee.update({
            where: { id: e.id },
            data: { vacationDaysOpen: { increment: delta } },
          });
        }
      }
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Ungültige Daten." }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ error: "Speichern fehlgeschlagen." }, { status: 500 });
  }
}
