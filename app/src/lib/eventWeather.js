export const EVENT_WEATHER_FIELD_KEYS = [
  'weatherTempC',
  'weatherFeelsLikeC',
  'weatherWindKph',
  'weatherWindDirectionDeg',
  'weatherCode',
  'weatherSummary',
  'weatherFetchedAt',
  'weatherSource',
  'weatherObservation',
  'weatherSyncPending',
];

export function eventHasWeather(event) {
  return Boolean(
    event?.weatherSyncPending
    || event?.weatherSummary
    || event?.weatherTempC != null,
  );
}

export function weatherFieldsFromSnapshot(snapshot, { syncPending = false } = {}) {
  if (!snapshot) {
    return { weatherSyncPending: syncPending || undefined };
  }
  return {
    weatherTempC: snapshot.temperatureC ?? null,
    weatherFeelsLikeC: snapshot.feelsLikeC ?? null,
    weatherWindKph: snapshot.windKph ?? null,
    weatherWindDirectionDeg: snapshot.windDirectionDeg ?? null,
    weatherCode: snapshot.weatherCode ?? null,
    weatherSummary: snapshot.summary ?? null,
    weatherFetchedAt: snapshot.fetchedAt ?? null,
    weatherSource: snapshot.source ?? null,
    weatherSyncPending: syncPending ? true : false,
  };
}

export function pickEventWeatherFields(source) {
  return {
    observedAt: source?.observedAt || null,
    weatherTempC: source?.weatherTempC ?? null,
    weatherFeelsLikeC: source?.weatherFeelsLikeC ?? null,
    weatherWindKph: source?.weatherWindKph ?? null,
    weatherWindDirectionDeg: source?.weatherWindDirectionDeg ?? null,
    weatherCode: source?.weatherCode ?? null,
    weatherSummary: source?.weatherSummary || null,
    weatherFetchedAt: source?.weatherFetchedAt || null,
    weatherSource: source?.weatherSource || null,
    weatherObservation: source?.weatherObservation || '',
    weatherSyncPending: Boolean(source?.weatherSyncPending),
  };
}

export function resolveObservedAtIso({ observedTimeMode, observedDate, observedTime }) {
  if (observedTimeMode !== 'custom') return new Date().toISOString();
  if (!observedDate || !observedTime) return new Date().toISOString();
  const parsed = new Date(`${observedDate}T${observedTime}`);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
}

export function observedAtToDateTimeFields(observedAt) {
  const dt = observedAt ? new Date(observedAt) : new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return {
    observedTimeMode: observedAt ? 'custom' : 'now',
    observedDate: `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`,
    observedTime: `${pad(dt.getHours())}:${pad(dt.getMinutes())}`,
  };
}

export function buildCustomEventDraft(event) {
  const timeFields = observedAtToDateTimeFields(event?.observedAt);
  return {
    observedTimeMode: timeFields.observedTimeMode,
    observedDate: timeFields.observedDate,
    observedTime: timeFields.observedTime,
    weatherObservation: event?.weatherObservation || '',
    weatherTempC: event?.weatherTempC ?? null,
    weatherFeelsLikeC: event?.weatherFeelsLikeC ?? null,
    weatherWindKph: event?.weatherWindKph ?? null,
    weatherWindDirectionDeg: event?.weatherWindDirectionDeg ?? null,
    weatherCode: event?.weatherCode ?? null,
    weatherSummary: event?.weatherSummary ?? null,
    weatherFetchedAt: event?.weatherFetchedAt ?? null,
    weatherSource: event?.weatherSource ?? null,
    weatherSyncPending: Boolean(event?.weatherSyncPending),
  };
}

export function celsiusToF(c) {
  return (c * 9) / 5 + 32;
}
