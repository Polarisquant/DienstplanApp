import test from "node:test";
import assert from "node:assert/strict";
import { vacationDayUnitsFromCell, countVacationDaysInWeek } from "./vacation";

const C = 40;
const W = 5;

test("vacationDayUnits: U = 1, U(8) = 1 Tag, U(2) = 0,25", () => {
  assert.equal(vacationDayUnitsFromCell("U", C, W), 1);
  assert.equal(vacationDayUnitsFromCell("U(8)", C, W), 1);
  assert.equal(vacationDayUnitsFromCell("U(2)", C, W), 0.25);
  assert.equal(vacationDayUnitsFromCell("K(4)", C, W), 0);
});

test("countVacationDaysInWeek summiert U-Tagesäquivalente", () => {
  const cells = ["", "U(2)", "U", "", "", "", ""];
  assert.equal(countVacationDaysInWeek(cells, C, W), 1 + 0.25);
});
