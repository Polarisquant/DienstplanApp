import test from "node:test";
import assert from "node:assert/strict";
import {
  BUSINESS_DAYS_PER_WEEK,
  employeeVisibleInWeek,
  weeklyContractTargetForEmployment,
  weekIsFullyBeforeEntry,
} from "./employmentWeekTarget";

/**
 * Sechstel-Regel (Betriebswoche Mo–Sa): jeder beschäftigte Betriebstag zählt
 * Vertragsstunden ÷ 6 des an diesem Tag gültigen Vertrags. Sonntag zählt nie.
 */

const PIA_CONTRACT = [
  { effectiveFrom: "2026-07-01", contractHoursPerWeek: 20, workDaysPerWeek: 5 },
];
const ENTRY = "2026-07-01";

test("Betriebswoche ist Mo–Sa (6 Tage)", () => {
  assert.equal(BUSINESS_DAYS_PER_WEEK, 6);
});

test("KW vollständig vor Eintritt → nicht im Dienstplan, Soll 0", () => {
  assert.equal(weekIsFullyBeforeEntry("2026-06-22", ENTRY), true);
  assert.equal(employeeVisibleInWeek("2026-06-22", ENTRY, null), false);
  const target = weeklyContractTargetForEmployment(PIA_CONTRACT, "2026-06-22", {
    entryDateISO: ENTRY,
    exitDateISO: null,
  });
  assert.equal(target, 0);
});

test("Eintritt Mi 01.07. → Soll = 4/6 × 20 = 13,33 (Mi–Sa)", () => {
  const target = weeklyContractTargetForEmployment(PIA_CONTRACT, "2026-06-29", {
    entryDateISO: ENTRY,
    exitDateISO: null,
  });
  assert.ok(Math.abs(target - (4 / 6) * 20) < 1e-9);
});

test("Volle Beschäftigungswoche → Soll = Vertragsstunden (6 × H/6)", () => {
  const target = weeklyContractTargetForEmployment(PIA_CONTRACT, "2026-07-06", {
    entryDateISO: ENTRY,
    exitDateISO: null,
  });
  assert.ok(Math.abs(target - 20) < 1e-9);
});

test("Ohne Eintrittsdatum: gleiche Formel, volle Woche = Vertragsstunden", () => {
  const target = weeklyContractTargetForEmployment(PIA_CONTRACT, "2026-06-29");
  assert.ok(Math.abs(target - 20) < 1e-9);
});

test("Zoey: Eintritt Di 01.09., 15 h → Soll 5/6 × 15 = 12,5", () => {
  const rows = [
    { effectiveFrom: "2026-09-01", contractHoursPerWeek: 15, workDaysPerWeek: 3 },
  ];
  const target = weeklyContractTargetForEmployment(rows, "2026-08-31", {
    entryDateISO: "2026-09-01",
    exitDateISO: null,
  });
  assert.ok(Math.abs(target - 12.5) < 1e-9);
});

test("Eintritt Freitag → Soll 2/6 (Fr+Sa), kein Voll-Soll-Schock", () => {
  const rows = [
    { effectiveFrom: "2026-09-04", contractHoursPerWeek: 15, workDaysPerWeek: 3 },
  ];
  const target = weeklyContractTargetForEmployment(rows, "2026-08-31", {
    entryDateISO: "2026-09-04",
    exitDateISO: null,
  });
  assert.ok(Math.abs(target - (2 / 6) * 15) < 1e-9);
});

test("Eintritt Sonntag → Soll 0 (Sonntag ist kein Betriebstag)", () => {
  const rows = [
    { effectiveFrom: "2026-09-06", contractHoursPerWeek: 15, workDaysPerWeek: 3 },
  ];
  const target = weeklyContractTargetForEmployment(rows, "2026-08-31", {
    entryDateISO: "2026-09-06",
    exitDateISO: null,
  });
  assert.equal(target, 0);
});

test("Austritt Dienstag → Soll 2/6 (Mo+Di), nichts nach dem Ende", () => {
  const rows = [
    { effectiveFrom: "2020-01-01", contractHoursPerWeek: 30, workDaysPerWeek: 5 },
  ];
  const target = weeklyContractTargetForEmployment(rows, "2026-08-31", {
    entryDateISO: "2020-01-01",
    exitDateISO: "2026-09-01",
  });
  assert.ok(Math.abs(target - (2 / 6) * 30) < 1e-9);
});

test("Vertragswechsel Mi 01.04. (30→20 h): Soll = 2/6×30 + 4/6×20 = 23,33", () => {
  const rows = [
    { effectiveFrom: "2025-10-14", contractHoursPerWeek: 30, workDaysPerWeek: 5 },
    { effectiveFrom: "2026-04-01", contractHoursPerWeek: 20, workDaysPerWeek: 3 },
  ];
  const target = weeklyContractTargetForEmployment(rows, "2026-03-30", {
    entryDateISO: "2025-10-14",
    exitDateISO: null,
  });
  assert.ok(Math.abs(target - ((2 / 6) * 30 + (4 / 6) * 20)) < 1e-9);
});

test("Ein- und Austritt in derselben Woche → nur die beschäftigten Betriebstage", () => {
  const rows = [
    { effectiveFrom: "2026-09-01", contractHoursPerWeek: 12, workDaysPerWeek: 2 },
  ];
  // Di 01.09. bis Do 03.09. → 3 Betriebstage × 2 h
  const target = weeklyContractTargetForEmployment(rows, "2026-08-31", {
    entryDateISO: "2026-09-01",
    exitDateISO: "2026-09-03",
  });
  assert.ok(Math.abs(target - (3 / 6) * 12) < 1e-9);
});
