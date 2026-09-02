import {
  type Prisma,
  type PrismaClient,
  VacationLedgerKind,
} from "@prisma/client";
import { contractForDate } from "@/lib/employeeContract";
import { openingEffectiveDateForEmployee } from "@/lib/vacationCutover";
import {
  annualVacationDaysFromWorkDaysPerWeek,
  monthlyVacationAccrualFromAnnual,
  prismaDateToISO,
} from "@/lib/vacationAccrualAT";

type Tx = Prisma.TransactionClient;

/**
 * Vormonat als YYYY-MM für **automatischen** Cron (ohne `period`-Parameter).
 *
 * Fenster: **UTC-Kalendertage 1–3** des aktuellen Monats → Buchung des **Vormonats**.
 * Grund: Streng nur Tag 1 ist fragil (Invocations kurz nach Mitternacht UTC, seltene
 * Plattform-Randfälle). **Dedupe** über `VacationLedger.accrualPeriod` verhindert Doppelbuchung,
 * wenn der Job mehrfach läuft (Vercel empfiehlt idempotente Crons).
 */
export function accrualPeriodForCronRun(runOnUtc: Date): string | null {
  const day = runOnUtc.getUTCDate();
  if (day < 1 || day > 3) return null;
  const y = runOnUtc.getUTCFullYear();
  const m = runOnUtc.getUTCMonth();
  const prev = new Date(Date.UTC(y, m - 1, 1));
  const py = prev.getUTCFullYear();
  const pm = String(prev.getUTCMonth() + 1).padStart(2, "0");
  return `${py}-${pm}`;
}

/** Validiert `YYYY-MM` für Nachbuchungen / API (Kalendermonat der Gutschrift). */
export function parseAccrualPeriodYYYYMM(raw: string): string | null {
  const s = raw.trim();
  if (!/^\d{4}-\d{2}$/.test(s)) return null;
  const m = Number(s.slice(5, 7));
  if (!Number.isInteger(m) || m < 1 || m > 12) return null;
  return s;
}

export type VacationAccrualRunMode = "cron_auto" | "explicit_period";

/**
 * Welcher Kalendermonat gebucht werden soll.
 * - Ohne `explicitPeriodRaw`: wie Cron — **UTC-Tage 1–3** → Vormonat, sonst kein Period.
 * - Mit gültigem `explicitPeriodRaw`: immer dieser Monat (Nachbuchung), gleiche Auth wie Cron.
 */
export function resolveVacationAccrualPeriod(
  runAtUtc: Date,
  explicitPeriodRaw?: string | null
): {
  period: string | null;
  skipReason: string | null;
  mode: VacationAccrualRunMode;
} {
  const trimmed =
    explicitPeriodRaw != null && explicitPeriodRaw.trim() !== ""
      ? explicitPeriodRaw.trim()
      : null;

  if (trimmed !== null) {
    const parsed = parseAccrualPeriodYYYYMM(trimmed);
    if (!parsed) {
      return {
        period: null,
        skipReason: "invalid_period_expected_yyyy_mm",
        mode: "explicit_period",
      };
    }
    return { period: parsed, skipReason: null, mode: "explicit_period" };
  }

  const auto = accrualPeriodForCronRun(runAtUtc);
  if (!auto) {
    return {
      period: null,
      skipReason: "cron_auto_outside_accrual_window_utc",
      mode: "cron_auto",
    };
  }
  return { period: auto, skipReason: null, mode: "cron_auto" };
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
  // Deaktivierte MA bekommen weiter Gutschriften bis zum Austrittstag (anteilig);
  // ohne Austrittsdatum lässt sich nichts aliquotieren → überspringen.
  if (!emp.active && !emp.exitDate) return { posted: 0, skipped: true };

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

  // Arbeitstage/Woche aus der Vertragshistorie des **Gutschrift-Monats**
  // (Monatsletzter als Stichtag) — nicht aus dem heutigen Stammdaten-Cache.
  const contractRowsDb = await tx.employeeContract.findMany({
    where: { employeeId: emp.id },
    orderBy: { effectiveFrom: "asc" },
  });
  const rows = contractRowsDb.map((r) => ({
    effectiveFrom: prismaDateToISO(r.effectiveFrom),
    contractHoursPerWeek: r.contractHoursPerWeek,
    workDaysPerWeek: r.workDaysPerWeek,
  }));
  const workDaysForPeriod =
    rows.length > 0
      ? contractForDate(rows, lastDayISOOfMonth(periodYYYYMM)).workDaysPerWeek
      : emp.workDaysPerWeek;

  const annual = annualVacationDaysFromWorkDaysPerWeek(workDaysForPeriod);
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
    note: `Monatsgutschrift ${periodYYYYMM} (5 Wo. × ${workDaysForPeriod} AT/Wo = ${annual} T/Jahr ÷ 12${noteAnteil})`,
    effectiveDate: effNoon,
    accrualPeriod: periodYYYYMM,
  });
  return { posted: amount, skipped: false };
}

/**
 * Monatsabschluss für alle aktiven Mitarbeiter.
 * - **Cron:** ohne `periodYYYYMM` nur **UTC-Tage 1–3** → Buchung **Vormonat**.
 * - **Nachbuchung:** `periodYYYYMM: "2026-04"` (nach Auth) → Buchung dieses Monats (Dedupe über `accrualPeriod`).
 */
export async function processMonthlyVacationAccrualAll(
  prisma: PrismaClient,
  options?: { now?: Date; periodYYYYMM?: string | null }
): Promise<{
  employees: number;
  postedTotal: number;
  period: string | null;
  skipped: boolean;
  skipReason: string | null;
  mode: VacationAccrualRunMode;
}> {
  const runAt = options?.now ?? new Date();
  const { period, skipReason, mode } = resolveVacationAccrualPeriod(
    runAt,
    options?.periodYYYYMM
  );
  if (!period) {
    return {
      employees: 0,
      postedTotal: 0,
      period: null,
      skipped: true,
      skipReason,
      mode,
    };
  }

  // Auch deaktivierte MA laden: sie bekommen bis zu ihrem Austrittstag
  // anteilige Gutschriften (Filter in applyMonthlyContractAccrualForEmployee).
  const employees = await prisma.employee.findMany({
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
    skipReason: null,
    mode,
  };
}
