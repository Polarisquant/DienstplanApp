"use client";

import { AppNavLinks } from "@/components/AppNavLinks";
import { Fragment, useCallback, useEffect, useState } from "react";
import { annualVacationDaysFromWorkDaysPerWeek } from "@/lib/vacationAccrualAT";

type WorkSiteVal = "CRUSH" | "CAPPUCONE" | "SHARED";

type ContractSlice = {
  id?: string;
  effectiveFrom: string;
  contractHoursPerWeek: number;
  workDaysPerWeek: number;
};

type Employee = {
  id: string;
  name: string;
  personalNumber?: string;
  entryDate?: string | null;
  exitDate?: string | null;
  workSite: WorkSiteVal;
  contractHoursPerWeek: number;
  workDaysPerWeek: number;
  startBalanceHours: number;
  vacationDaysOpen: number;
  /** Jahresurlaub Arbeitstage (Cache; abgeleitet aus Arbeitstagen/Woche) */
  annualVacationDays: number;
  active: boolean;
  contracts?: ContractSlice[];
};

/** Formular: ZAG / Urlaub als String, damit „-“ beim Tippen nicht zu NaN/0 wird */
type EmployeeFormState = {
  name: string;
  personalNumber: string;
  entryDate: string;
  exitDate: string;
  workSite: WorkSiteVal;
  contractHoursPerWeek: number;
  workDaysPerWeek: number;
  startBalanceHours: string;
  vacationDaysOpen: string;
  /** Nur Bearbeiten: zusätzlicher Vertrag ab (1. eines Monats) */
  contractChangeFrom: string;
  contractChangeHours: number;
  contractChangeDays: number;
};

function numToInputString(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return String(n);
}

