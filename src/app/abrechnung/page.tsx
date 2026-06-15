"use client";

import { AppNavLinks } from "@/components/AppNavLinks";
import { useCallback, useEffect, useState } from "react";

type Row = {
  employeeId: string;
  name: string;
  workSiteLabel: string;
  contractHoursPerWeek: number;
  vacationDaysOpenNow: number;
  istHoursInPeriod: number;
  vacationDaysInPeriod: number;
  balanceHoursAtEnd: number;
  balanceExplanation: string;
  parseErrors: string[];
};

type Payload = {
  from: string;
  to: string;
  disclaimer: string;
  rows: Row[];
};

function defaultMonthInput(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

const fmt = new Intl.NumberFormat("de-AT", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const fmtDays2 = new Intl.NumberFormat("de-AT", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function escapeCsvField(s: string): string {
  if (/[;"\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export default function AbrechnungPage() {
  const [month, setMonth] = useState(defaultMonthInput);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      let url: string;
      if (useCustom && from && to) {
        url = `/api/payroll-summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
      } else {
        url = `/api/payroll-summary?month=${encodeURIComponent(month)}`;
      }
      const res = await fetch(url);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? "Laden fehlgeschlagen.");
        setData(null);
        return;
      }
      setData(j as Payload);
    } catch {
      setErr("Netzwerkfehler.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [month, from, to, useCustom]);

  useEffect(() => {
    void load();
  }, [load]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  function handlePrint() {
    window.print();
  }

  function downloadCsv() {
    if (!data) return;
    const sep = ";";
    const header = [
      "Mitarbeiter",
      "Standort",
      "Vertrag_h_Wo",
      "Ist_h_Zeitraum",
      "Urlaub_Tage_Zeitraum",
      "o_U_aktuell",
      "Stundenkonto",
      "Hinweis_Konto",
    ];
    const lines = [header.join(sep)];
    for (const r of data.rows) {
      const hint = `${r.balanceExplanation}${r.parseErrors.length ? " | " + r.parseErrors.join(" | ") : ""}`;
      lines.push(
        [
          escapeCsvField(r.name),
          escapeCsvField(r.workSiteLabel ?? ""),
          fmt.format(r.contractHoursPerWeek).replace(".", ","),
          fmt.format(r.istHoursInPeriod).replace(".", ","),
          fmtDays2.format(r.vacationDaysInPeriod).replace(".", ","),
          fmtDays2.format(r.vacationDaysOpenNow).replace(".", ","),
          fmt.format(r.balanceHoursAtEnd).replace(".", ","),
          escapeCsvField(hint),
        ].join(sep)
      );
    }
    const csv = "\ufeff" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `abrechnung_${data.from}_${data.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function openEmailDraft() {
    if (!data) return;
    const subject = `Abrechnungsübersicht ${data.from} – ${data.to}`;
    const bodyLines = [
      `Zeitraum: ${data.from} bis ${data.to}`,
      "",
      data.disclaimer,
      "",
      ...data.rows.map(
        (r) =>
          `${r.name}: Ist ${fmt.format(r.istHoursInPeriod)} h | Urlaub ${fmtDays2.format(r.vacationDaysInPeriod)} T | o.U. ${fmtDays2.format(r.vacationDaysOpenNow)} | Konto ${fmt.format(r.balanceHoursAtEnd)} h`
      ),
      "",
      "(Bei vielen Mitarbeitern ggf. stattdessen CSV exportieren und anhängen.)",
    ];
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

  return (
    <div className="min-h-screen p-4 md:p-6 print:p-4">
      <header className="no-print mb-6 flex flex-col gap-4 border-b border-slate-200 pb-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Abrechnungsübersicht</h1>
          <p className="text-sm text-slate-500">
            Stunden & Urlaub im Zeitraum — kein offizieller Lohnzettel
          </p>
        </div>
        <AppNavLinks
          links={[
            { href: "/dienstplan", label: "Dienstplan" },
            { href: "/mitarbeiter", label: "Mitarbeiter" },
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
          <span className="font-medium text-slate-700">Kalendermonat</span>
          <input
            type="month"
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
              setUseCustom(false);
            }}
            className="mobile-input rounded border border-slate-300 px-2 py-1.5"
          />
        </label>
        <span className="text-slate-400 md:self-center">oder</span>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Von (YYYY-MM-DD)</span>
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setUseCustom(true);
            }}
            className="mobile-input rounded border border-slate-300 px-2 py-1.5"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Bis (YYYY-MM-DD)</span>
          <input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setUseCustom(true);
            }}
            className="mobile-input rounded border border-slate-300 px-2 py-1.5"
          />
        </label>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-50"
        >
          Aktualisieren
        </button>
        <div className="flex w-full flex-wrap gap-2 border-t border-slate-100 pt-3 md:ml-2 md:w-auto md:border-0 md:pt-0">
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
            title="Für Excel oder als E-Mail-Anhang"
          >
            CSV exportieren
          </button>
          <button
            type="button"
            disabled={!data || loading}
            onClick={() => openEmailDraft()}
            className="rounded-lg border border-slate-400 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-40"
            title="Öffnet das Standard-Mailprogramm mit vorausgefülltem Text"
          >
            E-Mail (Entwurf)
          </button>
        </div>
      </div>

      <p className="no-print mb-2 text-xs text-slate-500">
        Drucken blendet Steuerung aus. E-Mail öffnet nur einen Entwurf — Anhänge bitte manuell (z. B.
        CSV).
      </p>

      {err && (
        <p className="no-print mb-3 text-sm text-red-700" role="alert">
          {err}
        </p>
      )}

      {loading && !data ? (
        <p className="text-slate-500">Lade…</p>
      ) : data ? (
        <article className="table-scroll-x table-scroll-hint rounded-xl border border-slate-200 bg-white shadow-sm print:border-0 print:shadow-none">
          <p className="no-print px-3 py-2 text-xs text-slate-500 md:hidden">
            Tabelle horizontal wischen.
          </p>
          <h2 className="mb-2 hidden text-lg font-semibold print:block">
            Abrechnungsübersicht · {data.from} — {data.to}
          </h2>
          <p className="mb-3 px-3 text-xs text-slate-600 print:px-0 print:text-[10px]">{data.disclaimer}</p>
          <table className="min-w-[800px] w-full border-collapse text-sm print:min-w-0 print:text-xs">
            <thead>
              <tr className="bg-slate-100 text-left print:bg-white">
                <th className="border border-slate-200 px-2 py-2">Mitarbeiter</th>
                <th className="border border-slate-200 px-2 py-2">Standort</th>
                <th className="border border-slate-200 px-2 py-2">Vertrag h/Wo</th>
                <th className="border border-slate-200 px-2 py-2">Ist h (Zeitraum)</th>
                <th className="border border-slate-200 px-2 py-2">Urlaub Tage (Zeitraum)</th>
                <th className="border border-slate-200 px-2 py-2">o. U. (aktuell)</th>
                <th className="border border-slate-200 px-2 py-2">± Stundenkonto</th>
                <th className="border border-slate-200 px-2 py-2">Hinweis Konto</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.employeeId} className="border-b border-slate-100">
                  <td className="border border-slate-200 px-2 py-2 font-medium">
                    {r.name}
                  </td>
                  <td className="border border-slate-200 px-2 py-2 text-slate-600">
                    {r.workSiteLabel}
                  </td>
                  <td className="border border-slate-200 px-2 py-2 tabular-nums">
                    {fmt.format(r.contractHoursPerWeek)}
                  </td>
                  <td className="border border-slate-200 px-2 py-2 tabular-nums">
                    {fmt.format(r.istHoursInPeriod)}
                  </td>
                  <td className="border border-slate-200 px-2 py-2 tabular-nums">
                    {fmtDays2.format(r.vacationDaysInPeriod)}
                  </td>
                  <td className="border border-slate-200 px-2 py-2 tabular-nums">
                    {fmtDays2.format(r.vacationDaysOpenNow)}
                  </td>
                  <td
                    className={`border border-slate-200 px-2 py-2 text-right tabular-nums ${
                      r.balanceHoursAtEnd < 0 ? "text-red-600 print:text-red-700" : ""
                    }`}
                  >
                    {fmt.format(r.balanceHoursAtEnd)}
                  </td>
                  <td className="max-w-xs border border-slate-200 px-2 py-2 text-xs text-slate-600">
                    {r.balanceExplanation}
                    {r.parseErrors.length > 0 && (
                      <ul className="mt-1 list-inside list-disc text-amber-800">
                        {r.parseErrors.map((x, i) => (
                          <li key={i}>{x}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-slate-200 p-2 text-xs text-slate-500">
            Zeitraum: {data.from} — {data.to}
          </p>
        </article>
      ) : null}
    </div>
  );
}
