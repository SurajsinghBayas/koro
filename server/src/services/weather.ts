/** Weather for the phone's location: Open-Meteo (free, no key) + air quality + place name. Cached 15 min per ~1 km. */
export type Weather = {
  place: string | null;
  now: { temp: number; feels: number; code: number; wind: number; humidity: number; isDay: boolean };
  today: { max: number; min: number; rainChance: number; sunrise: string; sunset: string; uv: number };
  hours: { at: string; temp: number; code: number; rain: number }[];
  aqi: number | null;
  rainSoon: string | null; // e.g. "Rain likely around 17:00"
  at: string;
};
const cache = new Map<string, { at: number; w: Weather }>();
const places = new Map<string, string | null>();

async function j<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { 'user-agent': 'Koro/1.0 (personal app)' }, signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw new Error(`${new URL(url).hostname} ${r.status}`);
  return (await r.json()) as T;
}

async function placeName(lat: number, lon: number) {
  const k = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  if (places.has(k)) return places.get(k)!;
  try {
    const p = await j<{ locality?: string; city?: string; principalSubdivision?: string }>(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
    const name = p.locality || p.city || p.principalSubdivision || null;
    places.set(k, name);
    return name;
  } catch { return null; }
}

/** First hour in the next 6 with ≥ 50 % rain chance. Exported for tests. */
export function rainSoon(hours: Weather['hours'], now = Date.now()): string | null {
  const h = hours.find((x) => Date.parse(x.at) >= now - 3_600_000 && Date.parse(x.at) <= now + 6 * 3_600_000 && x.rain >= 50);
  return h ? `Rain likely around ${h.at.slice(11, 16)}` : null;
}

export async function getWeather(lat: number, lon: number, tz: string): Promise<Weather> {
  const k = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < 15 * 60_000) return hit.w;
  const q = `latitude=${lat}&longitude=${lon}&timezone=${encodeURIComponent(tz)}`;
  const [f, aq, place] = await Promise.all([
    j<any>(`https://api.open-meteo.com/v1/forecast?${q}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m,is_day` +
      `&hourly=temperature_2m,weather_code,precipitation_probability&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max&forecast_days=2`),
    j<any>(`https://air-quality-api.open-meteo.com/v1/air-quality?${q}&current=us_aqi`).catch(() => null),
    placeName(lat, lon),
  ]);
  const nowIdx = Math.max(0, (f.hourly.time as string[]).findIndex((t) => t >= f.current.time.slice(0, 13)));
  // Open-Meteo returns local wall-clock times; tag them with the offset so the app can compare instants.
  const off = (s: number) => `${s < 0 ? '-' : '+'}${String(Math.floor(Math.abs(s) / 3600)).padStart(2, '0')}:${String((Math.abs(s) % 3600) / 60).padStart(2, '0')}`;
  const tag = (t: string) => `${t}:00${off(f.utc_offset_seconds ?? 0)}`;
  const hours = (f.hourly.time as string[]).slice(nowIdx, nowIdx + 12).map((t, i) => ({
    at: tag(t), temp: Math.round(f.hourly.temperature_2m[nowIdx + i]), code: f.hourly.weather_code[nowIdx + i], rain: f.hourly.precipitation_probability[nowIdx + i] ?? 0,
  }));
  const w: Weather = {
    place,
    now: { temp: Math.round(f.current.temperature_2m), feels: Math.round(f.current.apparent_temperature), code: f.current.weather_code,
      wind: Math.round(f.current.wind_speed_10m), humidity: f.current.relative_humidity_2m, isDay: !!f.current.is_day },
    today: { max: Math.round(f.daily.temperature_2m_max[0]), min: Math.round(f.daily.temperature_2m_min[0]), rainChance: f.daily.precipitation_probability_max[0] ?? 0,
      sunrise: tag(f.daily.sunrise[0]), sunset: tag(f.daily.sunset[0]), uv: Math.round(f.daily.uv_index_max[0] ?? 0) },
    hours,
    aqi: aq?.current?.us_aqi ?? null,
    rainSoon: rainSoon(hours),
    at: new Date().toISOString(),
  };
  cache.set(k, { at: Date.now(), w });
  return w;
}
