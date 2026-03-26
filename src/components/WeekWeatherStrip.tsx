"use client";

type Day = {
  dateISO: string;
  tempMin: number;
  tempMax: number;
  precipProbMax: number | null;
  windGustsMax: number | null;
  labelDe: string;
  symbol: string;
};

type Props = {
  days: Day[];
  locationName: string;
  attribution: string;
  weekDayLabels: string[];
};

function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!d || !m) return iso;
  return `${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}.`;
}

export function WeekWeatherStrip({
  days,
  locationName,
  attribution,
  weekDayLabels,
}: Props) {
  return (
    <div className="mb-4 rounded-2xl border border-slate-200/90 bg-white/90 px-3 py-3 shadow-sm backdrop-blur-sm print:hidden">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Woche · {locationName}
        </p>
        <p className="text-[10px] text-slate-400">{attribution}</p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {days.map((d, i) => (
          <div
            key={d.dateISO}
            className="flex flex-col rounded-xl border border-slate-100 bg-gradient-to-b from-slate-50/80 to-white px-2 py-2 text-center"
          >
            <span className="text-[10px] font-medium text-slate-500">
              {weekDayLabels[i] ?? ""} · {shortDate(d.dateISO)}
            </span>
            <span className="my-1 text-2xl leading-none" aria-hidden>
              {d.symbol}
            </span>
            <span className="text-[11px] leading-tight text-slate-700">{d.labelDe}</span>
            <span className="mt-1 text-sm font-semibold tabular-nums text-slate-900">
              {d.tempMax}° / {d.tempMin}°
            </span>
            <span className="mt-0.5 text-[10px] tabular-nums text-slate-500">
              {d.precipProbMax != null ? `Regen ${d.precipProbMax} %` : "—"}
              {d.windGustsMax != null ? ` · Wind ${d.windGustsMax} km/h` : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function WeekWeatherSkeleton() {
  return (
    <div className="mb-4 animate-pulse rounded-2xl border border-slate-200/80 bg-white/60 px-3 py-4 print:hidden">
      <div className="mb-3 h-3 w-40 rounded bg-slate-200" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="h-28 rounded-xl bg-slate-100" />
        ))}
      </div>
    </div>
  );
}
