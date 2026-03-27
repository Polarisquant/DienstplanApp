/** Legacy-Platzhalter, wenn kein Eintrittsdatum gesetzt ist. */
export const LEGACY_CONTRACT_ANCHOR_ISO = "2000-01-01";

export function toIsoDate(d: Date | string): string {
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).trim().slice(0, 10);
}

/** Erster Vertragsstand: ab Eintritt, sonst Legacy-Anker. */
export function firstContractEffectiveFromISO(
  entryDate: Date | null | undefined
): string {
  if (entryDate == null) return LEGACY_CONTRACT_ANCHOR_ISO;
  const iso = toIsoDate(entryDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return LEGACY_CONTRACT_ANCHOR_ISO;
  return iso;
}

export function firstContractEffectiveFromNoonUTC(
  entryDate: Date | null | undefined
): Date {
  const iso = firstContractEffectiveFromISO(entryDate);
  return new Date(`${iso}T12:00:00.000Z`);
}
