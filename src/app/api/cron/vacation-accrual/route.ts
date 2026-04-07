import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { processMonthlyVacationAccrualAll } from "@/lib/vacationLedger";

function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const url = new URL(req.url);
  return url.searchParams.get("secret") === secret;
}

/**
 * Monatsgutschrift Urlaub: Vormonat, Jahresurlaub (aus Arbeitstagen/Woche) ÷ 12.
 * Bucht nur, wenn der Aufruf am **1.** des Monats (UTC) erfolgt — siehe `vercel.json`.
 * Lokal am 1.: `curl -H "Authorization: Bearer $CRON_SECRET" -X POST …/api/cron/vacation-accrual`
 */
export async function POST(req: Request) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "Nicht autorisiert." }, { status: 401 });
  }
  try {
    const result = await processMonthlyVacationAccrualAll(prisma);
    return NextResponse.json({
      ok: true,
      cutoverDateConfigured: Boolean(process.env.VACATION_LEDGER_CUTOVER_DATE?.trim()),
      ...result,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Aufbuchung fehlgeschlagen." }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return POST(req);
}
