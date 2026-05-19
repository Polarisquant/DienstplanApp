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

const STRIPE =
  "bg-[repeating-linear-gradient(-45deg,transparent,transparent_5px,rgb(148_163_184/0.22)_5px,rgb(148_163_184/0.22)_10px)]";

export function employmentDayShellClasses(mark: EmploymentDayMark): string {
  switch (mark) {
    case "after_exit":
      return `${STRIPE} bg-slate-100/90`;
    case "before_entry":
      return `${STRIPE} bg-slate-50/95`;
    case "exit_last_day":
      return "ring-2 ring-inset ring-orange-500 bg-orange-50/80";
    default:
      return "";
  }
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

export function weekExitRowBadge(
  scope: WeekExitScope,
  exitDateISO: string
): { text: string; className: string } | null {
  const d = exitDateISO.split("-").reverse().join(".");
  if (scope === "exit_week") {
    return {
      text: `Austritt ${d}`,
      className: "text-orange-800",
    };
  }
  if (scope === "after_exit") {
    return {
      text: `ausgeschieden ab ${d}`,
      className: "text-slate-600",
    };
  }
  return null;
}
