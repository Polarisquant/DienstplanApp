import test from "node:test";
import assert from "node:assert/strict";
import { austrianLaborHintsForWeek } from "./austrianLaborHints";

test("PAUSE: 8h ohne Pause → Warnung", () => {
  const dates = ["2026-03-23", "2026-03-24", "2026-03-25", "2026-03-26", "2026-03-27", "2026-03-28", "2026-03-29"];
  const raws = ["08:00-16:00", "", "", "", "", "", ""];
  const h = austrianLaborHintsForWeek(dates, raws, null);
  assert.ok(h.some((x) => x.code === "PAUSE"));
});

test("Ruhezeit: Ende 22:00, nächster Start 08:00 → zu kurz", () => {
  const dates = ["2026-03-23", "2026-03-24", "", "", "", "", ""];
  const raws = ["14:00-22:00", "08:00-12:00", "", "", "", "", ""];
  const h = austrianLaborHintsForWeek(dates, raws, null);
  assert.ok(h.some((x) => x.code === "REST"));
});

test("U/K wird ignoriert", () => {
  const dates = Array.from({ length: 7 }, (_, i) => `2026-03-${23 + i}`);
  const raws = ["U", "U", "U", "U", "U", "U", "U"];
  const h = austrianLaborHintsForWeek(dates, raws, null);
  assert.equal(h.filter((x) => x.code === "PAUSE").length, 0);
});
