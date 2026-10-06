/**
 * Korrektur „doppeltes Wochensoll“ bei geteilten Mitarbeitern.
 *
 * Ursache: Crush-Wochen wurden mit der Alt-Logik (source IST_CLOSED, Soll enthalten)
 * gebucht; die spätere CappuCone-Buchung derselben KW hat das nicht als „Soll schon
 * gebucht“ erkannt und das Soll ein zweites Mal abgezogen (IST_CLOSED_SOLL).
 *
 * Je betroffener KW wird die CappuCone-Zeile auf „nur Ist“ (IST_CLOSED_NOSOLL) gesetzt,
 * danach werden die Salden-Ketten beider Filialen neu aufgebaut. Vorher wird eine
 * JSON-Sicherung aller Zeitkonto-Zeilen des Mitarbeiters nach ../backups/ geschrieben.
 *
 * Aufruf: DB_URL="postgres://…" npx tsx scripts/fix-doppeltes-soll-geteilt.ts "Sarah Schiersner" --apply
 * Ohne --apply: reine Vorschau.
 */
import { PrismaClient, WeekStatus, WorkSite } from "@prisma/client";
import { mkdirSync, writeFileSync } from "node:fs";
import { computeWeeklyBalanceWithContracts } from "../src/lib/computeWeekly";
import { employmentBoundsFromDates } from "../src/lib/employmentWeekTarget";
import { lineHoldsSoll, TIME_SOURCE_NOSOLL } from "../src/lib/balance";

const name = process.argv[2];
const apply = process.argv.includes("--apply");
if (!name || name.startsWith("--")) {
  console.error('Aufruf: npx tsx scripts/fix-doppeltes-soll-geteilt.ts "Vorname Nachname" [--apply]');
  process.exit(1);
}

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DB_URL ?? process.env.DATABASE_URL! } },
});
const iso = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  const e = await prisma.employee.findFirstOrThrow({
    where: { name },
    include: { contracts: { orderBy: { effectiveFrom: "asc" } } },
  });
  const rows = e.contracts.map((c) => ({
    effectiveFrom: iso(c.effectiveFrom),
    contractHoursPerWeek: c.contractHoursPerWeek,
    workDaysPerWeek: c.workDaysPerWeek,
  }));
  const employment = employmentBoundsFromDates(e.entryDate, e.exitDate);
  const holidays = new Set(
    (await prisma.holiday.findMany({ where: { includedInPlan: true } })).map((h) => iso(h.date))
  );

  const before = await prisma.timeAccountLine.findMany({
    where: { employeeId: e.id },
    include: { workWeek: true },
  });
  if (apply) {
    mkdirSync("../backups", { recursive: true });
    const file = `../backups/zeitkonto_${e.name.replace(/\s+/g, "_")}_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    writeFileSync(file, JSON.stringify(before, null, 2));
    console.log(`Sicherung: ${file}`);
  }
  const sumBefore = before
    .filter((l) => l.workWeek.status === WeekStatus.CLOSED)
    .reduce((s, l) => s + l.weeklyDeltaHours, 0);

  await prisma.$transaction(async (tx) => {
    const lines = await tx.timeAccountLine.findMany({
      where: { employeeId: e.id, workWeek: { status: WeekStatus.CLOSED } },
      include: { workWeek: true },
    });

    // 1) Doppeltes Soll: beide Zeilen einer KW enthalten das Soll → CappuCone auf „nur Ist“
    for (const l of lines.filter((x) => x.workWeek.site === WorkSite.CAPPUCONE)) {
      const ws = iso(l.workWeek.weekStart);
      const crush = lines.find(
        (x) => x.workWeek.site === WorkSite.CRUSH && iso(x.workWeek.weekStart) === ws
      );
      if (!crush || !lineHoldsSoll(crush.source) || !lineHoldsSoll(l.source)) continue;

      const cells = await tx.shiftCell.findMany({
        where: { workWeekId: l.workWeekId, employeeId: e.id, layer: "ACTUAL" },
      });
      const arr = Array(7).fill("");
      for (const c of cells) arr[c.dayIndex] = c.rawValue;
      const keys = new Set(
        Array.from({ length: 7 }, (_, i) => {
          const d = new Date(`${ws}T00:00:00.000Z`);
          d.setUTCDate(d.getUTCDate() + i);
          return iso(d);
        }).filter((d) => holidays.has(d))
      );
      const { weeklyHours } = computeWeeklyBalanceWithContracts(arr, ws, rows, keys, employment);
      console.log(
        `KW ${ws} CappuCone: ${l.weeklyDeltaHours.toFixed(2)} (${l.source}) → ${weeklyHours.toFixed(2)} (${TIME_SOURCE_NOSOLL})`
      );
      await tx.timeAccountLine.update({
        where: { id: l.id },
        data: { weeklyDeltaHours: weeklyHours, source: TIME_SOURCE_NOSOLL },
      });
    }

    // 2) Salden-Ketten je Filiale neu aufbauen
    for (const site of [WorkSite.CRUSH, WorkSite.CAPPUCONE]) {
      const chain = await tx.timeAccountLine.findMany({
        where: { employeeId: e.id, workWeek: { site, status: WeekStatus.CLOSED } },
        include: { workWeek: true },
        orderBy: { workWeek: { weekStart: "asc" } },
      });
      let bal = e.startBalanceHours;
      for (const l of chain) {
        bal += l.weeklyDeltaHours;
        if (Math.abs(bal - l.balanceAfter) > 0.001) {
          console.log(
            `  Kette ${site} ${iso(l.workWeek.weekStart)}: balanceAfter ${l.balanceAfter.toFixed(2)} → ${bal.toFixed(2)}`
          );
          await tx.timeAccountLine.update({ where: { id: l.id }, data: { balanceAfter: bal } });
        }
      }
    }

    const sumAfter = await tx.timeAccountLine.aggregate({
      where: { employeeId: e.id, workWeek: { status: WeekStatus.CLOSED } },
      _sum: { weeklyDeltaHours: true },
    });
    console.log(
      `\n${e.name}: Gesamtsaldo ${(e.startBalanceHours + sumBefore).toFixed(2)} h → ${(e.startBalanceHours + (sumAfter._sum.weeklyDeltaHours ?? 0)).toFixed(2)} h`
    );
    if (!apply) throw new Error("VORSCHAU");
  }).catch((err) => {
    if (err instanceof Error && err.message === "VORSCHAU") {
      console.log("Vorschau — nichts geschrieben. Mit --apply ausführen.");
      return;
    }
    throw err;
  });
}

main().finally(() => prisma.$disconnect());
