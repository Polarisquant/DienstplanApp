import { addDaysISO } from "@/lib/dateNav";
import type { ContractRow } from "@/lib/employeeContract";
import { contractForDate } from "@/lib/employeeContract";
import type { EmploymentBounds } from "@/lib/employmentWeekTarget";
import { isFtPaidHolidayAbbreviation, shiftAbbrevUiKind } from "@/lib/parseShiftCell";
import {
  actualRowHasContent,
  countVacationDaysInWeekWithPlanActual,
} from "@/lib/vacation";

function deDate(iso: string): string {
  return iso.split("-").reverse().join(".");
}

/**
 * Nicht-blockierende Eingabe-Hinweise für eine Woche (Plan+Ist).
 * Blockierende Fehler (Parse, Einträge außerhalb der Beschäftigung) kommen
 * weiterhin aus `sumParsedWeekHoursWithContracts`.
 */
export function weekInputWarnings(
  planCells: string[],
  actualCells: string[],
  weekStartISO: string,
  contractRows: ContractRow[],
  employment: EmploymentBounds | undefined,
  publicHolidayDates: ReadonlySet<string>
): string[] {
  const warnings: string[] = [];
  if (contractRows.length === 0) return warnings;
  const row = actualRowHasContent(actualCells) ? actualCells : planCells;

  for (let i = 0; i < 7; i++) {
    const dateISO = addDaysISO(weekStartISO, i);
    const raw = (row[i] ?? "").replace(/\s+/g, " ").trim();
    if (!raw) continue;
    const kind = shiftAbbrevUiKind(raw);

    if (i === 6) {
      if (kind) {
        warnings.push(
          `So ${deDate(dateISO)}: „${raw}“ am Sonntag (Betrieb geschlossen) — zählt weder Stunden noch Urlaub.`
        );
      } else {
        warnings.push(
          `So ${deDate(dateISO)}: Arbeitszeit am Sonntag eingetragen — Betrieb ist sonntags geschlossen, bitte prüfen.`
        );
      }
      continue;
    }

    if (kind === "u" && publicHolidayDates.has(dateISO)) {
      warnings.push(
        `${deDate(dateISO)}: „U“ am gesetzlichen Feiertag — ein Feiertag verbraucht keinen Urlaub, bitte als FT erfassen.`
      );
    }
    if (
      raw.charAt(0).toUpperCase() === "F" &&
      isFtPaidHolidayAbbreviation(raw) &&
      !publicHolidayDates.has(dateISO)
    ) {
      warnings.push(
        `${deDate(dateISO)}: FT ohne gesetzlichen Feiertag — zählt 0 h.`
      );
    }
  }

  const uUnits = countVacationDaysInWeekWithPlanActual(
    planCells,
    actualCells,
    weekStartISO,
    contractRows,
    employment
  );
  const maxWorkDays = Math.max(
    ...Array.from({ length: 7 }, (_, i) =>
      contractForDate(contractRows, addDaysISO(weekStartISO, i)).workDaysPerWeek
    )
  );
  if (uUnits > maxWorkDays + 1e-9) {
    warnings.push(
      `${uUnits.toLocaleString("de-AT")} U-Tage in dieser Woche bei ${maxWorkDays} Arbeitstagen/Woche laut Vertrag — bitte prüfen (jeder U-Tag schreibt ein Tagessoll gut).`
    );
  }

  return warnings;
}
