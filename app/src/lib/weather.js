const OPEN_METEO_BASE = 'https://api.open-meteo.com/v1/forecast';
const OPEN_METEO_ARCHIVE_BASE = 'https://archive-api.open-meteo.com/v1/archive';

export async function fetchCurrentWeather(lat, lng) {
  if (lat == null || lng == null) {
    throw new Error('Missing coordinates for weather lookup');
  }

  const url = new URL(OPEN_METEO_BASE);
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lng));
  url.searchParams.set('current', 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m');
  url.searchParams.set('timezone', 'auto');

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const details = body ? ` :: ${body.slice(0, 220)}` : '';
    throw new Error(`Weather fetch failed (${res.status})${details}`);
  }

  const data = await res.json();
  const current = data?.current;
  if (!current) throw new Error('Weather fetch returned no current conditions');

  return {
    temperatureC: toFinite(current.temperature_2m),
    feelsLikeC: toFinite(current.apparent_temperature),
    windKph: toFinite(current.wind_speed_10m),
    windDirectionDeg: toFinite(current.wind_direction_10m),
    weatherCode: toFinite(current.weather_code),
    summary: weatherCodeLabel(toFinite(current.weather_code)),
    fetchedAt: current.time || new Date().toISOString(),
    source: 'open-meteo',
  };
}

export async function fetchWeatherAtTime(lat, lng, observedAt) {
  if (lat == null || lng == null) {
    throw new Error('Missing coordinates for weather lookup');
  }

  const target = observedAt ? new Date(observedAt) : new Date();
  const now = new Date();
  const useArchive = target.getTime() < now.getTime() - (2 * 60 * 60 * 1000);

  const dateKey = isoDateUTC(target);
  const url = new URL(useArchive ? OPEN_METEO_ARCHIVE_BASE : OPEN_METEO_BASE);
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lng));
  url.searchParams.set('hourly', 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m');
  url.searchParams.set('timezone', 'UTC');
  url.searchParams.set('start_date', dateKey);
  url.searchParams.set('end_date', dateKey);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const details = body ? ` :: ${body.slice(0, 220)}` : '';
    throw new Error(`Weather timed fetch failed (${res.status})${details}`);
  }

  const data = await res.json();
  const snap = nearestHourlySnapshot(data?.hourly, target);
  if (!snap) {
    // Fallback to current when timed data is unavailable.
    return fetchCurrentWeather(lat, lng);
  }

  return {
    temperatureC: toFinite(snap.temperature_2m),
    feelsLikeC: toFinite(snap.apparent_temperature),
    windKph: toFinite(snap.wind_speed_10m),
    windDirectionDeg: toFinite(snap.wind_direction_10m),
    weatherCode: toFinite(snap.weather_code),
    summary: weatherCodeLabel(toFinite(snap.weather_code)),
    fetchedAt: snap.time || target.toISOString(),
    source: useArchive ? 'open-meteo-archive' : 'open-meteo-forecast-hourly',
  };
}

function nearestHourlySnapshot(hourly, targetDate) {
  if (!hourly?.time?.length) return null;
  const t = targetDate.getTime();
  let bestIdx = -1;
  let bestDelta = Number.POSITIVE_INFINITY;

  for (let i = 0; i < hourly.time.length; i += 1) {
    const ts = Date.parse(hourly.time[i]);
    if (!Number.isFinite(ts)) continue;
    const delta = Math.abs(ts - t);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIdx = i;
    }
  }

  if (bestIdx < 0) return null;
  return {
    time: hourly.time[bestIdx],
    temperature_2m: hourly.temperature_2m?.[bestIdx],
    apparent_temperature: hourly.apparent_temperature?.[bestIdx],
    weather_code: hourly.weather_code?.[bestIdx],
    wind_speed_10m: hourly.wind_speed_10m?.[bestIdx],
    wind_direction_10m: hourly.wind_direction_10m?.[bestIdx],
  };
}

function isoDateUTC(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10);
}

function toFinite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function weatherCodeLabel(code) {
  const map = {
    0: 'Clear',
    1: 'Mostly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Fog',
    48: 'Rime fog',
    51: 'Light drizzle',
    53: 'Drizzle',
    55: 'Heavy drizzle',
    56: 'Freezing drizzle',
    57: 'Heavy freezing drizzle',
    61: 'Light rain',
    63: 'Rain',
    65: 'Heavy rain',
    66: 'Freezing rain',
    67: 'Heavy freezing rain',
    71: 'Light snow',
    73: 'Snow',
    75: 'Heavy snow',
    77: 'Snow grains',
    80: 'Rain showers',
    81: 'Heavy rain showers',
    82: 'Violent rain showers',
    85: 'Snow showers',
    86: 'Heavy snow showers',
    95: 'Thunderstorm',
    96: 'Thunderstorm with hail',
    99: 'Severe thunderstorm with hail',
  };
  return map[code] || 'Unknown';
}
