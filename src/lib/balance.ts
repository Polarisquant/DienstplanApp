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

/** Marker an `TimeAccountLine.source` (siehe Wochenabschluss): Soll bei geteilten Mitarbeitern genau einmal pro KW. */
export const TIME_SOURCE_SOLL = "IST_CLOSED_SOLL";
export const TIME_SOURCE_NOSOLL = "IST_CLOSED_NOSOLL";

/** Enthält diese Zeitkonto-Zeile das Wochensoll? Alles außer NOSOLL (auch Alt-Buchungen IST_CLOSED). */
export function lineHoldsSoll(source: string): boolean {
  return source !== TIME_SOURCE_NOSOLL;
}

/**
 * ZAG-Basis für **geteilte** Mitarbeiter im Dienstplan: Gesamtsaldo über **beide** Filialen.
 * Die Standort-Ketten (`balanceAfter`) taugen dafür nicht — das Wochensoll wird nur an einer
 * Filiale abgezogen, die andere bucht nur Ist (und würde daher Woche für Woche „wachsen“).
 *
 * `base` = Startsaldo + alle abgeschlossenen Wochen vor dieser KW (beide Standorte)
 *        + bereits gebuchte Zeile der **anderen** Filiale in dieser KW.
 * `sollAlreadyBooked` = diese Zeile der anderen Filiale enthält das Wochensoll schon.
 * `otherWeek` = Woche der anderen Filiale (falls angelegt) — ist sie noch offen, rechnet der
 * Aufrufer deren Stunden live dazu, damit beide Dienstpläne denselben ZAG zeigen.
 */
export async function getSharedBalancesForWeek(
  employees: { id: string; startBalanceHours: number }[],
  weekStart: Date,
  site: WorkSite
): Promise<{
  byEmployee: Map<string, { base: number; sollAlreadyBooked: boolean }>;
  otherWeek: { id: string; closed: boolean } | null;
}> {
  const byEmployee = new Map<string, { base: number; sollAlreadyBooked: boolean }>();
  for (const e of employees) {
    byEmployee.set(e.id, { base: e.startBalanceHours, sollAlreadyBooked: false });
  }
  const otherSite = site === WorkSite.CRUSH ? WorkSite.CAPPUCONE : WorkSite.CRUSH;
  const otherWeek = await prisma.workWeek.findUnique({
    where: { weekStart_site: { weekStart, site: otherSite } },
    select: { id: true, status: true },
  });
  const otherClosed = otherWeek?.status === WeekStatus.CLOSED;
  const otherWeekInfo = otherWeek ? { id: otherWeek.id, closed: otherClosed } : null;

  const ids = employees.map((e) => e.id);
  if (ids.length === 0) return { byEmployee, otherWeek: otherWeekInfo };

  const [before, otherThisWeek] = await Promise.all([
    prisma.timeAccountLine.groupBy({
      by: ["employeeId"],
      where: {
        employeeId: { in: ids },
        workWeek: { status: WeekStatus.CLOSED, weekStart: { lt: weekStart } },
      },
      _sum: { weeklyDeltaHours: true },
    }),
    otherClosed
      ? prisma.timeAccountLine.findMany({
          where: { employeeId: { in: ids }, workWeekId: otherWeek.id },
          select: { employeeId: true, weeklyDeltaHours: true, source: true },
        })
      : Promise.resolve([]),
  ]);

  for (const g of before) {
    const cur = byEmployee.get(g.employeeId);
    if (cur) cur.base += g._sum.weeklyDeltaHours ?? 0;
  }
  for (const l of otherThisWeek) {
    const cur = byEmployee.get(l.employeeId);
    if (!cur) continue;
    cur.base += l.weeklyDeltaHours;
    cur.sollAlreadyBooked = lineHoldsSoll(l.source);
  }
  return { byEmployee, otherWeek: otherWeekInfo };
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
