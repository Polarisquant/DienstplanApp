import { EmployeeSite, ShiftLayer, WeekStatus, WorkSite } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  parseShiftCellTotalHours,
  parseShiftCellTotalHoursForDate,
  pauseMinutesFromRaw,
} from "@/lib/parseShiftCell";
import { vacationDayUnitsForDayPlanActual } from "@/lib/vacation";
import { contractForDate } from "@/lib/employeeContract";
import { contractRowsMapForEmployees } from "@/lib/employeeContractLoad";
import {
  addDaysISO,
  dayIndexInWeek,
  enumerateDatesInclusive,
  weekStartISOContainingDate,
} from "@/lib/dateNav";
import { getBalanceAtPeriodEnd } from "@/lib/balance";
import { formatWeekStart, isoWeekNumberUTC, parseWeekStartParam } from "@/lib/weekUtils";
import { companyDepartmentName, companyEmployerName } from "@/lib/companyConfig";

function firstDayOfMonth(year: number, month1to12: number): string {
  return `${year}-${String(month1to12).padStart(2, "0")}-01`;
}

function lastDayOfMonth(year: number, month1to12: number): string {
  const d = new Date(year, month1to12, 0, 12, 0, 0);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function weekIdsForEmployeeOnMonday(
  empSite: EmployeeSite,
  crushId: string | undefined,
  capId: string | undefined
): string[] {
  switch (empSite) {
    case EmployeeSite.CRUSH:
      return crushId ? [crushId] : [];
    case EmployeeSite.CAPPUCONE:
      return capId ? [capId] : [];
    default:
      return [crushId, capId].filter(Boolean) as string[];
  }
}

/** Soll pro Tag: erste N Wochentage (Mo=0 …) im Sinne „Mo zuerst“. */
export function dailyContractHoursForDayIndex(
  dayIndexInWeek: number,
  contractHoursPerWeek: number,
  workDaysPerWeek: number
): number {
  if (dayIndexInWeek < 0 || dayIndexInWeek > 6) return 0;
  if (workDaysPerWeek <= 0) return 0;
  if (dayIndexInWeek >= workDaysPerWeek) return 0;
  return contractHoursPerWeek / workDaysPerWeek;
}

export function shiftCellDisplayParts(raw: string): {
  dienstArt: "zeit" | "urlaub" | "krank" | "zaft" | "leer";
  von: string;
  bis: string;
  pauseMin: string;
} {
  const s = raw.replace(/\s+/g, " ").trim();
  if (!s) {
    return { dienstArt: "leer", von: "", bis: "", pauseMin: "" };
  }
  const u = s.charAt(0).toUpperCase();
  if (u === "U") {
    return { dienstArt: "urlaub", von: "", bis: "", pauseMin: "" };
  }
  if (u === "K") {
    return { dienstArt: "krank", von: "", bis: "", pauseMin: "" };
  }
  if (u === "Z" || u === "F") {
    return { dienstArt: "zaft", von: "", bis: "", pauseMin: "" };
  }
  const parts = s.split("-").map((p) => p.trim());
  if (parts.length >= 2) {
    const pause =
      parts.length >= 3 && parts[2] !== undefined
        ? String(parts[2]).replace(".", ",")
        : "";
    return {
      dienstArt: "zeit",
      von: parts[0] ?? "",
      bis: parts[1] ?? "",
      pauseMin: pause,
    };
  }
  return { dienstArt: "leer", von: "", bis: "", pauseMin: "" };
}

/** Bis zu drei Zeit-Segmente (von/bis) für Anzeige; Pause gesamt separat in `pauseHours`. */
function segmentTripleFromRaw(raw: string): {
  von: string;
  bis: string;
  von2: string;
  bis2: string;
  von3: string;
  bis3: string;
} {
  const s = raw.replace(/\s+/g, " ").trim();
  const empty = { von: "", bis: "", von2: "", bis2: "", von3: "", bis3: "" };
  if (!s) return empty;
  const first = s.charAt(0).toUpperCase();
  const special =
    (first === "U" || first === "K" || first === "Z" || first === "F") &&
    !s.includes("|");
  if (special) {
    const d = shiftCellDisplayParts(s);
    return {
      von: d.von,
      bis: d.bis,
      von2: "",
      bis2: "",
      von3: "",
      bis3: "",
    };
  }
  const segs = s
    .split("|")
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 3);
  const pad: [string, string, string] = [
    segs[0] ?? "",
    segs[1] ?? "",
    segs[2] ?? "",
  ];
  const d1 = shiftCellDisplayParts(pad[0] ?? "");
  const d2 = shiftCellDisplayParts(pad[1] ?? "");
  const d3 = shiftCellDisplayParts(pad[2] ?? "");
  return {
    von: d1.von,
    bis: d1.bis,
    von2: d2.von,
    bis2: d2.bis,
    von3: d3.von,
    bis3: d3.bis,
  };
}

