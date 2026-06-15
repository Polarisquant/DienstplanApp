"use client";

import { AppNavLinks } from "@/components/AppNavLinks";
import { useCallback, useEffect, useMemo, useState } from "react";

type MonthlyReportPayload = {
  generatedAt: string;
  employerName: string;
  departmentName: string;
  monthLabel: string;
  month: string;
  employee: {
    id: string;
    name: string;
    personalNumber: string;
    entryDate: string | null;
    exitDate: string | null;
    contractHoursPerWeek: number;
    workDaysPerWeek: number;
  };
  vortrag: {
    zeitausgleichHours: number;
    feiertageHours: number;
    urlaubTage: number;
  };
  days: {
    dateISO: string;
    isoWeek: number;
    dayShort: string;
    dayNum: number;
    isWeekend: boolean;
    dienst: string;
    von: string;
    bis: string;
    von2: string;
    bis2: string;
    von3: string;
    bis3: string;
    pauseHours: number;
    sonstiges: string;
    soll: number;
    ist: number;
    abweichung: number;
    isPublicHoliday: boolean;
  }[];
  summen: {
    pauseHours: number;
    soll: number;
    ist: number;
    abweichung: number;
  };
  kennzahlen: {
    sollStunden: number;
    ruhetage: {
      tage: number;
      sollStunden: number;
      u0: number;
      k0: number;
    };
    arbeitstage: { tage: number; istStunden: number };
    urlaub: { tage: number; istStunden: number };
    krankheit: { tage: number; istStunden: number };
    sonderurlaubBezahlt: { tage: number; istStunden: number };
    samstagSonntag: { tage: number; istStunden: number };
    feiertageStunden: number;
    guthabenMonatsende: number;
    zeitausgleichEnde: number;
    urlaubAliquot: { tage: number; zusaetzlicheStunden: number };
  };
  endstand: { zeitausgleichHours: number };
  unclosedWeeks: { weekStart: string; label: string }[];
  unclosedWeekRangeLabel: string | null;
};

type Emp = { id: string; name: string; active: boolean };

const fmt = new Intl.NumberFormat("de-AT", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const fmt1 = new Intl.NumberFormat("de-AT", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
});

function defaultMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function escapeCsvField(s: string): string {
  if (/[;"\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function cellTime(v: string): string {
  return v?.trim() ? v : "—";
}

export default function MonatsuebersichtPage() {
  const [month, setMonth] = useState(defaultMonth);
  const [employees, setEmployees] = useState<Emp[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [data, setData] = useState<MonthlyReportPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadEmployees = useCallback(async () => {
    try {
      const res = await fetch("/api/employees");
      if (!res.ok) return;
      const j = await res.json();
      const list = (j.employees ?? []) as Emp[];
      setEmployees(list.filter((e) => e.active));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadEmployees();
  }, [loadEmployees]);

  const loadReport = useCallback(async () => {
    if (!employeeId || !month) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/monthly-report?employeeId=${encodeURIComponent(employeeId)}&month=${encodeURIComponent(month)}`
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? "Laden fehlgeschlagen.");
        setData(null);
        return;
      }
      setData(j as MonthlyReportPayload);
    } catch {
      setErr("Netzwerkfehler.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [employeeId, month]);

  useEffect(() => {
    if (employeeId) void loadReport();
  }, [employeeId, month, loadReport]);

  function handlePrint() {
    window.print();
  }

  function downloadCsv() {
    if (!data) return;
    const sep = ";";
    const h = [
      "KW",
      "Tag",
      "Dienst",
      "von_1",
      "bis_1",
      "von_2",
      "bis_2",
      "von_3",
      "bis_3",
      "davon_Pause_h",
      "Sonstiges",
      "Soll_lt_Vertrag",
      "Arbeitszeit",
      "Abweichung",
    ];
    const lines = [h.join(sep)];
    for (const r of data.days) {
      lines.push(
        [
          String(r.isoWeek),
          r.dateISO.split("-").reverse().join("."),
          escapeCsvField(r.dienst),
          escapeCsvField(r.von),
          escapeCsvField(r.bis),
          escapeCsvField(r.von2),
          escapeCsvField(r.bis2),
          escapeCsvField(r.von3),
          escapeCsvField(r.bis3),
          fmt.format(r.pauseHours).replace(".", ","),
          escapeCsvField(r.sonstiges),
          fmt.format(r.soll).replace(".", ","),
          fmt.format(r.ist).replace(".", ","),
          fmt.format(r.abweichung).replace(".", ","),
        ].join(sep)
      );
    }
    const csv = "\ufeff" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `monatsuebersicht_${data.employee.name.replace(/\s+/g, "_")}_${data.month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function openEmailDraft() {
    if (!data) return;
    const k = data.kennzahlen;
    const subject = `Monatsübersicht ${data.monthLabel} · ${data.employee.name}`;
    const body = [
      `${data.employerName} · ${data.departmentName}`,
      `Mitarbeiter: ${data.employee.name} (${data.employee.personalNumber || "o. Nr."})`,
      `Monat: ${data.monthLabel}`,
      `Soll-Stunden: ${fmt.format(k.sollStunden)} Std.`,
      `Ruhetage: ${k.ruhetage.tage} Tage [ U0 : ${k.ruhetage.u0}, K0 : ${k.ruhetage.k0} ] (${fmt.format(k.ruhetage.sollStunden)} Std.)`,
      `Arbeitstage: ${k.arbeitstage.tage} Tage (${fmt.format(k.arbeitstage.istStunden)} Std.)`,
      `Urlaub: ${k.urlaub.tage} Tage (${fmt.format(k.urlaub.istStunden)} Std.)`,
      "",
      data.unclosedWeeks.length > 0
        ? `WARNUNG: ${data.unclosedWeeks.length} Woche(n) nicht abgeschlossen.`
        : "",
    ].join("\n");
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  const createdStr = useMemo(() => {
    if (!data?.generatedAt) return "";
    try {
      const d = new Date(data.generatedAt);
      return d.toLocaleString("de-AT", {
        dateStyle: "short",
        timeStyle: "short",
      });
    } catch {
      return "";
    }
  }, [data?.generatedAt]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const thNum =
    "border border-slate-200 px-1 py-1 text-center align-bottom text-xs font-medium leading-tight text-slate-800 print:px-0.5 print:text-[8px]";

  return (
    <div className="min-h-screen p-4 md:p-6 print:bg-white print:p-4">
      <header className="no-print mb-6 flex flex-col gap-3 border-b border-slate-200 pb-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Monatsübersicht</h1>
          <p className="text-sm text-slate-500">
            Ist-Stunden pro Mitarbeiter und Monat (nach schließbaren Kalenderwochen)
          </p>
        </div>
        <AppNavLinks
          links={[
            { href: "/dienstplan", label: "Dienstplan" },
            { href: "/mitarbeiter", label: "Mitarbeiter" },
            { href: "/abrechnung", label: "Abrechnung" },
          ]}
          after={
            <button
              type="button"
              onClick={() => void logout()}
              className="block w-full rounded-lg px-3 py-2.5 text-left text-sm text-slate-600 hover:bg-slate-100 md:inline md:w-auto md:p-0 md:hover:underline"
            >
              Abmelden
            </button>
          }
        />
      </header>

      <div className="no-print mb-4 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:flex-row md:flex-wrap md:items-end">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Mitarbeiter</span>
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className="mobile-input min-w-0 w-full rounded border border-slate-300 px-2 py-1.5 md:min-w-[14rem]"
          >
            <option value="">— wählen —</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Monat</span>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="mobile-input rounded border border-slate-300 px-2 py-1.5"
          />
        </label>
        <button
          type="button"
          onClick={() => void loadReport()}
          disabled={loading || !employeeId}
          className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-50"
        >
          Aktualisieren
        </button>
        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3 md:ml-2 md:border-0 md:pt-0">
          <button
            type="button"
            disabled={!data || loading}
            onClick={() => handlePrint()}
            className="rounded-lg border border-slate-400 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-40"
          >
            Drucken
          </button>
          <button
            type="button"
            disabled={!data || loading}
            onClick={() => downloadCsv()}
            className="rounded-lg border border-slate-400 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-40"
          >
            CSV exportieren
          </button>
          <button
            type="button"
            disabled={!data || loading}
            onClick={() => openEmailDraft()}
            className="rounded-lg border border-slate-400 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-40"
          >
            E-Mail (Entwurf)
          </button>
        </div>
      </div>

      {err && (
        <p className="no-print mb-3 text-sm text-red-700" role="alert">
          {err}
        </p>
      )}

      {loading && !data && <p className="no-print text-slate-500">Lade…</p>}

      {data && (
        <article className="table-scroll-x table-scroll-hint rounded-xl border border-slate-200 bg-white shadow-sm print:border-0 print:shadow-none">
          <p className="no-print px-3 py-2 text-xs text-slate-500 md:hidden">
            Tabelle horizontal wischen.
          </p>
          <div className="border-b border-slate-200 p-4 print:p-2">
            <h2 className="text-lg font-semibold text-slate-900 print:text-base">
              Monatsübersicht {data.monthLabel} · {data.employee.name}
            </h2>
            <p className="text-xs text-slate-600 print:text-[10px]">
              Erstellt: {createdStr} · Dienstgeber: {data.employerName} · Abteilung:{" "}
              {data.departmentName}
            </p>
            <div className="mt-3 grid gap-2 text-sm md:grid-cols-2 print:text-xs">
              <p>
                <strong>Personalnummer:</strong> {data.employee.personalNumber || "—"}
              </p>
              <p>
                <strong>Vertrag:</strong> {fmt1.format(data.employee.contractHoursPerWeek)} h /{" "}
                {data.employee.workDaysPerWeek} T
              </p>
              <p>
                <strong>Eintritt:</strong>{" "}
                {data.employee.entryDate
                  ? data.employee.entryDate.split("-").reverse().join(".")
                  : "—"}
              </p>
              <p>
                <strong>Austritt:</strong>{" "}
                {data.employee.exitDate
                  ? data.employee.exitDate.split("-").reverse().join(".")
                  : "—"}
              </p>
            </div>
            <div className="mt-4 grid gap-1 rounded-lg bg-slate-50 p-3 text-sm print:bg-white print:p-2 print:text-[10px]">
              <p>
                <strong>Vortrag Zeitausgleich (ZA):</strong>{" "}
                {fmt.format(data.vortrag.zeitausgleichHours)} Stunden
              </p>
              <p>
                <strong>Vortrag Feiertage:</strong>{" "}
                {fmt.format(data.vortrag.feiertageHours)} Stunden
              </p>
              <p>
                <strong>Vortrag Urlaub (aliquot):</strong>{" "}
                {fmt1.format(data.vortrag.urlaubTage)} Tage
              </p>
            </div>
          </div>

          <table className="w-full min-w-[1100px] border-collapse text-sm print:min-w-0 print:text-[9px]">
            <thead>
              <tr className="bg-slate-100 text-left print:bg-white">
                <th className="border border-slate-200 px-1 py-1">KW</th>
                <th className="border border-slate-200 px-1 py-1">Tag</th>
                <th className="border border-slate-200 px-1 py-1">Dienst</th>
                <th className="border border-slate-200 px-0.5 py-1 text-center text-xs">von</th>
                <th className="border border-slate-200 px-0.5 py-1 text-center text-xs">bis</th>
                <th className="border border-slate-200 px-0.5 py-1 text-center text-xs">von</th>
                <th className="border border-slate-200 px-0.5 py-1 text-center text-xs">bis</th>
                <th className="border border-slate-200 px-0.5 py-1 text-center text-xs">von</th>
                <th className="border border-slate-200 px-0.5 py-1 text-center text-xs">bis</th>
                <th className="border border-slate-200 px-1 py-1 text-center text-xs leading-tight">
                  davon
                  <br />
                  Pause
                </th>
                <th className="border border-slate-200 px-1 py-1">Sonstiges</th>
                <th className={thNum}>
                  Soll lt.
                  <br />
                  Vertrag
                </th>
                <th className={thNum}>Arbeitszeit</th>
                <th className={thNum}>Abweichung</th>
              </tr>
            </thead>
            <tbody>
              {data.days.map((r) => (
                <tr
                  key={r.dateISO}
                  className={
                    r.isWeekend ? "bg-slate-100/90 print:bg-slate-100" : "border-b border-slate-100"
                  }
                >
                  <td className="border border-slate-200 px-1 py-0.5 tabular-nums">{r.isoWeek}</td>
                  <td className="border border-slate-200 px-1 py-0.5">
                    {r.dayNum} {r.dayShort}
                  </td>
                  <td className="border border-slate-200 px-1 py-0.5">{r.dienst}</td>
                  <td className="border border-slate-200 px-0.5 py-0.5 text-center">
                    {cellTime(r.von)}
                  </td>
                  <td className="border border-slate-200 px-0.5 py-0.5 text-center">
                    {cellTime(r.bis)}
                  </td>
                  <td className="border border-slate-200 px-0.5 py-0.5 text-center">
                    {cellTime(r.von2)}
                  </td>
                  <td className="border border-slate-200 px-0.5 py-0.5 text-center">
                    {cellTime(r.bis2)}
                  </td>
                  <td className="border border-slate-200 px-0.5 py-0.5 text-center">
                    {cellTime(r.von3)}
                  </td>
                  <td className="border border-slate-200 px-0.5 py-0.5 text-center">
                    {cellTime(r.bis3)}
                  </td>
                  <td className="border border-slate-200 px-1 py-0.5 text-center tabular-nums">
                    {r.pauseHours > 0 ? fmt.format(r.pauseHours) : "—"}
                  </td>
                  <td className="max-w-[8rem] border border-slate-200 px-1 py-0.5 text-xs text-slate-700">
                    {r.sonstiges || ""}
                  </td>
                  <td className="border border-slate-200 px-1 py-0.5 text-right tabular-nums">
                    {fmt.format(r.soll)}
                  </td>
                  <td className="border border-slate-200 px-1 py-0.5 text-right tabular-nums">
                    {fmt.format(r.ist)}
                  </td>
                  <td
                    className={`border border-slate-200 px-1 py-0.5 text-right tabular-nums ${
                      r.abweichung < 0 ? "text-red-700" : ""
                    }`}
                  >
                    {fmt.format(r.abweichung)}
                  </td>
                </tr>
              ))}
              <tr className="bg-slate-50 font-semibold print:bg-white">
                <td
                  className="border border-slate-200 px-1 py-1"
                  colSpan={9}
                >
                  Summe (in Stunden)
                </td>
                <td className="border border-slate-200 px-1 py-1 text-center tabular-nums">
                  {data.summen.pauseHours > 0 ? fmt.format(data.summen.pauseHours) : "—"}
                </td>
                <td className="border border-slate-200 px-1 py-1" />
                <td className="border border-slate-200 px-1 py-1 text-right tabular-nums">
                  {fmt.format(data.summen.soll)}
                </td>
                <td className="border border-slate-200 px-1 py-1 text-right tabular-nums">
                  {fmt.format(data.summen.ist)}
                </td>
                <td
                  className={`border border-slate-200 px-1 py-1 text-right tabular-nums ${
                    data.summen.abweichung < 0 ? "text-red-700" : ""
                  }`}
                >
                  {fmt.format(data.summen.abweichung)}
                </td>
              </tr>
            </tbody>
          </table>

          <div className="border-t border-slate-200 p-4 text-sm print:p-2 print:text-[10px]">
            <ul className="space-y-1.5">
              <li>
                <strong>Soll-Stunden:</strong> {fmt.format(data.kennzahlen.sollStunden)} Std.
              </li>
              <li>
                <strong>Ruhetage:</strong> {data.kennzahlen.ruhetage.tage} Tage{" "}
                <span className="tabular-nums">
                  [ U0 : {data.kennzahlen.ruhetage.u0}, K0 : {data.kennzahlen.ruhetage.k0} ] (
                  {fmt.format(data.kennzahlen.ruhetage.sollStunden)} Std.)
                </span>
              </li>
              <li>
                <strong>Arbeitstage:</strong> {data.kennzahlen.arbeitstage.tage} Tage (
                {fmt.format(data.kennzahlen.arbeitstage.istStunden)} Std.)
              </li>
              <li>
                <strong>Urlaub:</strong> {data.kennzahlen.urlaub.tage} Tage (
                {fmt.format(data.kennzahlen.urlaub.istStunden)} Std.)
              </li>
              <li>
                <strong>Krankheit:</strong> {data.kennzahlen.krankheit.tage} Tage (
                {fmt.format(data.kennzahlen.krankheit.istStunden)} Std.)
              </li>
              <li>
                <strong>Sonderurlaub bezahlt:</strong> {data.kennzahlen.sonderurlaubBezahlt.tage}{" "}
                Tage ({fmt.format(data.kennzahlen.sonderurlaubBezahlt.istStunden)} Std.)
              </li>
              <li>
                <strong>Samstags- und Sonntagszeiten:</strong>{" "}
                {data.kennzahlen.samstagSonntag.tage} Tage (
                {fmt.format(data.kennzahlen.samstagSonntag.istStunden)} Std.)
              </li>
              <li>
                <strong>Guthaben zum Monatsende:</strong>{" "}
                {fmt.format(data.kennzahlen.guthabenMonatsende)} Stunden
              </li>
              <li>
                <strong>Zeitausgleich (ZA):</strong>{" "}
                {fmt.format(data.kennzahlen.zeitausgleichEnde)} Stunden
              </li>
              <li>
                <strong>Feiertage:</strong> {fmt.format(data.kennzahlen.feiertageStunden)} Stunden
              </li>
              <li>
                <strong>Urlaub (aliquot):</strong>{" "}
                {fmt1.format(data.kennzahlen.urlaubAliquot.tage)} Tage
                {data.kennzahlen.urlaubAliquot.zusaetzlicheStunden > 0
                  ? ` (+${fmt.format(data.kennzahlen.urlaubAliquot.zusaetzlicheStunden)} Std.)`
                  : ""}
              </li>
            </ul>

            <p className="mt-4 border-t border-slate-200 pt-3">
              <strong>Unterschrift:</strong>{" "}
              <span className="inline-block min-w-[12rem] border-b border-slate-800 print:min-w-[16rem]">
                {" "}
              </span>
              <span className="ml-2 text-slate-800">{data.employee.name}</span>
            </p>
          </div>

          {data.unclosedWeeks.length > 0 && (
            <div className="border-t border-red-200 bg-red-50 p-4 text-sm text-red-950 print:bg-red-50 print:text-[10px]">
              <p className="font-bold">
                Warnung: Es sind nicht alle Wochen abgeschlossen! Alle angezeigten Werte auf diesem
                Blatt können falsch sein!
              </p>
              <p className="mt-1 text-red-900">
                Es wurden {data.unclosedWeeks.length} nicht abgeschlossene Wochen
                {data.unclosedWeekRangeLabel
                  ? ` zwischen dem ${data.unclosedWeekRangeLabel}`
                  : " im gewählten Monat"}{" "}
                gefunden ({data.unclosedWeeks.map((w) => w.label).join(", ")}).
              </p>
            </div>
          )}
        </article>
      )}
    </div>
  );
}
