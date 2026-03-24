import { WeekStatus, WorkSite } from "@prisma/client";
import { prisma } from "./prisma";
import { weekStartISOContainingDate } from "./dateNav";
import { parseWeekStartParam, formatWeekStart } from "./weekUtils";

function cmpWeekSite(
  a: { weekStart: Date; site: WorkSite },
  b: { weekStart: Date; site: WorkSite }
): number {
  const t = a.weekStart.getTime() - b.weekStart.getTime();
  if (t !== 0) return t;
  if (a.site === b.site) return 0;
  return a.site === WorkSite.CRUSH ? -1 : 1;
}

/** Streng vor (weekStart, site): lexikographisch kleiner, nur CLOSED. */
function whereClosedBefore(weekStart: Date, site: WorkSite) {
  if (site === WorkSite.CAPPUCONE) {
    return {
      OR: [
        { weekStart: { lt: weekStart } },
        { AND: [{ weekStart }, { site: WorkSite.CRUSH }] },
      ],
    };
  }
  return { weekStart: { lt: weekStart } };
}

/** Kontostand vor dieser Kalenderwoche am gewählten Standort (nach abgeschlossenen Vorperioden). */
export async function getBalanceBeforeWeek(
  employeeId: string,
  weekStart: Date,
  site: WorkSite
): Promise<number> {
  const emp = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!emp) throw new Error("Mitarbeiter nicht gefunden");

  const last = await prisma.timeAccountLine.findFirst({
    where: {
      employeeId,
      workWeek: {
        status: WeekStatus.CLOSED,
        ...whereClosedBefore(weekStart, site),
      },
    },
    orderBy: [{ workWeek: { weekStart: "desc" } }, { workWeek: { site: "desc" } }],
  });

  return last?.balanceAfter ?? emp.startBalanceHours;
}

/**
 * Stundenkonto nach der letzten abgeschlossenen (weekStart, site)-Position
 * auf oder vor der Woche, die den letzten Tag des Zeitraums enthält.
 */
export async function getBalanceAtPeriodEnd(
  employeeId: string,
  lastDayISO: string
): Promise<{ balance: number; explanation: string }> {
  const emp = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!emp) throw new Error("Mitarbeiter nicht gefunden");

  const mondayISO = weekStartISOContainingDate(lastDayISO);
  const monDate = parseWeekStartParam(mondayISO);
  if (!monDate) throw new Error("Ungültiges Datum");

  const endWeeks = await prisma.workWeek.findMany({
    where: { weekStart: monDate },
    select: { id: true, status: true, site: true, weekStart: true },
  });

  const closedOnEndMonday = endWeeks.filter((w) => w.status === WeekStatus.CLOSED);
  if (closedOnEndMonday.length > 0) {
    let best = closedOnEndMonday[0];
    for (let i = 1; i < closedOnEndMonday.length; i++) {
      if (
        cmpWeekSite(closedOnEndMonday[i], best) > 0
      ) {
        best = closedOnEndMonday[i];
      }
    }
    const line = await prisma.timeAccountLine.findUnique({
      where: {
        employeeId_workWeekId: { employeeId, workWeekId: best.id },
      },
    });
    return {
      balance: line?.balanceAfter ?? emp.startBalanceHours,
      explanation:
        "Konto nach der letzten abgeschlossenen Standort-Woche am Montag der Endwoche (Crush vor CappuCone).",
    };
  }

  const line = await prisma.timeAccountLine.findFirst({
    where: {
      employeeId,
      workWeek: {
        status: WeekStatus.CLOSED,
        weekStart: { lt: monDate },
      },
    },
    orderBy: [{ workWeek: { weekStart: "desc" } }, { workWeek: { site: "desc" } }],
  });

  return {
    balance: line?.balanceAfter ?? emp.startBalanceHours,
    explanation:
      "Konto nach der letzten abgeschlossenen Woche vor der Endwoche (Endwoche noch nicht abgeschlossen).",
  };
}

/** Alle WorkWeek-IDs im Zeitraum (beide Standorte pro Montag). */
export async function workWeekRowsForStarts(
  weekStartDates: Date[]
): Promise<{ id: string; weekStart: Date; site: WorkSite }[]> {
  if (weekStartDates.length === 0) return [];
  return prisma.workWeek.findMany({
    where: { weekStart: { in: weekStartDates } },
    select: { id: true, weekStart: true, site: true },
  });
}
