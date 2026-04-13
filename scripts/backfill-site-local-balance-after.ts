/**
 * Einmalig nach Umstellung auf standort-lokale balanceAfter-Ketten:
 * pro Mitarbeiter × Standort chronologisch neu setzen (Startsaldo + kumulierte Deltas).
 *
 *   cd web && npx tsx scripts/backfill-site-local-balance-after.ts
 */
import { PrismaClient, WeekStatus, WorkSite } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const employees = await prisma.employee.findMany({
    select: { id: true, startBalanceHours: true },
  });
  let updated = 0;
  for (const emp of employees) {
    for (const site of [WorkSite.CRUSH, WorkSite.CAPPUCONE]) {
      const lines = await prisma.timeAccountLine.findMany({
        where: {
          employeeId: emp.id,
          workWeek: { site, status: WeekStatus.CLOSED },
        },
        orderBy: { workWeek: { weekStart: "asc" } },
        select: { id: true, weeklyDeltaHours: true, balanceAfter: true },
      });
      let running = emp.startBalanceHours;
      for (const line of lines) {
        running += line.weeklyDeltaHours;
        if (Math.abs(line.balanceAfter - running) > 1e-5) {
          await prisma.timeAccountLine.update({
            where: { id: line.id },
            data: { balanceAfter: running },
          });
          updated++;
        }
      }
    }
  }
  console.log(`backfill-site-local-balance-after: updated ${updated} row(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