function dienstLabel(
  raw: string,
  hours: number
): "Frei" | "Urlaub" | "Krank" | "ZA/FT" | "Dienst" {
  const t = raw.trim();
  if (!t) return "Frei";
  const f = t.charAt(0).toUpperCase();
  if (f === "U") return "Urlaub";
  if (f === "K") return "Krank";
  if (f === "Z" || f === "F") return "ZA/FT";
  if (hours > 0 || t.includes(":")) return "Dienst";
  return "Frei";
}

export type MonthlyReportDayRow = {
  dateISO: string;
  isoWeek: number;
  dayShort: string;
  dayNum: number;
  isWeekend: boolean;
  dienst: string;
  von: string;
  bis: string;
  von2: string;
  bis2: string;
  von3: string;
  bis3: string;
  /** Summe Pausen aus allen Segmenten (Stunden, z. B. 0,5) */
  pauseHours: number;
  sonstiges: string;
  soll: number;
  ist: number;
  abweichung: number;
  isPublicHoliday: boolean;
};

export type MonthlyReportPayload = {
  generatedAt: string;
  employerName: string;
  departmentName: string;
  monthLabel: string;
  month: string;
  employee: {
    id: string;
    name: string;
    personalNumber: string;
    entryDate: string | null;
    exitDate: string | null;
    contractHoursPerWeek: number;
    workDaysPerWeek: number;
  };
  vortrag: {
    zeitausgleichHours: number;
    feiertageHours: number;
    urlaubTage: number;
  };
  days: MonthlyReportDayRow[];
  summen: {
    pauseHours: number;
    soll: number;
    ist: number;
    abweichung: number;
  };
  /** Kennzahlen wie Excel-Monatsübersicht (unterhalb der Tabelle) */
  kennzahlen: {
    sollStunden: number;
    ruhetage: {
      tage: number;
      sollStunden: number;
      u0: number;
      k0: number;
    };
    arbeitstage: { tage: number; istStunden: number };
    urlaub: { tage: number; istStunden: number };
    krankheit: { tage: number; istStunden: number };
    sonderurlaubBezahlt: { tage: number; istStunden: number };
    samstagSonntag: { tage: number; istStunden: number };
    feiertageStunden: number;
    guthabenMonatsende: number;
    zeitausgleichEnde: number;
    urlaubAliquot: { tage: number; zusaetzlicheStunden: number };
  };
  endstand: {
    zeitausgleichHours: number;
  };
  unclosedWeeks: { weekStart: string; label: string }[];
  unclosedWeekRangeLabel: string | null;
  disclaimer: string;
};

