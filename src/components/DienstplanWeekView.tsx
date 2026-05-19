"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  addDaysISO,
  defaultWeekStartISO,
  weekStartISOContainingDate,
} from "@/lib/dateNav";
import {
  employmentDayMark,
  employmentDayShellClasses,
  employmentDayTitle,
  weekExitRowBadge,
  weekExitScope,
  weekExitScopeRowClasses,
  weekExitScopeSummaryColClasses,
} from "@/lib/employeeEmployment";
import { firstContractEffectiveFromISO } from "@/lib/firstContractDate";
import { austrianLaborHintsForWeek } from "@/lib/austrianLaborHints";
import {
  computeWeeklyBalanceWithContracts,
} from "@/lib/computeWeekly";
import { countVacationDaysInWeekWithPlanActual } from "@/lib/vacation";
import { contractForDate, type ContractRow } from "@/lib/employeeContract";
import {
  shiftAbbrevUiKind,
  type ShiftAbbrevUiKind,
} from "@/lib/parseShiftCell";
import { WeekWeatherSkeleton, WeekWeatherStrip } from "@/components/WeekWeatherStrip";

type Layer = "PLAN" | "ACTUAL";
type UiWorkSite = "CRUSH" | "CAPPUCONE";

const SITE_STORAGE_KEY = "dienstplan-active-site";
const WEATHER_STORAGE_KEY = "dienstplan-show-weather";
/** Geteilte Mitarbeiter (SHARED) in der Tabelle ausblenden */
const HIDE_SHARED_STORAGE_KEY = "dienstplan-hide-shared";

type WeatherApiResponse = {
  weekStart: string;
  weekEnd: string;
  locationName: string;
  days: {
    dateISO: string;
    tempMin: number;
    tempMax: number;
    precipProbMax: number | null;
    windGustsMax: number | null;
    labelDe: string;
    symbol: string;
  }[];
  attribution: string;
};

type LaborHint = {
  code: string;
  severity: "warning" | "info";
  message: string;
  dayIndex?: number;
  dateISO?: string;
};

type RowDTO = {
  employee: {
    id: string;
    name: string;
    workSite: "CRUSH" | "CAPPUCONE" | "SHARED";
    contractHoursPerWeek: number;
    workDaysPerWeek: number;
    vacationDaysOpen: number;
    /** Für Fallback-Vertrag ohne Historie-Zeilen */
    entryDate?: string | null;
    exitDate?: string | null;
  };
  plan: string[];
  actual: string[];
  planNotes: string[];
  actualNotes: string[];
  /** Summe Stunden Plan (Woche), nicht Δ zum Vertrag */
  wsPlan: number;
  /** Summe Stunden Ist (Woche) */
  wsActual: number;
  errorsPlan: string[];
  errorsActual: string[];
  balanceBeforeWeek: number;
  zagPreview: number;
  prevSundayPlan: string | null;
  prevSundayActual: string | null;
  /** Vertrags-Historie (für Wechsel mitten in der KW) */
  contractRows?: ContractRow[];
};

function contractRowsForRow(r: RowDTO): ContractRow[] {
  if (r.contractRows && r.contractRows.length > 0) return r.contractRows;
  const entry = r.employee.entryDate ?? null;
  return [
    {
      effectiveFrom: firstContractEffectiveFromISO(
        entry ? new Date(`${entry}T12:00:00.000Z`) : null
      ),
      contractHoursPerWeek: r.employee.contractHoursPerWeek,
      workDaysPerWeek: r.employee.workDaysPerWeek,
    },
  ];
}

/** Anzeige Mo…So: ein Wert oder „10/3T → 30/3T“ wenn die KW zwei Verträge trifft */
function contractLabelForWeek(rows: ContractRow[], weekStartISO: string): string {
  const first = contractForDate(rows, weekStartISO);
  const last = contractForDate(rows, addDaysISO(weekStartISO, 6));
  const a = `${fmt.format(first.contractHoursPerWeek)}/${first.workDaysPerWeek}`;
  const b = `${fmt.format(last.contractHoursPerWeek)}/${last.workDaysPerWeek}`;
  if (a === b) return `${a}T`;
  return `${a}T → ${b}T`;
}

type FerienInDay = {
  name: string;
  region: string;
  position: "start" | "end" | "between" | "single";
};

type DayMeta = {
  dayIndex: number;
  dateISO: string;
  holidays: { name: string; region: string }[];
  ferien: FerienInDay[];
};

type WeekPayload = {
  weekStart: string;
  site: UiWorkSite;
  status: "DRAFT" | "CLOSED";
  isoWeek: number;
  feiDaysInWeek: number;
  days: DayMeta[];
  rows: RowDTO[];
};

type GridRow = {
  plan: string[];
  actual: string[];
  planNotes: string[];
  actualNotes: string[];
};

const SHORT_DAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

const ABBREV_BADGE: Record<
  ShiftAbbrevUiKind,
  { chip: string; title: string; printBg: string }
> = {
  u: {
    chip: "bg-emerald-600 ring-1 ring-emerald-800/20",
    title: "Urlaub (U)",
    printBg: "bg-emerald-100",
  },
  k: {
    chip: "bg-rose-600 ring-1 ring-rose-900/20",
    title: "Krankheit (K)",
    printBg: "bg-rose-100",
  },
  f: {
    chip: "bg-amber-600 ring-1 ring-amber-900/25",
    title: "Feiertag (F / FT / Feiertag)",
    printBg: "bg-amber-100",
  },
  z: {
    chip: "bg-violet-600 ring-1 ring-violet-900/20",
    title: "Zeitausgleich (ZA)",
    printBg: "bg-violet-100",
  },
};

function rotaShiftCellShellClasses(kind: ShiftAbbrevUiKind | null): string {
  const base = "border-2 border-slate-400";
  if (!kind) return `${base} bg-white`;
  switch (kind) {
    case "u":
      return `${base} border-l-[6px] border-l-emerald-600 bg-emerald-50/90`;
    case "k":
      return `${base} border-l-[6px] border-l-rose-600 bg-rose-50/90`;
    case "f":
      return `${base} border-l-[6px] border-l-amber-600 bg-amber-50/95`;
    case "z":
      return `${base} border-l-[6px] border-l-violet-600 bg-violet-50/90`;
  }
}

function rotaAbbrevMarkChar(kind: ShiftAbbrevUiKind): string {
  switch (kind) {
    case "u":
      return "U";
    case "k":
      return "K";
    case "f":
      return "F";
    case "z":
      return "Z";
  }
}

function rotaPrintCellClass(
  raw: string,
  employmentMark: ReturnType<typeof employmentDayMark> = "active"
): string {
  const k = shiftAbbrevUiKind(raw ?? "");
  const base =
    "border-2 border-slate-500 px-1 py-1 align-top text-[11px] font-semibold leading-snug text-slate-900 print:text-xs";
  const emp = employmentDayShellClasses(employmentMark);
  if (!k) return emp ? `${base} ${emp}` : base;
  return `${base} ${ABBREV_BADGE[k].printBg}${emp ? ` ${emp}` : ""}`;
}

function rotaAbbrevCaretClass(kind: ShiftAbbrevUiKind): string {
  switch (kind) {
    case "u":
      return "caret-emerald-800";
    case "k":
      return "caret-rose-900";
    case "f":
      return "caret-amber-950";
    case "z":
      return "caret-violet-900";
  }
}

type RotaDayCellProps = {
  dayShort: string;
  readOnly: boolean;
  val: string;
  note: string;
  employmentMark?: ReturnType<typeof employmentDayMark>;
  onValChange: (v: string) => void;
  onNoteChange: (v: string) => void;
};

/**
 * Schichtzelle: Abkürzung U/K/F/Z als ein farbiges Kästchen (Text im Feld unsichtbar bis Fokus).
 * Notiz: volle Höhe für die Zeit, zweite Zeile nur bei Inhalt oder nach kleinem „+“ unten rechts.
 */