/** Leer → 0; Komma oder Punkt; unvollständiges „-“ → null */
function parseSignedDecimal(raw: string): number | null {
  const t = raw.trim().replace(",", ".");
  if (t === "") return 0;
  if (t === "-" || t === "+" || t === "." || t === ",") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** API liefert ISO ggf. mit Zeit — nur yyyy-mm-dd vergleichen/anzeigen */
function normIsoDate(s: string): string {
  return String(s).trim().slice(0, 10);
}

/** Kalenderdatum deutsch z. B. 2000-01-01 → 01.01.2000 */
function isoDateToDE(iso: string): string {
  const d = normIsoDate(iso);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return iso;
  return d.split("-").reverse().join(".");
}

const emptyForm: EmployeeFormState = {
  name: "",
  personalNumber: "",
  entryDate: "",
  exitDate: "",
  workSite: "SHARED",
  contractHoursPerWeek: 40,
  workDaysPerWeek: 5,
  startBalanceHours: "0",
  vacationDaysOpen: "0",
  contractChangeFrom: "",
  contractChangeHours: 30,
  contractChangeDays: 5,
};

const SITE_OPTIONS: { value: WorkSiteVal; label: string }[] = [
  { value: "CRUSH", label: "Crush" },
  { value: "CAPPUCONE", label: "CappuCone" },
  { value: "SHARED", label: "Geteilt (beide Standorte)" },
];

const fmtDec2 = new Intl.NumberFormat("de-AT", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

type ConsistencyPayload = {
  checkedAt: string;
  employees: number;
  issues: { employee: string; bereich: "urlaub" | "zeitkonto"; text: string }[];
};

type LedgerRow = {
  dateISO: string;
  label: string;
  ui: "open" | "acc" | "cons" | "man";
  note: string;
  amount: number;
  balanceAfter: number;
};

type LedgerPayload = {
  employee: {
    id: string;
    name: string;
    vacationDaysOpen: number;
    annualVacationDays: number;
    monthlyAccrual: number;
  };
  rows: LedgerRow[];
  check: { ok: boolean; journalDiff: number; saldoDiff: number };
};

const LEDGER_CHIP: Record<LedgerRow["ui"], string> = {
  open: "bg-slate-100 text-slate-700",
  acc: "bg-emerald-50 text-emerald-800",
  cons: "bg-pink-50 text-pink-800",
  man: "bg-amber-50 text-amber-800",
};

function deDate(iso: string): string {
  return iso.split("-").reverse().join(".");
}

export function MitarbeiterVerwaltung() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<EmployeeFormState>(emptyForm);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EmployeeFormState>(emptyForm);
  const [contractDeletingId, setContractDeletingId] = useState<string | null>(null);
  const [employeeDeletingId, setEmployeeDeletingId] = useState<string | null>(null);
  const [consistency, setConsistency] = useState<ConsistencyPayload | null>(null);
  const [ledgerOpenId, setLedgerOpenId] = useState<string | null>(null);
  const [ledgerData, setLedgerData] = useState<LedgerPayload | null>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerShowAll, setLedgerShowAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/employees?includeInactive=1");
      if (!res.ok) throw new Error("Laden fehlgeschlagen");
      const j = await res.json();
      setEmployees(j.employees ?? []);
    } catch {
      setMsg("Mitarbeiter konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadConsistency = useCallback(async () => {
    try {
      const res = await fetch("/api/consistency", { cache: "no-store" });
      if (!res.ok) return;
      setConsistency((await res.json()) as ConsistencyPayload);
    } catch {
      /* Abgleich ist optional — Seite bleibt nutzbar */
    }
  }, []);

  useEffect(() => {
    void load();
    void loadConsistency();
  }, [load, loadConsistency]);

  async function toggleLedger(empId: string) {
    if (ledgerOpenId === empId) {
      setLedgerOpenId(null);
      setLedgerData(null);
      return;
    }
    setLedgerOpenId(empId);
    setLedgerData(null);
    setLedgerShowAll(false);
    setLedgerLoading(true);
    try {
      const res = await fetch(`/api/employees/${empId}/vacation-ledger`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setMsg("Urlaubs-Verlauf konnte nicht geladen werden.");
        setLedgerOpenId(null);
        return;
      }
      setLedgerData((await res.json()) as LedgerPayload);
    } catch {
      setMsg("Urlaubs-Verlauf konnte nicht geladen werden.");
      setLedgerOpenId(null);
    } finally {
      setLedgerLoading(false);
    }
  }

  async function createEmployee(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const startBalanceHours = parseSignedDecimal(form.startBalanceHours);
    const vacationDaysOpen = parseSignedDecimal(form.vacationDaysOpen);
    if (startBalanceHours === null || vacationDaysOpen === null) {
      setMsg(
        "Startsaldo ZAG oder offener Urlaub: bitte gültige Zahl eingeben (Minus und Dezimalstellen erlaubt)."
      );
      return;
    }
    const res = await fetch("/api/employees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        personalNumber: form.personalNumber,
        entryDate: form.entryDate.trim() || null,
        exitDate: form.exitDate.trim() || null,
        workSite: form.workSite,
        contractHoursPerWeek: form.contractHoursPerWeek,
        workDaysPerWeek: form.workDaysPerWeek,
        startBalanceHours,
        vacationDaysOpen,
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(j.error ?? "Anlegen fehlgeschlagen.");
      return;
    }
    setForm(emptyForm);
    setCreating(false);
    setMsg("Mitarbeiter angelegt.");
    await load();
  }

  function startEdit(emp: Employee) {
    setEditId(emp.id);
    const today = new Date().toISOString().slice(0, 10);
    const contracts = emp.contracts ?? [];
    let cur: ContractSlice | undefined;
    if (contracts.length > 0) {
      const sorted = [...contracts].sort((a, b) =>
        normIsoDate(a.effectiveFrom).localeCompare(normIsoDate(b.effectiveFrom))
      );
      cur = sorted[0];
      for (const c of sorted) {
        if (normIsoDate(c.effectiveFrom) <= today) cur = c;
      }
    }
    setEditForm({
      name: emp.name,
      personalNumber: emp.personalNumber ?? "",
      entryDate:
        typeof emp.entryDate === "string"
          ? emp.entryDate.slice(0, 10)
          : emp.entryDate
            ? new Date(emp.entryDate).toISOString().slice(0, 10)
            : "",
      exitDate:
        typeof emp.exitDate === "string"
          ? emp.exitDate.slice(0, 10)
          : emp.exitDate
            ? new Date(emp.exitDate).toISOString().slice(0, 10)
            : "",
      workSite: emp.workSite,
      contractHoursPerWeek: cur?.contractHoursPerWeek ?? emp.contractHoursPerWeek,
      workDaysPerWeek: cur?.workDaysPerWeek ?? emp.workDaysPerWeek,
      startBalanceHours: numToInputString(emp.startBalanceHours),
      vacationDaysOpen: numToInputString(emp.vacationDaysOpen),
      contractChangeFrom: "",
      contractChangeHours: 30,
      contractChangeDays: 5,
    });
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editId) return;
    setMsg(null);
    const startBalanceHours = parseSignedDecimal(editForm.startBalanceHours);
    const vacationDaysOpen = parseSignedDecimal(editForm.vacationDaysOpen);
    if (startBalanceHours === null || vacationDaysOpen === null) {
      setMsg(
        "Startsaldo ZAG oder offener Urlaub: bitte gültige Zahl eingeben (Minus und Dezimalstellen erlaubt)."
      );
      return;
    }
    if (editForm.contractChangeFrom.trim()) {
      const d = editForm.contractChangeFrom.trim();
      if (!/^\d{4}-\d{2}-01$/.test(d)) {
        setMsg(
          "Vertragswechsel: Datum muss der 1. eines Monats sein (z. B. 2025-04-01)."
        );
        return;
      }
    }
    const payload: Record<string, unknown> = {
      name: editForm.name,
      personalNumber: editForm.personalNumber,
      workSite: editForm.workSite,
      contractHoursPerWeek: editForm.contractHoursPerWeek,
      workDaysPerWeek: editForm.workDaysPerWeek,
      startBalanceHours,
      vacationDaysOpen,
      entryDate: editForm.entryDate.trim() || null,
      exitDate: editForm.exitDate.trim() || null,
    };
    if (editForm.contractChangeFrom.trim()) {
      payload.contractChange = {
        effectiveFrom: editForm.contractChangeFrom.trim(),
        contractHoursPerWeek: editForm.contractChangeHours,
        workDaysPerWeek: editForm.contractChangeDays,
      };
    }
    const res = await fetch(`/api/employees/${editId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(j.error ?? "Speichern fehlgeschlagen.");
      return;
    }
    setEditId(null);
    setMsg("Gespeichert.");
    await load();
  }

  async function deactivate(id: string) {
    if (!confirm("Mitarbeiter deaktivieren? Er erscheint nicht mehr im Dienstplan.")) return;
    setMsg(null);
    const res = await fetch(`/api/employees/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: false }),
    });
    if (!res.ok) {
      setMsg("Deaktivieren fehlgeschlagen.");
      return;
    }
    setMsg("Deaktiviert.");
    await load();
  }

  async function reactivate(id: string) {
    setMsg(null);
    const res = await fetch(`/api/employees/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: true }),
    });
    if (!res.ok) {
      setMsg("Reaktivieren fehlgeschlagen.");
      return;
    }
    setMsg("Wieder aktiv.");
    await load();
  }

  async function deleteContractRow(employeeId: string, contractId: string) {
    if (
      !confirm(
        "Diesen Vertragsstand wirklich entfernen? Die Historie wird angepasst."
      )
    ) {
      return;
    }
    setMsg(null);
    setContractDeletingId(contractId);
    try {
      const res = await fetch(
        `/api/employees/${employeeId}/contracts/${contractId}`,
        { method: "DELETE" }
      );
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setMsg(j.error ?? "Vertragsstand konnte nicht gelöscht werden.");
        return;
      }
      setMsg("Vertragsstand entfernt.");
      await load();
    } finally {
      setContractDeletingId(null);
    }
  }

  async function deleteEmployeePermanent(id: string, name: string) {
    if (
      !confirm(
        `Mitarbeiter „${name}“ endgültig löschen?\n\nAlle zugehörigen Dienstplan-Zellen und Kontoeinträge werden unwiderruflich entfernt.`
      )
    ) {
      return;
    }
    setMsg(null);
    setEmployeeDeletingId(id);
    try {
      const res = await fetch(`/api/employees/${id}`, { method: "DELETE" });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setMsg(j.error ?? "Löschen fehlgeschlagen.");
        return;
      }
      if (editId === id) setEditId(null);
      setMsg("Mitarbeiter gelöscht.");
      await load();
    } finally {
      setEmployeeDeletingId(null);
    }
  }

  function siteLabel(v: WorkSiteVal) {
    return SITE_OPTIONS.find((o) => o.value === v)?.label ?? v;
  }

  return (
    <div className="min-h-screen p-4 md:p-6">
      <header className="mb-6 flex flex-col gap-3 border-b border-slate-200 pb-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Mitarbeiter</h1>
          <p className="text-sm text-slate-500">Stammdaten für den Dienstplan</p>
        </div>
        <div className="flex w-full flex-col gap-2 md:w-auto">
          <AppNavLinks
            links={[
              { href: "/feiertage", label: "Feiertage & Ferien" },
              { href: "/dienstplan", label: "Zum Dienstplan" },
              { href: "/monatsuebersicht", label: "Monatsübersicht" },
            ]}
          />
          <button
            type="button"
            onClick={() => {
              setCreating((c) => !c);
              setEditId(null);
            }}
            className="touch-target w-full rounded-lg bg-[var(--rota-header)] px-3 py-2 text-sm font-medium text-white md:w-auto md:py-1.5"
          >
            {creating ? "Abbrechen" : "Neuer Mitarbeiter"}
          </button>
        </div>
      </header>

      {msg && <p className="mb-3 text-sm text-slate-700">{msg}</p>}

      {consistency && (
        consistency.issues.length === 0 ? (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-900">
            <span aria-hidden>✓</span>
            <span>
              <strong>Alle Konten konsistent.</strong> Urlaubs-Journal = Dienstplan
              und Zeitkonto = Wochenberechnung, geprüft für {consistency.employees}{" "}
              Mitarbeiter ({new Date(consistency.checkedAt).toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" })} Uhr).
            </span>
          </div>
        ) : (
          <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-950">
            <p className="font-semibold">
              ⚠ {consistency.issues.length} Abweichung
              {consistency.issues.length === 1 ? "" : "en"} zwischen Journal,
              Dienstplan und Zeitkonto — bitte prüfen:
            </p>
            <ul className="mt-1 list-inside list-disc">
              {consistency.issues.map((i, idx) => (
                <li key={idx}>
                  <strong>{i.employee}</strong>: {i.text}
                </li>
              ))}
            </ul>
          </div>
        )
      )}

      {creating && (
        <form
          onSubmit={createEmployee}
          className="mb-8 grid max-w-3xl gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-2"
        >
          <h2 className="md:col-span-2 text-sm font-semibold text-slate-800">
            Neuer Mitarbeiter
          </h2>
          <Field label="Name">
            <input
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full rounded border border-slate-300 px-2 py-1.5 mobile-input"
            />
          </Field>
          <Field label="Personalnummer">
            <input
              value={form.personalNumber}
              onChange={(e) =>
                setForm((f) => ({ ...f, personalNumber: e.target.value }))
              }
              className="w-full rounded border border-slate-300 px-2 py-1.5 mobile-input"
              placeholder="z. B. 98992"
            />
          </Field>
          <Field label="Eintritt">
            <input
              type="date"
              value={form.entryDate}
              onChange={(e) => setForm((f) => ({ ...f, entryDate: e.target.value }))}
              className="w-full rounded border border-slate-300 px-2 py-1.5 mobile-input"
            />
          </Field>
          <Field label="Austritt">
            <input
              type="date"
              value={form.exitDate}
              onChange={(e) => setForm((f) => ({ ...f, exitDate: e.target.value }))}
              className="w-full rounded border border-slate-300 px-2 py-1.5 mobile-input"
            />
          </Field>
          <Field label="Standort">
            <select
              value={form.workSite}
              onChange={(e) =>
                setForm((f) => ({ ...f, workSite: e.target.value as WorkSiteVal }))
              }
              className="w-full rounded border border-slate-300 px-2 py-1.5 mobile-input"
            >
              {SITE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Vertragsstunden / Woche">
            <input
              type="number"
              step="0.5"
              min={0}
              required
              value={form.contractHoursPerWeek}
              onChange={(e) =>
                setForm((f) => ({ ...f, contractHoursPerWeek: Number(e.target.value) }))
              }
              className="w-full rounded border border-slate-300 px-2 py-1.5 mobile-input"
            />
          </Field>
          <Field label="Arbeitstage / Woche">
            <input
              type="number"
              min={1}
              max={7}
              required
              value={form.workDaysPerWeek}
              onChange={(e) =>
                setForm((f) => ({ ...f, workDaysPerWeek: Number(e.target.value) }))
              }
              className="w-full rounded border border-slate-300 px-2 py-1.5 mobile-input"
            />
          </Field>
          <Field label="Startsaldo ZAG (Std.)">
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={form.startBalanceHours}
              onChange={(e) =>
                setForm((f) => ({ ...f, startBalanceHours: e.target.value }))
              }
              placeholder="z. B. -12,5"
              className="w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-sm tabular-nums"
            />
          </Field>
          <Field label="Offener Urlaub (Tage)">
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={form.vacationDaysOpen}
              onChange={(e) =>
                setForm((f) => ({ ...f, vacationDaysOpen: e.target.value }))
              }
              placeholder="z. B. -0,25"
              className="w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-sm tabular-nums"
            />
          </Field>
          <Field label="Jahresurlaub (Tage/Jahr, automatisch)">
            <div
              className="w-full rounded border border-dashed border-slate-200 bg-slate-50 px-2 py-1.5 text-sm tabular-nums text-slate-700"
              title="5 Urlaubswochen × min(Arbeitstage/Woche, 6)"
            >
              {fmtDec2.format(
                annualVacationDaysFromWorkDaysPerWeek(form.workDaysPerWeek)
              )}
            </div>
          </Field>
          <div className="md:col-span-2">
            <button
              type="submit"
              className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white"
            >
              Anlegen
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-slate-500">Lade…</p>
      ) : (
        <div className="table-scroll-x table-scroll-hint rounded-xl border border-slate-200 bg-white shadow-sm">
          <p className="px-3 py-2 text-xs text-slate-500 md:hidden">
            Tabelle horizontal wischen.
          </p>
          <table className="min-w-[800px] w-full border-collapse text-sm">
            <thead>
              <tr className="bg-slate-100 text-left">
                <th className="border border-slate-200 px-2 py-2">Name</th>
                <th className="border border-slate-200 px-2 py-2">Pers.-Nr.</th>
                <th className="border border-slate-200 px-2 py-2">Standort</th>
                <th className="border border-slate-200 px-2 py-2">Std/W</th>
                <th className="border border-slate-200 px-2 py-2">Tage</th>
                <th className="border border-slate-200 px-2 py-2">Start ZAG</th>
                <th className="border border-slate-200 px-2 py-2">o. U.</th>
                <th className="border border-slate-200 px-2 py-2" title="Jahresurlaub Arbeitstage">
                  JUrl
                </th>
                <th className="border border-slate-200 px-2 py-2">Aktiv</th>
                <th className="border border-slate-200 px-2 py-2">Aktion</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <Fragment key={emp.id}>
                  <tr className={emp.active ? "" : "bg-slate-50 text-slate-500"}>
                    <td className="border border-slate-200 px-2 py-1 font-medium">{emp.name}</td>
                    <td className="border border-slate-200 px-2 py-1 tabular-nums">
                      {emp.personalNumber ?? "—"}
                    </td>
                    <td className="border border-slate-200 px-2 py-1">{siteLabel(emp.workSite)}</td>
                    <td className="border border-slate-200 px-2 py-1 tabular-nums">
                      {emp.contractHoursPerWeek}
                    </td>
                    <td className="border border-slate-200 px-2 py-1">{emp.workDaysPerWeek}</td>
                    <td className="border border-slate-200 px-2 py-1 tabular-nums">
                      {fmtDec2.format(emp.startBalanceHours)}
                    </td>
                    <td className="border border-slate-200 px-2 py-1 tabular-nums">
                      {fmtDec2.format(emp.vacationDaysOpen)}
                    </td>
                    <td className="border border-slate-200 px-2 py-1 tabular-nums">
                      {fmtDec2.format(
                        annualVacationDaysFromWorkDaysPerWeek(emp.workDaysPerWeek)
                      )}
                    </td>
                    <td className="border border-slate-200 px-2 py-1">
                      {emp.active ? "Ja" : "Nein"}
                    </td>
                    <td className="border border-slate-200 px-2 py-1">
                      <div className="flex flex-col gap-1 md:flex-row md:flex-wrap md:items-center md:gap-x-2 md:gap-y-1">
                        <button
                          type="button"
                          onClick={() => startEdit(emp)}
                          className="rounded-lg border border-slate-200 px-2 py-1.5 text-left text-sm text-[var(--rota-header)] hover:bg-slate-50 md:border-0 md:p-0 md:hover:underline"
                        >
                          Bearbeiten
                        </button>
                        <button
                          type="button"
                          onClick={() => void toggleLedger(emp.id)}
                          className="rounded-lg border border-slate-200 px-2 py-1.5 text-left text-sm text-emerald-700 hover:bg-emerald-50 md:border-0 md:p-0 md:hover:underline"
                        >
                          {ledgerOpenId === emp.id ? "Verlauf zuklappen" : "Urlaubs-Verlauf"}
                        </button>
                        {emp.active ? (
                          <button
                            type="button"
                            onClick={() => void deactivate(emp.id)}
                            className="rounded-lg border border-slate-200 px-2 py-1.5 text-left text-sm text-red-600 hover:bg-red-50 md:border-0 md:p-0 md:hover:underline"
                          >
                            Deaktivieren
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void reactivate(emp.id)}
                            className="rounded-lg border border-slate-200 px-2 py-1.5 text-left text-sm text-green-700 hover:bg-green-50 md:border-0 md:p-0 md:hover:underline"
                          >
                            Aktivieren
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={employeeDeletingId === emp.id}
                          onClick={() => void deleteEmployeePermanent(emp.id, emp.name)}
                          className="touch-target inline-flex shrink-0 items-center justify-center rounded border border-slate-200 bg-white text-lg font-light leading-none text-red-600 hover:border-red-200 hover:bg-red-50 disabled:opacity-40 md:h-6 md:w-6 md:text-[15px]"
                          title="Endgültig löschen"
                          aria-label={`${emp.name} endgültig löschen`}
                        >
                          ×
                        </button>
                      </div>
                    </td>
                  </tr>
                  {ledgerOpenId === emp.id && (
                    <tr>
                      <td colSpan={10} className="border border-slate-200 bg-emerald-50/30 p-4">
                        {ledgerLoading || !ledgerData ? (
                          <p className="text-sm text-slate-500">Lade Verlauf…</p>
                        ) : (
                          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 border-b border-slate-200 px-4 py-2.5">
                              <span className="text-base font-bold text-slate-900">
                                {ledgerData.employee.name}
                              </span>
                              <span className="text-xl font-extrabold tabular-nums text-slate-900">
                                {fmtDec2.format(ledgerData.employee.vacationDaysOpen)}{" "}
                                <span className="text-xs font-medium text-slate-500">Tage offen</span>
                              </span>
                              <span className="text-xs text-slate-500">
                                Jahresanspruch {fmtDec2.format(ledgerData.employee.annualVacationDays)} T ·
                                Gutschrift {fmtDec2.format(ledgerData.employee.monthlyAccrual)} T/Monat
                              </span>
                              <span
                                className={`ml-auto rounded-full border px-2.5 py-0.5 text-xs ${
                                  ledgerData.check.ok
                                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                    : "border-amber-300 bg-amber-50 text-amber-900"
                                }`}
                              >
                                {ledgerData.check.ok
                                  ? "✓ Journal = Dienstplan"
                                  : `⚠ Abweichung ${fmtDec2.format(Math.abs(ledgerData.check.journalDiff || ledgerData.check.saldoDiff))} T`}
                              </span>
                            </div>
                            <div className="overflow-x-auto">
                              <table className="w-full border-collapse text-sm">
                                <thead>
                                  <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                                    <th className="border-b-2 border-slate-300 px-4 py-2">Datum</th>
                                    <th className="border-b-2 border-slate-300 px-4 py-2">Art</th>
                                    <th className="border-b-2 border-slate-300 px-4 py-2">Grund</th>
                                    <th className="border-b-2 border-slate-300 px-4 py-2 text-right">Tage</th>
                                    <th className="border-b-2 border-slate-300 px-4 py-2 text-right">Saldo danach</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(ledgerShowAll
                                    ? ledgerData.rows
                                    : ledgerData.rows.slice(0, 10)
                                  ).map((r, i) => (
                                    <tr key={i} className="align-top">
                                      <td className="border-b border-slate-100 px-4 py-1.5 whitespace-nowrap">
                                        {deDate(r.dateISO)}
                                      </td>
                                      <td className="border-b border-slate-100 px-4 py-1.5">
                                        <span
                                          className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-bold ${LEDGER_CHIP[r.ui]}`}
                                        >
                                          {r.label}
                                        </span>
                                      </td>
                                      <td className="border-b border-slate-100 px-4 py-1.5 text-xs text-slate-600">
                                        {r.note || "—"}
                                      </td>
                                      <td
                                        className={`border-b border-slate-100 px-4 py-1.5 text-right font-semibold tabular-nums ${
                                          r.amount >= 0 ? "text-emerald-700" : "text-rose-700"
                                        }`}
                                      >
                                        {r.amount >= 0 ? "+" : ""}
                                        {fmtDec2.format(r.amount)}
                                      </td>
                                      <td className="border-b border-slate-100 px-4 py-1.5 text-right tabular-nums">
                                        {fmtDec2.format(r.balanceAfter)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            {ledgerData.rows.length > 10 && (
                              <div className="px-4 py-2 text-sm text-slate-500">
                                <button
                                  type="button"
                                  className="rounded-lg border border-slate-300 px-2.5 py-1 text-sm text-slate-700 hover:bg-slate-50"
                                  onClick={() => setLedgerShowAll((s) => !s)}
                                >
                                  {ledgerShowAll
                                    ? "Weniger anzeigen"
                                    : `Alle ${ledgerData.rows.length} Buchungen anzeigen`}
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                  {editId === emp.id && (
                    <tr>
                      <td colSpan={10} className="border border-slate-200 bg-amber-50/50 p-4">
                        <form
                          onSubmit={saveEdit}
                          className="grid gap-3 md:grid-cols-2 lg:grid-cols-3"
                        >
                          <Field label="Name">
                            <input
                              required
                              value={editForm.name}
                              onChange={(e) =>
                                setEditForm((f) => ({ ...f, name: e.target.value }))
                              }
                              className="w-full rounded border border-slate-300 px-2 py-1.5 mobile-input"
                            />
                          </Field>
                          <Field label="Personalnummer">
                            <input
                              value={editForm.personalNumber}
                              onChange={(e) =>
                                setEditForm((f) => ({
                                  ...f,
                                  personalNumber: e.target.value,
                                }))
                              }
                              className="w-full rounded border border-slate-300 px-2 py-1.5 mobile-input"
                            />
                          </Field>
                          <Field label="Eintritt">
                            <input
                              type="date"
                              value={editForm.entryDate}
                              onChange={(e) =>
                                setEditForm((f) => ({ ...f, entryDate: e.target.value }))
                              }
                              className="w-full rounded border border-slate-300 px-2 py-1.5 mobile-input"
                            />
                          </Field>
                          <Field label="Austritt">
                            <input
                              type="date"
                              value={editForm.exitDate}
                              onChange={(e) =>
                                setEditForm((f) => ({ ...f, exitDate: e.target.value }))
                              }
                              className="w-full rounded border border-slate-300 px-2 py-1.5 mobile-input"
                            />
                          </Field>
                          <Field label="Standort">
                            <select
                              value={editForm.workSite}
                              onChange={(e) =>
                                setEditForm((f) => ({
                                  ...f,
                                  workSite: e.target.value as WorkSiteVal,
                                }))
                              }
                              className="w-full rounded border border-slate-300 px-2 py-1.5 mobile-input"
                            >
                              {SITE_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label="Vertragsstunden / Woche">
                            <input
                              type="number"
                              step="0.5"
                              min={0}
                              value={editForm.contractHoursPerWeek}
                              onChange={(e) =>
                                setEditForm((f) => ({
                                  ...f,
                                  contractHoursPerWeek: Number(e.target.value),
                                }))
                              }
                              className="w-full rounded border border-slate-300 px-2 py-1.5 mobile-input"
                            />
                          </Field>
                          <Field label="Arbeitstage / Woche">
                            <input
                              type="number"
                              min={1}
                              max={7}
                              value={editForm.workDaysPerWeek}
                              onChange={(e) =>
                                setEditForm((f) => ({
                                  ...f,
                                  workDaysPerWeek: Number(e.target.value),
                                }))
                              }
                              className="w-full rounded border border-slate-300 px-2 py-1.5 mobile-input"
                            />
                          </Field>
                          {emp.contracts && emp.contracts.length > 0 && (
                            <div className="md:col-span-2 lg:col-span-3 rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                              <p className="font-semibold text-slate-800">Vertragsstände (Historie)</p>
                              <ul className="mt-1 space-y-0.5">
                                {[...emp.contracts]
                                  .sort((a, b) =>
                                    normIsoDate(a.effectiveFrom).localeCompare(
                                      normIsoDate(b.effectiveFrom)
                                    )
                                  )
                                  .map((c) => {
                                    const cid = c.id;
                                    return (
                                      <li
                                        key={cid ?? normIsoDate(c.effectiveFrom)}
                                        className="flex flex-wrap items-center gap-1.5"
                                      >
                                        <span>
                                          ab {isoDateToDE(c.effectiveFrom)}:{" "}
                                          {c.contractHoursPerWeek} h / {c.workDaysPerWeek} T
                                        </span>
                                        {cid ? (
                                          <button
                                            type="button"
                                            disabled={contractDeletingId === cid}
                                            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-slate-200 bg-white text-[15px] font-light leading-none text-red-600 hover:border-red-200 hover:bg-red-50 disabled:opacity-40"
                                            title="Vertragsstand entfernen"
                                            aria-label="Vertragsstand entfernen"
                                            onClick={() =>
                                              void deleteContractRow(emp.id, cid)
                                            }
                                          >
                                            ×
                                          </button>
                                        ) : null}
                                      </li>
                                    );
                                  })}
                              </ul>
                            </div>
                          )}
                          <div className="md:col-span-2 lg:col-span-3 rounded border border-dashed border-slate-300 bg-slate-50/80 px-3 py-2">
                            <p className="mb-2 text-xs font-semibold text-slate-800">
                              Geplanter Vertragswechsel (optional)
                            </p>
                            <p className="mb-2 text-[11px] text-slate-600">
                              Ab dem <strong>1.</strong> eines Monats — zusätzliche Zeile; Dienstplan
                              und Konto nutzen ab dann automatisch den neuen Vertrag pro Kalendertag.
                            </p>
                            <div className="grid gap-2 sm:grid-cols-3">
                              <Field label="Gültig ab (1. des Monats)">
                                <input
                                  type="date"
                                  value={editForm.contractChangeFrom}
                                  onChange={(e) =>
                                    setEditForm((f) => ({
                                      ...f,
                                      contractChangeFrom: e.target.value,
                                    }))
                                  }
                                  className="w-full rounded border border-slate-300 px-2 py-1.5 mobile-input"
                                />
                              </Field>
                              <Field label="Neu: Std./Woche">
                                <input
                                  type="number"
                                  step="0.5"
                                  min={0}
                                  value={editForm.contractChangeHours}
                                  onChange={(e) =>
                                    setEditForm((f) => ({
                                      ...f,
                                      contractChangeHours: Number(e.target.value),
                                    }))
                                  }
                                  className="w-full rounded border border-slate-300 px-2 py-1.5 mobile-input"
                                />
                              </Field>
                              <Field label="Neu: Tage/Woche">
                                <input
                                  type="number"
                                  min={1}
                                  max={7}
                                  value={editForm.contractChangeDays}
                                  onChange={(e) =>
                                    setEditForm((f) => ({
                                      ...f,
                                      contractChangeDays: Number(e.target.value),
                                    }))
                                  }
                                  className="w-full rounded border border-slate-300 px-2 py-1.5 mobile-input"
                                />
                              </Field>
                            </div>
                          </div>
                          <Field label="Startsaldo ZAG (Std.)">
                            <input
                              type="text"
                              inputMode="decimal"
                              autoComplete="off"
                              value={editForm.startBalanceHours}
                              onChange={(e) =>
                                setEditForm((f) => ({
                                  ...f,
                                  startBalanceHours: e.target.value,
                                }))
                              }
                              placeholder="z. B. -12,5"
                              className="w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-sm tabular-nums"
                            />
                          </Field>
                          <Field label="Offener Urlaub (Tage)">
                            <input
                              type="text"
                              inputMode="decimal"
                              autoComplete="off"
                              value={editForm.vacationDaysOpen}
                              onChange={(e) =>
                                setEditForm((f) => ({
                                  ...f,
                                  vacationDaysOpen: e.target.value,
                                }))
                              }
                              placeholder="z. B. -0,25"
                              className="w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-sm tabular-nums"
                            />
                          </Field>
                          <Field label="Jahresurlaub (Tage/Jahr, automatisch)">
                            <div
                              className="w-full rounded border border-dashed border-slate-200 bg-slate-50 px-2 py-1.5 text-sm tabular-nums text-slate-700"
                              title="5 Urlaubswochen × min(Arbeitstage/Woche, 6)"
                            >
                              {fmtDec2.format(
                                annualVacationDaysFromWorkDaysPerWeek(
                                  editForm.workDaysPerWeek
                                )
                              )}
                            </div>
                          </Field>
                          <div className="flex items-end gap-2 md:col-span-2 lg:col-span-3">
                            <button
                              type="submit"
                              className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-white"
                            >
                              Speichern
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditId(null)}
                              className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
                            >
                              Abbrechen
                            </button>
                          </div>
                        </form>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      <div className="mt-0.5">{children}</div>
    </label>
  );
}
