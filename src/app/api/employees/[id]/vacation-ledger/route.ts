import { NextResponse } from "next/server";
import { ShiftLayer, VacationLedgerKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { ContractRow } from "@/lib/employeeContract";
import { employmentBoundsFromDates } from "@/lib/employmentWeekTarget";
import { countVacationDaysInWeekWithPlanActual } from "@/lib/vacation";
import { annualVacationDaysFromWorkDaysPerWeek } from "@/lib/vacationAccrualAT";
import { SYSTEMKORREKTUR_NOTE } from "@/lib/consistencyCheck";

type Params = { params: { id: string } };

const iso = (d: Date) => d.toISOString().slice(0, 10);

const KIND_LABEL: Record<VacationLedgerKind, { label: string; ui: string }> = {
  OPENING_MIGRATION: { label: "Eröffnung", ui: "open" },
  MONTHLY_CONTRACT_ACCRUAL: { label: "Gutschrift", ui: "acc" },
  STATUTORY_ACCRUAL: { label: "Alt-Gutschrift", ui: "acc" },
  CONSUMPTION_ROTA: { label: "Urlaub", ui: "cons" },
  MANUAL_ADJUSTMENT: { label: "Korrektur", ui: "man" },
};

/** Urlaubs-Verlauf eines Mitarbeiters: alle Journal-Buchungen mit laufendem Saldo + Prüf-Status. */
export async function GET(_req: Request, context: Params) {
  try {
    const { id } = context.params;
    const emp = await prisma.employee.findUnique({
      where: { id },
      include: { contracts: { orderBy: { effectiveFrom: "asc" } } },
    });
    if (!emp) {
      return NextResponse.json({ error: "Mitarbeiter nicht gefunden." }, { status: 404 });
    }

    const led = await prisma.vacationLedger.findMany({
      where: { employeeId: id },
      orderBy: { createdAt: "asc" },
    });

    let run = 0;
    const rowsOut = led.map((l) => {
      run += l.amount;
      return {
        dateISO: iso(l.effectiveDate),
        createdAtISO: l.createdAt.toISOString(),
        kind: l.kind,
        label: KIND_LABEL[l.kind].label,
        ui: KIND_LABEL[l.kind].ui,
        note: l.note,
        accrualPeriod: l.accrualPeriod,
        amount: l.amount,
        balanceAfter: Math.round(run * 10000) / 10000,
      };
    });

    // Persönlicher Abgleich: Verbrauchsseite des Journals vs. Dienstplan-Zählung
    const contractRows: ContractRow[] = emp.contracts.map((c) => ({
      effectiveFrom: iso(c.effectiveFrom),
      contractHoursPerWeek: c.contractHoursPerWeek,
      workDaysPerWeek: c.workDaysPerWeek,
    }));
    if (contractRows.length === 0) {
      contractRows.push({
        effectiveFrom: "2000-01-01",
        contractHoursPerWeek: emp.contractHoursPerWeek,
        workDaysPerWeek: emp.workDaysPerWeek,
      });
    }
    const employment = employmentBoundsFromDates(emp.entryDate, emp.exitDate);
    const openingRow = led.find((l) => l.kind === VacationLedgerKind.OPENING_MIGRATION);
    const openingISO = openingRow ? iso(openingRow.effectiveDate) : null;

    const weeks = await prisma.workWeek.findMany({ orderBy: [{ weekStart: "asc" }] });
    const cells = await prisma.shiftCell.findMany({
      where: { employeeId: id },
      select: { workWeekId: true, dayIndex: true, layer: true, rawValue: true },
    });
    const cellMap = new Map<string, string[]>();
    for (const c of cells) {
      const k = `${c.workWeekId}|${c.layer}`;
      const arr = cellMap.get(k) ?? Array(7).fill("");
      arr[c.dayIndex] = c.rawValue;
      cellMap.set(k, arr);
    }
    let consNew = 0;
    for (const w of weeks) {
      const ws = iso(w.weekStart);
      if (openingISO && ws < openingISO.slice(0, 8) + "01") continue;
      const plan = cellMap.get(`${w.id}|${ShiftLayer.PLAN}`) ?? Array(7).fill("");
      const actual = cellMap.get(`${w.id}|${ShiftLayer.ACTUAL}`) ?? Array(7).fill("");
      if (!plan.some((c) => c.trim()) && !actual.some((c) => c.trim())) continue;
      consNew += countVacationDaysInWeekWithPlanActual(
        plan, actual, ws, contractRows, employment
      );
    }
    const consSide = led
      .filter(
        (l) =>
          l.kind === VacationLedgerKind.CONSUMPTION_ROTA ||
          (l.kind === VacationLedgerKind.MANUAL_ADJUSTMENT &&
            l.note === SYSTEMKORREKTUR_NOTE)
      )
      .reduce((s, l) => s + l.amount, 0);
    const sumAll = led.reduce((s, l) => s + l.amount, 0);
    const journalDiff = Math.round((consSide + consNew) * 10000) / 10000;
    const saldoDiff = Math.round((sumAll - emp.vacationDaysOpen) * 10000) / 10000;

    const annual = annualVacationDaysFromWorkDaysPerWeek(emp.workDaysPerWeek);
    return NextResponse.json(
      {
        employee: {
          id: emp.id,
          name: emp.name,
          vacationDaysOpen: emp.vacationDaysOpen,
          annualVacationDays: annual,
          monthlyAccrual: Math.round((annual / 12) * 100) / 100,
        },
        rows: rowsOut.reverse(),
        check: {
          ok: Math.abs(journalDiff) <= 0.01 && Math.abs(saldoDiff) <= 0.01,
          journalDiff,
          saldoDiff,
          verbrauchLautDienstplan: Math.round(consNew * 10000) / 10000,
        },
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Verlauf konnte nicht geladen werden." }, { status: 500 });
  }
}
