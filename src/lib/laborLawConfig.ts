/**
 * Konfigurierbare Schwellen für heuristische AT-Arbeitszeit-Hinweise (MVP).
 * Kein Ersatz für Kollektivvertrag / Einzelvertrag / Rechtsberatung.
 * Quellen: übliche ARB/Arbeitszeitdiskussion (Ruhezeit, Pausen) — im Betrieb mit Anwalt/KV prüfen.
 */
export const LABOR_LAW_CONFIG = {
  /** Mindest-Ruhezeit zwischen zwei Schichtenden und nächstem Dienstbeginn (h) */
  minRestHoursBetweenShifts: 11,
  /** Brutto-Anwesenheit (Start–Ende, ggf. über Mitternacht) über dieser Grenze → Hinweis */
  maxGrossDailyHours: 12,
  /** Ab dieser Brutto-Dauer muss laut MVP-Regel eine Pause eingetragen sein */
  pauseRequiredFromGrossHours: 6,
  /** Mindestpause (Minuten), wenn Brutto ≥ pauseRequiredFromGrossHours */
  minPauseMinutes: 30,
} as const;

export const LABOR_LAW_DISCLAIMER_DE =
  "Hinweise sind unverbindlich und ersetzen keine Rechtsberatung. Es gelten u. a. Kollektivvertrag, Arbeitsvertrag und Ausnahmen (z. B. Bereitschaft). Keine Prüfung der 36h-Wochenruhe oder Nachtarbeit.";
