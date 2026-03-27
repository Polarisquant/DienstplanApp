import { prisma } from "@/lib/prisma";
import type { ContractRow } from "@/lib/employeeContract";
import { contractForDate } from "@/lib/employeeContract";
import {
  firstContractEffectiveFromISO,
  firstContractEffectiveFromNoonUTC,
  LEGACY_CONTRACT_ANCHOR_ISO,
  toIsoDate,
} from "@/lib/firstContractDate";

function toRow(r: {
  effectiveFrom: Date;
  contractHoursPerWeek: number;
  workDaysPerWeek: number;
}): ContractRow {
  const iso =
    r.effectiveFrom instanceof Date
      ? r.effectiveFrom.toISOString().slice(0, 10)
      : String(r.effectiveFrom).slice(0, 10);
  return {
    effectiveFrom: iso,
    contractHoursPerWeek: r.contractHoursPerWeek,
    workDaysPerWeek: r.workDaysPerWeek,
  };
}

/**
 * Lädt alle Vertragszeilen; legt bei fehlender Historie eine Zeile aus dem Employee-Stamm an.
 */
export async function contractRowsMapForEmployees(
  employeeIds: string[]
): Promise<Map<string, ContractRow[]>> {
  const map = new Map<string, ContractRow[]>();
  if (employeeIds.length === 0) return map;

  const existing = await prisma.employeeContract.findMany({
    where: { employeeId: { in: employeeIds } },
    orderBy: { effectiveFrom: "asc" },
  });
  for (const id of employeeIds) {
    map.set(id, []);
  }
  for (const r of existing) {
    const arr = map.get(r.employeeId) ?? [];
    arr.push(toRow(r));
    map.set(r.employeeId, arr);
  }

  const missing = employeeIds.filter((id) => (map.get(id)?.length ?? 0) === 0);
  if (missing.length === 0) return map;

  const emps = await prisma.employee.findMany({
    where: { id: { in: missing } },
  });
  for (const e of emps) {
    const from = firstContractEffectiveFromNoonUTC(e.entryDate);
    const fromIso = firstContractEffectiveFromISO(e.entryDate);
    await prisma.employeeContract.create({
      data: {
        employeeId: e.id,
        effectiveFrom: from,
        contractHoursPerWeek: e.contractHoursPerWeek,
        workDaysPerWeek: e.workDaysPerWeek,
      },
    });
    map.set(e.id, [
      {
        effectiveFrom: fromIso,
        contractHoursPerWeek: e.contractHoursPerWeek,
        workDaysPerWeek: e.workDaysPerWeek,
      },
    ]);
  }
  return map;
}

/** Aktualisiert die gecachten Felder auf Employee (Anzeige / Legacy) auf den Vertrag von „heute“. */
export async function syncEmployeeContractCache(
  employeeId: string,
  rows: ContractRow[]
): Promise<void> {
  if (rows.length === 0) return;
  const today = new Date().toISOString().slice(0, 10);
  const c = contractForDate(rows, today);
  await prisma.employee.update({
    where: { id: employeeId },
    data: {
      contractHoursPerWeek: c.contractHoursPerWeek,
      workDaysPerWeek: c.workDaysPerWeek,
    },
  });
}

/**
 * Platzhalter-Vertrag 2000-01-01 → ab Eintritt, oder löschen wenn schon eine Zeile am Eintritt existiert.
 */
export async function normalizePlaceholderContractForEmployee(
  employeeId: string
): Promise<void> {
  const e = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { entryDate: true },
  });
  if (!e?.entryDate) return;
  const entryISO = toIsoDate(e.entryDate);
  if (entryISO <= LEGACY_CONTRACT_ANCHOR_ISO) return;

  const rows = await prisma.employeeContract.findMany({
    where: { employeeId },
    orderBy: { effectiveFrom: "asc" },
  });
  const placeholder = rows.find(
    (r) => toIsoDate(r.effectiveFrom) === LEGACY_CONTRACT_ANCHOR_ISO
  );
  if (!placeholder) return;

  const otherAtEntry = rows.some(
    (r) => r.id !== placeholder.id && toIsoDate(r.effectiveFrom) === entryISO
  );
  if (otherAtEntry) {
    await prisma.employeeContract.delete({ where: { id: placeholder.id } });
    return;
  }

  await prisma.employeeContract.update({
    where: { id: placeholder.id },
    data: { effectiveFrom: new Date(`${entryISO}T12:00:00.000Z`) },
  });
}

export async function normalizePlaceholderContractsAll(): Promise<void> {
  const emps = await prisma.employee.findMany({ select: { id: true } });
  await Promise.all(emps.map((x) => normalizePlaceholderContractForEmployee(x.id)));
}

/**
 * Stammdaten mit Vertragshistorie für „heute“ abgleichen, nur wo nötig.
 * Wird bei GET /api/employees ausgeführt — kein manueller Schritt, wenig DB-Schreiblast.
 */
export async function syncEmployeeContractCachesIfStale(): Promise<void> {
  const emps = await prisma.employee.findMany({
    select: { id: true, contractHoursPerWeek: true, workDaysPerWeek: true },
  });
  if (emps.length === 0) return;
  const ids = emps.map((e) => e.id);
  const map = await contractRowsMapForEmployees(ids);
  const today = new Date().toISOString().slice(0, 10);
  for (const e of emps) {
    const rows = map.get(e.id);
    if (!rows?.length) continue;
    const c = contractForDate(rows, today);
    if (
      c.contractHoursPerWeek !== e.contractHoursPerWeek ||
      c.workDaysPerWeek !== e.workDaysPerWeek
    ) {
      await syncEmployeeContractCache(e.id, rows);
    }
  }
}
