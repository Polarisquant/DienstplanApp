import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { processMonthlyVacationAccrualAll } from "@/lib/vacationLedger";

function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const url = new URL(req.url);
  return url.searchParams.get("secret") === secret;
}

/**
 * Optional: Kalendermonat der Gutschrift (`YYYY-MM`) für Nachbuchung — gleiche Auth wie Cron.
 * Query `?period=2026-04` oder JSON-Body `{ "period": "2026-04" }` (nur POST mit JSON).
 */
async function extractPeriodOverride(req: Request): Promise<string | undefined> {
  const url = new URL(req.url);
  const q = url.searchParams.get("period");
  if (q !== null && q.trim() !== "") return q.trim();

  if (req.method.toUpperCase() !== "POST") return undefined;

  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) return undefined;

  try {
    const body: unknown = await req.json();
    if (
      body &&
      typeof body === "object" &&
      "period" in body &&
      typeof (body as { period: unknown }).period === "string"
    ) {
      const p = (body as { period: string }).period.trim();
      return p === "" ? undefined : p;
    }
  } catch {
    /* leerer Body */
  }
  return undefined;
}

/**
 * Monatsgutschrift Urlaub: Vormonat, Jahresurlaub (aus Arbeitstagen/Woche) ÷ 12.
 * Cron (ohne `period`): nur an den **UTC-Tagen 1–3** — Buchung **Vormonat** (siehe `vercel.json`).
 *
 * Nachbuchung: `period=YYYY-MM` (Query oder JSON), z. B. ausgelaufener Cron.
 *
 * Lokal: `curl -H "Authorization: Bearer $CRON_SECRET" -X POST …/api/cron/vacation-accrual`
 * Nachbuchung April: `…?period=2026-04` oder `-d '{"period":"2026-04"}'`
 */
export async function POST(req: Request) {
  if (!cronAuthorized(req)) {
    const configured = Boolean(process.env.CRON_SECRET?.trim());
    return NextResponse.json(
      {
        error: configured ? "Nicht autorisiert." : "CRON_SECRET fehlt — Route ist gesperrt.",
      },
      { status: 401 }
    );
  }

  try {
    const periodOverride = await extractPeriodOverride(req);
    const result = await processMonthlyVacationAccrualAll(prisma, {
      periodYYYYMM: periodOverride ?? null,
    });
    const status = result.skipped && result.skipReason === "invalid_period_expected_yyyy_mm" ? 400 : 200;

    return NextResponse.json(
      {
        ok: !result.skipped,
        cutoverDateConfigured: Boolean(process.env.VACATION_LEDGER_CUTOVER_DATE?.trim()),
        hintSkippedAuto:
          result.skipped && result.skipReason === "cron_auto_outside_accrual_window_utc"
            ? "Cron ohne period bucht nur UTC-Tage 1–3 (Vormonat). Für Nachbuchung period=YYYY-MM angeben."
            : undefined,
        ...result,
      },
      { status }
    );
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Aufbuchung fehlgeschlagen." }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return POST(req);
}
