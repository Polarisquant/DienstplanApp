import { EmployeeSite, Prisma, WeekStatus, WorkSite } from "@prisma/client";

/** Query-Parameter / JSON: CRUSH | CAPPUCONE */
export function parseWorkSiteParam(v: string | null): WorkSite {
  const u = (v ?? "CRUSH").trim().toUpperCase();
  if (u === "CAPPUCONE" || u === "CAPPU") return WorkSite.CAPPUCONE;
  return WorkSite.CRUSH;
}

export function workSiteToParam(s: WorkSite): "CRUSH" | "CAPPUCONE" {
  return s === WorkSite.CAPPUCONE ? "CAPPUCONE" : "CRUSH";
}

/** Mitarbeiterfilter: am gewählten Standort + Geteilt */
export function employeeWhereForWorkSite(site: WorkSite) {
  const own: EmployeeSite =
    site === WorkSite.CRUSH ? EmployeeSite.CRUSH : EmployeeSite.CAPPUCONE;
  return {
    OR: [{ workSite: own }, { workSite: EmployeeSite.SHARED }],
  };
}

/** Sortierung der Mitarbeiterzeilen im Dienstplan für den gewählten Filial-Standort */
export function planOrderByForWorkSite(site: WorkSite) {
  return site === WorkSite.CRUSH
    ? ([{ planSortOrderCrush: "asc" as const }, { name: "asc" as const }] as const)
    : ([{ planSortOrderCappucone: "asc" as const }, { name: "asc" as const }] as const);
}

export function employeeSiteLabel(s: EmployeeSite): string {
  switch (s) {
    case EmployeeSite.CRUSH:
      return "Crush";
    case EmployeeSite.CAPPUCONE:
      return "CappuCone";
    default:
      return "Geteilt";
  }
}

export function workSiteLabel(s: WorkSite): string {
  return s === WorkSite.CRUSH ? "Crush" : "CappuCone";
}

/** Für „Woche wieder öffnen“: gibt es eine spätere abgeschlossene (weekStart, site)? */
export function whereLaterClosedWeek(
  weekStart: Date,
  site: WorkSite
): Prisma.WorkWeekWhereInput {
  if (site === WorkSite.CRUSH) {
    return {
      status: WeekStatus.CLOSED,
      OR: [
        { weekStart: { gt: weekStart } },
        { AND: [{ weekStart }, { site: WorkSite.CAPPUCONE }] },
      ],
    };
  }
  return {
    status: WeekStatus.CLOSED,
    weekStart: { gt: weekStart },
  };
}
