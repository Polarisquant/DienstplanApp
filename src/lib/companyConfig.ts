/**
 * Dienstgeber / Abteilung für Monatsübersicht & Druck (wie bisheriger Screenshot).
 * Per Umgebungsvariable überschreibbar.
 */
export function companyEmployerName(): string {
  return (
    process.env.COMPANY_EMPLOYER_NAME?.trim() ||
    process.env.NEXT_PUBLIC_COMPANY_EMPLOYER_NAME?.trim() ||
    "Doris Raschhofer"
  );
}

export function companyDepartmentName(): string {
  return (
    process.env.COMPANY_DEPARTMENT_NAME?.trim() ||
    process.env.NEXT_PUBLIC_COMPANY_DEPARTMENT_NAME?.trim() ||
    "Doris Raschhofer"
  );
}
