import { collectTripPhotos } from './tripPhotos';

/** Build structured trip data for AI report generation (text only). */

export function buildTripManifest(trip) {
  if (!trip) return null;

  const entries = [...(trip.entries || [])].sort(
    (a, b) => new Date(a.observedAt || a.createdAt || 0) - new Date(b.observedAt || b.createdAt || 0),
  );
  const locations = trip.locations || [];
  const events = trip.events || [];
  const locById = new Map(locations.map((l) => [l.id, l]));
  const eventById = new Map(events.map((e) => [e.id, e]));

  const dayMap = new Map();

  for (const entry of entries) {
    const dayKey = dayKeyFromTs(entry.observedAt || entry.createdAt);
    if (!dayMap.has(dayKey)) dayMap.set(dayKey, { date: dayKey, entries: [], locations: new Set(), events: new Set() });
    const bucket = dayMap.get(dayKey);
    const loc = entry.locationId ? locById.get(entry.locationId) : null;
    const ev = entry.eventId ? eventById.get(entry.eventId) : null;
    if (loc) bucket.locations.add(loc.name);
    if (ev) bucket.events.add(ev.name);
    bucket.entries.push({
      id: entry.id,
      time: entry.observedAt || entry.createdAt,
      type: entry.type,
      title: entry.title || entry.type,
      notes: truncate(entry.notes, 800),
      locationName: loc?.name || entry.locationName,
      eventName: ev?.name || entry.eventName,
      cfs: entry.cfs ?? null,
      gaugeSiteName: entry.gaugeSiteName || null,
      weatherSummary: entry.weatherSummary || null,
      weatherTempC: entry.weatherTempC ?? null,
      featureType: entry.featureType || null,
      rapidClass: entry.rapidClass || null,
      photoCount: (entry.photoFiles || []).length,
    });
  }

  const days = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, d]) => ({
      date: d.date,
      locations: [...d.locations],
      events: [...d.events],
      entries: d.entries,
    }));

  const stats = computeManifestStats(trip, entries);
  const photos = collectTripPhotos(trip).map((p) => ({
    id: p.id,
    label: p.caption || p.locationName || p.eventName || 'Trip photo',
    day: p.day,
    locationName: p.locationName || null,
    eventName: p.eventName || null,
  }));

  return {
    tripId: trip.id,
    name: trip.name,
    location: trip.location,
    types: trip.types || [],
    startDate: trip.startDate,
    endDate: trip.endDate || (trip.endedAt ? new Date(trip.endedAt).toISOString().slice(0, 10) : null),
    participants: (trip.collaborators || []).map((c) => c.handle || c.name).filter(Boolean),
    stats,
    photos,
    days,
    locationSummaries: locations.map((l) => ({
      id: l.id,
      name: l.name,
      type: l.type,
      notes: truncate(l.notes, 400),
      observedAt: l.observedAt || l.observedStartAt,
    })),
    eventSummaries: events.map((e) => ({
      id: e.id,
      name: e.name,
      type: e.type,
      locationName: locById.get(e.locationId)?.name,
      notes: truncate(e.notes, 400),
    })),
  };
}

export function manifestContentHash(manifest) {
  const raw = JSON.stringify(manifest);
  let hash = 0;
  for (let i = 0; i < raw.length; i++) hash = ((hash << 5) - hash) + raw.charCodeAt(i);
  return String(hash >>> 0);
}

function computeManifestStats(trip, entries) {
  const track = trip.track || [];
  let distanceM = 0;
  for (let i = 1; i < track.length; i++) {
    distanceM += haversineM(track[i - 1].lat, track[i - 1].lng, track[i].lat, track[i].lng);
  }
  const flows = entries.filter((e) => e.cfs != null).map((e) => e.cfs);
  const temps = entries.filter((e) => e.weatherTempC != null).map((e) => e.weatherTempC);
  return {
    entryCount: entries.length,
    locationCount: (trip.locations || []).length,
    trackPoints: track.length,
    distanceMi: (distanceM / 1609.34).toFixed(1),
    cfsMin: flows.length ? Math.round(Math.min(...flows)) : null,
    cfsMax: flows.length ? Math.round(Math.max(...flows)) : null,
    tempMinC: temps.length ? Math.round(Math.min(...temps)) : null,
    tempMaxC: temps.length ? Math.round(Math.max(...temps)) : null,
  };
}

function dayKeyFromTs(ts) {
  if (!ts) return 'unknown';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return 'unknown';
  return d.toISOString().slice(0, 10);
}

function truncate(s, max) {
  const t = String(s || '').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
