import test from "node:test";
import assert from "node:assert/strict";
import { parseShiftCell } from "./parseShiftCell";

const C = 40;
const W = 5;

test("Zeit ohne Pause: volle Spanne = Arbeitszeit", () => {
  const r = parseShiftCell("08:00-16:00", C, W);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.kind, "time");
  assert.equal(r.hours, 8);
});

test("Pause zählt nicht zur Arbeitszeit (dritter Wert = Minuten)", () => {
  const r = parseShiftCell("08:00-16:00-30", C, W);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.hours, 7.5);
});

test("Mitternachtsschicht: Pause wird abgezogen", () => {
  const r = parseShiftCell("22:00-06:00-30", C, W);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.hours, 7.5);
});
