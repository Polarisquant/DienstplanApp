import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const patchSchema = z.object({
  includedInPlan: z.boolean(),
});

type Params = { params: { id: string } };

export async function PATCH(req: Request, context: Params) {
  try {
    const { id } = context.params;
    const body = patchSchema.parse(await req.json());
    await prisma.schoolBreak.update({
      where: { id },
      data: { includedInPlan: body.includedInPlan },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Ungültige Daten." }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ error: "Speichern fehlgeschlagen." }, { status: 500 });
  }
}
