/**
 * Open-Meteo (https://open-meteo.com) — kostenlose Vorhersage, ohne API-Key.
 * Datenbasis u. a. ECMWF IFS, DWD ICON, GFS (je nach Region variabel).
 */

export type WeatherDayClient = {
  dateISO: string;
  tempMin: number;
  tempMax: number;
  /** 0–100 % */
  precipProbMax: number | null;
  /** km/h */
  windGustsMax: number | null;
  weatherCode: number;
  labelDe: string;
  symbol: string;
};

/** WMO Weather interpretation codes (https://open-meteo.com/en/docs) */
export function wmoCodeToGerman(code: number): { labelDe: string; symbol: string } {
  if (code === 0) return { labelDe: "Klar", symbol: "☀️" };
  if (code === 1) return { labelDe: "Überwiegend klar", symbol: "🌤️" };
  if (code === 2) return { labelDe: "Teilweise bewölkt", symbol: "⛅" };
  if (code === 3) return { labelDe: "Bewölkt", symbol: "☁️" };
  if (code === 45 || code === 48) return { labelDe: "Nebel", symbol: "🌫️" };
  if (code >= 51 && code <= 55) return { labelDe: "Nieselregen", symbol: "🌦️" };
  if (code >= 56 && code <= 57) return { labelDe: "Gefrierender Niesel", symbol: "🌨️" };
  if (code >= 61 && code <= 65) return { labelDe: "Regen", symbol: "🌧️" };
  if (code >= 66 && code <= 67) return { labelDe: "Gefrierender Regen", symbol: "🌨️" };
  if (code >= 71 && code <= 77) return { labelDe: "Schnee", symbol: "❄️" };
  if (code >= 80 && code <= 82) return { labelDe: "Schauer", symbol: "🌧️" };
  if (code === 85 || code === 86) return { labelDe: "Schneeschauer", symbol: "🌨️" };
  if (code >= 95 && code <= 99) return { labelDe: "Gewitter", symbol: "⛈️" };
  return { labelDe: "Gemischt", symbol: "🌡️" };
}

export type OpenMeteoDailyJson = {
  daily?: {
    time?: string[];
    weathercode?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: (number | null)[];
    wind_gusts_10m_max?: (number | null)[];
  };
};

export function mapOpenMeteoDailyToDays(json: OpenMeteoDailyJson): WeatherDayClient[] {
  const d = json.daily;
  if (!d?.time?.length) return [];
  const out: WeatherDayClient[] = [];
  const n = d.time.length;
  for (let i = 0; i < n; i++) {
    const dateISO = d.time[i]!;
    const code = d.weathercode?.[i] ?? 0;
    const { labelDe, symbol } = wmoCodeToGerman(code);
    const tMax = d.temperature_2m_max?.[i];
    const tMin = d.temperature_2m_min?.[i];
    if (tMax === undefined || tMin === undefined) continue;
    const precip = d.precipitation_probability_max?.[i];
    const wind = d.wind_gusts_10m_max?.[i];
    out.push({
      dateISO,
      tempMin: Math.round(tMin * 10) / 10,
      tempMax: Math.round(tMax * 10) / 10,
      precipProbMax:
        precip != null && Number.isFinite(precip) ? Math.round(precip) : null,
      windGustsMax:
        wind != null && Number.isFinite(wind) ? Math.round(wind * 10) / 10 : null,
      weatherCode: code,
      labelDe,
      symbol,
    });
  }
  return out;
}
