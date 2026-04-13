import { WeekStatus, WorkSite } from "@prisma/client";
import { prisma } from "./prisma";
import { weekStartISOContainingDate } from "./dateNav";
import { parseWeekStartParam } from "./weekUtils";

/**
 * Abgeschlossene Wochen **dieses Standorts** mit strikt früherem Montag.
 * `balanceAfter` je Zeile = laufender Saldo nur entlang dieser Filiale (Startsaldo + Summe Deltas).
 */
function whereClosedBefore(weekStart: Date, site: WorkSite) {
  return {
    site,
    weekStart: { lt: weekStart },
  };
}

/**
 * Gleiche Logik wie {@link getBalanceBeforeWeek}, aber **eine** Abfrage für alle Mitarbeiter
 * (wichtig für Serverless / hohe Latenz zur DB, z. B. Vercel + Neon).
 */
export async function getBalancesBeforeWeekForEmployees(
  employees: { id: string; startBalanceHours: number }[],
  weekStart: Date,
  site: WorkSite
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  for (const e of employees) {
    map.set(e.id, e.startBalanceHours);
  }
  const ids = employees.map((e) => e.id);
  if (ids.length === 0) return map;

  const lines = await prisma.timeAccountLine.findMany({
    where: {
      employeeId: { in: ids },
      workWeek: {
        status: WeekStatus.CLOSED,
        ...whereClosedBefore(weekStart, site),
      },
    },
    orderBy: { workWeek: { weekStart: "desc" } },
    select: { employeeId: true, balanceAfter: true },
  });

  const seen = new Set<string>();
  for (const line of lines) {
    if (seen.has(line.employeeId)) continue;
    seen.add(line.employeeId);
    map.set(line.employeeId, line.balanceAfter);
  }
  return map;
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
    orderBy: { workWeek: { weekStart: "desc" } },
  });

  return last?.balanceAfter ?? emp.startBalanceHours;
}

/**
 * Gesamt-Stundenkonto zum Stichtag: Startsaldo + Summe aller `weeklyDeltaHours`
 * aus abgeschlossenen Standort-Wochen mit Montag ≤ Montag der Kalenderwoche von `lastDayISO`.
 * Beide Filialen fließen additiv ein; Reihenfolge der Abschlüsse ist irrelevant.
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

  const agg = await prisma.timeAccountLine.aggregate({
    where: {
      employeeId,
      workWeek: {
        status: WeekStatus.CLOSED,
        OR: [{ weekStart: { lt: monDate } }, { weekStart: monDate }],
      },
    },
    _sum: { weeklyDeltaHours: true },
  });

  const sumDelta = agg._sum.weeklyDeltaHours ?? 0;
  const balance = emp.startBalanceHours + sumDelta;

  return {
    balance,
    explanation:
      "Startsaldo zuzüglich Summe der IST-Wochendeltas aller abgeschlossenen Arbeitstag-Wochen bis einschließlich Kalenderwoche des Stichtags (Crush und CappuCone getrennt gebucht, global addiert).",
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
