import { NextResponse } from "next/server";
import { EmployeeSite, ShiftLayer, WorkSite } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseShiftCell } from "@/lib/parseShiftCell";
import { vacationDayUnitsForDayPlanActual } from "@/lib/vacation";
import { contractForDate } from "@/lib/employeeContract";
import { contractRowsMapForEmployees } from "@/lib/employeeContractLoad";
import {
  enumerateDatesInclusive,
  weekStartISOContainingDate,
  dayIndexInWeek,
} from "@/lib/dateNav";
import { parseWeekStartParam, formatWeekStart } from "@/lib/weekUtils";
import { getBalanceAtPeriodEnd, workWeekRowsForStarts } from "@/lib/balance";
import { employeeSiteLabel } from "@/lib/workSite";

function lastDayOfMonth(year: number, month1to12: number): string {
  const d = new Date(year, month1to12, 0, 12, 0, 0);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function firstDayOfMonth(year: number, month1to12: number): string {
  return `${year}-${String(month1to12).padStart(2, "0")}-01`;
}

function weekIdsForEmployeeOnMonday(
  empSite: EmployeeSite,
  crushId: string | undefined,
  capId: string | undefined
): string[] {
  switch (empSite) {
    case EmployeeSite.CRUSH:
      return crushId ? [crushId] : [];
    case EmployeeSite.CAPPUCONE:
      return capId ? [capId] : [];
    default:
      return [crushId, capId].filter(Boolean) as string[];
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month");
  const fromQ = searchParams.get("from");
  const toQ = searchParams.get("to");

  let fromISO: string;
  let toISO: string;

  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split("-").map(Number);
    if (!y || !m || m < 1 || m > 12) {
      return NextResponse.json({ error: "Ungültiger Monat." }, { status: 400 });
    }
    fromISO = firstDayOfMonth(y, m);
    toISO = lastDayOfMonth(y, m);
  } else if (
    fromQ &&
    toQ &&
    /^\d{4}-\d{2}-\d{2}$/.test(fromQ) &&
    /^\d{4}-\d{2}-\d{2}$/.test(toQ)
  ) {
    fromISO = fromQ;
    toISO = toQ;
  } else {
    return NextResponse.json(
      {
        error:
          "Query month=YYYY-MM oder from=YYYY-MM-DD und to=YYYY-MM-DD erforderlich.",
      },
      { status: 400 }
    );
  }

  if (fromISO > toISO) {
    return NextResponse.json({ error: "from muss ≤ to sein." }, { status: 400 });
  }

  const days = enumerateDatesInclusive(fromISO, toISO);
  const weekStarts = Array.from(
    new Set(days.map((d) => weekStartISOContainingDate(d)))
  );
  const weekStartDates = weekStarts
    .map((s) => parseWeekStartParam(s))
    .filter((d): d is Date => d != null);

  const weekRows = await workWeekRowsForStarts(weekStartDates);
  const idsByMonday = new Map<
    string,
    { crush?: string; cappucone?: string }
  >();
  for (const w of weekRows) {
    const key = formatWeekStart(w.weekStart);
    const cur = idsByMonday.get(key) ?? {};
    if (w.site === WorkSite.CRUSH) cur.crush = w.id;
    else cur.cappucone = w.id;
    idsByMonday.set(key, cur);
  }

  const allWeekIds = Array.from(
    new Set(
      weekRows.map((w) => w.id)
    )
  );

  const cells =
    allWeekIds.length === 0
      ? []
      : await prisma.shiftCell.findMany({
          where: {
            workWeekId: { in: allWeekIds },
            layer: { in: [ShiftLayer.PLAN, ShiftLayer.ACTUAL] },
          },
          select: {
            workWeekId: true,
            employeeId: true,
            dayIndex: true,
            layer: true,
            rawValue: true,
          },
        });

  const planLookup = new Map<string, string>();
  const actualLookup = new Map<string, string>();
  for (const c of cells) {
    const key = `${c.workWeekId}|${c.employeeId}|${c.dayIndex}`;
    if (c.layer === ShiftLayer.PLAN) planLookup.set(key, c.rawValue);
    if (c.layer === ShiftLayer.ACTUAL) actualLookup.set(key, c.rawValue);
  }

  const employees = await prisma.employee.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
  });

  const contractMapPayroll = await contractRowsMapForEmployees(
    employees.map((e) => e.id)
  );

  const rows = await Promise.all(
    employees.map(async (e) => {
      let istHours = 0;
      let vacationDays = 0;
      const parseErrors: string[] = [];
      const rowsC = contractMapPayroll.get(e.id) ?? [];

      for (const day of days) {
        const ws = weekStartISOContainingDate(day);
        const di = dayIndexInWeek(ws, day);
        if (di < 0 || di > 6) continue;
        const pair = idsByMonday.get(ws);
        const wids = weekIdsForEmployeeOnMonday(
          e.workSite,
          pair?.crush,
          pair?.cappucone
        );
        if (wids.length === 0) continue;

        const cDay = contractForDate(rowsC, day);
        let dayVacationUnits = 0;
        let dayHours = 0;
        for (const wid of wids) {
          const key = `${wid}|${e.id}|${di}`;
          const planRaw = planLookup.get(key) ?? "";
          const actualRaw = actualLookup.get(key) ?? "";
          const vu = vacationDayUnitsForDayPlanActual(
            planRaw,
            actualRaw,
            cDay.contractHoursPerWeek,
            cDay.workDaysPerWeek
          );
          if (vu > 0) {
            dayVacationUnits = vu;
            break;
          }
          const r = parseShiftCell(
            actualRaw,
            cDay.contractHoursPerWeek,
            cDay.workDaysPerWeek
          );
          if (!r.ok) {
            if (actualRaw.trim()) parseErrors.push(`${day}: ${r.error}`);
            continue;
          }
          dayHours += r.hours;
        }
        if (dayVacationUnits > 0) vacationDays += dayVacationUnits;
        else istHours += dayHours;
      }

      const { balance, explanation } = await getBalanceAtPeriodEnd(e.id, toISO);

      const cToday = contractForDate(rowsC, toISO);
      return {
        employeeId: e.id,
        name: e.name,
        workSite: e.workSite,
        workSiteLabel: employeeSiteLabel(e.workSite),
        contractHoursPerWeek: cToday.contractHoursPerWeek,
        vacationDaysOpenNow: e.vacationDaysOpen,
        istHoursInPeriod: istHours,
        vacationDaysInPeriod: vacationDays,
        balanceHoursAtEnd: balance,
        balanceExplanation: explanation,
        parseErrors: parseErrors.slice(0, 25),
      };
    })
  );

  return NextResponse.json({
    from: fromISO,
    to: toISO,
    disclaimer:
      "Keine offizielle Lohnabrechnung. Stunden aus Ist-Zelle, falls leer aus Plan; Urlaub = „U“/„U(h)“ — Ist zählt wenn befüllt, sonst Plan (wie Urlaubskonto im Dienstplan). Stundenkonto gemäß letzter abgeschlossener Woche.",
    rows,
  });
}
