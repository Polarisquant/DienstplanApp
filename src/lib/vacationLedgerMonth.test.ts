import assert from "node:assert/strict";
import test from "node:test";
import {
  accrualCalendarProrateFactor,
  accrualPeriodForCronRun,
  calendarDaysInclusiveUTC,
} from "./vacationLedger";

test("accrualPeriodForCronRun: nur am 1. UTC, sonst null", () => {
  assert.equal(
    accrualPeriodForCronRun(new Date(Date.UTC(2026, 2, 1, 5, 0, 0))),
    "2026-02"
  );
  assert.equal(accrualPeriodForCronRun(new Date(Date.UTC(2026, 0, 1, 0, 0, 0))), "2025-12");
  assert.equal(accrualPeriodForCronRun(new Date(Date.UTC(2026, 2, 2, 0, 0, 0))), null);
  assert.equal(accrualPeriodForCronRun(new Date(Date.UTC(2026, 2, 15, 0, 0, 0))), null);
});

test("calendarDaysInclusiveUTC", () => {
  assert.equal(calendarDaysInclusiveUTC("2026-03-01", "2026-03-31"), 31);
  assert.equal(calendarDaysInclusiveUTC("2026-03-15", "2026-03-31"), 17);
});

test("accrualCalendarProrateFactor: Eintritt Mitte März", () => {
  assert.equal(accrualCalendarProrateFactor("2026-03", "2026-03-15", null), 17 / 31);
});

test("accrualCalendarProrateFactor: Eröffnung 1. des Monats = 100%", () => {
  assert.equal(accrualCalendarProrateFactor("2026-03", "2026-03-01", null), 1);
});

test("accrualCalendarProrateFactor: Austritt 10.3. (Eröffnung davor)", () => {
  assert.equal(
    accrualCalendarProrateFactor("2026-03", "2020-01-01", "2026-03-10"),
    10 / 31
  );
});

test("accrualCalendarProrateFactor: Eröffnung nach Monatsende", () => {
  assert.equal(accrualCalendarProrateFactor("2026-03", "2026-04-05", null), 0);
});