function RotaDayCell({
  dayShort,
  readOnly,
  val,
  note,
  employmentMark = "active",
  onValChange,
  onNoteChange,
}: RotaDayCellProps) {
  const abbrKind = shiftAbbrevUiKind(val ?? "");
  const employmentShell = employmentDayShellClasses(employmentMark);
  const shell = `${rotaShiftCellShellClasses(abbrKind)} ${employmentShell}`.trim();
  const employmentHint = employmentDayTitle(employmentMark);
  const badgeMeta = abbrKind ? ABBREV_BADGE[abbrKind] : null;
  const [shiftFocused, setShiftFocused] = useState(false);
  const noteRef = useRef<HTMLInputElement>(null);
  const hasNote = (note ?? "").trim().length > 0;
  const [noteRowVisible, setNoteRowVisible] = useState(hasNote);

  useEffect(() => {
    if (hasNote) setNoteRowVisible(true);
  }, [hasNote]);

  const showAbbrevTile =
    Boolean(abbrKind && badgeMeta) &&
    (readOnly || !shiftFocused);

  const shiftMinH = noteRowVisible ? "min-h-[2.35rem]" : "min-h-[3.65rem]";

  const dis = readOnly ? "disabled:bg-slate-100/80 disabled:opacity-95" : "";

  let shiftClass = `rota-shift-input-fluid w-full min-w-0 rounded-md border-2 py-1 font-semibold leading-tight tracking-tight outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--rota-header)] ${shiftMinH} ${dis}`;

  if (!abbrKind) {
    shiftClass += showAbbrevTile
      ? ""
      : ` border-slate-400 bg-white text-slate-900 placeholder:text-slate-400 placeholder:font-medium`;
  } else if (showAbbrevTile) {
    shiftClass += ` border-transparent bg-transparent text-transparent shadow-none ${rotaAbbrevCaretClass(abbrKind)}`;
  } else {
    const col =
      abbrKind === "u"
        ? "border-emerald-400/90 bg-white/95 text-emerald-950"
        : abbrKind === "k"
          ? "border-rose-400/90 bg-white/95 text-rose-950"
          : abbrKind === "f"
            ? "border-amber-400/90 bg-white/95 text-amber-950"
            : "border-violet-400/90 bg-white/95 text-violet-950";
    shiftClass += ` ${col}`;
  }

  function openNoteRow() {
    setNoteRowVisible(true);
    queueMicrotask(() => noteRef.current?.focus());
  }

  function onNoteBlur() {
    if ((noteRef.current?.value ?? "").trim() === "") {
      setNoteRowVisible(false);
    }
  }

  return (
    <td
      className={`rota-day-cell-cq relative p-0 align-stretch ${shell}`}
      title={employmentHint}
    >
      <div className="flex h-full min-h-0 flex-col gap-1 p-1 pb-3">
        <div
          className={`relative flex min-w-0 flex-1 items-center justify-center ${noteRowVisible ? "" : "min-h-[4.15rem]"}`}
        >
          {showAbbrevTile && badgeMeta ? (
            <div
              className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center"
              aria-hidden
            >
              <span
                className={`rota-shift-abbrev-tile flex items-center justify-center rounded-lg font-bold leading-none text-white shadow-md ${badgeMeta.chip}`}
                title={badgeMeta.title}
              >
                {rotaAbbrevMarkChar(abbrKind!)}
              </span>
            </div>
          ) : null}
          <input
            disabled={readOnly}
            value={val}
            onChange={(e) => onValChange(e.target.value)}
            onFocus={() => setShiftFocused(true)}
            onBlur={() => setShiftFocused(false)}
            className={`relative z-10 box-border ${shiftClass}`}
            title={badgeMeta?.title}
            aria-label={`Schicht ${dayShort}${badgeMeta ? `, ${badgeMeta.title}` : ""}`}
          />
        </div>
        {noteRowVisible ? (
          <input
            ref={noteRef}
            disabled={readOnly}
            value={note ?? ""}
            onChange={(e) => onNoteChange(e.target.value)}
            onBlur={onNoteBlur}
            className="h-7 w-full min-w-[6.5rem] shrink-0 rounded-md border-2 border-dashed border-slate-400 bg-slate-100/90 px-2 text-[12px] font-medium text-slate-800 outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--rota-header)] disabled:bg-slate-200/80"
            aria-label={`Notiz ${dayShort}`}
            placeholder="Notiz …"
            maxLength={2000}
          />
        ) : null}
      </div>
      {!noteRowVisible && !readOnly ? (
        <button
          type="button"
          onClick={openNoteRow}
          className="absolute bottom-px right-px z-20 flex h-3.5 min-w-[0.85rem] items-center justify-center rounded px-[1px] text-[9px] font-semibold leading-none text-slate-400 hover:bg-slate-200/70 hover:text-slate-600"
          aria-label="Notiz hinzufügen"
          title="Notiz hinzufügen"
        >
          +
        </button>
      ) : null}
    </td>
  );
}

/** Kopfzeile: Feiertag amber; Ferien Start/Ende zusätzlich Ring; nur Ferien „dazwischen“ sehr leicht. */
function dayHeaderHighlightClasses(d: DayMeta): string {
  const hasHol = d.holidays.length > 0;
  const ferien = d.ferien ?? [];
  const strongFerien = ferien.some(
    (f) =>
      f.position === "start" ||
      f.position === "end" ||
      f.position === "single"
  );
  const hasFerien = ferien.length > 0;
  const lightOnlyFerien = hasFerien && !strongFerien;

  const parts: string[] = [];
  if (hasHol) parts.push("bg-amber-500/35");
  if (strongFerien) {
    parts.push("ring-2 ring-inset ring-cyan-200/90");
    if (!hasHol) parts.push("bg-cyan-400/20");
  }
  if (lightOnlyFerien) parts.push("bg-white/[0.08]");
  return parts.join(" ");
}

function escapeCsvField(s: string): string {
  if (/[;"\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function istCellsForRow(r: RowDTO, grid: Record<string, GridRow>): {
  actual: string[];
  actualNotes: string[];
} {
  const g = grid[r.employee.id];
  if (!g) {
    return { actual: r.actual, actualNotes: r.actualNotes ?? Array(7).fill("") };
  }
  return {
    actual: g.actual.length ? g.actual : r.actual,
    actualNotes: g.actualNotes.length ? g.actualNotes : r.actualNotes ?? Array(7).fill(""),
  };
}

function planCellsForRow(r: RowDTO, grid: Record<string, GridRow>): {
  plan: string[];
  planNotes: string[];
} {
  const g = grid[r.employee.id];
  if (!g) {
    return { plan: r.plan, planNotes: r.planNotes ?? Array(7).fill("") };
  }
  return {
    plan: g.plan.length ? g.plan : r.plan,
    planNotes: g.planNotes.length ? g.planNotes : r.planNotes ?? Array(7).fill(""),
  };
}

/** Alle sichtbaren Zeit-Zellen (keine U/K/F/Z-Kürzel) für eine einheitliche Tabellen-Schriftgröße. */
function collectRotaTimeStringsForUniformFont(
  rows: RowDTO[],
  grid: Record<string, GridRow>,
  layer: Layer
): string[] {
  const out: string[] = [];
  for (const r of rows) {
    const cells =
      layer === "PLAN"
        ? planCellsForRow(r, grid).plan
        : istCellsForRow(r, grid).actual;
    for (let di = 0; di < 7; di++) {
      const v = (cells[di] ?? "").trim();
      if (!v) continue;
      if (shiftAbbrevUiKind(v)) continue;
      out.push(v);
    }
  }
  return out;
}

/**
 * Prüft mit verstecktem Input (gleiche Klassen + Breite wie Referenzfeld), ob **alle** Zeitstrings bei `px` passen.
 * Wie zuvor: Referenz = **erstes** Schichtfeld, `width` = dessen `clientWidth`.
 * Gegen Abschneiden der letzten Ziffer: früher galt `scrollWidth > clientWidth + 2` → bis **2px Überlauf** wurde noch
 * als „passt“ gewertet. Jetzt strikt `scrollWidth ≤ clientWidth` (kein Zuschlag nach oben).
 */
function rotaAllTimeStringsFitAtFontPx(
  strings: readonly string[],
  px: number,
  referenceInput: HTMLInputElement,
  probe: HTMLInputElement
): boolean {
  const w = referenceInput.clientWidth;
  if (w < 24) return false;
  probe.style.width = `${w}px`;
  probe.style.maxWidth = `${w}px`;
  probe.style.fontSize = `${px}px`;
  for (const s of strings) {
    probe.value = s;
    void probe.offsetWidth;
    if (probe.scrollWidth > probe.clientWidth) return false;
  }
  return true;
}

/**
 * Eine gemeinsame Schriftgröße für alle Zeit-Einträge im Raster: so groß wie möglich (bis 22px),
 * begrenzt durch echtes Input-Layout (scrollWidth). ResizeObserver bei Fenster-/Scroll-Änderung.
 */
function useUniformRotaShiftFont(
  tableWrapRef: React.RefObject<HTMLDivElement | null>,
  timeStrings: readonly string[],
  enabled: boolean
) {
  const signature = timeStrings.join("\u0001");

  useLayoutEffect(() => {
    const root = tableWrapRef.current;
    if (!enabled) {
      root?.style.removeProperty("--rota-shift-uniform");
      return;
    }
    if (!root) return;

    const probe = document.createElement("input");
    probe.type = "text";
    probe.readOnly = true;
    probe.tabIndex = -1;
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText =
      "position:fixed;left:0;top:0;opacity:0;pointer-events:none;z-index:-1;margin:0;box-sizing:border-box;";
    document.body.appendChild(probe);

    const run = () => {
      const input = root.querySelector(
        "input.rota-shift-input-fluid"
      ) as HTMLInputElement | null;
      if (!input) return;
      if (input.clientWidth < 36) return;

      if (timeStrings.length === 0) {
        root.style.removeProperty("--rota-shift-uniform");
        return;
      }

      probe.className = input.className;
      void probe.offsetWidth;

      const lo = 7.5;
      const hi = 22;
      const fit = (px: number) =>
        rotaAllTimeStringsFitAtFontPx(timeStrings, px, input, probe);

      if (fit(hi)) {
        root.style.setProperty("--rota-shift-uniform", `${hi}px`);
        return;
      }
      if (!fit(lo)) {
        root.style.setProperty("--rota-shift-uniform", `${lo}px`);
        return;
      }
      let low = lo;
      let high = hi;
      for (let i = 0; i < 28; i++) {
        const mid = (low + high) / 2;
        if (fit(mid)) low = mid;
        else high = mid;
      }
      root.style.setProperty("--rota-shift-uniform", `${low}px`);
    };

    const ro = new ResizeObserver(() => requestAnimationFrame(run));
    ro.observe(root);
    requestAnimationFrame(run);
    return () => {
      ro.disconnect();
      probe.remove();
      root.style.removeProperty("--rota-shift-uniform");
    };
  }, [enabled, signature, tableWrapRef]);
}

/** o. U. nach Plan+Ist im Raster vs. zuletzt geladenem Stand (Vorschau vor Speichern). */
function vacationOpenPreview(
  r: RowDTO,
  grid: Record<string, GridRow>,
  weekStart: string,
  cr: ContractRow[]
): number {
  const { plan: livePlan } = planCellsForRow(r, grid);
  const { actual: liveActual } = istCellsForRow(r, grid);
  const saved = countVacationDaysInWeekWithPlanActual(
    r.plan,
    r.actual,
    weekStart,
    cr
  );
  const live = countVacationDaysInWeekWithPlanActual(
    livePlan,
    liveActual,
    weekStart,
    cr
  );
  return r.employee.vacationDaysOpen - (live - saved);
}

/** Nur bei transienten Server-/Netzwerkfehlern wiederholen — keine Doppel-Speicherung bei 4xx. */
const SAVE_RETRY_DELAYS_MS = [0, 900, 2200] as const;
const SAVE_MAX_ATTEMPTS = 3;

async function putWeekWithSafeRetry(payload: object): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < SAVE_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise((r) =>
        setTimeout(r, SAVE_RETRY_DELAYS_MS[attempt] ?? 1500)
      );
    }
    try {
      const res = await fetch("/api/week", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) return res;
      const retryable =
        res.status === 502 ||
        res.status === 503 ||
        res.status === 504 ||
        res.status === 408 ||
        res.status === 429;
      if (!retryable || attempt === SAVE_MAX_ATTEMPTS - 1) return res;
    } catch (e) {
      lastErr = e;
      if (attempt === SAVE_MAX_ATTEMPTS - 1) throw e;
    }
  }
  throw lastErr ?? new Error("Speichern fehlgeschlagen");
}

