import assert from "node:assert/strict";
import test from "node:test";
import {
  employmentDayMark,
  weekExitScope,
} from "./employeeEmployment";

test("employmentDayMark: Austritt 01.04.", () => {
  const exit = "2026-04-01";
  assert.equal(employmentDayMark("2026-03-31", null, exit), "active");
  assert.equal(employmentDayMark("2026-04-01", null, exit), "exit_last_day");
  assert.equal(employmentDayMark("2026-04-02", null, exit), "after_exit");
});

test("employmentDayMark: Eintritt 15.03.", () => {
  const entry = "2026-03-15";
  assert.equal(employmentDayMark("2026-03-14", entry, null), "before_entry");
  assert.equal(employmentDayMark("2026-03-15", entry, null), "active");
});

test("weekExitScope: KW mit 01.04. Austritt", () => {
  assert.equal(weekExitScope("2026-03-24", "2026-04-01"), "none");
  assert.equal(weekExitScope("2026-03-30", "2026-04-01"), "exit_week");
  assert.equal(weekExitScope("2026-04-06", "2026-04-01"), "after_exit");
});
