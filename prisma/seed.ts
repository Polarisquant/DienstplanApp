import {
  Prisma,
  PrismaClient,
  WeekStatus,
  WorkSite,
  EmployeeSite,
} from "@prisma/client";
import bcrypt from "bcryptjs";
import { buildPublicHolidaysSeed } from "./holidaysSeed";
import { seedSchoolBreaks } from "./schoolBreaksSeed";

const prisma = new PrismaClient();

async function main() {
  const password =
    process.env.PLANNER_PASSWORD ?? "change-me-in-production";
  const hash = await bcrypt.hash(password, 10);

  await prisma.user.upsert({
    where: { email: "planer@local" },
    create: { email: "planer@local", passwordHash: hash },
    update: { passwordHash: hash },
  });

  const existing = await prisma.employee.count();
  if (existing === 0) {
    await prisma.employee.createMany({
      data: [
        {
          name: "Anna Müller",
          workSite: EmployeeSite.CRUSH,
          contractHoursPerWeek: 40,
          workDaysPerWeek: 5,
          startBalanceHours: 0,
          vacationDaysOpen: 2.5,
        },
        {
          name: "Thomas Schmidt",
          workSite: EmployeeSite.CAPPUCONE,
          contractHoursPerWeek: 38.5,
          workDaysPerWeek: 5,
          startBalanceHours: 2.5,
          vacationDaysOpen: 0.1,
        },
      ],
    });
  }

  const holidayRows = buildPublicHolidaysSeed();
  for (const h of holidayRows) {
    const date = new Date(h.d + "T12:00:00.000Z");
    await prisma.holiday.upsert({
      where: {
        date_region: {
          date,
          region: h.region,
        },
      },
      create: {
        date,
        name: h.name,
        region: h.region,
        includedInPlan: true,
      },
      update: {
        name: h.name,
      },
    });
  }

  const ws = new Date("2026-03-02T12:00:00.000Z");
  for (const site of [WorkSite.CRUSH, WorkSite.CAPPUCONE]) {
    await prisma.workWeek.upsert({
      where: { weekStart_site: { weekStart: ws, site } },
      create: { weekStart: ws, site, status: WeekStatus.DRAFT },
      update: {},
    });
  }

  const ferienN = await seedSchoolBreaks(prisma);

  console.log(
    `Seed OK (${holidayRows.length} Feiertage, ${ferienN} Ferien-Zeiträume). Login: planer@local / Passwort aus PLANNER_PASSWORD oder Standard.`
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2022"
    ) {
      console.error(
        "\nDie Datenbank-Tabellen passen noch nicht zum aktuellen Prisma-Schema " +
          "(z. B. fehlt die Spalte WorkWeek.site oder Employee.workSite).\n\n" +
          "Im Projektordner web (dort liegt prisma/schema.prisma) zuerst ausführen:\n" +
          "  npx prisma db push --accept-data-loss\n\n" +
          "Danach erneut:\n" +
          "  npx prisma db seed\n"
      );
    } else {
      console.error(e);
    }
    void prisma.$disconnect();
    process.exit(1);
  });
