import assert from "node:assert/strict";
import test from "node:test";
import {
  accrualCalendarProrateFactor,
  accrualPeriodForCronRun,
  calendarDaysInclusiveUTC,
  parseAccrualPeriodYYYYMM,
  resolveVacationAccrualPeriod,
} from "./vacationLedger";

test("accrualPeriodForCronRun: UTC-Tag 1–3 → Vormonat, sonst null", () => {
  assert.equal(
    accrualPeriodForCronRun(new Date(Date.UTC(2026, 2, 1, 5, 0, 0))),
    "2026-02"
  );
  assert.equal(accrualPeriodForCronRun(new Date(Date.UTC(2026, 0, 1, 0, 0, 0))), "2025-12");
  assert.equal(accrualPeriodForCronRun(new Date(Date.UTC(2026, 2, 2, 0, 0, 0))), "2026-02");
  assert.equal(accrualPeriodForCronRun(new Date(Date.UTC(2026, 2, 3, 23, 59, 0))), "2026-02");
  assert.equal(accrualPeriodForCronRun(new Date(Date.UTC(2026, 2, 4, 0, 0, 0))), null);
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

test("parseAccrualPeriodYYYYMM", () => {
  assert.equal(parseAccrualPeriodYYYYMM("2026-04"), "2026-04");
  assert.equal(parseAccrualPeriodYYYYMM(" 2026-04 "), "2026-04");
  assert.equal(parseAccrualPeriodYYYYMM("2026-13"), null);
  assert.equal(parseAccrualPeriodYYYYMM("2026-4"), null);
  assert.equal(parseAccrualPeriodYYYYMM("26-04"), null);
});

test("resolveVacationAccrualPeriod: explicit überschreibt Kalendertag", () => {
  const midMay = new Date(Date.UTC(2026, 4, 15, 12, 0, 0));
  const r = resolveVacationAccrualPeriod(midMay, "2026-04");
  assert.equal(r.period, "2026-04");
  assert.equal(r.skipReason, null);
  assert.equal(r.mode, "explicit_period");
});

test("resolveVacationAccrualPeriod: ohne explicit nur UTC-Tage 1–3", () => {
  const midMay = new Date(Date.UTC(2026, 4, 15, 12, 0, 0));
  const r = resolveVacationAccrualPeriod(midMay, null);
  assert.equal(r.period, null);
  assert.equal(r.skipReason, "cron_auto_outside_accrual_window_utc");
  assert.equal(r.mode, "cron_auto");
});

test("resolveVacationAccrualPeriod: invalid explicit", () => {
  const r = resolveVacationAccrualPeriod(new Date(), "not-a-month");
  assert.equal(r.period, null);
  assert.equal(r.skipReason, "invalid_period_expected_yyyy_mm");
});
