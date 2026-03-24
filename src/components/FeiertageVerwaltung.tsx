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

type SchoolBreakRow = {
  id: string;
  startDate: string;
  endDate: string;
  name: string;
  region: string;
  includedInPlan: boolean;
};

const YEARS = [2025, 2026, 2027];

function fmtDe(iso: string): string {
  return iso.slice(0, 10).split("-").reverse().join(".");
}

export function FeiertageVerwaltung() {
  const [year, setYear] = useState(2026);
  const [rows, setRows] = useState<HolidayRow[]>([]);
  const [breaks, setBreaks] = useState<SchoolBreakRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const [hRes, sRes] = await Promise.all([
        fetch(`/api/holidays?year=${year}`),
        fetch(`/api/school-breaks?year=${year}`),
      ]);
      const failed: string[] = [];
      setRows([]);
      setBreaks([]);

      if (hRes.ok) {
        const hj = await hRes.json();
        const list = (hj.holidays ?? []).map((h: HolidayRow & { date: string }) => ({
          ...h,
          date: typeof h.date === "string" ? h.date.slice(0, 10) : h.date,
        }));
        setRows(list);
      } else {
        failed.push("Feiertage");
      }

      if (sRes.ok) {
        const sj = await sRes.json();
        const blist = (sj.schoolBreaks ?? []).map(
          (b: SchoolBreakRow & { startDate: string; endDate: string }) => ({
            ...b,
            startDate:
              typeof b.startDate === "string" ? b.startDate.slice(0, 10) : b.startDate,
            endDate: typeof b.endDate === "string" ? b.endDate.slice(0, 10) : b.endDate,
          })
        );
        setBreaks(blist);
      } else {
        failed.push("Schulferien");
      }

      if (failed.length > 0) {
        setMsg(
          `${failed.join(" und ")} konnten nicht geladen werden.` +
            (failed.includes("Schulferien")
              ? " Falls die Ferien-Tabelle neu ist: im Ordner web `npx prisma db push` und `npx prisma db seed` ausführen."
              : "")
        );
      }
    } catch {
      setMsg("Netzwerkfehler beim Laden der Feiertage/Ferien.");
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleHoliday(id: string, includedInPlan: boolean) {
    setPending(`h:${id}`);
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

  async function toggleBreak(id: string, includedInPlan: boolean) {
    setPending(`s:${id}`);
    setMsg(null);
    try {
      const res = await fetch(`/api/school-breaks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includedInPlan }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setMsg(j.error ?? "Speichern fehlgeschlagen.");
        return;
      }
      setBreaks((prev) =>
        prev.map((r) => (r.id === id ? { ...r, includedInPlan } : r))
      );
    } finally {
      setPending(null);
    }
  }

  const activeHolidayCount = rows.filter((r) => r.includedInPlan).length;
  const activeBreakCount = breaks.filter((r) => r.includedInPlan).length;

  return (
    <div className="min-h-screen p-4 md:p-6">
      <header className="mb-6 flex flex-col gap-3 border-b border-slate-200 pb-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">
            Feiertage &amp; Ferien
          </h1>
          <p className="text-sm text-slate-500">
            Zentrale Auswahl: welche <strong>Feiertage</strong> und{" "}
            <strong>Schulferien</strong> im <strong>Dienstplan</strong> in der Kopfzeile
            markiert werden (gilt für alle Mitarbeiter). Ferien sind Zeiträume (Von–Bis);
            im Raster sind <strong>erster und letzter Tag</strong> stärker hervorgehoben
            als die Tage dazwischen.
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
          Feiertage: {activeHolidayCount} / {rows.length} aktiv · Ferien:{" "}
          {activeBreakCount} / {breaks.length} aktiv
        </span>
      </div>

      {msg && <p className="mb-3 text-sm text-amber-800">{msg}</p>}

      {loading ? (
        <p className="text-slate-500">Lade…</p>
      ) : (
        <>
          <h2 className="mb-2 text-lg font-semibold text-slate-800">Feiertage</h2>
          {rows.length === 0 ? (
            <p className="mb-8 text-slate-600">
              Keine Feiertage für {year}. Bitte{" "}
              <code className="rounded bg-slate-100 px-1">npx prisma db seed</code>{" "}
              ausführen oder Jahr wechseln.
            </p>
          ) : (
            <div className="mb-10 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
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
                          disabled={pending === `h:${r.id}`}
                          onChange={(e) => void toggleHoliday(r.id, e.target.checked)}
                          className="h-4 w-4 accent-[var(--rota-header)]"
                          aria-label={`${r.name} im Plan`}
                        />
                      </td>
                      <td className="border border-slate-200 px-2 py-2 tabular-nums">
                        {fmtDe(r.date)}
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

          <h2 className="mb-2 text-lg font-semibold text-slate-800">
            Schulferien (Salzburg AT / Bayern DE)
          </h2>
          {breaks.length === 0 ? (
            <p className="text-slate-600">
              Keine Ferien-Zeiträume für {year} in der Datenbank.{" "}
              <code className="rounded bg-slate-100 px-1">npx prisma db push</code> und{" "}
              <code className="rounded bg-slate-100 px-1">npx prisma db seed</code>{" "}
              ausführen.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="min-w-[720px] w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-100 text-left">
                    <th className="border border-slate-200 px-2 py-2">Im Dienstplan</th>
                    <th className="border border-slate-200 px-2 py-2">Von</th>
                    <th className="border border-slate-200 px-2 py-2">Bis</th>
                    <th className="border border-slate-200 px-2 py-2">Bezeichnung</th>
                    <th className="border border-slate-200 px-2 py-2">Region</th>
                  </tr>
                </thead>
                <tbody>
                  {breaks.map((r) => (
                    <tr
                      key={r.id}
                      className={r.includedInPlan ? "" : "bg-slate-50 text-slate-500"}
                    >
                      <td className="border border-slate-200 px-2 py-2">
                        <input
                          type="checkbox"
                          checked={r.includedInPlan}
                          disabled={pending === `s:${r.id}`}
                          onChange={(e) => void toggleBreak(r.id, e.target.checked)}
                          className="h-4 w-4 accent-[var(--rota-header)]"
                          aria-label={`${r.name} (${r.region}) im Plan`}
                        />
                      </td>
                      <td className="border border-slate-200 px-2 py-2 tabular-nums">
                        {fmtDe(r.startDate)}
                      </td>
                      <td className="border border-slate-200 px-2 py-2 tabular-nums">
                        {fmtDe(r.endDate)}
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
        </>
      )}

      <p className="mt-6 max-w-2xl text-xs text-slate-500">
        <strong>Feiertage:</strong> Derselbe Kalendertag kann für AT und BY unterschiedlich
        benannt sein (zwei Zeilen). <strong>Ferien:</strong> Termine stammen aus dem Seed
        (Recherche-Stand) — bitte mit offiziellen Ferienkalendern des Landes Salzburg und
        des Freistaats Bayern abgleichen und bei Bedarf in{" "}
        <code className="rounded bg-slate-100 px-1">prisma/schoolBreaksSeed.ts</code>{" "}
        anpassen.
      </p>
    </div>
  );
}
