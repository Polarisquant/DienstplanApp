import test from "node:test";
import assert from "node:assert/strict";
import { shiftDisplay } from "./shiftDisplay";

test("Leere Zelle ist leer", () => {
  assert.equal(shiftDisplay("").empty, true);
  assert.equal(shiftDisplay("   ").empty, true);
});

test("Zeit mit Pause: ausgeschriebene Zeit + Pausenzeile", () => {
  const d = shiftDisplay("11:30-20:00-30");
  assert.equal(d.empty, false);
  assert.equal(d.blocks.length, 1);
  assert.deepEqual(d.blocks[0], {
    kind: "time",
    time: "11:30\u00A0– 20:00",
    pause: "Pause 30 min",
  });
});

test("Zeit ohne Pause: keine Pausenzeile, Stunden führend genullt", () => {
  const d = shiftDisplay("9:00-17:00");
  assert.deepEqual(d.blocks[0], {
    kind: "time",
    time: "09:00\u00A0– 17:00",
    pause: null,
  });
});

test("Pause 60 min wird als Stunde ausgegeben", () => {
  const d = shiftDisplay("08:00-18:00-60");
  assert.equal(d.blocks[0]!.kind === "time" && d.blocks[0].pause, "Pause 1 h");
});

test("Kürzel werden ausgeschrieben", () => {
  assert.deepEqual(shiftDisplay("U").blocks[0], {
    kind: "abbrev",
    code: "u",
    label: "Urlaub",
  });
  assert.deepEqual(shiftDisplay("K").blocks[0], {
    kind: "abbrev",
    code: "k",
    label: "Krank",
  });
  assert.deepEqual(shiftDisplay("FT").blocks[0], {
    kind: "abbrev",
    code: "f",
    label: "Feiertag",
  });
  assert.deepEqual(shiftDisplay("ZA").blocks[0], {
    kind: "abbrev",
    code: "z",
    label: "Zeitausgleich",
  });
});

test("U(2) zeigt die Stunden mit", () => {
  assert.deepEqual(shiftDisplay("U(2,5)").blocks[0], {
    kind: "abbrev",
    code: "u",
    label: "Urlaub 2,5 h",
  });
});

test("Mehrfachschicht mit | ergibt zwei Blöcke", () => {
  const d = shiftDisplay("11:00-14:00-30 | 17:00-20:00");
  assert.equal(d.blocks.length, 2);
  assert.equal(d.blocks[0]!.kind === "time" && d.blocks[0].time, "11:00\u00A0– 14:00");
  assert.equal(d.blocks[1]!.kind === "time" && d.blocks[1].time, "17:00\u00A0– 20:00");
});

test("Unbekannter Text bleibt unverändert stehen", () => {
  assert.deepEqual(shiftDisplay("Schulung").blocks[0], {
    kind: "text",
    text: "Schulung",
  });
});
