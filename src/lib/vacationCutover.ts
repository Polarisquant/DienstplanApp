import { LEGACY_CONTRACT_ANCHOR_ISO } from "@/lib/firstContractDate";
import { prismaDateToISO } from "@/lib/vacationAccrualAT";

/**
 * Globaler Stichtag für Urlaubs-Journal / Aufstockung (Systemwechsel, Go-Live).
 * `VACATION_LEDGER_CUTOVER_DATE=YYYY-MM-DD` in `.env` / Hosting.
 * Wenn **nicht** gesetzt: Eröffnung wie bisher (Eintritt oder „heute“ beim ersten Buchungslauf).
 */
export function vacationLedgerCutoverISO(): string | null {
  const raw = process.env.VACATION_LEDGER_CUTOVER_DATE?.trim();
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return raw;
}

function noonUtc(iso: string): Date {
  return new Date(`${iso}T12:00:00.000Z`);
}

/**
 * Stichtag der **OPENING_MIGRATION** (Start der Urlaubs-Journal-Rechnung):
 * – Mit globalem Cutover: MA war vor Cutover schon dabei → **Cutover**; Eintritt **≥** Cutover → **Eintrittsdatum**.
 * – Ohne Cutover: **Eintritt**, sonst **heute** (faule Eröffnung).
 */
export function openingEffectiveDateForEmployee(entryDate: Date | null): Date {
  const cutover = vacationLedgerCutoverISO();
  const entryISO = entryDate ? prismaDateToISO(entryDate) : null;

  if (!cutover) {
    if (entryISO && entryISO !== LEGACY_CONTRACT_ANCHOR_ISO) {
      return noonUtc(entryISO);
    }
    return new Date();
  }

  if (!entryISO || entryISO === LEGACY_CONTRACT_ANCHOR_ISO) {
    return noonUtc(cutover);
  }

  if (entryISO >= cutover) {
    return noonUtc(entryISO);
  }

  return noonUtc(cutover);
}
