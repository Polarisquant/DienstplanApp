import {
  type Prisma,
  type PrismaClient,
  VacationLedgerKind,
} from "@prisma/client";
import { openingEffectiveDateForEmployee } from "@/lib/vacationCutover";
import {
  annualVacationDaysProportional,
  monthlyVacationAccrualFromAnnual,
  prismaDateToISO,
} from "@/lib/vacationAccrualAT";

type Tx = Prisma.TransactionClient;

/**
 * Vormonat als YYYY-MM, nur wenn `runOnUtc` der **1.** eines Kalendermonats ist (UTC).
 * Cron bucht dann den gerade beendeten Monat.
 */
export function accrualPeriodForCronRun(runOnUtc: Date): string | null {
  if (runOnUtc.getUTCDate() !== 1) return null;
  const y = runOnUtc.getUTCFullYear();
  const m = runOnUtc.getUTCMonth();
  const prev = new Date(Date.UTC(y, m - 1, 1));
  const py = prev.getUTCFullYear();
  const pm = String(prev.getUTCMonth() + 1).padStart(2, "0");
  return `${py}-${pm}`;
}

function lastDayISOOfMonth(periodYYYYMM: string): string {
  const [y0, m0] = periodYYYYMM.split("-").map(Number);
  const last = new Date(Date.UTC(y0!, m0!, 0));
  return last.toISOString().slice(0, 10);
}

function periodStartISO(periodYYYYMM: string): string {
  return `${periodYYYYMM}-01`;
}

/** Monatsletzter liegt auf oder nach Eröffnungsstichtag → Monat wird mitgerechnet. */
function periodIsOnOrAfterOpening(periodYYYYMM: string, openingISO: string): boolean {
  return lastDayISOOfMonth(periodYYYYMM) >= openingISO.slice(0, 10);
}

function utcDayIndex(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!) / 86_400_000;
}

/** Kalendertage inkl. Start und Ende (UTC-Datum, keine Sommerzeit). */
export function calendarDaysInclusiveUTC(startISO: string, endISO: string): number {
  const a = utcDayIndex(startISO);
  const b = utcDayIndex(endISO);
  return Math.floor(b - a) + 1;
}

/**
 * Anteil 0–1 für Monats-Gutschrift: Beschäftigung im Kalendermonat schneidet
 * [Eröffnung, Austritt] mit [Monatserster, Monatsletzter].
 * Eintritt Mitte Monat → nur Tage ab Eintritt; Austritt Mitte Monat → nur bis Austritt (inkl.).
 */
export function accrualCalendarProrateFactor(
  periodYYYYMM: string,
  openingISO: string,
  exitISO: string | null
): number {
  const open = openingISO.slice(0, 10);
  const pStart = periodStartISO(periodYYYYMM);
  const pEnd = lastDayISOOfMonth(periodYYYYMM);
  const daysInMonth = calendarDaysInclusiveUTC(pStart, pEnd);

  if (open > pEnd) return 0;

  let winStart = pStart;
  if (open > winStart) winStart = open;

  let winEnd = pEnd;
  if (exitISO) {
    const ex = exitISO.slice(0, 10);
    if (ex < pStart) return 0;
    if (ex < winEnd) winEnd = ex;
  }

  if (winStart > winEnd) return 0;
  const active = calendarDaysInclusiveUTC(winStart, winEnd);
  return active / daysInMonth;
}

/**
 * Buchung + gleicher Betrag auf `Employee.vacationDaysOpen` (Summe Ledger = Saldo).
 */
export async function appendVacationLedger(
  tx: Tx,
  input: {
    employeeId: string;
    amount: number;
    kind: VacationLedgerKind;
    note?: string;
    effectiveDate?: Date;
    accrualPeriod?: string | null;
  }
): Promise<void> {
  const eff = input.effectiveDate ?? new Date();
  const iso = eff.toISOString().slice(0, 10);
  const effNoon = new Date(`${iso}T12:00:00.000Z`);
  await tx.vacationLedger.create({
    data: {
      employeeId: input.employeeId,
      amount: input.amount,
      kind: input.kind,
      note: input.note ?? "",
      effectiveDate: effNoon,
      accrualPeriod: input.accrualPeriod ?? null,
    },
  });
  await tx.employee.update({
    where: { id: input.employeeId },
    data: { vacationDaysOpen: { increment: input.amount } },
  });
}

/**
 * Erste Buchung: festschreiben des aktuellen Saldos ohne Änderung von `vacationDaysOpen`.
 */
