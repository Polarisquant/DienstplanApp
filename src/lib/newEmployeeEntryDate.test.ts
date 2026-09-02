/**
 * Pia Six — Eintritt Mi 01.07.2026, 20 h/Woche, flexibel.
 * Sechstel-Regel: Eintrittswoche Soll = 4/6 × 20 = 13,33 h.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { computeWeeklyBalanceWithContracts } from "./computeWeekly";
import { employeeVisibleInWeek } from "./employmentWeekTarget";
import { countVacationDaysInWeekWithPlanActual } from "./vacation";

const PIA_CONTRACT = [
  { effectiveFrom: "2026-07-01", contractHoursPerWeek: 20, workDaysPerWeek: 5 },
];
const ENTRY = "2026-07-01";
const EMPLOYMENT = { entryDateISO: ENTRY, exitDateISO: null as string | null };
const EMPTY_WEEK = ["", "", "", "", "", "", ""] as const;

test("KW 26: Pia erscheint nicht im Dienstplan (vor Eintritt)", () => {
  assert.equal(employeeVisibleInWeek("2026-06-22", ENTRY, null), false);
});

test("KW 26: Soll 0, leere Woche → delta 0 (kein -20)", () => {
  const { deltaVsContract } = computeWeeklyBalanceWithContracts(
    [...EMPTY_WEEK],
    "2026-06-22",
    PIA_CONTRACT,
    undefined,
    EMPLOYMENT
  );
  assert.equal(deltaVsContract, 0);
});

test("KW 27: Mi+Do Ist (~12,42 h) vs Soll 13,33 h → delta ≈ −0,92", () => {
  const actual = ["", "", "14:00-20:17", "14:00-20:08", "", "", ""];
  const { weeklyHours, deltaVsContract } = computeWeeklyBalanceWithContracts(
    actual,
    "2026-06-29",
    PIA_CONTRACT,
    undefined,
    EMPLOYMENT
  );
  assert.ok(Math.abs(weeklyHours - 12.416666666666668) < 1e-9);
  assert.ok(Math.abs(deltaVsContract - (12.416666666666668 - (4 / 6) * 20)) < 1e-9);
});

test("KW 28: 18 h Ist vs Soll 20 h → delta -2", () => {
  const actual = ["", "", "14:00-20:00", "14:00-20:00", "15:00-21:30-30", "", ""];
  const { deltaVsContract } = computeWeeklyBalanceWithContracts(
    actual,
    "2026-07-06",
    PIA_CONTRACT,
    undefined,
    EMPLOYMENT
  );
  assert.ok(Math.abs(deltaVsContract - -2) < 1e-9);
});

test("Ist-Eintrag vor Eintritt zählt nicht (Fehler statt Stunden)", () => {
  // Mo 29.06. liegt vor Eintritt Mi 01.07. — Eintrag darf nicht zählen.
  const actual = ["09:00-17:00", "", "14:00-20:17", "14:00-20:08", "", "", ""];
  const { weeklyHours, errors } = computeWeeklyBalanceWithContracts(
    actual,
    "2026-06-29",
    PIA_CONTRACT,
    undefined,
    EMPLOYMENT
  );
  assert.ok(Math.abs(weeklyHours - 12.416666666666668) < 1e-9);
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /außerhalb des Beschäftigungszeitraums/);
});

test("Urlaub: U vor Eintritt in Plan zählt nicht", () => {
  const plan = ["U", "U", "U", "", "", "", ""];
  const units = countVacationDaysInWeekWithPlanActual(
    plan,
    [...EMPTY_WEEK],
    "2026-06-29",
    PIA_CONTRACT,
    EMPLOYMENT
  );
  assert.equal(units, 1);
});

test("Urlaub: leere Woche → 0", () => {
  const units = countVacationDaysInWeekWithPlanActual(
    [...EMPTY_WEEK],
    [...EMPTY_WEEK],
    "2026-06-22",
    PIA_CONTRACT,
    EMPLOYMENT
  );
  assert.equal(units, 0);
});
