import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runConsistencyCheck } from "@/lib/consistencyCheck";

export const dynamic = "force-dynamic";

/**
 * Dauer-Abgleich: Journal ↔ Dienstplan-Zellen ↔ Zeitkonto (nur lesend).
 * `?summary=1` liefert nur die Anzahl (fürs Badge im Dienstplan).
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const result = await runConsistencyCheck(prisma);
    if (searchParams.get("summary") === "1") {
      return NextResponse.json(
        {
          checkedAt: result.checkedAt,
          employees: result.employees,
          issueCount: result.issues.length,
        },
        { headers: { "Cache-Control": "private, no-store" } }
      );
    }
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Konsistenzprüfung fehlgeschlagen." },
      { status: 500 }
    );
  }
}
