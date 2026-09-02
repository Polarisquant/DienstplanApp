"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { employmentDayMark } from "@/lib/employeeEmployment";
import type { ShiftAbbrevUiKind } from "@/lib/parseShiftCell";
import { shiftDisplay, SHIFT_ABBREV_LABEL } from "@/lib/shiftDisplay";

export type OverviewDay = {
  dateISO: string;
  holidays: { name: string; region: string }[];
};

export type OverviewRow = {
  id: string;
  name: string;
  shared: boolean;
  entryDateISO: string | null;
  exitDateISO: string | null;
  /** 7 Rohwerte (Mo…So) der aktuell angezeigten Ebene */
  cells: string[];
  notes: string[];
  weeklyHours: number;
};

type Props = {
  onClose: () => void;
  weekStartISO: string;
  isoWeek: number;
  siteLabel: string;
  layer: "PLAN" | "ACTUAL";
  onLayerChange: (l: "PLAN" | "ACTUAL") => void;
  days: OverviewDay[];
  rows: OverviewRow[];
  hasUnsavedChanges: boolean;
  onPrevWeek: () => void;
  onNextWeek: () => void;
};

const DAY_LABELS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

const hoursFmt = new Intl.NumberFormat("de-AT", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** Kräftige Flächenfarben — auf einem Handyfoto noch klar unterscheidbar. */
const ABBREV_PILL: Record<ShiftAbbrevUiKind, string> = {
  u: "bg-emerald-600",
  k: "bg-rose-600",
  f: "bg-amber-600",
  z: "bg-violet-600",
};

const ABBREV_CELL_TINT: Record<ShiftAbbrevUiKind, string> = {
  u: "bg-emerald-50",
  k: "bg-rose-50",
  f: "bg-amber-50",
  z: "bg-violet-50",
};

function ddmm(dateISO: string): string {
  const [, m, d] = dateISO.split("-");
  return `${d}.${m}.`;
}

function ddmmyyyy(dateISO: string): string {
  return dateISO.split("-").reverse().join(".");
}

function isEmptyRow(r: OverviewRow): boolean {
  return r.cells.every((c) => (c ?? "").trim() === "");
}

/* ------------------------------------------------------------------ *
 * Vollbild-Fit: größte Schriftgröße, bei der alles auf einen Screen passt
 * ------------------------------------------------------------------ */

const FIT_MIN_PX = 5;
const FIT_MAX_PX = 44;

/**
 * Sucht die größtmögliche Basis-Schriftgröße, bei der
 * (a) die gesamte Übersicht in die Höhe des Bildschirms passt und
 * (b) keine Zeitangabe/Kopfzeile horizontal abgeschnitten wird.
 *
 * Gemessen wird an echtem Layout (nicht geschätzt): zum Messen bekommt der
 * Inhalt `height:auto`, danach wieder `height:100%`, damit die Zeilen den
 * restlichen Platz gleichmäßig ausfüllen.
 */
function useFitFontSize(
  shellRef: React.RefObject<HTMLDivElement | null>,
  fitRef: React.RefObject<HTMLDivElement | null>,
  signature: string
) {
  useLayoutEffect(() => {
    const shell = shellRef.current;
    const fit = fitRef.current;
    if (!shell || !fit) return;
    let raf = 0;

    const overflows = (availH: number): boolean => {
      if (fit.offsetHeight > availH) return true;
      // Elemente, die nie abgeschnitten werden dürfen (Zeiten, Kopfzeilen, Summen).
      // Zeiten dürfen umbrechen — überlaufen erst, wenn schon „11:30 –“ zu breit ist.
      const nodes = fit.querySelectorAll<HTMLElement>("[data-fit-nooverflow]");
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]!;
        if (n.scrollWidth > n.clientWidth + 0.5) return true;
      }
      return false;
    };

    const run = () => {
      const availH = shell.clientHeight - 1;
      if (availH < 80 || shell.clientWidth < 240) return;

      fit.style.height = "auto";
      const fits = (px: number) => {
        fit.style.fontSize = `${px}px`;
        void fit.offsetHeight; // Layout erzwingen
        return !overflows(availH);
      };

      let best: number;
      if (fits(FIT_MAX_PX)) {
        best = FIT_MAX_PX;
      } else if (!fits(FIT_MIN_PX)) {
        best = FIT_MIN_PX;
      } else {
        let lo = FIT_MIN_PX;
        let hi = FIT_MAX_PX;
        for (let i = 0; i < 20; i++) {
          const mid = (lo + hi) / 2;
          if (fits(mid)) lo = mid;
          else hi = mid;
        }
        best = lo;
      }

      fit.style.fontSize = `${best}px`;
      fit.style.height = "100%";
    };

    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(run);
    };

    run();

    const ro = new ResizeObserver(schedule);
    ro.observe(shell);

    const settle = setTimeout(run, 300);
    const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
    void fonts?.ready?.then(run).catch(() => undefined);

    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
      clearTimeout(settle);
    };
  }, [signature, shellRef, fitRef]);
}

