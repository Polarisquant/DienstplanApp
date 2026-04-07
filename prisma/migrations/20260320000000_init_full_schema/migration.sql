-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "EmployeeSite" AS ENUM ('CRUSH', 'CAPPUCONE', 'SHARED');

-- CreateEnum
CREATE TYPE "VacationLedgerKind" AS ENUM ('OPENING_MIGRATION', 'STATUTORY_ACCRUAL', 'MONTHLY_CONTRACT_ACCRUAL', 'CONSUMPTION_ROTA', 'MANUAL_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "WeekStatus" AS ENUM ('DRAFT', 'CLOSED');

-- CreateEnum
CREATE TYPE "WorkSite" AS ENUM ('CRUSH', 'CAPPUCONE');

-- CreateEnum
CREATE TYPE "ShiftLayer" AS ENUM ('PLAN', 'ACTUAL');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "personalNumber" TEXT NOT NULL DEFAULT '',
    "entryDate" DATE,
    "exitDate" DATE,
    "workSite" "EmployeeSite" NOT NULL DEFAULT 'SHARED',
    "contractHoursPerWeek" DOUBLE PRECISION NOT NULL,
    "workDaysPerWeek" INTEGER NOT NULL,
    "startBalanceHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "vacationDaysOpen" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "annualVacationDays" DOUBLE PRECISION NOT NULL DEFAULT 25,
    "planSortOrderCrush" INTEGER NOT NULL DEFAULT 0,
    "planSortOrderCappucone" INTEGER NOT NULL DEFAULT 0,
    "holidayRegion" TEXT NOT NULL DEFAULT 'AT-Salzburg',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VacationLedger" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveDate" DATE NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "kind" "VacationLedgerKind" NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "accrualPeriod" TEXT,

    CONSTRAINT "VacationLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeContract" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "contractHoursPerWeek" DOUBLE PRECISION NOT NULL,
    "workDaysPerWeek" INTEGER NOT NULL,

    CONSTRAINT "EmployeeContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkWeek" (
    "id" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "site" "WorkSite" NOT NULL DEFAULT 'CRUSH',
    "status" "WeekStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkWeek_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftCell" (
    "id" TEXT NOT NULL,
    "workWeekId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "dayIndex" INTEGER NOT NULL,
    "layer" "ShiftLayer" NOT NULL,
    "rawValue" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftCell_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeAccountLine" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "workWeekId" TEXT NOT NULL,
    "weeklyDeltaHours" DOUBLE PRECISION NOT NULL,
    "balanceAfter" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'IST_CLOSED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeAccountLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "includedInPlan" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolBreak" (
    "id" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "includedInPlan" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolBreak_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "VacationLedger_employeeId_idx" ON "VacationLedger"("employeeId");

-- CreateIndex
CREATE INDEX "VacationLedger_employeeId_kind_idx" ON "VacationLedger"("employeeId", "kind");

-- CreateIndex
CREATE INDEX "VacationLedger_employeeId_accrualPeriod_idx" ON "VacationLedger"("employeeId", "accrualPeriod");

-- CreateIndex
CREATE INDEX "EmployeeContract_employeeId_idx" ON "EmployeeContract"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeContract_employeeId_effectiveFrom_key" ON "EmployeeContract"("employeeId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "WorkWeek_weekStart_site_key" ON "WorkWeek"("weekStart", "site");

-- CreateIndex
CREATE INDEX "ShiftCell_workWeekId_employeeId_idx" ON "ShiftCell"("workWeekId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftCell_workWeekId_employeeId_dayIndex_layer_key" ON "ShiftCell"("workWeekId", "employeeId", "dayIndex", "layer");

-- CreateIndex
CREATE INDEX "TimeAccountLine_employeeId_idx" ON "TimeAccountLine"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "TimeAccountLine_employeeId_workWeekId_key" ON "TimeAccountLine"("employeeId", "workWeekId");

-- CreateIndex
CREATE INDEX "Holiday_region_idx" ON "Holiday"("region");

-- CreateIndex
CREATE INDEX "Holiday_includedInPlan_idx" ON "Holiday"("includedInPlan");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_date_region_key" ON "Holiday"("date", "region");

-- CreateIndex
CREATE INDEX "SchoolBreak_region_idx" ON "SchoolBreak"("region");

-- CreateIndex
CREATE INDEX "SchoolBreak_includedInPlan_idx" ON "SchoolBreak"("includedInPlan");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolBreak_startDate_endDate_region_name_key" ON "SchoolBreak"("startDate", "endDate", "region", "name");

-- AddForeignKey
ALTER TABLE "VacationLedger" ADD CONSTRAINT "VacationLedger_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeContract" ADD CONSTRAINT "EmployeeContract_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftCell" ADD CONSTRAINT "ShiftCell_workWeekId_fkey" FOREIGN KEY ("workWeekId") REFERENCES "WorkWeek"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftCell" ADD CONSTRAINT "ShiftCell_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeAccountLine" ADD CONSTRAINT "TimeAccountLine_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeAccountLine" ADD CONSTRAINT "TimeAccountLine_workWeekId_fkey" FOREIGN KEY ("workWeekId") REFERENCES "WorkWeek"("id") ON DELETE CASCADE ON UPDATE CASCADE;
