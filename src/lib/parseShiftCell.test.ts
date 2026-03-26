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

test("12:00–14:00 mit 30 min Pause = 1,5 h Netto", () => {
  const r = parseShiftCell("12:00-14:00-30", C, W);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.hours, 1.5);
});

test("U und K = voller Soll-Tag (40/5)", () => {
  const u = parseShiftCell("U", C, W);
  assert.ok(u.ok);
  if (!u.ok) return;
  assert.equal(u.hours, 8);
  const k = parseShiftCell("K", C, W);
  assert.ok(k.ok);
  if (!k.ok) return;
  assert.equal(k.hours, 8);
});

test("U(2) und K(4) = Stunden aus Klammern", () => {
  const u = parseShiftCell("U(2)", C, W);
  assert.ok(u.ok);
  if (!u.ok) return;
  assert.equal(u.hours, 2);
  const k = parseShiftCell("K(4)", C, W);
  assert.ok(k.ok);
  if (!k.ok) return;
  assert.equal(k.hours, 4);
});

test("U(2,5) Komma als Dezimaltrenner", () => {
  const r = parseShiftCell("U(2,5)", C, W);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.hours, 2.5);
});
