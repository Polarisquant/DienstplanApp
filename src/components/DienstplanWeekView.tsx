"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDaysISO, defaultWeekStartISO } from "@/lib/dateNav";
import { austrianLaborHintsForWeek } from "@/lib/austrianLaborHints";
import { computeWeeklyBalance } from "@/lib/computeWeekly";

type Layer = "PLAN" | "ACTUAL";
type UiWorkSite = "CRUSH" | "CAPPUCONE";

const SITE_STORAGE_KEY = "dienstplan-active-site";

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
};

type DayMeta = {
  dayIndex: number;
  dateISO: string;
  holidays: { name: string; region: string }[];
};

type WeekPayload = {
  weekStart: string;
  site: UiWorkSite;
  status: "DRAFT" | "CLOSED";
  isoWeek: number;
  feiDaysInWeek: number;
  days: DayMeta[];
  rows: RowDTO[];
  laborLawDisclaimer: string;
};

type GridRow = {
  plan: string[];
  actual: string[];
  planNotes: string[];
  actualNotes: string[];
};

const SHORT_DAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

const fmt = new Intl.NumberFormat("de-AT", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
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
  const [msg, setMsg] = useState<string | null>(null);
  const [laborOpenEmp, setLaborOpenEmp] = useState<string | null>(null);
  const saveInFlightRef = useRef(false);

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
      localStorage.setItem(SITE_STORAGE_KEY, workSite);
    } catch {
      /* ignore */
    }
  }, [workSite]);

  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch(
        `/api/week?start=${encodeURIComponent(weekStart)}&site=${encodeURIComponent(workSite)}`
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
    } catch {
      setMsg("Woche konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [weekStart, workSite]);

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
    try {
      const res = await fetch("/api/week", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start: weekStart, site: workSite, cells }),
      });
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
      await load();
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
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function reopenWeek() {
    if (!data || data.status !== "CLOSED") return;
    if (
      !confirm(
        "Abgeschlossene Woche wieder öffnen? Die Buchung des Zeitkontos für diese Woche wird entfernt. Spätere abgeschlossene Wochen müssen zuerst selbst wieder geöffnet werden."
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
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(j.error ?? "Wieder öffnen fehlgeschlagen.");
        return;
      }
      setMsg("Woche wieder geöffnet — bearbeiten und Speichern möglich.");
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const readOnly = data?.status === "CLOSED";

  const weekDatesISO = useMemo(
    () =>
      data?.days.length === 7 ? data.days.map((d) => d.dateISO) : [],
    [data?.days]
  );

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
    for (const r of data.rows) {
      const live = liveLaborByEmp.get(r.employee.id);
      const hints =
        layer === "PLAN" ? (live?.plan ?? []) : (live?.actual ?? []);
      const w = hints.filter((h) => h.severity === "warning").length;
      byEmp.set(r.employee.id, w);
      warnings += w;
    }
    return { warnings, byEmp };
  }, [data, layer, liveLaborByEmp]);

  const shellBg =
    workSite === "CRUSH"
      ? "min-h-screen bg-gradient-to-b from-orange-50/95 via-amber-50/50 to-orange-50/20 transition-[background] duration-500"
      : "min-h-screen bg-gradient-to-b from-emerald-50/90 via-teal-50/45 to-cyan-50/15 transition-[background] duration-500";

  return (
    <div className={shellBg}>
      <div className="p-4 md:p-6">
      <header className="mb-6 flex flex-col gap-4 border-b border-slate-200/80 pb-4 md:flex-row md:items-center md:justify-between">
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
          <Link
            href="/feiertage"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Feiertage
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
          <button
            type="button"
            onClick={() => void logout()}
            className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:underline"
          >
            Abmelden
          </button>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-3">
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
                title="Aktivierte Feiertage unter „Feiertage“"
              >
                {data.feiDaysInWeek} Feiertag{data.feiDaysInWeek === 1 ? "" : "e"} in dieser Woche
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

      {data && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50/80 p-3 text-xs text-amber-950">
          <strong className="font-semibold">Arbeitsrecht (Hinweise):</strong>{" "}
          {data.laborLawDisclaimer}
        </div>
      )}

      {msg && (
        <p className="mb-3 text-sm text-slate-700" role="status">
          {msg}
        </p>
      )}

      {loading || !data ? (
        <p className="text-slate-500">Lade…</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-[var(--rota-border)] bg-white shadow-sm">
            <table className="min-w-[980px] w-full border-collapse text-sm">
              <thead>
                <tr className="bg-[var(--rota-header)] text-white">
                  <th className="border border-white/20 px-2 py-2 text-left font-semibold">
                    Mitarbeiter
                  </th>
                  {data.days.map((d, i) => (
                    <th
                      key={d.dateISO}
                      className={`border border-white/20 px-1 py-2 text-center font-semibold ${
                        d.holidays.length > 0 ? "bg-amber-500/35" : ""
                      }`}
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
                    </th>
                  ))}
                  <th
                    className="border border-white/20 px-2 py-2"
                    title="Summe Netto-Stunden dieser Woche (Plan bzw. Ist je nach Ansicht)"
                  >
                    WS
                  </th>
                  <th
                    className="border border-white/20 px-2 py-2"
                    title="Zeitkonto: Saldo vor dieser Woche + (Ist-Summe − Vertragsstunden/Woche)"
                  >
                    ZAG
                  </th>
                  <th className="border border-white/20 px-2 py-2">o. U.</th>
                  <th className="border border-white/20 px-2 py-2 text-center">AT</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => {
                  const g = grid[r.employee.id] ?? emptyGridRow();
                  const planCells = g.plan.length ? g.plan : r.plan;
                  const actualCells = g.actual.length ? g.actual : r.actual;
                  const planNotes = g.planNotes.length ? g.planNotes : r.planNotes ?? [];
                  const actualNotes = g.actualNotes.length ? g.actualNotes : r.actualNotes ?? [];
                  const displayCells = layer === "PLAN" ? planCells : actualCells;
                  const displayNotes = layer === "PLAN" ? planNotes : actualNotes;
                  const liveLayer = computeWeeklyBalance(
                    displayCells,
                    r.employee.contractHoursPerWeek,
                    r.employee.workDaysPerWeek
                  );
                  const liveActual = computeWeeklyBalance(
                    actualCells,
                    r.employee.contractHoursPerWeek,
                    r.employee.workDaysPerWeek
                  );
                  const weeklyHoursShown = liveLayer.weeklyHours;
                  const zagLive =
                    r.balanceBeforeWeek + liveActual.deltaVsContract;
                  const siteHint =
                    r.employee.workSite === "SHARED" ? " · geteilt" : "";
                  const label = `${r.employee.name}${siteHint} (${fmt.format(r.employee.contractHoursPerWeek)}/${r.employee.workDaysPerWeek}T)`;
                  const liveH = liveLaborByEmp.get(r.employee.id);
                  const hints =
                    layer === "PLAN"
                      ? (liveH?.plan ?? [])
                      : (liveH?.actual ?? []);
                  const warnN = hints.filter((h) => h.severity === "warning").length;
                  const laborExpanded = laborOpenEmp === r.employee.id;

                  return (
                    <tr key={r.employee.id} className="border-b border-slate-200 align-top">
                      <td className="border border-slate-200 bg-[var(--rota-rail)] px-2 py-1 font-medium text-slate-800">
                        {label}
                      </td>
                      {displayCells.map((val, di) => (
                        <td key={di} className="border border-slate-200 p-0">
                          <div className="flex flex-col gap-0.5 p-0.5">
                            <input
                              disabled={readOnly}
                              value={val}
                              onChange={(e) => setCell(r.employee.id, di, e.target.value)}
                              className="h-9 w-full min-w-[6.5rem] rounded border border-slate-200 bg-white px-1.5 text-sm outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--rota-header)] disabled:bg-slate-100"
                              placeholder="11:30-18:00-30"
                            />
                            <input
                              disabled={readOnly}
                              value={displayNotes[di] ?? ""}
                              onChange={(e) => setNote(r.employee.id, di, e.target.value)}
                              className="h-7 w-full min-w-[6.5rem] rounded border border-dashed border-slate-300 bg-slate-50/80 px-1.5 text-[11px] text-slate-700 outline-none placeholder:text-slate-400 focus:ring-1 focus:ring-[var(--rota-header)] disabled:bg-slate-100"
                              placeholder="Notiz…"
                              maxLength={2000}
                            />
                          </div>
                        </td>
                      ))}
                      <td className="border border-slate-200 px-2 text-right tabular-nums">
                        {fmt.format(weeklyHoursShown)}
                      </td>
                      <td
                        className={`border border-slate-200 px-2 text-right tabular-nums ${
                          zagLive < 0 ? "text-red-600" : ""
                        }`}
                        title="Saldo vor Woche + (Ist-Summe − Vertragssoll); Ist-Summe unabhängig von der Ansicht"
                      >
                        {fmt.format(zagLive)}
                      </td>
                      <td className="border border-slate-200 px-2 text-right tabular-nums">
                        {fmt.format(r.employee.vacationDaysOpen)} T
                      </td>
                      <td className="border border-slate-200 px-1 text-center">
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

          {data.rows.some((r) => laborOpenEmp === r.employee.id) && (
            <div className="mt-3 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-950">
              {data.rows
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

          {errsBlockLive(data, grid, layer)}

          <div className="mt-4 flex flex-wrap gap-2">
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

          <p className="mt-4 text-xs text-slate-500">
            Eingabe: <code>11:30-20:00-30</code> — dritter Wert = Pausenminuten;{" "}
            <strong>Arbeitszeit = Zeitspanne minus Pause</strong> (Pause zählt nicht). Oder{" "}
            <code>U</code>, <code>K</code>, <code>ZA</code>, <code>FT</code>. <strong>WS</strong> =
            Summe Stunden (Plan/Ist je nach Ansicht). <strong>ZAG</strong> = Saldo vor der Woche +
            (Ist-Summe − Vertragsstunden). Urlaub
            wird bei <code>U</code> in der Ist-Zeile angepasst. Feiertage unter{" "}
            <strong>Feiertage</strong>. Untere Zeile = Notiz pro Tag (z. B. Tätigkeit).{" "}
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
  layer: Layer
) {
  const lines = data.rows.flatMap((r) => {
    const g = grid[r.employee.id];
    const cells =
      layer === "PLAN"
        ? (g?.plan ?? r.plan)
        : (g?.actual ?? r.actual);
    const { errors } = computeWeeklyBalance(
      cells,
      r.employee.contractHoursPerWeek,
      r.employee.workDaysPerWeek
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
