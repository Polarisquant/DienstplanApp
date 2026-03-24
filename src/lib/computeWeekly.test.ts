import test from "node:test";
import assert from "node:assert/strict";
import { computeWeeklyBalance } from "./computeWeekly";

test("38 h eingeteilt, 40 h Vertrag: WS-Summe = 38, Delta = −2", () => {
  const cells = [
    "08:00-16:00",
    "08:00-16:00",
    "08:00-16:00",
    "08:00-16:00",
    "09:00-15:00",
    "",
    "",
  ];
  const r = computeWeeklyBalance(cells, 40, 5);
  assert.equal(r.weeklyHours, 38);
  assert.equal(r.deltaVsContract, -2);
});

test("40 h = Vertrag: Delta 0", () => {
  const cells = [
    "08:00-16:00",
    "08:00-16:00",
    "08:00-16:00",
    "08:00-16:00",
    "08:00-16:00",
    "",
    "",
  ];
  const r = computeWeeklyBalance(cells, 40, 5);
  assert.equal(r.weeklyHours, 40);
  assert.equal(r.deltaVsContract, 0);
});
