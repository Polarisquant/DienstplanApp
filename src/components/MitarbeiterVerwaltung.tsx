"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useState } from "react";

type WorkSiteVal = "CRUSH" | "CAPPUCONE" | "SHARED";

type Employee = {
  id: string;
  name: string;
  workSite: WorkSiteVal;
  contractHoursPerWeek: number;
  workDaysPerWeek: number;
  startBalanceHours: number;
  vacationDaysOpen: number;
  active: boolean;
};

const emptyForm = {
  name: "",
  workSite: "SHARED" as WorkSiteVal,
  contractHoursPerWeek: 40,
  workDaysPerWeek: 5,
  startBalanceHours: 0,
  vacationDaysOpen: 0,
};

const SITE_OPTIONS: { value: WorkSiteVal; label: string }[] = [
  { value: "CRUSH", label: "Crush" },
  { value: "CAPPUCONE", label: "CappuCone" },
  { value: "SHARED", label: "Geteilt (beide Standorte)" },
];

export function MitarbeiterVerwaltung() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(emptyForm);

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
    const res = await fetch("/api/employees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
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
    setEditForm({
      name: emp.name,
      workSite: emp.workSite,
      contractHoursPerWeek: emp.contractHoursPerWeek,
      workDaysPerWeek: emp.workDaysPerWeek,
      startBalanceHours: emp.startBalanceHours,
      vacationDaysOpen: emp.vacationDaysOpen,
    });
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editId) return;
    setMsg(null);
    const res = await fetch(`/api/employees/${editId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editForm),
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
            Feiertage
          </Link>
          <Link
            href="/dienstplan"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Zum Dienstplan
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
              type="number"
              step="0.1"
              value={form.startBalanceHours}
              onChange={(e) =>
                setForm((f) => ({ ...f, startBalanceHours: Number(e.target.value) }))
              }
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            />
          </Field>
          <Field label="Offener Urlaub (Tage)">
            <input
              type="number"
              step="0.5"
              min={0}
              value={form.vacationDaysOpen}
              onChange={(e) =>
                setForm((f) => ({ ...f, vacationDaysOpen: Number(e.target.value) }))
              }
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            />
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
                <th className="border border-slate-200 px-2 py-2">Standort</th>
                <th className="border border-slate-200 px-2 py-2">Std/W</th>
                <th className="border border-slate-200 px-2 py-2">Tage</th>
                <th className="border border-slate-200 px-2 py-2">Start ZAG</th>
                <th className="border border-slate-200 px-2 py-2">o. U.</th>
                <th className="border border-slate-200 px-2 py-2">Aktiv</th>
                <th className="border border-slate-200 px-2 py-2">Aktion</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <Fragment key={emp.id}>
                  <tr className={emp.active ? "" : "bg-slate-50 text-slate-500"}>
                    <td className="border border-slate-200 px-2 py-1 font-medium">{emp.name}</td>
                    <td className="border border-slate-200 px-2 py-1">{siteLabel(emp.workSite)}</td>
                    <td className="border border-slate-200 px-2 py-1 tabular-nums">
                      {emp.contractHoursPerWeek}
                    </td>
                    <td className="border border-slate-200 px-2 py-1">{emp.workDaysPerWeek}</td>
                    <td className="border border-slate-200 px-2 py-1 tabular-nums">
                      {emp.startBalanceHours}
                    </td>
                    <td className="border border-slate-200 px-2 py-1 tabular-nums">
                      {emp.vacationDaysOpen}
                    </td>
                    <td className="border border-slate-200 px-2 py-1">
                      {emp.active ? "Ja" : "Nein"}
                    </td>
                    <td className="border border-slate-200 px-2 py-1">
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          onClick={() => startEdit(emp)}
                          className="text-[var(--rota-header)] hover:underline"
                        >
                          Bearbeiten
                        </button>
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
                      </div>
                    </td>
                  </tr>
                  {editId === emp.id && (
                    <tr>
                      <td colSpan={8} className="border border-slate-200 bg-amber-50/50 p-4">
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
                          <Field label="Startsaldo ZAG (Std.)">
                            <input
                              type="number"
                              step="0.1"
                              value={editForm.startBalanceHours}
                              onChange={(e) =>
                                setEditForm((f) => ({
                                  ...f,
                                  startBalanceHours: Number(e.target.value),
                                }))
                              }
                              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                            />
                          </Field>
                          <Field label="Offener Urlaub (Tage)">
                            <input
                              type="number"
                              step="0.5"
                              min={0}
                              value={editForm.vacationDaysOpen}
                              onChange={(e) =>
                                setEditForm((f) => ({
                                  ...f,
                                  vacationDaysOpen: Number(e.target.value),
                                }))
                              }
                              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                            />
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
