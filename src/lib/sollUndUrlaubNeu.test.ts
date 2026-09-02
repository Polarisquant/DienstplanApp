import assert from "node:assert/strict";
import test from "node:test";
import {
  parseShiftCellTotalHoursChecked,
  sumParsedWeekHoursWithContracts,
} from "./parseShiftCell";
import { weekInputWarnings } from "./weekWarnings";
import type { ContractRow } from "./employeeContract";

const ROWS: ContractRow[] = [
  { effectiveFrom: "2026-01-01", contractHoursPerWeek: 28, workDaysPerWeek: 4 },
];
const EMPTY = ["", "", "", "", "", "", ""];

test("Mehrfachschichten mit | zählen in der Wochensumme", () => {
  const cells = ["11:00-14:00-30 | 15:00-20:00", "", "", "", "", "", ""];
  const { hours, errors } = sumParsedWeekHoursWithContracts(
    cells,
    "2026-08-24",
    ROWS
  );
  assert.equal(errors.length, 0);
  assert.ok(Math.abs(hours - 7.5) < 1e-9);
});

test("Fehlerhafter |-Block ist ein Fehler, kein stilles 0", () => {
  const r = parseShiftCellTotalHoursChecked("11:00-14:00-30 | kaputt", 28, 4);
  assert.equal(r.ok, false);
});

test("U/K am Sonntag zählt 0 Stunden; Zeit am Sonntag zählt weiter", () => {
  const withSundayU = ["", "", "", "", "", "", "u"];
  const a = sumParsedWeekHoursWithContracts(withSundayU, "2026-08-24", ROWS);
  assert.equal(a.hours, 0);

  const withSundayTime = ["", "", "", "", "", "", "10:00-14:00"];
  const b = sumParsedWeekHoursWithContracts(withSundayTime, "2026-08-24", ROWS);
  assert.equal(b.hours, 4);
});

test("U-Stunden zählen an jedem Betriebstag (auch Sa)", () => {
  const cells = ["u", "", "u", "u", "", "u", ""];
  const { hours } = sumParsedWeekHoursWithContracts(cells, "2026-08-24", ROWS);
  assert.ok(Math.abs(hours - 4 * 7) < 1e-9);
});

test("Warnung: mehr U-Tage als Arbeitstage/Woche", () => {
  const cells = ["u", "u", "u", "u", "u", "", ""];
  const warns = weekInputWarnings(
    EMPTY,
    cells,
    "2026-08-31",
    ROWS,
    undefined,
    new Set()
  );
  assert.ok(warns.some((w) => w.includes("U-Tage")));
});

test("Warnung: U am gesetzlichen Feiertag", () => {
  const cells = ["u", "", "", "", "", "", ""];
  const warns = weekInputWarnings(
    EMPTY,
    cells,
    "2026-08-24",
    ROWS,
    undefined,
    new Set(["2026-08-24"])
  );
  assert.ok(warns.some((w) => w.includes("Feiertag")));
});

test("Warnung: Kürzel oder Zeit am Sonntag", () => {
  const cells = ["", "", "", "", "", "", "u"];
  const warns = weekInputWarnings(
    EMPTY,
    cells,
    "2026-08-24",
    ROWS,
    undefined,
    new Set()
  );
  assert.ok(warns.some((w) => w.includes("Sonntag")));
});

test("Keine Warnungen bei normaler Woche", () => {
  const cells = ["08:00-16:00-30", "", "u", "", "", "", ""];
  const warns = weekInputWarnings(
    EMPTY,
    cells,
    "2026-08-24",
    ROWS,
    undefined,
    new Set()
  );
  assert.equal(warns.length, 0);
});
