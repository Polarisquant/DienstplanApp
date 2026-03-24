import { NextResponse } from "next/server";
import { WeekStatus, WorkSite } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseWeekStartParam, formatWeekStart } from "@/lib/weekUtils";
import { whereLaterClosedWeek } from "@/lib/workSite";
import { z } from "zod";

const bodySchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  site: z.enum(["CRUSH", "CAPPUCONE"]).optional().default("CRUSH"),
});

/**
 * Geschlossene Woche wieder öffnen: Zeitkonto-Zeilen dieser Woche entfernen, Status DRAFT.
 * Nur wenn keine spätere (Kalenderwoche, Standort)-Position abgeschlossen ist.
 */
export async function POST(req: Request) {
  try {
    const body = bodySchema.parse(await req.json());
    const weekStart = parseWeekStartParam(body.start);
    if (!weekStart) {
      return NextResponse.json({ error: "Ungültiger Wochenstart." }, { status: 400 });
    }

    const site =
      body.site === "CAPPUCONE" ? WorkSite.CAPPUCONE : WorkSite.CRUSH;

    const week = await prisma.workWeek.findUnique({
      where: { weekStart_site: { weekStart: weekStart, site } },
    });
    if (!week) {
      return NextResponse.json({ error: "Woche nicht gefunden." }, { status: 404 });
    }
    if (week.status !== WeekStatus.CLOSED) {
      return NextResponse.json(
        { error: "Diese Woche ist nicht abgeschlossen." },
        { status: 400 }
      );
    }

    const laterClosed = await prisma.workWeek.findFirst({
      where: whereLaterClosedWeek(weekStart, site),
      orderBy: [{ weekStart: "asc" }, { site: "asc" }],
    });
    if (laterClosed) {
      return NextResponse.json(
        {
          error:
            "Eine spätere abgeschlossene Woche (gleicher oder späterer Kalendertag / anderer Standort) existiert. Bitte zuerst von hinten nach vorne wieder öffnen.",
        },
        { status: 409 }
      );
    }

    await prisma.$transaction([
      prisma.timeAccountLine.deleteMany({ where: { workWeekId: week.id } }),
      prisma.workWeek.update({
        where: { id: week.id },
        data: { status: WeekStatus.DRAFT },
      }),
    ]);

    return NextResponse.json({
      ok: true,
      weekStart: formatWeekStart(weekStart),
      site: body.site,
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Ungültige Daten." }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ error: "Wieder öffnen fehlgeschlagen." }, { status: 500 });
  }
}
