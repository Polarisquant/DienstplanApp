import assert from "node:assert/strict";
import test from "node:test";
import {
  annualVacationDaysFromWorkDaysPerWeek,
  annualVacationDaysProportional,
  defaultAnnualVacationDays,
  monthlyVacationAccrualFromAnnual,
} from "./vacationAccrualAT";

test("5 Urlaubswochen × Arbeitstage: 1–5 und 6 Tage", () => {
  assert.equal(annualVacationDaysFromWorkDaysPerWeek(1), 5);
  assert.equal(annualVacationDaysFromWorkDaysPerWeek(2), 10);
  assert.equal(annualVacationDaysFromWorkDaysPerWeek(3), 15);
  assert.equal(annualVacationDaysFromWorkDaysPerWeek(4), 20);
  assert.equal(annualVacationDaysFromWorkDaysPerWeek(5), 25);
  assert.equal(annualVacationDaysFromWorkDaysPerWeek(6), 30);
});

test("Stunden ändern die Tagesanzahl nicht", () => {
  assert.equal(annualVacationDaysProportional(5, 38.5), 25);
  assert.equal(annualVacationDaysProportional(5, 19.25), 25);
  assert.equal(annualVacationDaysProportional(2, 10.5), 10);
  assert.equal(annualVacationDaysProportional(2, 100), 10);
});

test(">6 Arbeitstage/Woche: Kappe wie 6-Tage (30 Tage)", () => {
  assert.equal(annualVacationDaysFromWorkDaysPerWeek(7), 30);
});

test("defaultAnnualVacationDays = Arbeitstage × 5", () => {
  assert.equal(defaultAnnualVacationDays(5), 25);
  assert.equal(defaultAnnualVacationDays(2), 10);
});

test("monthlyVacationAccrualFromAnnual: 10 Tage/Jahr → 10/12 pro Monat", () => {
  assert.equal(monthlyVacationAccrualFromAnnual(10), 10 / 12);
  assert.equal(monthlyVacationAccrualFromAnnual(25), 25 / 12);
  assert.equal(monthlyVacationAccrualFromAnnual(0), 0);
});