export async function buildMonthlyReport(
  employeeId: string,
  monthYYYYMM: string
): Promise<MonthlyReportPayload | { error: string }> {
  if (!/^\d{4}-\d{2}$/.test(monthYYYYMM)) {
    return { error: "Ungültiger Monat (YYYY-MM)." };
  }
  const [y, m] = monthYYYYMM.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) {
    return { error: "Ungültiger Monat." };
  }

  const emp = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!emp) return { error: "Mitarbeiter nicht gefunden." };

  const fromISO = firstDayOfMonth(y, m);
  const toISO = lastDayOfMonth(y, m);
  const prevLast = addDaysISO(fromISO, -1);

  const days = enumerateDatesInclusive(fromISO, toISO);
  const weekStarts = Array.from(
    new Set(days.map((d) => weekStartISOContainingDate(d)))
  );
  const weekStartDates = weekStarts
    .map((s) => parseWeekStartParam(s))
    .filter((d): d is Date => d != null);

  const weekRows = await prisma.workWeek.findMany({
    where: { weekStart: { in: weekStartDates } },
    select: { id: true, weekStart: true, site: true, status: true },
  });

  const idsByMonday = new Map<
    string,
    { crush?: string; cappucone?: string }
  >();
  const statusByWeekId = new Map<string, WeekStatus>();
  for (const w of weekRows) {
    const key = formatWeekStart(w.weekStart);
    const cur = idsByMonday.get(key) ?? {};
    if (w.site === WorkSite.CRUSH) cur.crush = w.id;
    else cur.cappucone = w.id;
    idsByMonday.set(key, cur);
    statusByWeekId.set(w.id, w.status);
  }

  const allWeekIds = Array.from(new Set(weekRows.map((w) => w.id)));
  const cells =
    allWeekIds.length === 0
      ? []
      : await prisma.shiftCell.findMany({
          where: {
            workWeekId: { in: allWeekIds },
            employeeId,
            layer: { in: [ShiftLayer.PLAN, ShiftLayer.ACTUAL] },
          },
          select: {
            workWeekId: true,
            dayIndex: true,
            layer: true,
            rawValue: true,
            note: true,
          },
        });

  const rawLookup = new Map<string, { raw: string; note: string }>();
  const planRawLookup = new Map<string, { raw: string; note: string }>();
  for (const c of cells) {
    const key = `${c.workWeekId}|${c.dayIndex}`;
    const cell = { raw: c.rawValue ?? "", note: c.note ?? "" };
    if (c.layer === ShiftLayer.ACTUAL) rawLookup.set(key, cell);
    if (c.layer === ShiftLayer.PLAN) planRawLookup.set(key, cell);
  }

  const holidayRows = await prisma.holiday.findMany({
    where: {
      includedInPlan: true,
      date: {
        gte: new Date(`${fromISO}T00:00:00.000Z`),
        lte: new Date(`${toISO}T23:59:59.999Z`),
      },
    },
    select: { date: true },
  });
  const holidayDateSet = new Set(
    holidayRows.map((h) => h.date.toISOString().slice(0, 10))
  );

  const contractMap = await contractRowsMapForEmployees([employeeId]);
  const contractRows = contractMap.get(employeeId) ?? [];
  const cReport = contractForDate(contractRows, fromISO);

  const dayRows: MonthlyReportDayRow[] = [];
  let sumSoll = 0;
  let sumIst = 0;
  let sumPause = 0;
  let vacationUnitsMonth = 0;

  const short = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

  for (const dayISO of days) {
    const ws = weekStartISOContainingDate(dayISO);
    const di = dayIndexInWeek(ws, dayISO);
    if (di < 0 || di > 6) continue;

    const pair = idsByMonday.get(ws);
    const wids = weekIdsForEmployeeOnMonday(
      emp.workSite,
      pair?.crush,
      pair?.cappucone
    );

    const raws: string[] = [];
    const notes: string[] = [];
    for (const wid of wids) {
      const cell = rawLookup.get(`${wid}|${di}`);
      if (cell?.raw) raws.push(cell.raw);
      if (cell?.note) notes.push(cell.note);
    }
    const combinedRaw = raws.join(" | ");
    const combinedNote = notes.join(" | ");

    let dayHours = 0;
    let dayVacationUnits = 0;
    const cDay = contractForDate(contractRows, dayISO);

    for (const wid of wids) {
      const key = `${wid}|${di}`;
      const planRaw = planRawLookup.get(key)?.raw ?? "";
      const actualRaw = rawLookup.get(key)?.raw ?? "";
      const vu = vacationDayUnitsForDayPlanActual(
        planRaw,
        actualRaw,
        cDay.contractHoursPerWeek,
        cDay.workDaysPerWeek
      );
      if (vu > 0) {
        dayVacationUnits = vu;
        const rawForVac =
          actualRaw.replace(/\s+/g, " ").trim() !== "" ? actualRaw : planRaw;
        dayHours += parseShiftCellTotalHours(
          rawForVac,
          cDay.contractHoursPerWeek,
          cDay.workDaysPerWeek
        );
        break;
      }
    }
    if (dayVacationUnits === 0) {
      for (const wid of wids) {
        const raw = rawLookup.get(`${wid}|${di}`)?.raw ?? "";
        dayHours += parseShiftCellTotalHoursForDate(raw, contractRows, dayISO);
      }
    }

    if (dayVacationUnits > 0) {
      vacationUnitsMonth += dayVacationUnits;
    }

    let dayPauseMin = 0;
    for (const wid of wids) {
      const raw = rawLookup.get(`${wid}|${di}`)?.raw ?? "";
      dayPauseMin += pauseMinutesFromRaw(raw);
    }
    const pauseHours = dayPauseMin / 60;

    const soll = dailyContractHoursForDayIndex(
      di,
      cDay.contractHoursPerWeek,
      cDay.workDaysPerWeek
    );
    const ist = dayHours;
    const abw = ist - soll;

    const [yy, mm, dd] = dayISO.split("-").map(Number);
    const dt = new Date(yy!, mm! - 1, dd!, 12, 0, 0, 0);
    const dow = dt.getDay();
    const dayLabel = short[dow] ?? "";
    const isWeekend = dow === 0 || dow === 6;
    const seg = segmentTripleFromRaw(combinedRaw);

    dayRows.push({
      dateISO: dayISO,
      isoWeek: isoWeekNumberUTC(
        new Date(Date.UTC(yy!, mm! - 1, dd!, 12, 0, 0, 0))
      ),
      dayShort: dayLabel,
      dayNum: dd!,
      isWeekend,
      dienst: dienstLabel(combinedRaw, ist),
      von: seg.von,
      bis: seg.bis,
      von2: seg.von2,
      bis2: seg.bis2,
      von3: seg.von3,
      bis3: seg.bis3,
      pauseHours,
      sonstiges: combinedNote,
      soll,
      ist,
      abweichung: abw,
      isPublicHoliday: holidayDateSet.has(dayISO),
    });

    sumSoll += soll;
    sumIst += ist;
    sumPause += pauseHours;
  }

  const { balance: zaVortrag } = await getBalanceAtPeriodEnd(employeeId, prevLast);
  const urlaubSaldoMonatsende =
    emp.vacationDaysOpen + vacationUnitsMonth;

  const { balance: zaEnde } = await getBalanceAtPeriodEnd(employeeId, toISO);

  const cEnd = contractForDate(contractRows, toISO);
  const dailyH =
    cEnd.workDaysPerWeek > 0
      ? cEnd.contractHoursPerWeek / cEnd.workDaysPerWeek
      : 0;
  const urlaubFrac = urlaubSaldoMonatsende - Math.floor(urlaubSaldoMonatsende);
  const urlaubAliquotStd =
    dailyH > 0 && urlaubFrac > 0 ? urlaubFrac * dailyH : 0;

  let arbeitTage = 0;
  let arbeitStd = 0;
  let urlaubTage = 0;
  let urlaubStd = 0;
  let krankTage = 0;
  let krankStd = 0;
  let saSoTage = 0;
  let saSoStd = 0;
  let feiertagStd = 0;
  let ruhetageSoll = 0;

  for (const r of dayRows) {
    const isArbeit = r.dienst === "Dienst" && r.ist > 0;
    const isUrlaub = r.dienst === "Urlaub";
    const isKrank = r.dienst === "Krank";
    const isSonder = false;

    if (isArbeit) {
      arbeitTage++;
      arbeitStd += r.ist;
    }
    if (isUrlaub) {
      urlaubTage++;
      urlaubStd += r.ist;
    }
    if (isKrank) {
      krankTage++;
      krankStd += r.ist;
    }
    if (r.isWeekend && r.ist > 0) {
      saSoTage++;
      saSoStd += r.ist;
    }
    if (r.isPublicHoliday) {
      feiertagStd += r.ist;
    }
    if (!isArbeit && !isUrlaub && !isKrank && !isSonder) {
      ruhetageSoll += r.soll;
    }
  }

  const tageImMonat = dayRows.length;
  const ruhetageTage =
    tageImMonat - arbeitTage - urlaubTage - krankTage;

  const unclosedWeeks: { weekStart: string; label: string }[] = [];
  for (const wsIso of weekStarts) {
    const pair = idsByMonday.get(wsIso);
    const crush = pair?.crush;
    const cap = pair?.cappucone;
    let ok = true;
    if (emp.workSite === EmployeeSite.CRUSH) {
      ok = !!(crush && statusByWeekId.get(crush) === WeekStatus.CLOSED);
    } else if (emp.workSite === EmployeeSite.CAPPUCONE) {
      ok = !!(cap && statusByWeekId.get(cap) === WeekStatus.CLOSED);
    } else {
      ok =
        !!(crush && statusByWeekId.get(crush) === WeekStatus.CLOSED) &&
        !!(cap && statusByWeekId.get(cap) === WeekStatus.CLOSED);
    }
    if (!ok) {
      const d0 = parseWeekStartParam(wsIso);
      unclosedWeeks.push({
        weekStart: wsIso,
        label: `KW ${d0 ? isoWeekNumberUTC(d0) : "?"}`,
      });
    }
  }

  const unclosedWeekRangeLabel =
    unclosedWeeks.length === 0
      ? null
      : (() => {
          const sorted = [...unclosedWeeks].sort((a, b) =>
            a.weekStart.localeCompare(b.weekStart)
          );
          const first = sorted[0]!.weekStart;
          const last = sorted[sorted.length - 1]!.weekStart;
          const fmt = (iso: string) => iso.split("-").reverse().join(".");
          return first === last ? fmt(first) : `${fmt(first)} und ${fmt(last)}`;
        })();

  const monthNames = [
    "Januar",
    "Februar",
    "März",
    "April",
    "Mai",
    "Juni",
    "Juli",
    "August",
    "September",
    "Oktober",
    "November",
    "Dezember",
  ];

  return {
    generatedAt: new Date().toISOString(),
    employerName: companyEmployerName(),
    departmentName: companyDepartmentName(),
    monthLabel: `${monthNames[m - 1]!} ${y}`,
    month: monthYYYYMM,
    employee: {
      id: emp.id,
      name: emp.name,
      personalNumber: emp.personalNumber,
      entryDate: emp.entryDate ? emp.entryDate.toISOString().slice(0, 10) : null,
      exitDate: emp.exitDate ? emp.exitDate.toISOString().slice(0, 10) : null,
      contractHoursPerWeek: cReport.contractHoursPerWeek,
      workDaysPerWeek: cReport.workDaysPerWeek,
    },
    vortrag: {
      zeitausgleichHours: zaVortrag,
      feiertageHours: 0,
      urlaubTage: urlaubSaldoMonatsende,
    },
    days: dayRows,
    summen: {
      pauseHours: sumPause,
      soll: sumSoll,
      ist: sumIst,
      abweichung: sumIst - sumSoll,
    },
    kennzahlen: {
      sollStunden: sumSoll,
      ruhetage: {
        tage: ruhetageTage,
        sollStunden: ruhetageSoll,
        u0: 0,
        k0: 0,
      },
      arbeitstage: { tage: arbeitTage, istStunden: arbeitStd },
      urlaub: { tage: urlaubTage, istStunden: urlaubStd },
      krankheit: { tage: krankTage, istStunden: krankStd },
      sonderurlaubBezahlt: { tage: 0, istStunden: 0 },
      samstagSonntag: { tage: saSoTage, istStunden: saSoStd },
      feiertageStunden: feiertagStd,
      guthabenMonatsende: zaEnde,
      zeitausgleichEnde: zaEnde,
      urlaubAliquot: {
        tage: urlaubSaldoMonatsende,
        zusaetzlicheStunden: urlaubAliquotStd,
      },
    },
    endstand: {
      zeitausgleichHours: zaEnde,
    },
    unclosedWeeks,
    unclosedWeekRangeLabel,
    disclaimer: "",
  };
}