/* ------------------------------------------------------------------ *
 * Vollbild (Browser-Leisten weg — mehr Fläche fürs Foto)
 * ------------------------------------------------------------------ */

type FsElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};
type FsDocument = Document & {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
};

function fullscreenActive(): boolean {
  const d = document as FsDocument;
  return Boolean(d.fullscreenElement ?? d.webkitFullscreenElement);
}

export async function requestAppFullscreen(): Promise<void> {
  const el = document.documentElement as FsElement;
  try {
    if (el.requestFullscreen) await el.requestFullscreen();
    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
  } catch {
    /* Vollbild ist optional (z. B. iOS Safari) */
  }
}

async function exitAppFullscreen(): Promise<void> {
  const d = document as FsDocument;
  try {
    if (!fullscreenActive()) return;
    if (d.exitFullscreen) await d.exitFullscreen();
    else if (d.webkitExitFullscreen) await d.webkitExitFullscreen();
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ *
 * Zellen
 * ------------------------------------------------------------------ */

function DayCell({
  raw,
  note,
  showNotes,
  dateISO,
  entryDateISO,
  exitDateISO,
  isWeekend,
  weekendStart,
  isHoliday,
}: {
  raw: string;
  note: string;
  showNotes: boolean;
  dateISO: string;
  entryDateISO: string | null;
  exitDateISO: string | null;
  isWeekend: boolean;
  /** Samstag: kräftigere Trennlinie zwischen Arbeitswoche und Wochenende */
  weekendStart: boolean;
  isHoliday: boolean;
}) {
  const d = shiftDisplay(raw);
  const mark = employmentDayMark(dateISO, entryDateISO, exitDateISO);
  const outsideEmployment = mark === "before_entry" || mark === "after_exit";
  const singleAbbrev =
    d.blocks.length === 1 && d.blocks[0]!.kind === "abbrev"
      ? (d.blocks[0] as { code: ShiftAbbrevUiKind }).code
      : null;

  let tint = "";
  if (singleAbbrev) tint = ABBREV_CELL_TINT[singleAbbrev];
  else if (d.empty && outsideEmployment) tint = "bg-slate-100";
  else if (d.empty && isHoliday) tint = "bg-amber-50/70";
  else if (d.empty && isWeekend) tint = "bg-slate-50";
  else if (isHoliday) tint = "bg-amber-50/40";

  const trimmedNote = (note ?? "").trim();

  return (
    <td
      className={`border border-slate-400 p-0 align-middle ${
        weekendStart ? "border-l-2 border-l-slate-600" : ""
      } ${tint}`}
    >
      <div className="flex h-full flex-col items-center justify-center gap-[0.12em] px-[0.2em] py-[0.28em] text-center">
        {d.empty ? (
          outsideEmployment ? (
            <span className="text-[0.72em] font-medium text-slate-400">—</span>
          ) : (
            <span className="text-[0.78em] font-semibold text-slate-400">frei</span>
          )
        ) : (
          d.blocks.map((b, i) => {
            if (b.kind === "time") {
              return (
                <div key={i} className="w-full">
                  <div
                    data-fit-nooverflow
                    className="w-full overflow-hidden font-bold leading-[1.08] tracking-tight text-slate-900"
                  >
                    {b.time}
                  </div>
                  {b.pause ? (
                    <div className="text-[0.58em] font-semibold leading-tight text-slate-500">
                      {b.pause}
                    </div>
                  ) : null}
                </div>
              );
            }
            if (b.kind === "abbrev") {
              return (
                <span
                  key={i}
                  className={`inline-block max-w-full break-words rounded-[0.22em] px-[0.45em] py-[0.12em] text-[0.8em] font-bold leading-tight text-white ${ABBREV_PILL[b.code]}`}
                >
                  {b.label}
                </span>
              );
            }
            return (
              <div
                key={i}
                className="w-full break-words text-[0.82em] font-semibold leading-tight text-slate-800"
              >
                {b.text}
              </div>
            );
          })
        )}
        {showNotes && trimmedNote ? (
          <div className="w-full break-words text-[0.58em] font-medium leading-tight text-slate-600">
            {trimmedNote}
          </div>
        ) : null}
      </div>
    </td>
  );
}

/* ------------------------------------------------------------------ *
 * Poster
 * ------------------------------------------------------------------ */

export function WeekOverviewPoster({
  onClose,
  weekStartISO,
  isoWeek,
  siteLabel,
  layer,
  onLayerChange,
  days,
  rows,
  hasUnsavedChanges,
  onPrevWeek,
  onNextWeek,
}: Props) {
  const [showHours, setShowHours] = useState(true);
  const [showNotes, setShowNotes] = useState(true);
  const [hideEmptyRows, setHideEmptyRows] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsVisibleRef = useRef(true);
  const [narrowPortrait, setNarrowPortrait] = useState(false);

  const shellRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<HTMLDivElement>(null);

  const [stamp] = useState(() =>
    new Date().toLocaleString("de-AT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  );

  const visibleRows = useMemo(
    () => (hideEmptyRows ? rows.filter((r) => !isEmptyRow(r)) : rows),
    [rows, hideEmptyRows]
  );
  const hiddenCount = rows.length - visibleRows.length;

  const weekEndISO = days[6]?.dateISO ?? weekStartISO;

  const signature = useMemo(
    () =>
      [
        layer,
        weekStartISO,
        showHours ? "h" : "",
        showNotes ? "n" : "",
        String(visibleRows.length),
        visibleRows
          .map((r) => `${r.name}${r.cells.join("")}${r.notes.join("")}`)
          .join(""),
        days.map((d) => d.holidays.map((h) => h.name).join(",")).join("|"),
      ].join("~"),
    [layer, weekStartISO, showHours, showNotes, visibleRows, days]
  );

  useFitFontSize(shellRef, fitRef, signature);

  /* Steuerung blendet sich aus, damit sie nicht mitfotografiert wird. */
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = () => {
      if (!controlsVisibleRef.current) {
        controlsVisibleRef.current = true;
        setControlsVisible(true);
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        controlsVisibleRef.current = false;
        setControlsVisible(false);
      }, 2800);
    };
    show();
    window.addEventListener("mousemove", show, { passive: true });
    window.addEventListener("touchstart", show, { passive: true });
    window.addEventListener("keydown", show);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("mousemove", show);
      window.removeEventListener("touchstart", show);
      window.removeEventListener("keydown", show);
    };
  }, []);

  /* Hochkant am Handy: quer halten bringt deutlich mehr Fläche fürs Foto. */
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 820px) and (orientation: portrait)");
    const sync = () => setNarrowPortrait(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    window.addEventListener("resize", sync);
    return () => {
      mq.removeEventListener("change", sync);
      window.removeEventListener("resize", sync);
    };
  }, []);

  /* Seite dahinter nicht scrollen */
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const sync = () => setIsFullscreen(fullscreenActive());
    sync();
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, []);

  const close = useCallback(() => {
    void exitAppFullscreen();
    onClose();
  }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (fullscreenActive()) void exitAppFullscreen();
        else close();
        return;
      }
      if (e.key === "ArrowLeft") onPrevWeek();
      if (e.key === "ArrowRight") onNextWeek();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, onPrevWeek, onNextWeek]);

  const colCount = 1 + 7 + (showHours ? 1 : 0);
  const nameColPct = showHours ? 17 : 18;
  const hoursColPct = 8;
  const dayColPct = (100 - nameColPct - (showHours ? hoursColPct : 0)) / 7;

  const ctlBtn =
    "rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/20";
  const ctlBtnOn =
    "rounded-lg border border-white/70 bg-white px-3 py-1.5 text-sm font-semibold text-slate-900 transition-colors";

  return (
    <div className="no-print fixed inset-0 z-[100] flex flex-col bg-white">
      {/* Steuerleiste — blendet sich nach kurzer Zeit aus */}
      <div
        className={`absolute bottom-3 left-1/2 z-20 w-[min(96vw,68rem)] -translate-x-1/2 rounded-2xl bg-slate-900/95 px-3 py-2 shadow-2xl ring-1 ring-white/10 backdrop-blur transition-opacity duration-300 ${
          controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button type="button" onClick={onPrevWeek} className={ctlBtn} title="Vorherige Woche (←)">
            ‹
          </button>
          <span className="px-1 text-sm font-semibold text-white">KW {isoWeek}</span>
          <button type="button" onClick={onNextWeek} className={ctlBtn} title="Nächste Woche (→)">
            ›
          </button>

          <span className="mx-1 h-6 w-px bg-white/20" />

          <div className="inline-flex rounded-lg border border-white/20 bg-white/10 p-0.5">
            <button
              type="button"
              onClick={() => onLayerChange("PLAN")}
              className={`rounded-md px-3 py-1 text-sm font-semibold transition-colors ${
                layer === "PLAN" ? "bg-white text-slate-900" : "text-white hover:bg-white/20"
              }`}
            >
              Plan
            </button>
            <button
              type="button"
              onClick={() => onLayerChange("ACTUAL")}
              className={`rounded-md px-3 py-1 text-sm font-semibold transition-colors ${
                layer === "ACTUAL" ? "bg-white text-slate-900" : "text-white hover:bg-white/20"
              }`}
            >
              Ist
            </button>
          </div>

          <span className="mx-1 h-6 w-px bg-white/20" />

          <button
            type="button"
            onClick={() => setShowHours((v) => !v)}
            className={showHours ? ctlBtnOn : ctlBtn}
            title="Spalte mit Wochenstunden ein-/ausblenden"
          >
            Stunden
          </button>
          <button
            type="button"
            onClick={() => setShowNotes((v) => !v)}
            className={showNotes ? ctlBtnOn : ctlBtn}
            title="Notizen der Tage ein-/ausblenden"
          >
            Notizen
          </button>
          <button
            type="button"
            onClick={() => setHideEmptyRows((v) => !v)}
            className={hideEmptyRows ? ctlBtnOn : ctlBtn}
            title="Mitarbeiter ohne Eintrag in dieser Woche ausblenden — der Rest wird dadurch größer"
          >
            Leere aus
          </button>
          <button
            type="button"
            onClick={() =>
              void (fullscreenActive() ? exitAppFullscreen() : requestAppFullscreen())
            }
            className={isFullscreen ? ctlBtnOn : ctlBtn}
            title="Vollbild — ohne Browser-Leisten wird die Übersicht größer"
          >
            Vollbild
          </button>

          <span className="mx-1 h-6 w-px bg-white/20" />

          <button
            type="button"
            onClick={close}
            className="rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-slate-900 hover:bg-slate-200"
            title="Schließen (Esc)"
          >
            ✕ Schließen
          </button>
        </div>
        <p className="mt-1.5 text-center text-xs text-white/70">
          Diese Leiste blendet sich automatisch aus — dann abfotografieren. Maus bewegen holt sie
          zurück.
          {hasUnsavedChanges ? (
            <span className="ml-1 font-semibold text-amber-300">
              Achtung: ungespeicherte Änderungen — die Übersicht zeigt den aktuellen Stand am
              Bildschirm.
            </span>
          ) : null}
        </p>
      </div>

      {narrowPortrait ? (
        <div className="pointer-events-none absolute left-1/2 top-3 z-30 -translate-x-1/2 rounded-full bg-slate-900/95 px-4 py-2 text-center text-xs font-semibold text-white shadow-lg">
          Handy quer halten — dann füllt der Dienstplan den ganzen Bildschirm.
        </div>
      ) : null}

      {/* Poster-Fläche */}
      <div ref={shellRef} className="relative min-h-0 flex-1 overflow-hidden">
        <div
          ref={fitRef}
          className="flex w-full flex-col p-[0.5em]"
          style={{ height: "100%" }}
        >
          {/* Kopf */}
          <div className="flex shrink-0 items-end justify-between gap-[0.6em] pb-[0.35em]">
            <div className="min-w-0">
              <div className="text-[1.5em] font-black leading-none tracking-tight text-slate-900">
                Dienstplan {siteLabel}
              </div>
              <div className="mt-[0.25em] text-[0.85em] font-bold leading-none text-slate-600">
                KW {isoWeek} · {ddmmyyyy(weekStartISO)} – {ddmmyyyy(weekEndISO)}
              </div>
            </div>
            <div className="shrink-0">
              <span
                className={`inline-block rounded-[0.25em] px-[0.6em] py-[0.2em] text-[0.95em] font-black uppercase tracking-wide text-white ${
                  layer === "PLAN" ? "bg-[var(--rota-header)]" : "bg-slate-800"
                }`}
              >
                {layer === "PLAN" ? "Plan" : "Ist"}
              </span>
            </div>
          </div>

          {/* Raster */}
          <div className="min-h-0 flex-1">
            <table
              className="w-full table-fixed border-collapse border-2 border-slate-600 bg-white"
              style={{ height: "100%" }}
            >
              <colgroup>
                <col style={{ width: `${nameColPct}%` }} />
                {days.map((d) => (
                  <col key={`col-${d.dateISO}`} style={{ width: `${dayColPct}%` }} />
                ))}
                {showHours ? <col style={{ width: `${hoursColPct}%` }} /> : null}
              </colgroup>
              <thead>
                <tr className="bg-[var(--rota-header)] text-white">
                  <th className="border border-slate-600 px-[0.4em] py-[0.3em] text-left align-middle">
                    <span className="text-[0.95em] font-black tracking-tight">Mitarbeiter</span>
                  </th>
                  {days.map((d, i) => {
                    const holiday = d.holidays[0] ?? null;
                    return (
                      <th
                        key={`h-${d.dateISO}`}
                        className={`border border-slate-600 px-[0.2em] py-[0.3em] text-center align-middle ${
                          holiday ? "bg-amber-500 text-slate-950" : ""
                        }`}
                      >
                        <div
                          data-fit-nooverflow
                          className="overflow-hidden whitespace-nowrap text-[1.05em] font-black leading-none tracking-tight"
                        >
                          {DAY_LABELS[i]}
                        </div>
                        <div className="mt-[0.15em] text-[0.7em] font-bold leading-none opacity-95">
                          {ddmm(d.dateISO)}
                        </div>
                        {holiday ? (
                          <div className="mt-[0.15em] break-words text-[0.58em] font-bold leading-tight">
                            {holiday.name}
                          </div>
                        ) : null}
                      </th>
                    );
                  })}
                  {showHours ? (
                    <th className="border border-slate-600 px-[0.2em] py-[0.3em] text-center align-middle">
                      <div
                        data-fit-nooverflow
                        className="overflow-hidden whitespace-nowrap text-[0.9em] font-black leading-none"
                      >
                        Std.
                      </div>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {visibleRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={colCount}
                      className="border border-slate-400 px-[0.5em] py-[1em] text-center text-[0.9em] font-semibold text-slate-500"
                    >
                      Keine Einträge in dieser Woche.
                    </td>
                  </tr>
                ) : (
                  visibleRows.map((r, ri) => (
                    <tr key={r.id} className={ri % 2 === 1 ? "bg-slate-50/70" : undefined}>
                      <td className="border border-slate-400 bg-[var(--rota-rail)] p-0 align-middle">
                        <div className="flex h-full flex-col justify-center px-[0.4em] py-[0.25em]">
                          <div
                            lang="de"
                            className="hyphens-auto break-words text-[1em] font-black leading-tight tracking-tight text-slate-900"
                          >
                            {r.name}
                          </div>
                          {r.shared ? (
                            <div className="text-[0.55em] font-bold uppercase leading-tight tracking-wide text-slate-500">
                              beide Standorte
                            </div>
                          ) : null}
                        </div>
                      </td>
                      {r.cells.map((raw, di) => {
                        const day = days[di];
                        const dateISO = day?.dateISO ?? "";
                        return (
                          <DayCell
                            key={di}
                            raw={raw ?? ""}
                            note={r.notes[di] ?? ""}
                            showNotes={showNotes}
                            dateISO={dateISO}
                            entryDateISO={r.entryDateISO}
                            exitDateISO={r.exitDateISO}
                            isWeekend={di >= 5}
                            weekendStart={di === 5}
                            isHoliday={(day?.holidays.length ?? 0) > 0}
                          />
                        );
                      })}
                      {showHours ? (
                        <td className="border border-slate-400 bg-slate-100 p-0 align-middle">
                          <div
                            data-fit-nooverflow
                            className="overflow-hidden whitespace-nowrap px-[0.25em] text-center text-[0.9em] font-black tabular-nums text-slate-900"
                          >
                            {hoursFmt.format(r.weeklyHours)}
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Legende */}
          <div className="mt-[0.3em] flex shrink-0 flex-wrap items-center justify-between gap-x-[0.8em] gap-y-[0.2em] text-[0.6em] font-semibold text-slate-600">
            <div className="flex flex-wrap items-center gap-x-[0.8em] gap-y-[0.2em]">
              {(Object.keys(SHIFT_ABBREV_LABEL) as ShiftAbbrevUiKind[]).map((k) => (
                <span key={k} className="inline-flex items-center gap-[0.3em]">
                  <span className={`inline-block h-[0.85em] w-[0.85em] rounded-[0.2em] ${ABBREV_PILL[k]}`} />
                  {SHIFT_ABBREV_LABEL[k]}
                </span>
              ))}
              <span className="text-slate-500">Zeiten = Dienstbeginn – Dienstende</span>
            </div>
            <div className="text-slate-500">
              {hiddenCount > 0 ? (
                <span className="font-bold text-slate-600">
                  {hiddenCount} ohne Dienst ausgeblendet ·{" "}
                </span>
              ) : null}
              Stand {stamp}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
