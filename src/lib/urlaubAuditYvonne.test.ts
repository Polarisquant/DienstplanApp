import assert from "node:assert/strict";
import test from "node:test";
import { countVacationDaysInWeekWithPlanActual } from "./vacation";
import type { ContractRow } from "./employeeContract";

/**
 * Regressionstests aus dem Yvonne-Audit (o. U. 33,2332 statt 14,3632).
 * Ursprünglich Beweis der Fehler — nach dem Fix Beweis des korrekten Verhaltens.
 */

const rows: ContractRow[] = [
  { effectiveFrom: "2010-05-21", contractHoursPerWeek: 40, workDaysPerWeek: 5 },
];
const employment = { entryDateISO: "2010-05-21", exitDateISO: null };

/** KW 08.06.2026 — reale Zellen: u am Mo, Di, Mi, Fr, Sa (Ist = Plan) */
const kw0806 = ["u", "u", "u", "", "u", "u", ""];

test("FIX 1 · Sa-Urlaub zählt — mit und ohne Eintrittsdatum identisch", () => {
  const mitEintritt = countVacationDaysInWeekWithPlanActual(
    kw0806, kw0806, "2026-06-08", rows, employment
  );
  const ohneEintritt = countVacationDaysInWeekWithPlanActual(
    kw0806, kw0806, "2026-06-08", rows, undefined
  );
  assert.equal(mitEintritt, 5, "alle 5 U-Tage (inkl. Samstag) werden abgezogen");
  assert.equal(ohneEintritt, 5, "eine Regel für alle Mitarbeiter");
});

test("FIX 2 · U am Sonntag zählt nie (Betrieb geschlossen)", () => {
  const withSunday = ["u", "", "", "", "", "", "u"];
  const n = countVacationDaysInWeekWithPlanActual(
    withSunday, withSunday, "2026-06-08", rows, employment
  );
  assert.equal(n, 1);
});

test("FIX 3 · Plan-Restzellen zählen nicht, wenn die Ist-Zeile Inhalt hat", () => {
  // KW 01.06.2026 real: Plan u am Fr UND Sa; Ist hat u nur am Fr → 1 Tag.
  const plan = ["", "", "", "", "u", "u", ""];
  const ist  = ["", "", "", "f", "u", "", ""];
  const gezaehlt = countVacationDaysInWeekWithPlanActual(
    plan, ist, "2026-06-01", rows, undefined
  );
  assert.equal(gezaehlt, 1, "Ist-Zeile hat Inhalt → nur sie zählt (real genommen: 1 Tag)");
});

test("FIX 3b · Reine Vorausplanung (Ist leer) zählt weiter den Plan", () => {
  const plan = ["u", "u", "", "", "", "", ""];
  const ist = ["", "", "", "", "", "", ""];
  const gezaehlt = countVacationDaysInWeekWithPlanActual(
    plan, ist, "2026-09-14", rows, employment
  );
  assert.equal(gezaehlt, 2);
});

test("REKONSTRUKTION · Yvonnes Soll-Stand 14,3632 und Zerlegung der Diskrepanz", () => {
  const monat = Math.round((25 / 12) * 10_000) / 10_000;
  assert.equal(monat, 2.0833);

  const startLautLohnbuero = 19.03; // 31.03.2026
  const verbrauchReal = 13;
  const soll = +(startLautLohnbuero + 4 * monat - verbrauchReal).toFixed(4);
  assert.equal(soll, 14.3632);

  // Journal real: Eröffnung 16,9 + 4 Gutschriften + netto +8 aus Verbrauchs-Buchungen
  const appStand = +(16.9 + 4 * monat + 8).toFixed(4);
  assert.equal(appStand, 33.2332);
  assert.equal(+(appStand - soll).toFixed(2), 18.87);
});
