"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type HolidayRow = {
  id: string;
  date: string;
  name: string;
  region: string;
  includedInPlan: boolean;
};

const YEARS = [2025, 2026, 2027];

export function FeiertageVerwaltung() {
  const [year, setYear] = useState(2026);
  const [rows, setRows] = useState<HolidayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/holidays?year=${year}`);
      if (!res.ok) throw new Error("Laden fehlgeschlagen");
      const j = await res.json();
      const list = (j.holidays ?? []).map((h: HolidayRow & { date: string }) => ({
        ...h,
        date: typeof h.date === "string" ? h.date.slice(0, 10) : h.date,
      }));
      setRows(list);
    } catch {
      setMsg("Feiertage konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(id: string, includedInPlan: boolean) {
    setPending(id);
    setMsg(null);
    try {
      const res = await fetch(`/api/holidays/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includedInPlan }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setMsg(j.error ?? "Speichern fehlgeschlagen.");
        return;
      }
      setRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, includedInPlan } : r))
      );
    } finally {
      setPending(null);
    }
  }

  const activeCount = rows.filter((r) => r.includedInPlan).length;

  return (
    <div className="min-h-screen p-4 md:p-6">
      <header className="mb-6 flex flex-col gap-3 border-b border-slate-200 pb-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Feiertage</h1>
          <p className="text-sm text-slate-500">
            Auswahl, welche Feiertage im <strong>Dienstplan</strong> markiert werden
            (gilt für alle Mitarbeiter). Herkunft: AT-Salzburg / DE-Bayern als
            Referenzregion pro Eintrag.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/dienstplan"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Zum Dienstplan
          </Link>
          <Link
            href="/mitarbeiter"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Mitarbeiter
          </Link>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium text-slate-700">
          Jahr{" "}
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="ml-1 rounded border border-slate-300 px-2 py-1 text-sm"
          >
            {YEARS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <span className="text-sm text-slate-600">
          {activeCount} von {rows.length} für Plan aktiv
        </span>
      </div>

      {msg && <p className="mb-3 text-sm text-amber-800">{msg}</p>}

      {loading ? (
        <p className="text-slate-500">Lade…</p>
      ) : rows.length === 0 ? (
        <p className="text-slate-600">
          Keine Feiertage für {year}. Bitte{" "}
          <code className="rounded bg-slate-100 px-1">npx prisma db seed</code> ausführen
          oder Jahr wechseln.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-[640px] w-full border-collapse text-sm">
            <thead>
              <tr className="bg-slate-100 text-left">
                <th className="border border-slate-200 px-2 py-2">Im Dienstplan</th>
                <th className="border border-slate-200 px-2 py-2">Datum</th>
                <th className="border border-slate-200 px-2 py-2">Name</th>
                <th className="border border-slate-200 px-2 py-2">Referenz</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className={r.includedInPlan ? "" : "bg-slate-50 text-slate-500"}
                >
                  <td className="border border-slate-200 px-2 py-2">
                    <input
                      type="checkbox"
                      checked={r.includedInPlan}
                      disabled={pending === r.id}
                      onChange={(e) => void toggle(r.id, e.target.checked)}
                      className="h-4 w-4 accent-[var(--rota-header)]"
                      aria-label={`${r.name} im Plan`}
                    />
                  </td>
                  <td className="border border-slate-200 px-2 py-2 tabular-nums">
                    {r.date.split("-").reverse().join(".")}
                  </td>
                  <td className="border border-slate-200 px-2 py-2 font-medium">
                    {r.name}
                  </td>
                  <td className="border border-slate-200 px-2 py-2 text-xs">
                    {r.region}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-6 max-w-2xl text-xs text-slate-500">
        Hinweis: Derselbe Kalendertag kann für AT und BY unterschiedlich benannt sein
        (zwei Zeilen). Schalte nur die Einträge ein, die für euren Betrieb gelten sollen.
        Im Dienstplan werden aktivierte Tage in der Kopfzeile hervorgehoben.
      </p>
    </div>
  );
}
