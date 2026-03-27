import { NextResponse } from "next/server";
import { EmployeeSite } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const createSchema = z.object({
  name: z.string().min(1).max(200),
  personalNumber: z.string().max(50).optional().default(""),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  exitDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  workSite: z.enum(["CRUSH", "CAPPUCONE", "SHARED"]).optional().default("SHARED"),
  contractHoursPerWeek: z.number().min(0).max(80),
  workDaysPerWeek: z.number().int().min(1).max(7),
  startBalanceHours: z.number().min(-10000).max(10000).optional().default(0),
  /** Auch negative Werte (z. B. Defizit); bis 2 Nachkommastellen sinnvoll im UI */
  vacationDaysOpen: z.number().min(-1000).max(1000).optional().default(0),
});

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const all = searchParams.get("includeInactive") === "1";
  const list = await prisma.employee.findMany({
    where: all ? undefined : { active: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ employees: list });
}

export async function POST(req: Request) {
  try {
    const body = createSchema.parse(await req.json());
    const workSite =
      body.workSite === "CRUSH"
        ? EmployeeSite.CRUSH
        : body.workSite === "CAPPUCONE"
          ? EmployeeSite.CAPPUCONE
          : EmployeeSite.SHARED;
    const emp = await prisma.employee.create({
      data: {
        name: body.name.trim(),
        personalNumber: body.personalNumber?.trim() ?? "",
        entryDate: body.entryDate ? new Date(`${body.entryDate}T12:00:00.000Z`) : null,
        exitDate: body.exitDate ? new Date(`${body.exitDate}T12:00:00.000Z`) : null,
        workSite,
        contractHoursPerWeek: body.contractHoursPerWeek,
        workDaysPerWeek: body.workDaysPerWeek,
        startBalanceHours: body.startBalanceHours ?? 0,
        vacationDaysOpen: body.vacationDaysOpen ?? 0,
      },
    });
    return NextResponse.json(emp);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Ungültige Daten.", details: e.flatten() }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ error: "Anlegen fehlgeschlagen." }, { status: 500 });
  }
}
