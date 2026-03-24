import { NextResponse } from "next/server";
import { EmployeeSite, ShiftLayer, WorkSite } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseShiftCell } from "@/lib/parseShiftCell";
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
            layer: ShiftLayer.ACTUAL,
          },
          select: {
            workWeekId: true,
            employeeId: true,
            dayIndex: true,
            rawValue: true,
          },
        });

  const rawLookup = new Map<string, string>();
  for (const c of cells) {
    rawLookup.set(`${c.workWeekId}|${c.employeeId}|${c.dayIndex}`, c.rawValue);
  }

  const employees = await prisma.employee.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
  });

  const rows = await Promise.all(
    employees.map(async (e) => {
      let istHours = 0;
      let vacationDays = 0;
      const parseErrors: string[] = [];

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

        let dayU = false;
        let dayHours = 0;
        for (const wid of wids) {
          const raw =
            rawLookup.get(`${wid}|${e.id}|${di}`) ?? "";
          const u = raw.trim().toUpperCase();
          if (u.startsWith("U")) {
            dayU = true;
            break;
          }
          const r = parseShiftCell(raw, e.contractHoursPerWeek, e.workDaysPerWeek);
          if (!r.ok) {
            if (raw.trim()) parseErrors.push(`${day}: ${r.error}`);
            continue;
          }
          dayHours += r.hours;
        }
        if (dayU) vacationDays += 1;
        else istHours += dayHours;
      }

      const { balance, explanation } = await getBalanceAtPeriodEnd(e.id, toISO);

      return {
        employeeId: e.id,
        name: e.name,
        workSite: e.workSite,
        workSiteLabel: employeeSiteLabel(e.workSite),
        contractHoursPerWeek: e.contractHoursPerWeek,
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
      "Keine offizielle Lohnabrechnung. Ist-Stunden aus Ist-Zellen (Standort gemäß Mitarbeiter-Zuordnung Crush/CappuCone/Geteilt); bei Geteilt werden beide Standorte pro Tag summiert; Urlaubstage = Tage mit „U“ in der Ist-Zeile; Stundenkonto gemäß letzter abgeschlossener Woche.",
    rows,
  });
}
