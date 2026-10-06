import { NextResponse } from "next/server";
import {
  EmployeeSite,
  ShiftLayer,
  VacationLedgerKind,
  WeekStatus,
  WorkSite,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { addDaysISO } from "@/lib/dateNav";
import { buildHolidayMap } from "@/lib/holidays";
import { schoolBreakFindManySafe } from "@/lib/schoolBreakDb";
import {
  countHighlightedCalendarDays,
  ferienByDateForWeek,
  holidayDateKeysFromMap,
} from "@/lib/schoolBreaks";
import {
  formatWeekStart,
  isoWeekNumberUTC,
  parseWeekStartParam,
} from "@/lib/weekUtils";
import {
  computeWeeklyBalanceWithContracts,
} from "@/lib/computeWeekly";
import { contractForDate } from "@/lib/employeeContract";
import {
  contractRowsMapForEmployees,
  normalizePlaceholderContractsAll,
} from "@/lib/employeeContractLoad";
import {
  getBalancesBeforeWeekForEmployees,
  getSharedBalancesForWeek,
} from "@/lib/balance";
import {
  employeeVisibleInWeek,
  employmentBoundsFromDates,
} from "@/lib/employmentWeekTarget";
import { countVacationDaysInWeekWithPlanActual } from "@/lib/vacation";
import {
  countedCellsForSite,
  countVacationDaysCalendarWeek,
  isAbsenceCell,
  mixedDayIndexes,
  otherSiteKey,
  type PlanActual,
  type SiteKey,
  siteKeyLabel,
} from "@/lib/sharedSite";
import { openingEffectiveDateForEmployee } from "@/lib/vacationCutover";
import {
  appendVacationLedger,
  ensureVacationOpeningMigration,
} from "@/lib/vacationLedger";
import {
  employeeWhereForWorkSite,
  parseWorkSiteParam,
  planOrderByForWorkSite,
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

  await normalizePlaceholderContractsAll();

  let week = await prisma.workWeek.findUnique({
    where: { weekStart_site: { weekStart: start, site } },
  });
  if (!week) {
    week = await prisma.workWeek.create({
      data: { weekStart: start, site, status: WeekStatus.DRAFT },
    });
  }

  const weekStartStr = formatWeekStart(start);
  const lastDayStr = addDaysISO(weekStartStr, 6);
  const weekStartD = new Date(`${weekStartStr}T12:00:00.000Z`);
  const lastDayD = new Date(`${lastDayStr}T12:00:00.000Z`);
  const prevMondayStr = addDaysISO(weekStartStr, -7);
  const prevStart = parseWeekStartParam(prevMondayStr);

  const [
    employees,
    cellsRaw,
    holidayRows,
    schoolBreakRows,
    prevSundayMaps,
  ] = await Promise.all([
    prisma.employee.findMany({
      where: { active: true, ...employeeWhereForWorkSite(site) },
      orderBy: [...planOrderByForWorkSite(site)],
    }),
    prisma.shiftCell.findMany({
      where: { workWeekId: week.id },
    }),
    prisma.holiday.findMany({
      where: {
        includedInPlan: true,
        date: {
          gte: new Date(`${weekStartStr}T00:00:00.000Z`),
          lte: new Date(`${lastDayStr}T23:59:59.999Z`),
        },
      },
    }),
    schoolBreakFindManySafe(prisma, {
      where: {
        includedInPlan: true,
        AND: [{ startDate: { lte: lastDayD } }, { endDate: { gte: weekStartD } }],
      },
    }),
    (async (): Promise<{
      plan: Map<string, string | null>;
      actual: Map<string, string | null>;
    }> => {
      const plan = new Map<string, string | null>();
      const actual = new Map<string, string | null>();
      if (!prevStart) return { plan, actual };
      const prevWeek = await prisma.workWeek.findUnique({
        where: { weekStart_site: { weekStart: prevStart, site } },
      });
      if (!prevWeek) return { plan, actual };
      const prevCells = await prisma.shiftCell.findMany({
        where: { workWeekId: prevWeek.id, dayIndex: 6 },
      });
      for (const c of prevCells) {
        if (c.layer === ShiftLayer.PLAN) plan.set(c.employeeId, c.rawValue ?? null);
        if (c.layer === ShiftLayer.ACTUAL)
          actual.set(c.employeeId, c.rawValue ?? null);
      }
      return { plan, actual };
    })(),
  ]);

  const cells: CellRow[] = cellsRaw.map((c) => ({
    employeeId: c.employeeId,
    layer: c.layer,
    dayIndex: c.dayIndex,
    rawValue: c.rawValue,
    note: c.note ?? "",
  }));

  const prevSundayByEmpPlan = prevSundayMaps.plan;
  const prevSundayByEmpActual = prevSundayMaps.actual;

  const holidayMap = buildHolidayMap(holidayRows);
  const ferienMap = ferienByDateForWeek(weekStartStr, schoolBreakRows);
  const holidayKeys = holidayDateKeysFromMap(weekStartStr, holidayMap);
  const feiDaysInWeek = countHighlightedCalendarDays(
    weekStartStr,
    holidayKeys,
    ferienMap
  );

  const days = Array.from({ length: 7 }, (_, i) => {
    const dateISO = addDaysISO(weekStartStr, i);
    return {
      dayIndex: i,
      dateISO,
      holidays: holidayMap.get(dateISO) ?? [],
      ferien: ferienMap.get(dateISO) ?? [],
    };
  });

  const balanceByEmp = await getBalancesBeforeWeekForEmployees(
    employees.map((e) => ({
      id: e.id,
      startBalanceHours: e.startBalanceHours,
    })),
    start,
    site
  );
  const sharedEmployees = employees.filter((e) => e.workSite === EmployeeSite.SHARED);
  const { byEmployee: sharedBalanceByEmp, otherWeek } = await getSharedBalancesForWeek(
    sharedEmployees.map((e) => ({ id: e.id, startBalanceHours: e.startBalanceHours })),
    start,
    site
  );

  const contractMap = await contractRowsMapForEmployees(employees.map((e) => e.id));

  // Geteilt: Zellen der anderen Filiale in dieser KW — für „U/K/FT nur einmal“,
  // und (solange dort offen) deren Stunden live im ZAG, damit beide Dienstpläne
  // denselben Wert zeigen.
  const ownSiteKey: SiteKey = site === WorkSite.CAPPUCONE ? "CAPPUCONE" : "CRUSH";
  const otherCellsByEmp = new Map<string, PlanActual>();
  if (otherWeek && sharedEmployees.length > 0) {
    const otherCells = await prisma.shiftCell.findMany({
      where: {
        workWeekId: otherWeek.id,
        employeeId: { in: sharedEmployees.map((e) => e.id) },
      },
      select: { employeeId: true, dayIndex: true, layer: true, rawValue: true },
    });
    for (const e of sharedEmployees) {
      const pa: PlanActual = { plan: Array(7).fill(""), actual: Array(7).fill("") };
      for (const c of otherCells) {
        if (c.employeeId !== e.id) continue;
        (c.layer === ShiftLayer.PLAN ? pa.plan : pa.actual)[c.dayIndex] = c.rawValue;
      }
      otherCellsByEmp.set(e.id, pa);
    }
  }

  const visibleEmployees = employees.filter((e) =>
    employeeVisibleInWeek(
      weekStartStr,
      e.entryDate ? e.entryDate.toISOString().slice(0, 10) : null,
      e.exitDate ? e.exitDate.toISOString().slice(0, 10) : null
    )
  );

  const rows = visibleEmployees.map((e) => {
    const contractRows = contractMap.get(e.id) ?? [];
    const cWeek = contractForDate(contractRows, weekStartStr);
    const employment = employmentBoundsFromDates(e.entryDate, e.exitDate);
    const plan = packShiftField(cells, e.id, ShiftLayer.PLAN, "rawValue");
    const actual = packShiftField(cells, e.id, ShiftLayer.ACTUAL, "rawValue");
    const planNotes = packShiftField(cells, e.id, ShiftLayer.PLAN, "note");
    const actualNotes = packShiftField(cells, e.id, ShiftLayer.ACTUAL, "note");
    const other = otherCellsByEmp.get(e.id);
    const wsPlan = computeWeeklyBalanceWithContracts(
      countedCellsForSite(plan, ownSiteKey, other?.plan),
      weekStartStr,
      contractRows,
      holidayKeys,
      employment
    );
    const wsAct = computeWeeklyBalanceWithContracts(
      countedCellsForSite(actual, ownSiteKey, other?.actual),
      weekStartStr,
      contractRows,
      holidayKeys,
      employment
    );
    const shared = sharedBalanceByEmp.get(e.id);
    const base = shared?.base ?? balanceByEmp.get(e.id) ?? e.startBalanceHours;
    const sollAlreadyBooked = shared?.sollAlreadyBooked ?? false;
    const otherOpenActual =
      other && otherWeek && !otherWeek.closed
        ? computeWeeklyBalanceWithContracts(
            countedCellsForSite(other.actual, otherSiteKey(ownSiteKey), actual),
            weekStartStr,
            contractRows,
            holidayKeys,
            employment
          ).weeklyHours
        : 0;
    const zagPreview =
      base +
      otherOpenActual +
      (sollAlreadyBooked ? wsAct.weeklyHours : wsAct.deltaVsContract);
    return {
      employee: {
        id: e.id,
        name: e.name,
        workSite: e.workSite,
        contractHoursPerWeek: cWeek.contractHoursPerWeek,
        workDaysPerWeek: cWeek.workDaysPerWeek,
        vacationDaysOpen: e.vacationDaysOpen,
        entryDate: e.entryDate ? e.entryDate.toISOString().slice(0, 10) : null,
        exitDate: e.exitDate ? e.exitDate.toISOString().slice(0, 10) : null,
      },
      contractRows,
      plan,
      actual,
      planNotes,
      actualNotes,
      wsPlan: wsPlan.weeklyHours,
      wsActual: wsAct.weeklyHours,
      errorsPlan: wsPlan.errors,
      errorsActual: wsAct.errors,
      balanceBeforeWeek: base,
      sollAlreadyBooked,
      /** Geteilt: Zellen der anderen Filiale (gleiche KW) + ob sie dort schon abgeschlossen ist. */
      otherSite: other
        ? { site: otherSiteKey(ownSiteKey), ...other, closed: otherWeek?.closed ?? false }
        : undefined,
      zagPreview,
      /** Für Ruhezeit So→Mo: Sonntag Vorwoche (Client berechnet Hinweise live aus Grid) */
      prevSundayPlan: prevSundayByEmpPlan.get(e.id) ?? null,
      prevSundayActual: prevSundayByEmpActual.get(e.id) ?? null,
    };
  });

  return NextResponse.json(
    {
      weekStart: weekStartStr,
      site: workSiteToParam(site),
      status: week.status,
      isoWeek: isoWeekNumberUTC(start),
      feiDaysInWeek,
      days,
      rows,
    },
    {
      headers: {
        "Cache-Control": "private, no-store, max-age=0, must-revalidate",
      },
    }
  );
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
      orderBy: [...planOrderByForWorkSite(site)],
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

    const weekStartStrPut = formatWeekStart(start);
    const contractMapPut = await contractRowsMapForEmployees(
      employees.map((e) => e.id)
    );

    const [allPlanBefore, allActualBefore] = await Promise.all([
      prisma.shiftCell.findMany({
        where: { workWeekId: week.id, layer: ShiftLayer.PLAN },
        select: { employeeId: true, dayIndex: true, rawValue: true },
      }),
      prisma.shiftCell.findMany({
        where: { workWeekId: week.id, layer: ShiftLayer.ACTUAL },
        select: { employeeId: true, dayIndex: true, rawValue: true },
      }),
    ]);
    const beforePlanArrays = new Map<string, string[]>();
    const beforeActualArrays = new Map<string, string[]>();
    for (const e of employees) {
      beforePlanArrays.set(e.id, Array(7).fill(""));
      beforeActualArrays.set(e.id, Array(7).fill(""));
    }
    for (const c of allPlanBefore) {
      const arr = beforePlanArrays.get(c.employeeId);
      if (arr) arr[c.dayIndex] = c.rawValue;
    }
    for (const c of allActualBefore) {
      const arr = beforeActualArrays.get(c.employeeId);
      if (arr) arr[c.dayIndex] = c.rawValue;
    }

    // ---- Geteilte Mitarbeiter: Zellen der anderen Filiale dieser KW ----
    const ownSiteKey: SiteKey = site === WorkSite.CAPPUCONE ? "CAPPUCONE" : "CRUSH";
    const sharedIds = employees
      .filter((e) => e.workSite === EmployeeSite.SHARED)
      .map((e) => e.id);
    const otherWeekPut = await prisma.workWeek.findUnique({
      where: {
        weekStart_site: {
          weekStart: start,
          site: site === WorkSite.CRUSH ? WorkSite.CAPPUCONE : WorkSite.CRUSH,
        },
      },
      select: { id: true, status: true },
    });
    const otherByEmp = new Map<string, PlanActual>();
    if (otherWeekPut && sharedIds.length > 0) {
      const oc = await prisma.shiftCell.findMany({
        where: { workWeekId: otherWeekPut.id, employeeId: { in: sharedIds } },
        select: { employeeId: true, dayIndex: true, layer: true, rawValue: true },
      });
      for (const id of sharedIds) {
        otherByEmp.set(id, { plan: Array(7).fill(""), actual: Array(7).fill("") });
      }
      for (const c of oc) {
        const pa = otherByEmp.get(c.employeeId);
        if (pa) (c.layer === ShiftLayer.PLAN ? pa.plan : pa.actual)[c.dayIndex] = c.rawValue;
      }
    }

    // Sperren für geteilte Mitarbeiter (nur geänderte Zellen prüfen):
    // 1. Mischtag U/K + Dienst über beide Filialen.
    // 2. Crush ändert U/K/FT an einem Tag, an dem die schon abgeschlossene
    //    CappuCone-Woche auch U/K/FT hat — sonst stimmt deren Buchung nicht mehr.
    const nameById = new Map(employees.map((e) => [e.id, e.name]));
    const otherLabel = siteKeyLabel(otherSiteKey(ownSiteKey));
    const dayDe = (i: number) =>
      addDaysISO(weekStartStrPut, i).split("-").reverse().slice(0, 2).join(".") + ".";
    const sharedBlockers: string[] = [];
    for (const c of body.cells) {
      const other = otherByEmp.get(c.employeeId);
      if (!other) continue;
      const before =
        (c.layer === "PLAN" ? beforePlanArrays : beforeActualArrays).get(c.employeeId)?.[
          c.dayIndex
        ] ?? "";
      if (before.trim() === c.rawValue.trim()) continue;
      const otherCell = (c.layer === "PLAN" ? other.plan : other.actual)[c.dayIndex] ?? "";
      const nm = nameById.get(c.employeeId) ?? "";
      const layerDe = c.layer === "PLAN" ? "Plan" : "Ist";
      const own = Array(7).fill("");
      own[c.dayIndex] = c.rawValue;
      const ot = Array(7).fill("");
      ot[c.dayIndex] = otherCell;
      if (mixedDayIndexes(own, ot).length > 0) {
        sharedBlockers.push(
          `${nm}, ${dayDe(c.dayIndex)} (${layerDe}): Urlaub/Krank und Dienst am selben Tag — bei ${otherLabel} steht „${otherCell.trim()}“.`
        );
      }
      if (
        ownSiteKey === "CRUSH" &&
        c.layer === "ACTUAL" &&
        otherWeekPut?.status === WeekStatus.CLOSED &&
        isAbsenceCell(otherCell) &&
        isAbsenceCell(before) !== isAbsenceCell(c.rawValue)
      ) {
        sharedBlockers.push(
          `${nm}, ${dayDe(c.dayIndex)}: Bei CappuCone (Woche abgeschlossen) steht „${otherCell.trim()}“ — U/K/FT hier nur ändern, nachdem die CappuCone-Woche wieder geöffnet ist.`
        );
      }
    }
    if (sharedBlockers.length > 0) {
      return NextResponse.json(
        {
          error: `Speichern nicht möglich — geteilte Mitarbeiter:\n${sharedBlockers.join("\n")}`,
        },
        { status: 400 }
      );
    }

    /** Urlaubstage dieser Woche; geteilt: ganze Kalenderwoche beider Filialen (U nur einmal). */
    const vacationUnits = (
      e: (typeof employees)[number],
      own: PlanActual
    ): number => {
      const rows = contractMapPut.get(e.id) ?? [];
      const employment = employmentBoundsFromDates(e.entryDate, e.exitDate);
      const other = otherByEmp.get(e.id);
      if (!other) {
        return countVacationDaysInWeekWithPlanActual(
          own.plan,
          own.actual,
          weekStartStrPut,
          rows,
          employment
        );
      }
      return ownSiteKey === "CRUSH"
        ? countVacationDaysCalendarWeek(own, other, weekStartStrPut, rows, employment)
        : countVacationDaysCalendarWeek(other, own, weekStartStrPut, rows, employment);
    };

    const beforeU = new Map<string, number>();
    for (const e of employees) {
      beforeU.set(
        e.id,
        vacationUnits(e, {
          plan: beforePlanArrays.get(e.id)!,
          actual: beforeActualArrays.get(e.id)!,
        })
      );
    }

    await prisma.$transaction(
      async (tx) => {
        await Promise.all(
          body.cells.map((c) => {
            const layer = c.layer === "PLAN" ? ShiftLayer.PLAN : ShiftLayer.ACTUAL;
            return tx.shiftCell.upsert({
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
          })
        );

        const [allPlanAfter, allActualAfter] = await Promise.all([
          tx.shiftCell.findMany({
            where: { workWeekId: week.id, layer: ShiftLayer.PLAN },
            select: { employeeId: true, dayIndex: true, rawValue: true },
          }),
          tx.shiftCell.findMany({
            where: { workWeekId: week.id, layer: ShiftLayer.ACTUAL },
            select: { employeeId: true, dayIndex: true, rawValue: true },
          }),
        ]);
        const afterPlanArrays = new Map<string, string[]>();
        const afterActualArrays = new Map<string, string[]>();
        for (const e of employees) {
          afterPlanArrays.set(e.id, Array(7).fill(""));
          afterActualArrays.set(e.id, Array(7).fill(""));
        }
        for (const c of allPlanAfter) {
          const arr = afterPlanArrays.get(c.employeeId);
          if (arr) arr[c.dayIndex] = c.rawValue;
        }
        for (const c of allActualAfter) {
          const arr = afterActualArrays.get(c.employeeId);
          if (arr) arr[c.dayIndex] = c.rawValue;
        }

        for (const e of employees) {
          const bal = await tx.employee.findUnique({
            where: { id: e.id },
            select: { vacationDaysOpen: true },
          });
          if (bal) {
            await ensureVacationOpeningMigration(tx, e.id, bal.vacationDaysOpen, {
              openingEffectiveDate: openingEffectiveDateForEmployee(e.entryDate),
            });
          }
        }
        for (const e of employees) {
          const afterU = vacationUnits(e, {
            plan: afterPlanArrays.get(e.id)!,
            actual: afterActualArrays.get(e.id)!,
          });
          const before = beforeU.get(e.id) ?? 0;
          const delta = before - afterU;
          if (delta !== 0) {
            await appendVacationLedger(tx, {
              employeeId: e.id,
              amount: delta,
              kind: VacationLedgerKind.CONSUMPTION_ROTA,
              note: `Woche ${weekStartStrPut} · Plan/Ist Urlaub`,
            });
          }
        }
      },
      { maxWait: 10_000, timeout: 60_000 }
    );

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Ungültige Daten." }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ error: "Speichern fehlgeschlagen." }, { status: 500 });
  }
}