export async function ensureVacationOpeningMigration(
  tx: Tx,
  employeeId: string,
  currentBalance: number,
  options?: { openingEffectiveDate?: Date }
): Promise<{ cutoverISO: string }> {
  const existing = await tx.vacationLedger.findFirst({
    where: {
      employeeId,
      kind: VacationLedgerKind.OPENING_MIGRATION,
    },
    orderBy: { createdAt: "asc" },
  });
  if (existing) {
    return { cutoverISO: prismaDateToISO(existing.effectiveDate) };
  }
  const eff = options?.openingEffectiveDate ?? new Date();
  const iso = eff.toISOString().slice(0, 10);
  const effNoon = new Date(`${iso}T12:00:00.000Z`);
  await tx.vacationLedger.create({
    data: {
      employeeId,
      amount: currentBalance,
      kind: VacationLedgerKind.OPENING_MIGRATION,
      note: "Eröffnung / bestehender Saldo",
      effectiveDate: effNoon,
    },
  });
  return { cutoverISO: iso };
}

/**
 * Monatsgutschrift: Jahresurlaub ÷ 12 × **Kalenderanteil** im Abrechnungsmonat
 * (Eintritt nach dem 1. oder Austritt vor Monatsende → anteilig nach Kalendertagen).
 */
export async function applyMonthlyContractAccrualForEmployee(
  tx: Tx,
  emp: {
    id: string;
    active: boolean;
    vacationDaysOpen: number;
    entryDate: Date | null;
    exitDate: Date | null;
    workDaysPerWeek: number;
    contractHoursPerWeek: number;
  },
  periodYYYYMM: string
): Promise<{ posted: number; skipped: boolean }> {
  if (!emp.active) return { posted: 0, skipped: true };

  const pStart = periodStartISO(periodYYYYMM);
  if (emp.exitDate && prismaDateToISO(emp.exitDate) < pStart) {
    return { posted: 0, skipped: true };
  }

  const dup = await tx.vacationLedger.findFirst({
    where: {
      employeeId: emp.id,
      kind: VacationLedgerKind.MONTHLY_CONTRACT_ACCRUAL,
      accrualPeriod: periodYYYYMM,
    },
  });
  if (dup) return { posted: 0, skipped: true };

  const { cutoverISO: openingISO } = await ensureVacationOpeningMigration(
    tx,
    emp.id,
    emp.vacationDaysOpen,
    { openingEffectiveDate: openingEffectiveDateForEmployee(emp.entryDate) }
  );

  if (!periodIsOnOrAfterOpening(periodYYYYMM, openingISO)) {
    return { posted: 0, skipped: true };
  }

  const annual = annualVacationDaysProportional(
    emp.workDaysPerWeek,
    emp.contractHoursPerWeek
  );
  const baseMonth = monthlyVacationAccrualFromAnnual(annual);
  const exitISO = emp.exitDate ? prismaDateToISO(emp.exitDate) : null;
  const prorate = accrualCalendarProrateFactor(periodYYYYMM, openingISO, exitISO);
  const amount = Math.round(baseMonth * prorate * 10_000) / 10_000;
  if (amount <= 1e-9) return { posted: 0, skipped: true };

  const effNoon = new Date(`${lastDayISOOfMonth(periodYYYYMM)}T12:00:00.000Z`);
  const pct = Math.round(prorate * 1000) / 10;
  const noteAnteil =
    prorate >= 0.9999 ? "" : ` · anteilig ${pct}% Kalendertage`;
  await appendVacationLedger(tx, {
    employeeId: emp.id,
    amount,
    kind: VacationLedgerKind.MONTHLY_CONTRACT_ACCRUAL,
    note: `Monatsgutschrift ${periodYYYYMM} (5 Wo. × ${emp.workDaysPerWeek} AT/Wo = ${annual} T/Jahr ÷ 12${noteAnteil})`,
    effectiveDate: effNoon,
    accrualPeriod: periodYYYYMM,
  });
  return { posted: amount, skipped: false };
}

/**
 * Monatsabschluss für alle aktiven Mitarbeiter. Läuft sinnvoll nur am **1.** des Monats (UTC);
 * sonst wird nichts gebucht (`skipped: true`).
 */
export async function processMonthlyVacationAccrualAll(
  prisma: PrismaClient,
  options?: { now?: Date }
): Promise<{
  employees: number;
  postedTotal: number;
  period: string | null;
  skipped: boolean;
}> {
  const runAt = options?.now ?? new Date();
  const period = accrualPeriodForCronRun(runAt);
  if (!period) {
    return { employees: 0, postedTotal: 0, period: null, skipped: true };
  }

  const employees = await prisma.employee.findMany({
    where: { active: true },
    select: { id: true },
  });

  let postedTotal = 0;
  for (const e of employees) {
    await prisma.$transaction(async (tx) => {
      const fresh = await tx.employee.findUniqueOrThrow({
        where: { id: e.id },
        select: {
          id: true,
          active: true,
          vacationDaysOpen: true,
          entryDate: true,
          exitDate: true,
          workDaysPerWeek: true,
          contractHoursPerWeek: true,
        },
      });
      const r = await applyMonthlyContractAccrualForEmployee(tx, fresh, period);
      postedTotal += r.posted;
    });
  }

  return {
    employees: employees.length,
    postedTotal,
    period,
    skipped: false,
  };
}
