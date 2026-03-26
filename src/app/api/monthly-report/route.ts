import { NextResponse } from "next/server";
import { buildMonthlyReport } from "@/lib/monthlyReport";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const employeeId = searchParams.get("employeeId");
  const month = searchParams.get("month");
  if (!employeeId || !month) {
    return NextResponse.json(
      { error: "Query employeeId und month=YYYY-MM erforderlich." },
      { status: 400 }
    );
  }
  const result = await buildMonthlyReport(employeeId, month);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  return NextResponse.json(result);
}