const fmt = new Intl.NumberFormat("de-AT", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** Offener Urlaub (Tage): bis 2 Nachkommastellen, nicht auf 0,5 runden */
const fmtVacDays = new Intl.NumberFormat("de-AT", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function emptyGridRow(): GridRow {
  return {
    plan: Array(7).fill(""),
    actual: Array(7).fill(""),
    planNotes: Array(7).fill(""),
    actualNotes: Array(7).fill(""),
  };
}

function workSiteLabel(s: UiWorkSite): string {
  return s === "CRUSH" ? "Crush" : "CappuCone";
}

export function DienstplanWeekView() {
  const [weekStart, setWeekStart] = useState(defaultWeekStartISO);
  const [workSite, setWorkSite] = useState<UiWorkSite>("CRUSH");
  const [layer, setLayer] = useState<Layer>("PLAN");
  const [data, setData] = useState<WeekPayload | null>(null);
  const [grid, setGrid] = useState<Record<string, GridRow>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importingPrevWeek, setImportingPrevWeek] = useState(false);
  const [reorderBusy, setReorderBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [laborOpenEmp, setLaborOpenEmp] = useState<string | null>(null);
  const saveInFlightRef = useRef(false);
  const rotaTableWrapRef = useRef<HTMLDivElement>(null);
  const [showWeather, setShowWeather] = useState(false);
  const [weatherData, setWeatherData] = useState<WeatherApiResponse | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherErr, setWeatherErr] = useState<string | null>(null);
  const [hideSharedEmployees, setHideSharedEmployees] = useState(false);

  /** Kalendertage mit gesetzlichem Feiertag (aus API) — für FT = Soll-Tag / Feiertagsentgelt. */
  const publicHolidayDates = useMemo(() => {
    if (!data) return new Set<string>();
    return new Set(
      data.days.filter((d) => d.holidays.length > 0).map((d) => d.dateISO)
    );
  }, [data]);

  useEffect(() => {
    try {
      const s = localStorage.getItem(SITE_STORAGE_KEY);
      if (s === "CAPPUCONE" || s === "CRUSH") setWorkSite(s);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      const w = localStorage.getItem(WEATHER_STORAGE_KEY);
      if (w === "1") setShowWeather(true);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      const h = localStorage.getItem(HIDE_SHARED_STORAGE_KEY);
      if (h === "1") setHideSharedEmployees(true);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(SITE_STORAGE_KEY, workSite);
    } catch {
      /* ignore */
    }
  }, [workSite]);

  useEffect(() => {
    try {
      localStorage.setItem(WEATHER_STORAGE_KEY, showWeather ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [showWeather]);

  useEffect(() => {
    try {
      localStorage.setItem(HIDE_SHARED_STORAGE_KEY, hideSharedEmployees ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [hideSharedEmployees]);

  useEffect(() => {
    if (!showWeather) {
      setWeatherData(null);
      setWeatherErr(null);
      setWeatherLoading(false);
      return;
    }
    const ac = new AbortController();
    setWeatherLoading(true);
    setWeatherErr(null);
    void (async () => {
      try {
        const res = await fetch(
          `/api/weather?weekStart=${encodeURIComponent(weekStart)}`,
          { signal: ac.signal }
        );
        const json = (await res.json()) as WeatherApiResponse & { error?: string };
        if (!res.ok) {
          setWeatherData(null);
          setWeatherErr(json.error ?? "Wetter konnte nicht geladen werden.");
          return;
        }
        setWeatherData(json);
        setWeatherErr(null);
      } catch (e: unknown) {
        if (e instanceof Error && e.name === "AbortError") return;
        setWeatherData(null);
        setWeatherErr("Wetter konnte nicht geladen werden.");
      } finally {
        if (!ac.signal.aborted) setWeatherLoading(false);
      }
    })();
    return () => ac.abort();
  }, [showWeather, weekStart]);

  const load = useCallback(
    async (opts?: { preserveMessage?: boolean }): Promise<WeekPayload | null> => {
      setLoading(true);
      if (!opts?.preserveMessage) setMsg(null);
      try {
        const res = await fetch(
          `/api/week?start=${encodeURIComponent(weekStart)}&site=${encodeURIComponent(workSite)}`,
          { cache: "no-store" }
        );
        if (!res.ok) throw new Error("Laden fehlgeschlagen");
        const json: WeekPayload = await res.json();
        setData(json);
        const g: Record<string, GridRow> = {};
        for (const r of json.rows) {
          g[r.employee.id] = {
            plan: [...r.plan],
            actual: [...r.actual],
            planNotes: [...(r.planNotes ?? Array(7).fill(""))],
            actualNotes: [...(r.actualNotes ?? Array(7).fill(""))],
          };
        }
        setGrid(g);
        return json;
      } catch {
        setMsg("Woche konnte nicht geladen werden.");
        return null;
      } finally {
        setLoading(false);
      }
    },
    [weekStart, workSite]
  );

  useEffect(() => {
    void load();
  }, [load]);

  function setCell(empId: string, day: number, value: string) {
    setGrid((prev) => {
      const row = prev[empId] ?? emptyGridRow();
      const next = {
        ...prev,
        [empId]: {
          plan: [...row.plan],
          actual: [...row.actual],
          planNotes: [...row.planNotes],
          actualNotes: [...row.actualNotes],
        },
      };
      if (layer === "PLAN") next[empId]!.plan[day] = value;
      else next[empId]!.actual[day] = value;
      return next;
    });
  }

  function setNote(empId: string, day: number, value: string) {
    setGrid((prev) => {
      const row = prev[empId] ?? emptyGridRow();
      const next = {
        ...prev,
        [empId]: {
          plan: [...row.plan],
          actual: [...row.actual],
          planNotes: [...row.planNotes],
          actualNotes: [...row.actualNotes],
        },
      };
      if (layer === "PLAN") next[empId]!.planNotes[day] = value;
      else next[empId]!.actualNotes[day] = value;
      return next;
    });
  }

  /** Kopiert für alle Mitarbeiter Plan → Ist (Schichten + Notizen). Noch nicht gespeichert. */
  function copyPlanToActual() {
    if (!data || data.status === "CLOSED") return;

    let hasIstContent = false;
    for (const r of data.rows) {
      const g = grid[r.employee.id];
      const actual = g?.actual ?? r.actual;
      const actualNotes =
        g?.actualNotes ?? r.actualNotes ?? Array(7).fill("");
      for (let d = 0; d < 7; d++) {
        if (
          (actual[d] ?? "").trim() !== "" ||
          (actualNotes[d] ?? "").trim() !== ""
        ) {
          hasIstContent = true;
          break;
        }
      }
      if (hasIstContent) break;
    }

    if (
      hasIstContent &&
      !confirm(
        "Bereits eingetragene Ist-Zeilen und -Notizen werden für alle Mitarbeiter überschrieben. Fortfahren?"
      )
    ) {
      return;
    }

    setGrid((prev) => {
      const next: Record<string, GridRow> = { ...prev };
      for (const r of data.rows) {
        const g = prev[r.employee.id];
        const plan = g ? [...g.plan] : [...r.plan];
        const planNotes = g
          ? [...g.planNotes]
          : [...(r.planNotes ?? Array(7).fill(""))];
        next[r.employee.id] = {
          plan,
          actual: [...plan],
          planNotes,
          actualNotes: [...planNotes],
        };
      }
      return next;
    });
    setLayer("ACTUAL");
    setMsg("Plan (Soll) wurde in Ist übernommen — bitte Speichern.");
  }

  function weekHasAnyContent(): boolean {
    if (!data) return false;
    for (const r of data.rows) {
      const g = grid[r.employee.id];
      const plan = g?.plan ?? r.plan;
      const actual = g?.actual ?? r.actual;
      const planNotes =
        g?.planNotes ?? r.planNotes ?? Array(7).fill("");
      const actualNotes =
        g?.actualNotes ?? r.actualNotes ?? Array(7).fill("");
      for (let d = 0; d < 7; d++) {
        if (
          (plan[d] ?? "").trim() !== "" ||
          (actual[d] ?? "").trim() !== "" ||
          (planNotes[d] ?? "").trim() !== "" ||
          (actualNotes[d] ?? "").trim() !== ""
        ) {
          return true;
        }
      }
    }
    return false;
  }

  /** Leert Plan, Ist und alle Notizen für die aktuelle Woche (nur im Browser, bis Speichern). */
  function clearCurrentWeek() {
    if (!data || data.status === "CLOSED") return;
    if (
      !confirm(
        "Alle Plan- und Ist-Einträge sowie Notizen dieser Woche für alle Mitarbeiter löschen? (Noch nicht gespeichert — danach „Speichern“.)"
      )
    ) {
      return;
    }
    const empty7 = () => Array(7).fill("") as string[];
    setGrid((prev) => {
      const next: Record<string, GridRow> = { ...prev };
      for (const r of data.rows) {
        next[r.employee.id] = {
          plan: empty7(),
          actual: empty7(),
          planNotes: empty7(),
          actualNotes: empty7(),
        };
      }
      return next;
    });
    setMsg("Woche geleert — bitte Speichern.");
  }

  /** Übernimmt Vorwoche (Plan, Ist, Notizen) für alle Mitarbeiter, die in beiden Wochen vorkommen. */
  async function copyPreviousWeek() {
    if (!data || data.status === "CLOSED") return;
    if (weekHasAnyContent()) {
      if (
        !confirm(
          "Die aktuelle Woche enthält schon Einträge. Mit den Daten der Vorwoche komplett überschreiben?"
        )
      ) {
        return;
      }
    }
    const prevStart = addDaysISO(weekStart, -7);
    setImportingPrevWeek(true);
    setMsg("Lade Vorwoche…");
    try {
      const res = await fetch(
        `/api/week?start=${encodeURIComponent(prevStart)}&site=${encodeURIComponent(workSite)}`
      );
      if (!res.ok) {
        setMsg("Vorwoche konnte nicht geladen werden.");
        return;
      }
      const prevPayload: WeekPayload = await res.json();
      const byId = new Map(prevPayload.rows.map((row) => [row.employee.id, row]));

      setGrid((prev) => {
        const next: Record<string, GridRow> = { ...prev };
        for (const r of data.rows) {
          const p = byId.get(r.employee.id);
          const empty7 = () => Array(7).fill("") as string[];
          if (!p) {
            next[r.employee.id] = {
              plan: empty7(),
              actual: empty7(),
              planNotes: empty7(),
              actualNotes: empty7(),
            };
            continue;
          }
          next[r.employee.id] = {
            plan: [...p.plan],
            actual: [...p.actual],
            planNotes: [...(p.planNotes ?? Array(7).fill(""))],
            actualNotes: [...(p.actualNotes ?? Array(7).fill(""))],
          };
        }
        return next;
      });
      setMsg(
        `Daten der Vorwoche (${prevStart.split("-").reverse().join(".")}) übernommen — bitte Speichern.`
      );
    } catch {
      setMsg("Vorwoche konnte nicht geladen werden.");
    } finally {
      setImportingPrevWeek(false);
    }
  }

  async function save() {
    if (!data || saveInFlightRef.current) return;
    saveInFlightRef.current = true;
    setSaving(true);
    setMsg(null);
    const cells: {
      employeeId: string;
      dayIndex: number;
      layer: Layer;
      rawValue: string;
      note: string;
    }[] = [];
    for (const r of data.rows) {
      const g = grid[r.employee.id];
      if (!g) continue;
      for (let d = 0; d < 7; d++) {
        cells.push({
          employeeId: r.employee.id,
          dayIndex: d,
          layer: "PLAN",
          rawValue: g.plan[d] ?? "",
          note: g.planNotes[d] ?? "",
        });
        cells.push({
          employeeId: r.employee.id,
          dayIndex: d,
          layer: "ACTUAL",
          rawValue: g.actual[d] ?? "",
          note: g.actualNotes[d] ?? "",
        });
      }
    }
    const payload = { start: weekStart, site: workSite, cells };
    try {
      const res = await putWeekWithSafeRetry(payload);
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        const apiErr = j.error?.trim();
        setMsg(
          apiErr && apiErr.length > 0
            ? apiErr
            : res.status === 401
              ? "Sitzung ungültig — bitte neu anmelden."
              : `Speichern fehlgeschlagen (HTTP ${res.status}).`
        );
        return;
      }
      setMsg("Gespeichert.");
      await load({ preserveMessage: true });
    } catch {
      setMsg(
        "Netzwerkfehler beim Speichern — bitte Verbindung prüfen und erneut versuchen."
      );
    } finally {
      saveInFlightRef.current = false;
      setSaving(false);
    }
  }

  async function closeWeek() {
    if (!data || data.status === "CLOSED") return;
    if (!confirm("Woche wirklich abschließen? IST-Werte werden ins Zeitkonto übernommen.")) {
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/week/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start: weekStart, site: workSite }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(j.error ?? "Abschließen fehlgeschlagen.");
        return;
      }
      setMsg("Woche abgeschlossen.");
      await load({ preserveMessage: true });
    } finally {
      setSaving(false);
    }
  }

  async function reopenWeek() {
    if (!data || data.status !== "CLOSED") return;
    if (
      !confirm(
        "Abgeschlossene Woche wieder öffnen? Die Buchung des Zeitkontos für diese Woche wird entfernt. Spätere abgeschlossene Wochen am selben Standort müssen zuerst wieder geöffnet werden."
      )
    ) {
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/week/reopen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start: weekStart, site: workSite }),
        cache: "no-store",
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        const apiErr = j.error?.trim();
        setMsg(
          apiErr && apiErr.length > 0
            ? apiErr
            : res.status === 401
              ? "Sitzung ungültig — bitte neu anmelden."
              : `Wieder öffnen fehlgeschlagen (HTTP ${res.status}).`
        );
        return;
      }
      const refreshed = await load({ preserveMessage: true });
      if (refreshed?.status === "CLOSED") {
        setMsg(
          "Der Server hat geantwortet, die Woche erscheint aber noch als abgeschlossen. Bitte Seite neu laden. Falls Sie zwei Standorte nutzen: dieselbe Kalenderwoche am anderen Standort muss ebenfalls geöffnet sein."
        );
        return;
      }
      setMsg("Woche wieder geöffnet — bearbeiten und Speichern möglich.");
    } catch {
      setMsg(
        "Netzwerkfehler beim Wiederöffnen — bitte Verbindung prüfen und erneut versuchen."
      );
    } finally {
      setSaving(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  /** Reihenfolge der Zeilen pro Standort (Crush / CappuCone getrennt); speichert nur Sortierung, nicht den Raster. */
  async function moveEmployeeRow(employeeId: string, dir: -1 | 1) {
    if (!data || data.status === "CLOSED") return;
    const index = data.rows.findIndex((r) => r.employee.id === employeeId);
    if (index < 0) return;
    const newIndex = index + dir;
    if (newIndex < 0 || newIndex >= data.rows.length) return;

    const rows = [...data.rows];
    const [removed] = rows.splice(index, 1);
    rows.splice(newIndex, 0, removed);
    const employeeIds = rows.map((r) => r.employee.id);

    setReorderBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/employees/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site: workSite, employeeIds }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setMsg(j.error ?? "Reihenfolge konnte nicht gespeichert werden.");
        return;
      }
      setData((prev) => (prev ? { ...prev, rows } : prev));
    } catch {
      setMsg("Reihenfolge konnte nicht gespeichert werden.");
    } finally {
      setReorderBusy(false);
    }
  }

  const readOnly = data?.status === "CLOSED";

  function handlePrint() {
    window.print();
  }

  function downloadLayerCsv() {
    if (!data) return;
    const rows = hideSharedEmployees
      ? data.rows.filter((r) => r.employee.workSite !== "SHARED")
      : data.rows;
    const isPlan = layer === "PLAN";
    const sep = ";";
    const daySuffix = isPlan ? "Plan" : "Ist";
    const header: string[] = ["Mitarbeiter"];
    for (let i = 0; i < 7; i++) {
      header.push(`${SHORT_DAYS[i]}_${daySuffix}`);
    }
    for (let i = 0; i < 7; i++) {
      header.push(`${SHORT_DAYS[i]}_Notiz`);
    }
    header.push(isPlan ? "WS_Plan" : "WS_Ist", "ZAG", "o_U_Tage");
    const lines = [header.join(sep)];
    for (const r of rows) {
      const siteHint = r.employee.workSite === "SHARED" ? " · geteilt" : "";
      const label = `${r.employee.name}${siteHint}`;
      let row: string[];
      if (isPlan) {
        const { plan, planNotes } = planCellsForRow(r, grid);
        const cr = contractRowsForRow(r);
        const livePlan = computeWeeklyBalanceWithContracts(
          plan,
          data.weekStart,
          cr,
          publicHolidayDates
        );
        const zag = r.balanceBeforeWeek + livePlan.deltaVsContract;
        const vacPrev = vacationOpenPreview(r, grid, data.weekStart, cr);
        row = [
          escapeCsvField(label),
          ...plan.map((c) => escapeCsvField((c ?? "").trim())),
          ...planNotes.map((n) => escapeCsvField((n ?? "").trim())),
          fmt.format(livePlan.weeklyHours).replace(".", ","),
          fmt.format(zag).replace(".", ","),
          fmtVacDays.format(vacPrev).replace(".", ","),
        ];
      } else {
        const { actual, actualNotes } = istCellsForRow(r, grid);
        const cr = contractRowsForRow(r);
        const liveActual = computeWeeklyBalanceWithContracts(
          actual,
          data.weekStart,
          cr,
          publicHolidayDates
        );
        const zag = r.balanceBeforeWeek + liveActual.deltaVsContract;
        const vacPrev = vacationOpenPreview(r, grid, data.weekStart, cr);
        row = [
          escapeCsvField(label),
          ...actual.map((c) => escapeCsvField((c ?? "").trim())),
          ...actualNotes.map((n) => escapeCsvField((n ?? "").trim())),
          fmt.format(liveActual.weeklyHours).replace(".", ","),
          fmt.format(zag).replace(".", ","),
          fmtVacDays.format(vacPrev).replace(".", ","),
        ];
      }
      lines.push(row.join(sep));
    }
    const csv = "\ufeff" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const site = (data.site ?? workSite).toLowerCase();
    const prefix = isPlan ? "plan" : "ist";
    a.download = `${prefix}_dienstplan_kw${data.isoWeek}_${data.weekStart}_${site}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function openLayerEmailDraft() {
    if (!data) return;
    const rows = hideSharedEmployees
      ? data.rows.filter((r) => r.employee.workSite !== "SHARED")
      : data.rows;
    const isPlan = layer === "PLAN";
    const layerDe = isPlan ? "Plan" : "Ist";
    const site = workSiteLabel(data.site ?? workSite);
    const subject = `${layerDe}-Dienstplan KW ${data.isoWeek} · ${data.weekStart} · ${site}`;
    const bodyLines: string[] = [
      `${layerDe}-Stundenplan (Stand Anzeige, ggf. vorher Speichern)`,
      `KW ${data.isoWeek} · Wochenbeginn ${data.weekStart} · ${site}`,
      "",
      "—",
      "",
    ];
    for (const r of rows) {
      const siteHint = r.employee.workSite === "SHARED" ? " · geteilt" : "";
      const name = `${r.employee.name}${siteHint}`;
      if (isPlan) {
        const { plan, planNotes } = planCellsForRow(r, grid);
        const cr = contractRowsForRow(r);
        const livePlan = computeWeeklyBalanceWithContracts(
          plan,
          data.weekStart,
          cr,
          publicHolidayDates
        );
        const zag = r.balanceBeforeWeek + livePlan.deltaVsContract;
        const vacPrev = vacationOpenPreview(r, grid, data.weekStart, cr);
        const dayParts = data.days.map((d, i) => {
          const cell = (plan[i] ?? "").trim();
          const note = (planNotes[i] ?? "").trim();
          const dn = d.dateISO.split("-").reverse().join(".");
          if (note) return `${SHORT_DAYS[i]} ${dn}: ${cell || "—"} (Notiz: ${note})`;
          return `${SHORT_DAYS[i]} ${dn}: ${cell || "—"}`;
        });
        bodyLines.push(
          `${name} — WS Plan ${fmt.format(livePlan.weeklyHours)} h, ZAG ${fmt.format(zag)} h, o.U. ${fmtVacDays.format(vacPrev)} T`
        );
        bodyLines.push(dayParts.join(" | "));
        bodyLines.push("");
      } else {
        const { actual, actualNotes } = istCellsForRow(r, grid);
        const cr = contractRowsForRow(r);
        const liveActual = computeWeeklyBalanceWithContracts(
          actual,
          data.weekStart,
          cr,
          publicHolidayDates
        );
        const zag = r.balanceBeforeWeek + liveActual.deltaVsContract;
        const vacPrev = vacationOpenPreview(r, grid, data.weekStart, cr);
        const dayParts = data.days.map((d, i) => {
          const cell = (actual[i] ?? "").trim();
          const note = (actualNotes[i] ?? "").trim();
          const dn = d.dateISO.split("-").reverse().join(".");
          if (note) return `${SHORT_DAYS[i]} ${dn}: ${cell || "—"} (Notiz: ${note})`;
          return `${SHORT_DAYS[i]} ${dn}: ${cell || "—"}`;
        });
        bodyLines.push(
          `${name} — WS Ist ${fmt.format(liveActual.weeklyHours)} h, ZAG ${fmt.format(zag)} h, o.U. ${fmtVacDays.format(vacPrev)} T`
        );
        bodyLines.push(dayParts.join(" | "));
        bodyLines.push("");
      }
    }
    bodyLines.push(
      "(Bei vielen Mitarbeitern ggf. CSV exportieren und anhängen. Druck: Export-Leiste „PDF/Druck“ im Dienstplan — entspricht Plan- oder Ist-Ansicht.)"
    );
    const body = bodyLines.join("\n");
    const href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    if (href.length > 1800) {
      if (
        !confirm(
          "Der E-Mail-Text ist sehr lang und wird vom Mail-Programm ggf. gekürzt. Trotzdem öffnen? Tipp: CSV exportieren und anhängen."
        )
      ) {
        return;
      }
    }
    window.location.href = href;
  }

  const weekDatesISO = useMemo(
    () =>
      data?.days.length === 7 ? data.days.map((d) => d.dateISO) : [],
    [data?.days]
  );

  const displayRows = useMemo(() => {
    if (!data) return [];
    if (!hideSharedEmployees) return data.rows;
    return data.rows.filter((r) => r.employee.workSite !== "SHARED");
  }, [data, hideSharedEmployees]);

  const rotaUniformTimeStrings = useMemo(
    () =>
      data
        ? collectRotaTimeStringsForUniformFont(displayRows, grid, layer)
        : [],
    [data, displayRows, grid, layer]
  );

  useUniformRotaShiftFont(rotaTableWrapRef, rotaUniformTimeStrings, Boolean(data));

  useEffect(() => {
    if (!laborOpenEmp) return;
    if (!displayRows.some((r) => r.employee.id === laborOpenEmp)) {
      setLaborOpenEmp(null);
    }
  }, [displayRows, laborOpenEmp]);

  const liveLaborByEmp = useMemo(() => {
    const m = new Map<
      string,
      { plan: LaborHint[]; actual: LaborHint[] }
    >();
    if (!data || weekDatesISO.length !== 7) return m;
    for (const r of data.rows) {
      const g = grid[r.employee.id];
      const plan = g?.plan ?? r.plan;
      const actual = g?.actual ?? r.actual;
      m.set(r.employee.id, {
        plan: austrianLaborHintsForWeek(
          weekDatesISO,
          plan,
          r.prevSundayPlan ?? null
        ),
        actual: austrianLaborHintsForWeek(
          weekDatesISO,
          actual,
          r.prevSundayActual ?? null
        ),
      });
    }
    return m;
  }, [data, grid, weekDatesISO]);

  const laborSummary = useMemo(() => {
    if (!data) return { warnings: 0, byEmp: new Map<string, number>() };
    let warnings = 0;
    const byEmp = new Map<string, number>();
    for (const r of displayRows) {
      const live = liveLaborByEmp.get(r.employee.id);
      const hints =
        layer === "PLAN" ? (live?.plan ?? []) : (live?.actual ?? []);
      const w = hints.filter((h) => h.severity === "warning").length;
      byEmp.set(r.employee.id, w);
      warnings += w;
    }
    return { warnings, byEmp };
  }, [data, layer, liveLaborByEmp, displayRows]);

  const weatherDaysAligned = useMemo(() => {
    if (!data?.days || !weatherData?.days?.length) return null;
    const byIso = new Map(weatherData.days.map((d) => [d.dateISO, d]));
    const out: WeatherApiResponse["days"] = [];
    for (const wd of data.days) {
      const row = byIso.get(wd.dateISO);
      if (!row) return null;
      out.push(row);
    }
    return out.length === 7 ? out : null;
  }, [data?.days, weatherData]);

  const shellBg =
    workSite === "CRUSH"
      ? "min-h-screen bg-gradient-to-b from-orange-50/95 via-amber-50/50 to-orange-50/20 transition-[background] duration-500"
      : "min-h-screen bg-gradient-to-b from-emerald-50/90 via-teal-50/45 to-cyan-50/15 transition-[background] duration-500";

  return (
    <div className={`${shellBg} print:bg-white`}>
      <div className="p-4 md:p-6 print:p-4">
      <header className="no-print mb-6 flex flex-col gap-4 border-b border-slate-200/80 pb-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Dienstplan</h1>
          <p className="text-sm text-slate-500">
            Eine Zeile pro Mitarbeiter · Umschalten Plan / Ist · Notizen pro Tag
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-slate-600">Standort</span>
            <div className="inline-flex rounded-lg border border-slate-300/80 bg-white/80 p-0.5 shadow-sm backdrop-blur-sm">
              <button
                type="button"
                onClick={() => setWorkSite("CRUSH")}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  workSite === "CRUSH"
                    ? "bg-orange-400/90 text-white shadow-sm"
                    : "text-slate-600 hover:bg-orange-50"
                }`}
              >
                Crush
              </button>
              <button
                type="button"
                onClick={() => setWorkSite("CAPPUCONE")}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  workSite === "CAPPUCONE"
                    ? "bg-teal-500/90 text-white shadow-sm"
                    : "text-slate-600 hover:bg-emerald-50"
                }`}
              >
                CappuCone
              </button>
            </div>
            <span className="text-xs text-slate-500">
              ({workSiteLabel(workSite)} — nur zugeordnete Mitarbeiter)
            </span>
            <button
              type="button"
              onClick={() => setHideSharedEmployees((h) => !h)}
              className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                hideSharedEmployees
                  ? "border-slate-600 bg-slate-700 text-white shadow-sm"
                  : "border-slate-300/80 bg-white/80 text-slate-600 shadow-sm hover:bg-slate-50"
              }`}
              title="Mitarbeiter mit Standort ‚Geteilt (beide Standorte)‘ in der Tabelle aus- oder einblenden"
            >
              {hideSharedEmployees ? "Geteilte einblenden" : "Geteilte ausblenden"}
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setWeekStart((s) => addDaysISO(s, -7))}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Vorherige Woche
          </button>
          <button
            type="button"
            onClick={() => setWeekStart((s) => addDaysISO(s, 7))}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Nächste Woche
          </button>
          <button
            type="button"
            onClick={() => setWeekStart(defaultWeekStartISO())}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Aktuelle Woche
          </button>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm hover:bg-slate-50">
            <span className="text-slate-600">Gehe zu</span>
            <input
              type="date"
              className="w-[10.5rem] rounded border border-slate-200 bg-white px-1.5 py-0.5 text-sm text-slate-800"
              value={weekStart}
              onChange={(e) => {
                const v = e.target.value;
                if (v) setWeekStart(weekStartISOContainingDate(v));
              }}
              title="Beliebiges Datum in der Zielwoche wählen — es wird der Montag dieser Woche geladen"
            />
          </label>
          <Link
            href="/feiertage"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Feiertage &amp; Ferien
          </Link>
          <Link
            href="/mitarbeiter"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Mitarbeiter
          </Link>
          <Link
            href="/abrechnung"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Abrechnung
          </Link>
          <Link
            href="/monatsuebersicht"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Monatsübersicht
          </Link>
          <button
            type="button"
            onClick={() => void logout()}
            className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:underline"
          >
            Abmelden
          </button>
        </div>
      </header>

      <div className="no-print mb-4 flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-slate-600">Ansicht:</span>
        <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5">
          <button
            type="button"
            onClick={() => setLayer("PLAN")}
            className={`rounded-md px-4 py-1.5 text-sm font-medium ${
              layer === "PLAN"
                ? "bg-[var(--rota-header)] text-white"
                : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            Plan
          </button>
          <button
            type="button"
            onClick={() => setLayer("ACTUAL")}
            className={`rounded-md px-4 py-1.5 text-sm font-medium ${
              layer === "ACTUAL"
                ? "bg-[var(--rota-header)] text-white"
                : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            Ist
          </button>
        </div>
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-sky-200/80 bg-white/90 px-2.5 py-1.5 text-sm text-slate-600 shadow-sm">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
            checked={showWeather}
            onChange={(e) => setShowWeather(e.target.checked)}
          />
          Wetter
        </label>
        {data && data.status !== "CLOSED" && (
          <>
            <button
              type="button"
              disabled={saving || loading || importingPrevWeek}
              onClick={() => copyPlanToActual()}
              className="rounded-lg border border-slate-400 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-40"
              title="Alle Plan-Zellen und Notizen in die Ist-Zeilen kopieren"
            >
              Soll → Ist übernehmen
            </button>
            <button
              type="button"
              disabled={saving || loading || importingPrevWeek}
              onClick={() => void copyPreviousWeek()}
              className="rounded-lg border border-slate-400 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-40"
              title="Plan, Ist und Notizen der Kalenderwoche davor in diese Woche kopieren"
            >
              Vorwoche übernehmen
            </button>
            <button
              type="button"
              disabled={saving || loading || importingPrevWeek}
              onClick={() => clearCurrentWeek()}
              className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-800 shadow-sm hover:bg-red-50 disabled:opacity-40"
              title="Alle Einträge und Notizen dieser Woche leeren"
            >
              Woche leeren
            </button>
          </>
        )}
        {data && (
          <span className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <span>
              KW {data.isoWeek} · {data.weekStart.split("-").reverse().join(".")} ·{" "}
              {workSiteLabel(data.site ?? workSite)}
            </span>
            {data.feiDaysInWeek > 0 && (
              <span
                className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900"
                title="Aktivierte Feiertage oder Ferien unter „Feiertage & Ferien“"
              >
                {data.feiDaysInWeek} Kalendertag
                {data.feiDaysInWeek === 1 ? "" : "e"} mit Feiertag/Ferien
              </span>
            )}
            {data.status === "CLOSED" && (
              <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-900">
                Abgeschlossen
              </span>
            )}
            {laborSummary.warnings > 0 && (
              <span
                className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-900"
                title="AT-Arbeitszeit-Hinweise (heuristisch)"
              >
                {laborSummary.warnings} Arbeitszeit-Hinweis
                {laborSummary.warnings === 1 ? "" : "e"}
              </span>
            )}
          </span>
        )}
      </div>

      {msg && (
        <p className="no-print mb-3 text-sm text-slate-700" role="status">
          {msg}
        </p>
      )}

      {loading || !data ? (
        <p className="no-print text-slate-500">Lade…</p>
      ) : (
        <>
          <div className="no-print mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white/95 px-3 py-2 shadow-sm">
            <span className="text-sm font-medium text-slate-700">Export</span>
            <button
              type="button"
              onClick={() => handlePrint()}
              className="rounded-lg border border-slate-400 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
              title="Druckdialog (dort „Als PDF speichern“) — Inhalt wie Plan/Ist-Umschalter"
            >
              PDF / Druck
            </button>
            <button
              type="button"
              onClick={() => downloadLayerCsv()}
              className="rounded-lg border border-slate-400 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
              title="Semikolon-CSV — Spalten wie aktuelle Plan- oder Ist-Ansicht"
            >
              CSV exportieren
            </button>
            <button
              type="button"
              onClick={() => openLayerEmailDraft()}
              className="rounded-lg border border-slate-400 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
              title="Standard-Mailprogramm mit Entwurf"
            >
              E-Mail (Entwurf)
            </button>
            <span className="text-xs text-slate-500">
              Gilt für die aktuelle Ansicht <strong>Plan</strong> oder <strong>Ist</strong> (Umschalter).
              Steuerung wird beim Druck ausgeblendet.
            </span>
          </div>

          {showWeather && (
            <div className="no-print mb-3">
              {weatherLoading && <WeekWeatherSkeleton />}
              {!weatherLoading && weatherErr && (
                <div className="rounded-xl border border-red-200 bg-red-50/90 px-3 py-2 text-sm text-red-900">
                  {weatherErr}
                </div>
              )}
              {!weatherLoading &&
                !weatherErr &&
                weatherData &&
                weatherDaysAligned &&
                data && (
                  <WeekWeatherStrip
                    days={weatherDaysAligned}
                    locationName={weatherData.locationName}
                    attribution={weatherData.attribution}
                    weekDayLabels={SHORT_DAYS}
                  />
                )}
              {!weatherLoading &&
                !weatherErr &&
                weatherData &&
                !weatherDaysAligned &&
                data && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/90 px-3 py-2 text-sm text-amber-950">
                    Wetterdaten passen nicht exakt zu den Kalendertagen dieser Woche (Zeitzone /
                    Zeitraum). Bitte Seite neu laden oder andere Woche wählen.
                  </div>
                )}
            </div>
          )}

          <div
            ref={rotaTableWrapRef}
            className="no-print overflow-x-auto rounded-xl border-2 border-[var(--rota-border)] bg-white shadow-md"
          >
            <table className="min-w-[980px] w-full border-collapse text-[15px]">
              <thead>
                <tr className="bg-[var(--rota-header)] text-white">
                  <th className="border-2 border-white/35 px-2 py-2.5 text-left text-base font-bold tracking-tight">
                    Mitarbeiter
                  </th>
                  {data.days.map((d, i) => (
                    <th
                      key={d.dateISO}
                      className={`border-2 border-white/35 px-1 py-2.5 text-center text-sm font-bold leading-tight ${dayHeaderHighlightClasses(d)}`}
                    >
                      <div>
                        {SHORT_DAYS[i]} {d.dateISO.split("-").reverse().join(".")}
                      </div>
                      {d.holidays.length > 0 && (
                        <div className="mt-1 max-w-[8rem] text-[10px] font-normal leading-tight text-white/95">
                          {d.holidays.map((h, hi) => (
                            <span key={`${d.dateISO}-${h.region}-${h.name}-${hi}`} className="block">
                              {h.name}
                              <span className="opacity-80"> ({h.region})</span>
                            </span>
                          ))}
                        </div>
                      )}
                      {(d.ferien ?? []).length > 0 && (
                        <div className="mt-1 max-w-[8rem] text-[10px] font-normal leading-tight">
                          {(d.ferien ?? []).map((f, fi) => (
                            <span
                              key={`${d.dateISO}-f-${f.region}-${f.name}-${fi}`}
                              className={`block ${
                                f.position === "between" ? "text-white/50" : "text-white/95"
                              }`}
                            >
                              {f.name}
                              <span className="opacity-75"> ({f.region})</span>
                              {f.position === "start" ? (
                                <span className="block text-[9px] font-normal opacity-80">
                                  Beginn
                                </span>
                              ) : null}
                              {f.position === "end" ? (
                                <span className="block text-[9px] font-normal opacity-80">
                                  Ende
                                </span>
                              ) : null}
                            </span>
                          ))}
                        </div>
                      )}
                    </th>
                  ))}
                  <th
                    className="border-2 border-white/35 px-2 py-2.5 text-base font-bold"
                    title="Summe Netto-Stunden (Anwesenheit minus Pause je Tag)"
                  >
                    WS
                  </th>
                  <th
                    className="border-2 border-white/35 px-2 py-2.5 text-base font-bold"
                    title={
                      layer === "PLAN"
                        ? "Plan-Vorschau: Saldo vor dieser Woche + (Plan-Summe − Vertrags-Soll)"
                        : "Saldo vor dieser Woche + (Ist-Summe − Vertrags-Soll)"
                    }
                  >
                    ZAG
                  </th>
                  <th
                    className="border-2 border-white/35 px-2 py-2.5 text-base font-bold"
                    title="Offener Urlaub: Vorschau nach Plan/Ist dieser Woche (gegenüber zuletzt geladenem Speicherstand)"
                  >
                    o. U.
                  </th>
                  <th className="border-2 border-white/35 px-2 py-2.5 text-center text-base font-bold">
                    AT
                  </th>
                </tr>
              </thead>
              <tbody>
                {displayRows.map((r) => {
                  const g = grid[r.employee.id] ?? emptyGridRow();
                  const planCells = g.plan.length ? g.plan : r.plan;
                  const actualCells = g.actual.length ? g.actual : r.actual;
                  const planNotes = g.planNotes.length ? g.planNotes : r.planNotes ?? [];
                  const actualNotes = g.actualNotes.length ? g.actualNotes : r.actualNotes ?? [];
                  const displayCells = layer === "PLAN" ? planCells : actualCells;
                  const displayNotes = layer === "PLAN" ? planNotes : actualNotes;
                  const cr = contractRowsForRow(r);
                  const livePlanCalc = computeWeeklyBalanceWithContracts(
                    planCells,
                    data.weekStart,
                    cr,
                    publicHolidayDates
                  );
                  const liveActualCalc = computeWeeklyBalanceWithContracts(
                    actualCells,
                    data.weekStart,
                    cr,
                    publicHolidayDates
                  );
                  const weeklyHoursShown =
                    layer === "PLAN"
                      ? livePlanCalc.weeklyHours
                      : liveActualCalc.weeklyHours;
                  const zagLive =
                    layer === "PLAN"
                      ? r.balanceBeforeWeek + livePlanCalc.deltaVsContract
                      : r.balanceBeforeWeek + liveActualCalc.deltaVsContract;
                  const vacationShown = vacationOpenPreview(
                    r,
                    grid,
                    data.weekStart,
                    cr
                  );
                  const siteHint =
                    r.employee.workSite === "SHARED" ? " · geteilt" : "";
                  const label = `${r.employee.name}${siteHint} (${contractLabelForWeek(cr, data.weekStart)})`;
                  const exitScope = weekExitScope(
                    data.weekStart,
                    r.employee.exitDate ?? null
                  );
                  const exitBadge =
                    r.employee.exitDate && exitScope !== "none"
                      ? weekExitRowBadge(exitScope, r.employee.exitDate)
                      : null;
                  const liveH = liveLaborByEmp.get(r.employee.id);
                  const hints =
                    layer === "PLAN"
                      ? (liveH?.plan ?? [])
                      : (liveH?.actual ?? []);
                  const warnN = hints.filter((h) => h.severity === "warning").length;
                  const laborExpanded = laborOpenEmp === r.employee.id;
                  const reorderDisabled =
                    readOnly || reorderBusy || saving || loading;
                  const fullIndex = data.rows.findIndex(
                    (x) => x.employee.id === r.employee.id
                  );

                  return (
                    <tr key={r.employee.id} className="border-b-2 border-slate-400 align-top">
                      <td
                        className={`border-2 border-slate-400 bg-[var(--rota-rail)] px-1.5 py-1.5 text-[15px] font-semibold text-slate-900 ${weekExitScopeRowClasses(exitScope)}`}
                      >
                        <div className="flex items-start gap-1.5">
                          {!readOnly ? (
                            <div className="no-print flex shrink-0 flex-col gap-0 border-r border-slate-200/80 pr-1">
                              <button
                                type="button"
                                className="rounded px-0.5 text-xs leading-none text-slate-500 hover:bg-slate-200/80 hover:text-slate-900 disabled:opacity-30"
                                disabled={reorderDisabled || fullIndex <= 0}
                                aria-label="Zeile nach oben"
                                title="Nach oben"
                                onClick={() => void moveEmployeeRow(r.employee.id, -1)}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                className="rounded px-0.5 text-xs leading-none text-slate-500 hover:bg-slate-200/80 hover:text-slate-900 disabled:opacity-30"
                                disabled={
                                  reorderDisabled ||
                                  fullIndex < 0 ||
                                  fullIndex >= data.rows.length - 1
                                }
                                aria-label="Zeile nach unten"
                                title="Nach unten"
                                onClick={() => void moveEmployeeRow(r.employee.id, 1)}
                              >
                                ↓
                              </button>
                            </div>
                          ) : null}
                          <span className="min-w-0 pt-0.5">
                            {label}
                            {exitBadge ? (
                              <span className={exitBadge.className}>{exitBadge.text}</span>
                            ) : null}
                          </span>
                        </div>
                      </td>
                      {displayCells.map((val, di) => {
                        const dayISO = data.days[di]?.dateISO ?? "";
                        const empMark = employmentDayMark(
                          dayISO,
                          r.employee.entryDate ?? null,
                          r.employee.exitDate ?? null
                        );
                        return (
                          <RotaDayCell
                            key={di}
                            dayShort={SHORT_DAYS[di] ?? ""}
                            readOnly={readOnly}
                            val={val}
                            note={displayNotes[di] ?? ""}
                            employmentMark={empMark}
                            onValChange={(v) => setCell(r.employee.id, di, v)}
                            onNoteChange={(n) => setNote(r.employee.id, di, n)}
                          />
                        );
                      })}
                      <td
                        className={`border-2 border-slate-400 px-2 py-1.5 text-right text-[15px] font-semibold tabular-nums text-slate-900 bg-slate-50/80 ${weekExitScopeSummaryColClasses(exitScope)}`}
                      >
                        {fmt.format(weeklyHoursShown)}
                      </td>
                      <td
                        className={`border-2 border-slate-400 px-2 py-1.5 text-right text-[15px] font-semibold tabular-nums bg-slate-50/80 ${weekExitScopeSummaryColClasses(exitScope)} ${
                          zagLive < 0 ? "text-red-700" : "text-slate-900"
                        }`}
                        title={
                          layer === "PLAN"
                            ? "Vorschau: Saldo vor Woche + (Plan-Summe − Vertragssoll)"
                            : "Saldo vor Woche + (Ist-Summe − Vertragssoll)"
                        }
                      >
                        {fmt.format(zagLive)}
                      </td>
                      <td
                        className={`border-2 border-slate-400 px-2 py-1.5 text-right text-[15px] font-semibold tabular-nums text-slate-900 bg-slate-50/80 ${weekExitScopeSummaryColClasses(exitScope)}`}
                      >
                        {fmtVacDays.format(vacationShown)} T
                      </td>
                      <td
                        className={`border-2 border-slate-400 px-1 py-1.5 text-center bg-slate-50/80 ${weekExitScopeSummaryColClasses(exitScope)}`}
                      >
                        {warnN > 0 ? (
                          <button
                            type="button"
                            className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-900 hover:bg-orange-200"
                            onClick={() =>
                              setLaborOpenEmp(laborExpanded ? null : r.employee.id)
                            }
                            title="Hinweise anzeigen"
                          >
                            {warnN}
                          </button>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <article className="hidden print:block print:max-w-none">
            <h2 className="mb-1 text-base font-semibold text-slate-900">
              {layer === "PLAN" ? "Plan-Dienstplan" : "Ist-Dienstplan"} · KW {data.isoWeek}{" "}
              · {data.weekStart.split("-").reverse().join(".")} ·{" "}
              {workSiteLabel(data.site ?? workSite)}
            </h2>
            <p className="mb-3 text-[10px] leading-snug text-slate-600">
              Keine Rechtsberatung. Druck/Export folgt der Ansicht{" "}
              <strong>{layer === "PLAN" ? "Plan" : "Ist"}</strong> — bitte vorher{" "}
              <strong>Speichern</strong>, wenn alles in der Datenbank stehen soll.
              {layer === "PLAN" ? (
                <>
                  {" "}
                  <strong>ZAG</strong> und <strong>o. U.</strong> sind Plan-Vorschau (Saldo/Urlaub bei
                  Umsetzung dieses Plans; o. U. inkl. Ist-Zeile wenn befüllt).
                </>
              ) : null}
            </p>
            <table className="w-full border-collapse border-2 border-slate-600 text-[10px] print:text-xs">
              <thead>
                <tr className="bg-slate-200">
                  <th className="border-2 border-slate-500 px-1 py-1 text-left text-xs font-bold">
                    Mitarbeiter
                  </th>
                  {data.days.map((d, i) => (
                    <th
                      key={`print-h-${d.dateISO}`}
                      className="border-2 border-slate-500 px-1 py-1 text-center text-xs font-bold"
                    >
                      {SHORT_DAYS[i]} {d.dateISO.split("-").reverse().join(".")}
                    </th>
                  ))}
                  <th className="border-2 border-slate-500 px-1 py-1 text-xs font-bold">
                    {layer === "PLAN" ? "WS Plan" : "WS Ist"}
                  </th>
                  <th className="border-2 border-slate-500 px-1 py-1 text-xs font-bold">ZAG</th>
                  <th className="border-2 border-slate-500 px-1 py-1 text-xs font-bold">o. U.</th>
                </tr>
              </thead>
              <tbody>
                {displayRows.map((r) => {
                  const siteHint =
                    r.employee.workSite === "SHARED" ? " · geteilt" : "";
                  const printLabel = `${r.employee.name}${siteHint}`;
                  const printExitScope = weekExitScope(
                    data.weekStart,
                    r.employee.exitDate ?? null
                  );
                  const printExitBadge =
                    r.employee.exitDate && printExitScope !== "none"
                      ? weekExitRowBadge(printExitScope, r.employee.exitDate)
                      : null;
                  if (layer === "PLAN") {
                    const { plan, planNotes } = planCellsForRow(r, grid);
                    const crP = contractRowsForRow(r);
                    const livePlan = computeWeeklyBalanceWithContracts(
                      plan,
                      data.weekStart,
                      crP,
                      publicHolidayDates
                    );
                    const zagP = r.balanceBeforeWeek + livePlan.deltaVsContract;
                    const vacPrev = vacationOpenPreview(r, grid, data.weekStart, crP);
                    return (
                      <tr key={`print-${r.employee.id}`}>
                        <td className="border-2 border-slate-500 px-1 py-1 align-top text-xs font-semibold">
                          {printLabel}
                          {printExitBadge ? (
                            <div
                              className={`mt-0.5 text-[9px] font-bold ${printExitBadge.className}`}
                            >
                              {printExitBadge.text}
                            </div>
                          ) : null}
                        </td>
                        {plan.map((cell, di) => (
                          <td
                            key={di}
                            className={rotaPrintCellClass(
                              cell ?? "",
                              employmentDayMark(
                                data.days[di]?.dateISO ?? "",
                                r.employee.entryDate ?? null,
                                r.employee.exitDate ?? null
                              )
                            )}
                          >
                            <div>{(cell ?? "").trim() || "—"}</div>
                            {(planNotes[di] ?? "").trim() ? (
                              <div className="mt-0.5 text-[9px] font-medium text-slate-700">
                                {(planNotes[di] ?? "").trim()}
                              </div>
                            ) : null}
                          </td>
                        ))}
                        <td className="border-2 border-slate-500 bg-slate-100 px-1 py-1 text-right text-xs font-semibold tabular-nums">
                          {fmt.format(livePlan.weeklyHours)}
                        </td>
                        <td
                          className={`border-2 border-slate-500 bg-slate-100 px-1 py-1 text-right text-xs font-semibold tabular-nums ${
                            zagP < 0 ? "text-red-800" : ""
                          }`}
                        >
                          {fmt.format(zagP)}
                        </td>
                        <td className="border-2 border-slate-500 bg-slate-100 px-1 py-1 text-right text-xs font-semibold tabular-nums">
                          {fmtVacDays.format(vacPrev)} T
                        </td>
                      </tr>
                    );
                  }
                  const { actual, actualNotes } = istCellsForRow(r, grid);
                  const crI = contractRowsForRow(r);
                  const liveActual = computeWeeklyBalanceWithContracts(
                    actual,
                    data.weekStart,
                    crI,
                    publicHolidayDates
                  );
                  const zagP = r.balanceBeforeWeek + liveActual.deltaVsContract;
                  const vacPrevI = vacationOpenPreview(r, grid, data.weekStart, crI);
                  return (
                    <tr key={`print-${r.employee.id}`}>
                      <td className="border-2 border-slate-500 px-1 py-1 align-top text-xs font-semibold">
                        {printLabel}
                        {printExitBadge ? (
                          <div
                            className={`mt-0.5 text-[9px] font-bold ${printExitBadge.className}`}
                          >
                            {printExitBadge.text}
                          </div>
                        ) : null}
                      </td>
                      {actual.map((cell, di) => (
                        <td
                          key={di}
                          className={rotaPrintCellClass(
                            cell ?? "",
                            employmentDayMark(
                              data.days[di]?.dateISO ?? "",
                              r.employee.entryDate ?? null,
                              r.employee.exitDate ?? null
                            )
                          )}
                        >
                          <div>{(cell ?? "").trim() || "—"}</div>
                          {(actualNotes[di] ?? "").trim() ? (
                            <div className="mt-0.5 text-[9px] font-medium text-slate-700">
                              {(actualNotes[di] ?? "").trim()}
                            </div>
                          ) : null}
                        </td>
                      ))}
                      <td className="border-2 border-slate-500 bg-slate-100 px-1 py-1 text-right text-xs font-semibold tabular-nums">
                        {fmt.format(liveActual.weeklyHours)}
                      </td>
                      <td
                        className={`border-2 border-slate-500 bg-slate-100 px-1 py-1 text-right text-xs font-semibold tabular-nums ${
                          zagP < 0 ? "text-red-800" : ""
                        }`}
                      >
                        {fmt.format(zagP)}
                      </td>
                      <td className="border-2 border-slate-500 bg-slate-100 px-1 py-1 text-right text-xs font-semibold tabular-nums">
                        {fmtVacDays.format(vacPrevI)} T
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </article>

          {displayRows.some((r) => laborOpenEmp === r.employee.id) && (
            <div className="no-print mt-3 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-950">
              {displayRows
                .filter((r) => laborOpenEmp === r.employee.id)
                .map((r) => {
                  const liveH = liveLaborByEmp.get(r.employee.id);
                  const hints =
                    layer === "PLAN"
                      ? (liveH?.plan ?? [])
                      : (liveH?.actual ?? []);
                  return (
                    <div key={r.employee.id}>
                      <p className="font-semibold">{r.employee.name}</p>
                      {hints.length === 0 ? (
                        <p className="text-slate-600">Keine Hinweise.</p>
                      ) : (
                        <ul className="mt-1 list-inside list-disc space-y-1">
                          {hints.map((h, i) => (
                            <li
                              key={`${h.code}-${i}`}
                              className={
                                h.severity === "warning" ? "font-medium" : ""
                              }
                            >
                              {h.message}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
            </div>
          )}

          <div className="no-print">
            {errsBlockLive(data, grid, layer, displayRows, publicHolidayDates)}
          </div>

          <div className="no-print mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={readOnly || saving || importingPrevWeek}
              onClick={() => void save()}
              className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-40"
            >
              Speichern
            </button>
            <button
              type="button"
              disabled={readOnly || saving || importingPrevWeek}
              onClick={() => void closeWeek()}
              className="rounded-lg border border-slate-400 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-40"
            >
              Woche abschließen
            </button>
            {data.status === "CLOSED" && (
              <button
                type="button"
                disabled={saving || importingPrevWeek}
                onClick={() => void reopenWeek()}
                className="rounded-lg border border-amber-500 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-950 hover:bg-amber-100 disabled:opacity-40"
              >
                Woche wieder öffnen
              </button>
            )}
          </div>

          <div className="no-print mt-4 rounded-lg border-2 border-slate-400 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-800 shadow-sm">
            <p className="font-bold text-slate-700">Farben &amp; Zeichen in den Schichtzellen</p>
            <ul className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1">
              <li className="inline-flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded bg-emerald-600 text-[11px] font-bold text-white shadow-sm">
                  U
                </span>
                <span>Urlaub (grün)</span>
              </li>
              <li className="inline-flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded bg-rose-600 text-[11px] font-bold text-white shadow-sm">
                  K
                </span>
                <span>Krankheit (rot)</span>
              </li>
              <li className="inline-flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded bg-amber-600 text-[11px] font-bold text-white shadow-sm">
                  F
                </span>
                <span>Feiertag · <code>F</code> / <code>FT</code> / Feiertag (amber)</span>
              </li>
              <li className="inline-flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded bg-violet-600 text-[11px] font-bold text-white shadow-sm">
                  Z
                </span>
                <span>Zeitausgleich · <code>ZA</code> (violett)</span>
              </li>
            </ul>
            <p className="mt-1.5 text-[11px] font-normal text-slate-600">
              Zeit-Eingaben bleiben neutral (weiß); Mehrfachblöcke mit <code>|</code> ohne einheitliches Kürzel
              werden nicht eingefärbt. Kürzel bearbeiten: Zelle fokussieren — dann erscheint der Text wieder.
            </p>
          </div>

          <p className="no-print mt-4 text-xs font-medium text-slate-600">
            Eingabe: <code>11:30-20:00-30</code> — dritter Wert = Pausenminuten;{" "}
            <strong>Arbeitszeit = Zeitspanne minus Pause</strong>. Oder{" "}
            <code>U</code>, <code>K</code> (ganzer Soll-Tag) oder <code>U(2)</code>, <code>K(4)</code> (nur diese
            Stunden); <code>ZA</code>; <code>FT</code> an einem im Kalender markierten{" "}
            <strong>gesetzlichen Feiertag</strong> = Soll-Tag wie U (Feiertagsentgelt), sonst 0 h.{" "}
            <strong>WS</strong> =
            Summe Stunden (Plan/Ist je nach Ansicht). <strong>ZAG</strong> in der Plan-Ansicht =
            Vorschau (Saldo vor der Woche + Plan-Summe − Vertragssoll); in der Ist-Ansicht wie
            Zeitkonto (mit Ist-Summe). <strong>o. U.</strong> = Vorschau inkl. geplantem Urlaub
            dieser Woche (Ist zählt, wenn die Zelle nicht leer ist). Feiertage &amp; Ferien unter{" "}
            <strong>Feiertage &amp; Ferien</strong>. <strong>Notiz</strong> nur bei Bedarf:{" "}
            kleines <strong>+</strong> unten rechts in der Zelle, oder bereits gespeicherte Notiz — sonst volle Höhe
            für die Zeit.{" "}
            <strong>Soll → Ist übernehmen</strong> kopiert den gesamten Plan in die Ist-Zeilen.{" "}
            <strong>Vorwoche übernehmen</strong> lädt die vorige KW und überträgt Plan, Ist und
            Notizen (Mitarbeiter ohne Daten in der Vorwoche: leere Zeilen).{" "}
            <strong>Woche leeren</strong> setzt alles auf leer. Immer danach{" "}
            <strong>Speichern</strong>.
          </p>
        </>
      )}
      </div>
    </div>
  );
}

function errsBlockLive(
  data: WeekPayload,
  grid: Record<string, GridRow>,
  layer: Layer,
  rows: WeekPayload["rows"],
  publicHolidayDates: ReadonlySet<string>
) {
  const lines = rows.flatMap((r) => {
    const g = grid[r.employee.id];
    const cells =
      layer === "PLAN"
        ? (g?.plan ?? r.plan)
        : (g?.actual ?? r.actual);
    const { errors } = computeWeeklyBalanceWithContracts(
      cells,
      data.weekStart,
      contractRowsForRow(r),
      publicHolidayDates
    );
    return errors.map((x) => `${r.employee.name}: ${x}`);
  });
  if (lines.length === 0) return null;
  return (
    <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      <p className="font-medium">Eingabehinweise</p>
      <ul className="mt-1 list-inside list-disc">
        {lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
    </div>
  );
}
