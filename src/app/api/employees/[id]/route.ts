import { NextResponse } from "next/server";
import { EmployeeSite } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { contractForDate, type ContractRow } from "@/lib/employeeContract";
import {
  normalizePlaceholderContractForEmployee,
  syncEmployeeContractCache,
} from "@/lib/employeeContractLoad";
import { firstContractEffectiveFromNoonUTC } from "@/lib/firstContractDate";
import { z } from "zod";

const contractChangeSchema = z.object({
  effectiveFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((s) => s.endsWith("-01"), "Datum muss der 1. eines Monats sein."),
  contractHoursPerWeek: z.number().min(0).max(80),
  workDaysPerWeek: z.number().int().min(1).max(7),
});

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  personalNumber: z.string().max(50).optional(),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  exitDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  workSite: z.enum(["CRUSH", "CAPPUCONE", "SHARED"]).optional(),
  contractHoursPerWeek: z.number().min(0).max(80).optional(),
  workDaysPerWeek: z.number().int().min(1).max(7).optional(),
  startBalanceHours: z.number().min(-10000).max(10000).optional(),
  vacationDaysOpen: z.number().min(-1000).max(1000).optional(),
  active: z.boolean().optional(),
  /** Neuer Vertrag ab Monatserster (zusätzliche Zeile in der Historie) */
  contractChange: contractChangeSchema.optional(),
});

type Params = { params: { id: string } };

function toEmployeeSite(v: "CRUSH" | "CAPPUCONE" | "SHARED"): EmployeeSite {
  if (v === "CRUSH") return EmployeeSite.CRUSH;
  if (v === "CAPPUCONE") return EmployeeSite.CAPPUCONE;
  return EmployeeSite.SHARED;
}

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

export async function PATCH(req: Request, context: Params) {
  try {
    const { id } = context.params;
    const body = patchSchema.parse(await req.json());

    await prisma.$transaction(async (tx) => {
      await tx.employee.update({
        where: { id },
        data: {
          ...(body.name !== undefined && { name: body.name.trim() }),
          ...(body.personalNumber !== undefined && {
            personalNumber: body.personalNumber.trim(),
          }),
          ...(body.entryDate !== undefined && {
            entryDate: body.entryDate
              ? new Date(`${body.entryDate}T12:00:00.000Z`)
              : null,
          }),
          ...(body.exitDate !== undefined && {
            exitDate: body.exitDate
              ? new Date(`${body.exitDate}T12:00:00.000Z`)
              : null,
          }),
          ...(body.workSite !== undefined && { workSite: toEmployeeSite(body.workSite) }),
          ...(body.contractHoursPerWeek !== undefined && {
            contractHoursPerWeek: body.contractHoursPerWeek,
          }),
          ...(body.workDaysPerWeek !== undefined && {
            workDaysPerWeek: body.workDaysPerWeek,
          }),
          ...(body.startBalanceHours !== undefined && {
            startBalanceHours: body.startBalanceHours,
          }),
          ...(body.vacationDaysOpen !== undefined && {
            vacationDaysOpen: body.vacationDaysOpen,
          }),
          ...(body.active !== undefined && { active: body.active }),
        },
      });

      let contractRowsDb = await tx.employeeContract.findMany({
        where: { employeeId: id },
        orderBy: { effectiveFrom: "asc" },
      });
      const today = new Date().toISOString().slice(0, 10);

      if (contractRowsDb.length === 0) {
        const empRow = await tx.employee.findUnique({ where: { id } });
        if (empRow) {
          await tx.employeeContract.create({
            data: {
              employeeId: id,
              effectiveFrom: firstContractEffectiveFromNoonUTC(empRow.entryDate),
              contractHoursPerWeek: empRow.contractHoursPerWeek,
              workDaysPerWeek: empRow.workDaysPerWeek,
            },
          });
          contractRowsDb = await tx.employeeContract.findMany({
            where: { employeeId: id },
            orderBy: { effectiveFrom: "asc" },
          });
        }
      }

      const slices = toContractRows(contractRowsDb);
      if (
        slices.length > 0 &&
        (body.contractHoursPerWeek !== undefined || body.workDaysPerWeek !== undefined)
      ) {
        const cur = contractForDate(slices, today);
        const match = contractRowsDb.find((r) => {
          const iso =
            r.effectiveFrom instanceof Date
              ? r.effectiveFrom.toISOString().slice(0, 10)
              : String(r.effectiveFrom).slice(0, 10);
          return iso === cur.effectiveFrom;
        });
        if (match) {
          await tx.employeeContract.update({
            where: { id: match.id },
            data: {
              ...(body.contractHoursPerWeek !== undefined && {
                contractHoursPerWeek: body.contractHoursPerWeek,
              }),
              ...(body.workDaysPerWeek !== undefined && {
                workDaysPerWeek: body.workDaysPerWeek,
              }),
            },
          });
        }
      }

      if (body.contractChange) {
        const from = new Date(`${body.contractChange.effectiveFrom}T12:00:00.000Z`);
        await tx.employeeContract.upsert({
          where: {
            employeeId_effectiveFrom: {
              employeeId: id,
              effectiveFrom: from,
            },
          },
          create: {
            employeeId: id,
            effectiveFrom: from,
            contractHoursPerWeek: body.contractChange.contractHoursPerWeek,
            workDaysPerWeek: body.contractChange.workDaysPerWeek,
          },
          update: {
            contractHoursPerWeek: body.contractChange.contractHoursPerWeek,
            workDaysPerWeek: body.contractChange.workDaysPerWeek,
          },
        });
      }
    });

    await normalizePlaceholderContractForEmployee(id);

    const finalRows = await prisma.employeeContract.findMany({
      where: { employeeId: id },
      orderBy: { effectiveFrom: "asc" },
    });
    await syncEmployeeContractCache(id, toContractRows(finalRows));

    const emp = await prisma.employee.findUnique({
      where: { id },
      include: { contracts: { orderBy: { effectiveFrom: "asc" } } },
    });
    return NextResponse.json(emp);
  } catch (e) {
    if (e instanceof z.ZodError) {
      const msg =
        e.errors.map((x) => x.message).filter(Boolean).join(" ") || "Ungültige Daten.";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ error: "Speichern fehlgeschlagen." }, { status: 500 });
  }
}
