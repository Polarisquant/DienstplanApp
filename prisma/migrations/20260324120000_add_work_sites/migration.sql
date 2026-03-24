-- Zwei Standorte: WorkWeek je (weekStart, site); Mitarbeiter workSite statt freier Abteilung.
CREATE TYPE "EmployeeSite" AS ENUM ('CRUSH', 'CAPPUCONE', 'SHARED');
CREATE TYPE "WorkSite" AS ENUM ('CRUSH', 'CAPPUCONE');

ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "workSite" "EmployeeSite" NOT NULL DEFAULT 'SHARED';
ALTER TABLE "Employee" DROP COLUMN IF EXISTS "department";

ALTER TABLE "WorkWeek" ADD COLUMN IF NOT EXISTS "site" "WorkSite" NOT NULL DEFAULT 'CRUSH';
ALTER TABLE "WorkWeek" DROP CONSTRAINT IF EXISTS "WorkWeek_weekStart_key";
CREATE UNIQUE INDEX IF NOT EXISTS "WorkWeek_weekStart_site_key" ON "WorkWeek"("weekStart", "site");
