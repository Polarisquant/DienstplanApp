import test from "node:test";
import assert from "node:assert/strict";
import { computeWeeklyBalanceWithContracts } from "./computeWeekly";
import {
  countedCellsForSite,
  countVacationDaysCalendarWeek,
  duplicateAbsenceDayIndexes,
  mixedDayIndexes,
  sharedDayMessages,
} from "./sharedSite";

// Montag 05.10.2026, Vertrag 35 h / 5 Tage (wie Sarah Schiersner)
const WS = "2026-10-05";
const ROWS = [{ effectiveFrom: "2026-01-01", contractHoursPerWeek: 35, workDaysPerWeek: 5 }];
const EMPTY = Array(7).fill("");

/** Wochen-Delta über beide Filialen wie Abschluss: Crush mit Soll, CappuCone nur Ist. */
function weekDelta(crush: string[], cap: string[]): number {
  const c = computeWeeklyBalanceWithContracts(crush, WS, ROWS);
  const k = computeWeeklyBalanceWithContracts(countedCellsForSite(cap, "CAPPUCONE", crush), WS, ROWS);
  return c.deltaVsContract + k.weeklyHours;
}

test("Beispiele Nutzer: 30/0 → −5, 10/10 → −15, 35/0 → 0", () => {
  const day = (hrs: number[]) =>
    Array.from({ length: 7 }, (_, i) =>
      hrs[i] ? `08:00-${String(8 + hrs[i]!).padStart(2, "0")}:00` : ""
    );
  assert.equal(weekDelta(day([6, 6, 6, 6, 6]), EMPTY), -5);
  assert.equal(weekDelta(day([5, 5]), day([0, 0, 5, 5])), -15);
  assert.equal(weekDelta(day([7, 7, 7, 7, 7]), EMPTY), 0);
});

test("U am selben Tag an beiden Filialen zählt nur einmal (Crush)", () => {
  const crush = ["U", "", "", "", "", "", ""];
  const cap = ["U", "", "", "", "", "", ""];
  assert.deepEqual(countedCellsForSite(cap, "CAPPUCONE", crush)[0], "");
  assert.deepEqual(countedCellsForSite(crush, "CRUSH", cap)[0], "U");
  // 1 U-Tag = 7 h, nicht 14 h
  assert.equal(weekDelta(crush, cap), 7 - 35);
  const units = countVacationDaysCalendarWeek(
    { plan: EMPTY, actual: crush },
    { plan: EMPTY, actual: cap },
    WS,
    ROWS
  );
  assert.equal(units, 1);
});

test("U nur bei CappuCone zählt dort normal", () => {
  const cap = ["U", "", "", "", "", "", ""];
  assert.equal(weekDelta(EMPTY, cap), 7 - 35);
  assert.equal(
    countVacationDaysCalendarWeek({ plan: EMPTY, actual: EMPTY }, { plan: EMPTY, actual: cap }, WS, ROWS),
    1
  );
});

test("Feiertag: FT bei einer Filiale, Dienst bei der anderen ist kein Mischtag", () => {
  assert.deepEqual(mixedDayIndexes(["FT"], ["10:00-14:00"]), []);
  assert.deepEqual(mixedDayIndexes(["10:00-14:00"], ["FT"]), []);
});

test("Mischtag U/K + Dienst wird erkannt, in beide Richtungen", () => {
  assert.deepEqual(mixedDayIndexes(["U", "K(2)"], ["10:00-14:00", "08:00-10:00"]), [0, 1]);
  assert.deepEqual(mixedDayIndexes(["10:00-14:00"], ["K"]), [0]);
  assert.deepEqual(mixedDayIndexes(["U"], [""]), []);
  const m = sharedDayMessages(["U"], ["10:00-14:00"], "CRUSH", WS);
  assert.equal(m.errors.length, 1);
});

test("Doppelte Abwesenheit liefert Hinweis, keinen Fehler", () => {
  assert.deepEqual(duplicateAbsenceDayIndexes(["U", "K", "FT"], ["K", "", "FT"]), [0, 2]);
  const m = sharedDayMessages(["U"], ["U"], "CAPPUCONE", WS);
  assert.equal(m.errors.length, 0);
  assert.equal(m.warnings.length, 1);
});
