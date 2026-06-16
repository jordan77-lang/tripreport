import { createMediaObjectUrl, getMediaRecord, isLegacyMediaRef } from './mediaStore';

/** Collect photos from a trip for slideshow / report. */
export function collectTripPhotos(trip, { scope = 'trip', day = null, locationId = null, eventId = null } = {}) {
  if (!trip) return [];

  const out = [];
  const seen = new Set();

  function add(media, meta) {
    if (!media) return;
    const hasRef = media.id || media.thumbDataUrl || media.dataUrl;
    if (!hasRef) return;
    const key = media.id || `${meta.source}-${meta.at}-${out.length}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      id: media.id || key,
      media,
      caption: meta.caption || '',
      at: meta.at || null,
      day: meta.day || null,
      locationId: meta.locationId || null,
      locationName: meta.locationName || null,
      eventId: meta.eventId || null,
      eventName: meta.eventName || null,
      source: meta.source,
    });
  }

  const locById = new Map((trip.locations || []).map((l) => [l.id, l]));
  const eventById = new Map((trip.events || []).map((e) => [e.id, e]));

  if (trip.coverPhoto) {
    add(trip.coverPhoto, {
      caption: `${trip.name} cover`,
      at: trip.startedAt || trip.createdAt,
      day: dayKey(trip.startedAt || trip.createdAt),
      source: 'trip-cover',
    });
  }

  for (const loc of trip.locations || []) {
    if (loc.coverPhoto) {
      add(loc.coverPhoto, {
        caption: loc.name,
        at: loc.observedAt || loc.observedStartAt,
        day: dayKey(loc.observedAt || loc.observedStartAt),
        locationId: loc.id,
        locationName: loc.name,
        source: 'location-cover',
      });
    }
  }

  for (const ev of trip.events || []) {
    if (ev.coverPhoto) {
      const loc = locById.get(ev.locationId);
      add(ev.coverPhoto, {
        caption: ev.name,
        at: ev.observedAt || ev.createdAt,
        day: dayKey(ev.observedAt || ev.createdAt),
        locationId: ev.locationId,
        locationName: loc?.name,
        eventId: ev.id,
        eventName: ev.name,
        source: 'event-cover',
      });
    }
  }

  for (const entry of trip.entries || []) {
    const loc = entry.locationId ? locById.get(entry.locationId) : null;
    const ev = entry.eventId ? eventById.get(entry.eventId) : null;
    const at = entry.observedAt || entry.createdAt;
    const caption = [entry.title || entry.type, entry.photoNotes, entry.notes].filter(Boolean).join(' — ');
    for (const f of entry.photoFiles || []) {
      add(f, {
        caption: truncate(caption, 200),
        at,
        day: dayKey(at),
        locationId: entry.locationId,
        locationName: loc?.name || entry.locationName,
        eventId: entry.eventId,
        eventName: ev?.name || entry.eventName,
        source: 'entry',
      });
    }
  }

  let filtered = out;
  if (scope === 'day' && day) filtered = filtered.filter((p) => p.day === day);
  if (scope === 'location' && locationId) filtered = filtered.filter((p) => p.locationId === locationId);
  if (scope === 'event' && eventId) filtered = filtered.filter((p) => p.eventId === eventId);

  return filtered.sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
}

export function listTripDays(trip) {
  const days = new Set();
  for (const p of collectTripPhotos(trip)) {
    if (p.day && p.day !== 'unknown') days.add(p.day);
  }
  for (const e of trip?.entries || []) {
    const d = dayKey(e.observedAt || e.createdAt);
    if (d !== 'unknown') days.add(d);
  }
  return [...days].sort();
}

/** Pick photos and encode as JPEG base64 for OpenAI vision (size-limited). */
export async function preparePhotosForApi(trip, settings = {}) {
  const maxPhotos = settings.photoScope === 'all' ? 30 : 18;
  let photos = collectTripPhotos(trip);

  if (settings.photoScope === 'best') {
    photos = pickBestPerDay(photos, 3);
  }

  photos = photos.slice(0, maxPhotos);
  const payload = [];

  for (const p of photos) {
    try {
      const encoded = await mediaToApiImage(p.media, { maxSide: 1024, quality: 0.82 });
      if (!encoded) continue;
      payload.push({
        id: p.id,
        label: p.caption || p.locationName || p.eventName || 'Trip photo',
        day: p.day,
        locationName: p.locationName,
        eventName: p.eventName,
        mime: encoded.mime,
        base64: encoded.base64,
      });
    } catch (e) {
      console.warn('Could not encode photo for API', p.id, e);
    }
  }

  return payload;
}

function pickBestPerDay(photos, perDay) {
  const byDay = new Map();
  for (const p of photos) {
    const d = p.day || 'unknown';
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(p);
  }
  const out = [];
  for (const [, list] of byDay) {
    out.push(...list.slice(0, perDay));
  }
  return out;
}

async function mediaToApiImage(media, { maxSide, quality }) {
  if (isLegacyMediaRef(media)) {
    const src = media.dataUrl || media.thumbDataUrl;
    if (!src) return null;
    return dataUrlToJpegBase64(src, { maxSide, quality });
  }
  if (!media.id) return null;

  const record = await getMediaRecord(media.id);
  const blob = record?.fullBlob || record?.thumbBlob;
  if (!blob) {
    const url = await createMediaObjectUrl(media.id, { preferThumb: false });
    if (!url) return null;
    try {
      return await blobUrlToJpegBase64(url, { maxSide, quality });
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    return await blobUrlToJpegBase64(url, { maxSide, quality });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function blobUrlToJpegBase64(url, { maxSide, quality }) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const ratio = Math.min(1, maxSide / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * ratio));
        const h = Math.max(1, Math.round(img.height * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        const base64 = dataUrl.split(',')[1];
        resolve({ mime: 'image/jpeg', base64 });
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = url;
  });
}

function dataUrlToJpegBase64(dataUrl, { maxSide, quality }) {
  return blobUrlToJpegBase64(dataUrl, { maxSide, quality });
}

function dayKey(ts) {
  if (!ts) return 'unknown';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return 'unknown';
  return d.toISOString().slice(0, 10);
}

function truncate(s, max) {
  const t = String(s || '');
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}
