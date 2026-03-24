import { LABOR_LAW_CONFIG } from "./laborLawConfig";
import { addDaysISO } from "./dateNav";
import { parseShiftBounds } from "./shiftBounds";

export type LaborHint = {
  code: string;
  severity: "warning" | "info";
  message: string;
  dayIndex?: number;
  dateISO?: string;
};

/**
 * Heuristische Prüfungen für eine Kalenderwoche (7 Tage, Mo=0).
 * @param weekDatesISO Montag … Sonntag als YYYY-MM-DD
 * @param raws 7 Zellen (Plan oder Ist)
 * @param prevSundayRaw Schicht am Sonntag der Vorwoche (gleicher Layer), für Ruhe So→Mo
 */
export function austrianLaborHintsForWeek(
  weekDatesISO: string[],
  raws: string[],
  prevSundayRaw: string | null
): LaborHint[] {
  const hints: LaborHint[] = [];
  const cfg = LABOR_LAW_CONFIG;

  if (weekDatesISO.length !== 7 || raws.length !== 7) {
    hints.push({
      code: "INTERNAL",
      severity: "info",
      message: "Intern: Woche unvollständig — keine Arbeitszeit-Prüfung.",
    });
    return hints;
  }

  const bounds = raws.map((raw, i) => parseShiftBounds(weekDatesISO[i]!, raw));

  for (let i = 0; i < 7; i++) {
    const b = bounds[i];
    if (!b) continue;
    const dateISO = weekDatesISO[i]!;

    if (b.grossHours > cfg.maxGrossDailyHours) {
      hints.push({
        code: "MAX_DAY_GROSS",
        severity: "warning",
        message: `Tag ${i + 1} (${dateISO}): Brutto-Anwesenheit ca. ${b.grossHours.toFixed(1)} h > ${cfg.maxGrossDailyHours} h.`,
        dayIndex: i,
        dateISO,
      });
    }

    if (
      b.grossHours > cfg.pauseRequiredAboveGrossHours &&
      b.breakMinutes < cfg.minPauseMinutes
    ) {
      hints.push({
        code: "PAUSE",
        severity: "warning",
        message: `Tag ${i + 1} (${dateISO}): Bei mehr als ${cfg.pauseRequiredAboveGrossHours} h Brutto ist typischerweise mindestens ${cfg.minPauseMinutes} Min Pause einzutragen (aktuell ${b.breakMinutes} min).`,
        dayIndex: i,
        dateISO,
      });
    }
  }

  // Ruhezeit zwischen aufeinanderfolgenden Schichten (Mo→Di … Sa→So)
  for (let i = 0; i < 6; i++) {
    const endA = bounds[i]?.endMs;
    const startB = bounds[i + 1]?.startMs;
    if (endA == null || startB == null) continue;
    const restH = (startB - endA) / 3600000;
    if (restH < cfg.minRestHoursBetweenShifts) {
      hints.push({
        code: "REST",
        severity: "warning",
        message: `Ruhezeit zwischen ${weekDatesISO[i]} und ${weekDatesISO[i + 1]}: nur ca. ${restH.toFixed(1)} h (Minimum laut Hinweis-Regel: ${cfg.minRestHoursBetweenShifts} h).`,
        dayIndex: i + 1,
        dateISO: weekDatesISO[i + 1],
      });
    }
  }

  // Vorwoche Sonntag → aktueller Montag
  const monB = bounds[0];
  if (prevSundayRaw && monB) {
    const sunISO = addDaysISO(weekDatesISO[0]!, -1);
    const prevSun = parseShiftBounds(sunISO, prevSundayRaw);
    if (prevSun) {
      const restH = (monB.startMs - prevSun.endMs) / 3600000;
      if (restH < cfg.minRestHoursBetweenShifts) {
        hints.push({
          code: "REST_WEEK",
          severity: "warning",
          message: `Ruhezeit von Vorwoche-So (${sunISO}) zu Mo (${weekDatesISO[0]}): nur ca. ${restH.toFixed(1)} h.`,
          dayIndex: 0,
          dateISO: weekDatesISO[0]!,
        });
      }
    }
  }

  return hints;
}
