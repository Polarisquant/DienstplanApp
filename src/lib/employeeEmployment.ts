import { addDaysISO } from "@/lib/dateNav";

/** Kalendertag relativ zu Eintritt/Austritt (ISO YYYY-MM-DD, lexikographischer Vergleich). */
export type EmploymentDayMark =
  | "active"
  | "before_entry"
  | "exit_last_day"
  | "after_exit";

/** Woche relativ zum Austritt (Montag = weekStart). */
export type WeekExitScope = "none" | "exit_week" | "after_exit";

export function employmentDayMark(
  dateISO: string,
  entryDateISO: string | null | undefined,
  exitDateISO: string | null | undefined
): EmploymentDayMark {
  if (exitDateISO) {
    if (dateISO > exitDateISO) return "after_exit";
    if (dateISO === exitDateISO) return "exit_last_day";
  }
  if (entryDateISO && dateISO < entryDateISO) return "before_entry";
  return "active";
}

/** Ab Kalenderwoche mit Austritt oder danach: Zeile im Raster hervorheben. */
export function weekExitScope(
  weekStartISO: string,
  exitDateISO: string | null | undefined
): WeekExitScope {
  if (!exitDateISO) return "none";
  if (weekStartISO > exitDateISO) return "after_exit";
  const weekEndISO = addDaysISO(weekStartISO, 6);
  if (exitDateISO <= weekEndISO) return "exit_week";
  return "none";
}

const SLATE_STRIPE =
  "bg-[repeating-linear-gradient(-45deg,transparent,transparent_5px,rgb(148_163_184/0.18)_5px,rgb(148_163_184/0.18)_10px)]";

/** Dezentes Rot für Austritt / nach Austritt */
const RED_STRIPE =
  "bg-[repeating-linear-gradient(-45deg,transparent,transparent_5px,rgb(254_202_202/0.28)_5px,rgb(254_202_202/0.28)_10px)]";

export function employmentDayShellClasses(mark: EmploymentDayMark): string {
  switch (mark) {
    case "after_exit":
      return `${RED_STRIPE} bg-red-50/45`;
    case "before_entry":
      return `${SLATE_STRIPE} bg-slate-50/95`;
    case "exit_last_day":
      return "ring-2 ring-inset ring-red-300/90 bg-red-50/70";
    default:
      return "";
  }
}

/** Leichte Zeilenmarkierung in der Namensspalte */
export function weekExitScopeRowClasses(scope: WeekExitScope): string {
  switch (scope) {
    case "exit_week":
      return "border-l-[3px] border-l-red-300/80 bg-red-50/35";
    case "after_exit":
      return "border-l-[3px] border-l-red-400/70 bg-red-50/50";
    default:
      return "";
  }
}

/** Summenspalten (WS, ZAG, o. U.) in Austrittswochen */
export function weekExitScopeSummaryColClasses(scope: WeekExitScope): string {
  if (scope === "none") return "";
  return scope === "after_exit" ? "bg-red-50/40" : "bg-red-50/25";
}

export function employmentDayTitle(mark: EmploymentDayMark): string | undefined {
  switch (mark) {
    case "after_exit":
      return "Nach Austritt — kein Beschäftigungstag";
    case "before_entry":
      return "Vor Eintritt — noch nicht im Dienst";
    case "exit_last_day":
      return "Letzter Arbeitstag (Austritt)";
    default:
      return undefined;
  }
}

const EXIT_BADGE_BASE =
  "mt-0.5 inline-block max-w-full rounded px-1.5 py-0.5 text-[10px] font-semibold leading-tight tracking-tight ring-1 ring-inset";

export function weekExitRowBadge(
  scope: WeekExitScope,
  exitDateISO: string
): { text: string; className: string } | null {
  const d = exitDateISO.split("-").reverse().join(".");
  if (scope === "exit_week") {
    return {
      text: `Austritt ${d}`,
      className: `${EXIT_BADGE_BASE} bg-red-50 text-red-800 ring-red-200/90`,
    };
  }
  if (scope === "after_exit") {
    return {
      text: `ausgeschieden ab ${d}`,
      className: `${EXIT_BADGE_BASE} bg-red-50/90 text-red-700/95 ring-red-200/75`,
    };
  }
  return null;
}
