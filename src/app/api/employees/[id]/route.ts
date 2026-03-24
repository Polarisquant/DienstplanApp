import { NextResponse } from "next/server";
import { EmployeeSite } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  workSite: z.enum(["CRUSH", "CAPPUCONE", "SHARED"]).optional(),
  contractHoursPerWeek: z.number().min(0).max(80).optional(),
  workDaysPerWeek: z.number().int().min(1).max(7).optional(),
  startBalanceHours: z.number().min(-1000).max(1000).optional(),
  vacationDaysOpen: z.number().min(0).max(365).optional(),
  active: z.boolean().optional(),
});

type Params = { params: { id: string } };

function toEmployeeSite(v: "CRUSH" | "CAPPUCONE" | "SHARED"): EmployeeSite {
  if (v === "CRUSH") return EmployeeSite.CRUSH;
  if (v === "CAPPUCONE") return EmployeeSite.CAPPUCONE;
  return EmployeeSite.SHARED;
}

export async function PATCH(req: Request, context: Params) {
  try {
    const { id } = context.params;
    const body = patchSchema.parse(await req.json());

    const emp = await prisma.employee.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name.trim() }),
        ...(body.workSite !== undefined && { workSite: toEmployeeSite(body.workSite) }),
        ...(body.contractHoursPerWeek !== undefined && {
          contractHoursPerWeek: body.contractHoursPerWeek,
        }),
        ...(body.workDaysPerWeek !== undefined && { workDaysPerWeek: body.workDaysPerWeek }),
        ...(body.startBalanceHours !== undefined && {
          startBalanceHours: body.startBalanceHours,
        }),
        ...(body.vacationDaysOpen !== undefined && {
          vacationDaysOpen: body.vacationDaysOpen,
        }),
        ...(body.active !== undefined && { active: body.active }),
      },
    });
    return NextResponse.json(emp);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Ungültige Daten." }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ error: "Speichern fehlgeschlagen." }, { status: 500 });
  }
}
