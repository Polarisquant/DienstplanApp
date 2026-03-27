import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { ContractRow } from "@/lib/employeeContract";
import {
  normalizePlaceholderContractForEmployee,
  syncEmployeeContractCache,
} from "@/lib/employeeContractLoad";
import { firstContractEffectiveFromNoonUTC } from "@/lib/firstContractDate";

type Params = { params: { id: string; contractId: string } };

function toContractRows(
  rows: { effectiveFrom: Date; contractHoursPerWeek: number; workDaysPerWeek: number }[]
): ContractRow[] {
  return rows.map((r) => ({
    effectiveFrom:
      r.effectiveFrom instanceof Date
        ? r.effectiveFrom.toISOString().slice(0, 10)
        : String(r.effectiveFrom).slice(0, 10),
    contractHoursPerWeek: r.contractHoursPerWeek,
    workDaysPerWeek: r.workDaysPerWeek,
  }));
}

export async function DELETE(_req: Request, context: Params) {
  try {
    const { id: employeeId, contractId } = context.params;

    const row = await prisma.employeeContract.findFirst({
      where: { id: contractId, employeeId },
    });
    if (!row) {
      return NextResponse.json({ error: "Vertragsstand nicht gefunden." }, { status: 404 });
    }

    await prisma.$transaction(async (tx) => {
      await tx.employeeContract.delete({ where: { id: contractId } });
      const n = await tx.employeeContract.count({ where: { employeeId } });
      if (n === 0) {
        const empRow = await tx.employee.findUnique({ where: { id: employeeId } });
        if (empRow) {
          await tx.employeeContract.create({
            data: {
              employeeId,
              effectiveFrom: firstContractEffectiveFromNoonUTC(empRow.entryDate),
              contractHoursPerWeek: empRow.contractHoursPerWeek,
              workDaysPerWeek: empRow.workDaysPerWeek,
            },
          });
        }
      }
    });

    await normalizePlaceholderContractForEmployee(employeeId);
    const finalRows = await prisma.employeeContract.findMany({
      where: { employeeId },
      orderBy: { effectiveFrom: "asc" },
    });
    if (finalRows.length > 0) {
      await syncEmployeeContractCache(employeeId, toContractRows(finalRows));
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Löschen fehlgeschlagen." }, { status: 500 });
  }
}
