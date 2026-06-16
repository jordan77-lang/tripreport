import { saveTrip } from './storage';

export const TRIP_TYPES = [
  'Backpacking',
  'Car Camping',
  'Rafting',
  'River Camping',
  'Overlanding',
  'Van Life',
  'Day Hike',
  'Paddling',
];

export function buildTripDraft(trip) {
  return {
    name: trip?.name || '',
    location: trip?.location || '',
    types: Array.isArray(trip?.types) ? [...trip.types] : [],
    startDate: trip?.startDate || '',
    endDate: trip?.endDate || '',
    privacy: trip?.privacy || 'private',
    gpsTrackingEnabled: Boolean(trip?.gpsTrackingEnabled),
    gpsBackgroundTracking: Boolean(trip?.gpsBackgroundTracking),
    gpsIntervalMs: trip?.gpsIntervalMs || 5000,
    coverPhoto: trip?.coverPhoto || null,
  };
}

export function formatTripDate(value) {
  if (!value) return 'TBD';
  const d = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return 'TBD';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatTripDateRange(startDate, endDate) {
  if (!startDate && !endDate) return 'Dates not set';
  if (startDate && endDate && startDate !== endDate) {
    return `${formatTripDate(startDate)} – ${formatTripDate(endDate)}`;
  }
  return formatTripDate(startDate || endDate);
}

export function saveTripDetailsFromDraft(trip, draft) {
  if (!trip) return null;
  const nextName = (draft.name || '').trim();
  if (!nextName) return null;

  const startDate = draft.startDate || null;
  const endDate = draft.endDate || null;
  if (startDate && endDate && endDate < startDate) {
    throw new Error('End date must be on or after the start date.');
  }

  return saveTrip({
    ...trip,
    name: nextName,
    location: (draft.location || '').trim(),
    types: Array.isArray(draft.types) ? draft.types : trip.types || [],
    startDate,
    endDate,
    privacy: draft.privacy || trip.privacy || 'private',
    gpsTrackingEnabled: Boolean(draft.gpsTrackingEnabled),
    gpsBackgroundTracking: draft.gpsTrackingEnabled ? Boolean(draft.gpsBackgroundTracking) : false,
    gpsIntervalMs: draft.gpsIntervalMs || 5000,
    coverPhoto: draft.coverPhoto || null,
    updatedAt: Date.now(),
    syncState: 'pending',
  });
}
