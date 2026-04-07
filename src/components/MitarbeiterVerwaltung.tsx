"use client";

import Link from "next/link";
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

  useEffect(() => {
    void load();
  }, [load]);

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
        <div className="flex flex-wrap gap-2">
          <Link
            href="/feiertage"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Feiertage &amp; Ferien
          </Link>
          <Link
            href="/dienstplan"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Zum Dienstplan
          </Link>
          <Link
            href="/monatsuebersicht"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Monatsübersicht
          </Link>
          <button
            type="button"
            onClick={() => {
              setCreating((c) => !c);
              setEditId(null);
            }}
            className="rounded-lg bg-[var(--rota-header)] px-3 py-1.5 text-sm font-medium text-white"
          >
            {creating ? "Abbrechen" : "Neuer Mitarbeiter"}
          </button>
        </div>
      </header>

      {msg && <p className="mb-3 text-sm text-slate-700">{msg}</p>}

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
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            />
          </Field>
          <Field label="Personalnummer">
            <input
              value={form.personalNumber}
              onChange={(e) =>
                setForm((f) => ({ ...f, personalNumber: e.target.value }))
              }
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
              placeholder="z. B. 98992"
            />
          </Field>
          <Field label="Eintritt">
            <input
              type="date"
              value={form.entryDate}
              onChange={(e) => setForm((f) => ({ ...f, entryDate: e.target.value }))}
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            />
          </Field>
          <Field label="Austritt">
            <input
              type="date"
              value={form.exitDate}
              onChange={(e) => setForm((f) => ({ ...f, exitDate: e.target.value }))}
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            />
          </Field>
          <Field label="Standort">
            <select
              value={form.workSite}
              onChange={(e) =>
                setForm((f) => ({ ...f, workSite: e.target.value as WorkSiteVal }))
              }
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
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
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
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
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
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
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
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
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <button
                          type="button"
                          onClick={() => startEdit(emp)}
                          className="text-[var(--rota-header)] hover:underline"
                        >
                          Bearbeiten
                        </button>
                        <span className="text-slate-300 select-none" aria-hidden>
                          |
                        </span>
                        {emp.active ? (
                          <button
                            type="button"
                            onClick={() => void deactivate(emp.id)}
                            className="text-red-600 hover:underline"
                          >
                            Deaktivieren
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void reactivate(emp.id)}
                            className="text-green-700 hover:underline"
                          >
                            Aktivieren
                          </button>
                        )}
                        <span className="text-slate-300 select-none" aria-hidden>
                          |
                        </span>
                        <button
                          type="button"
                          disabled={employeeDeletingId === emp.id}
                          onClick={() => void deleteEmployeePermanent(emp.id, emp.name)}
                          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-slate-200 bg-white text-[15px] font-light leading-none text-red-600 hover:border-red-200 hover:bg-red-50 disabled:opacity-40"
                          title="Endgültig löschen"
                          aria-label={`${emp.name} endgültig löschen`}
                        >
                          ×
                        </button>
                      </div>
                    </td>
                  </tr>
                  {editId === emp.id && (
                    <tr>
                      <td colSpan={9} className="border border-slate-200 bg-amber-50/50 p-4">
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
                              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
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
                              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                            />
                          </Field>
                          <Field label="Eintritt">
                            <input
                              type="date"
                              value={editForm.entryDate}
                              onChange={(e) =>
                                setEditForm((f) => ({ ...f, entryDate: e.target.value }))
                              }
                              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                            />
                          </Field>
                          <Field label="Austritt">
                            <input
                              type="date"
                              value={editForm.exitDate}
                              onChange={(e) =>
                                setEditForm((f) => ({ ...f, exitDate: e.target.value }))
                              }
                              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
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
                              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
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
                              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
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
                              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
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
                                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
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
                                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
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
                                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
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
