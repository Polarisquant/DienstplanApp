/**
 * Lesbare Darstellung einer Tageszelle für die Wochen-Übersicht (Foto/WhatsApp).
 *
 * Aus dem Eingabe-Kürzel wird ein ausgeschriebener Block:
 * - `11:30-20:00-30` → Zeit `11:30 – 20:00`, Pause `Pause 30 min`
 * - `U` / `U(2)`     → `Urlaub` / `Urlaub 2 h`
 * - `K`, `FT`, `ZA`  → `Krank`, `Feiertag`, `Zeitausgleich`
 * - Mehrere Blöcke mit `|` werden getrennt zurückgegeben.
 *
 * Rein anzeigend — die Stundenberechnung bleibt in `parseShiftCell`.
 */

import { shiftAbbrevUiKind, type ShiftAbbrevUiKind } from "@/lib/parseShiftCell";

export type ShiftDisplayBlock =
  | { kind: "time"; time: string; pause: string | null }
  | { kind: "abbrev"; code: ShiftAbbrevUiKind; label: string }
  | { kind: "text"; text: string };

export type ShiftDisplay = {
  empty: boolean;
  blocks: ShiftDisplayBlock[];
};

export const SHIFT_ABBREV_LABEL: Record<ShiftAbbrevUiKind, string> = {
  u: "Urlaub",
  k: "Krank",
  f: "Feiertag",
  z: "Zeitausgleich",
};

/** „9:00“ → „09:00“ (gleiche Breite in allen Zeilen, ruhigeres Foto). */
function padTime(t: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return t.trim();
  return `${m[1]!.padStart(2, "0")}:${m[2]}`;
}

function formatPause(minutes: number): string {
  if (minutes % 60 === 0 && minutes >= 60) {
    const h = minutes / 60;
    return `Pause ${h.toLocaleString("de-AT")} h`;
  }
  return `Pause ${minutes.toLocaleString("de-AT")} min`;
}

function displayBlock(segment: string): ShiftDisplayBlock {
  const s = segment.replace(/\s+/g, " ").trim();

  const code = shiftAbbrevUiKind(s);
  if (code) {
    const withHours = /^([UK])\s*\(\s*([\d.,]+)\s*\)\s*$/i.exec(s);
    const label = withHours
      ? `${SHIFT_ABBREV_LABEL[code]} ${withHours[2]!.replace(".", ",")} h`
      : SHIFT_ABBREV_LABEL[code];
    return { kind: "abbrev", code, label };
  }

  const parts = s.split("-").map((p) => p.trim());
  const isTime = (p: string | undefined) => Boolean(p) && /^\d{1,2}:\d{2}$/.test(p!);
  if (parts.length >= 2 && isTime(parts[0]) && isTime(parts[1])) {
    let pause: string | null = null;
    if (parts.length >= 3) {
      const min = Number(parts[2]!.replace(",", "."));
      if (Number.isFinite(min) && min > 0) pause = formatPause(min);
    }
    return {
      kind: "time",
      // Geschütztes Leerzeichen vor dem Gedankenstrich: bei engen Spalten darf die
      // Zeit nur **einmal** umbrechen — „11:30 –“ / „20:00“, nie der Strich allein.
      time: `${padTime(parts[0]!)}\u00A0– ${padTime(parts[1]!)}`,
      pause,
    };
  }

  return { kind: "text", text: s };
}

export function shiftDisplay(raw: string): ShiftDisplay {
  const s = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!s) return { empty: true, blocks: [] };
  const segments = s
    .split("|")
    .map((p) => p.trim())
    .filter(Boolean);
  if (segments.length === 0) return { empty: true, blocks: [] };
  return { empty: false, blocks: segments.map(displayBlock) };
}
