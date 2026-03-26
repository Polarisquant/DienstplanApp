import { NextResponse } from "next/server";
import { addDaysISO } from "@/lib/dateNav";
import { mapOpenMeteoDailyToDays, type OpenMeteoDailyJson } from "@/lib/openMeteoWeather";

export const dynamic = "force-dynamic";

/**
 * Vorhersage für Mo–So einer Kalenderwoche (Open-Meteo).
 * Standort: WEATHER_LATITUDE / WEATHER_LONGITUDE (Standard: Salzburg).
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const weekStart = searchParams.get("weekStart");
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return NextResponse.json(
      { error: "Query weekStart=YYYY-MM-DD (Montag) erforderlich." },
      { status: 400 }
    );
  }

  const lat = Number(
    process.env.WEATHER_LATITUDE ?? process.env.NEXT_PUBLIC_WEATHER_LATITUDE ?? "47.8095"
  );
  const lon = Number(
    process.env.WEATHER_LONGITUDE ?? process.env.NEXT_PUBLIC_WEATHER_LONGITUDE ?? "13.0550"
  );
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    return NextResponse.json(
      { error: "WEATHER_LATITUDE / WEATHER_LONGITUDE ungültig." },
      { status: 500 }
    );
  }

  const endSunday = addDaysISO(weekStart, 6);

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set(
    "daily",
    "weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_gusts_10m_max"
  );
  url.searchParams.set("timezone", "Europe/Vienna");
  url.searchParams.set("start_date", weekStart);
  url.searchParams.set("end_date", endSunday);

  try {
    const res = await fetch(url.toString(), {
      next: { revalidate: 3600 },
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: "Wetterdienst antwortet nicht (HTTP)." },
        { status: 502 }
      );
    }
    const json = (await res.json()) as OpenMeteoDailyJson & { reason?: string };
    if (json.reason) {
      return NextResponse.json(
        { error: `Wetterdienst: ${json.reason}` },
        { status: 502 }
      );
    }
    const days = mapOpenMeteoDailyToDays(json);
    if (days.length === 0) {
      return NextResponse.json(
        { error: "Keine Wetterdaten für diesen Zeitraum." },
        { status: 404 }
      );
    }

    const locationName =
      process.env.WEATHER_LOCATION_NAME?.trim() || "Salzburg (Umgebung)";

    return NextResponse.json({
      weekStart,
      weekEnd: endSunday,
      locationName,
      latitude: lat,
      longitude: lon,
      days,
      attribution: "Wetterdaten: Open-Meteo (open-meteo.com)",
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Wetterdaten konnten nicht geladen werden." },
      { status: 502 }
    );
  }
}
