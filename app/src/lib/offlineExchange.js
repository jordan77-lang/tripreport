const SCHEMA_VERSION = 1;
const APP_ID = 'TripReport';
const UPDATE_KIND = 'trip-update';
const FILE_MIME = 'application/json';

const COLLECTIONS = [
  'locations', 'events', 'entries', 'track', 'trackSessions', 'collaborators',
  'gearItems', 'meals', 'expenses', 'shoppingItems',
];

export async function exportTripUpdateFile(trip, sourceUserId) {
  const update = createTripUpdate(trip, sourceUserId);
  const json = JSON.stringify(update, null, 2);
  const filename = `${slugify(trip?.name || 'trip')}-${Date.now()}.tripreport-update.json`;
  const file = createUpdateFile(json, filename);

  const shareResult = await shareUpdateFile(file, trip);
  if (shareResult) {
    return { update, delivery: shareResult };
  }

  triggerDownload(file, filename);
  return { update, delivery: 'downloaded' };
}

export function createTripUpdate(trip, sourceUserId) {
  if (!trip?.id) throw new Error('A trip is required to export an update.');

  return {
    schemaVersion: SCHEMA_VERSION,
    app: APP_ID,
    kind: UPDATE_KIND,
    tripId: trip.id,
    tripName: trip.name || 'Trip',
    sourceUserId: sourceUserId || null,
    exportedAt: Date.now(),
    payload: sanitizeForExchange({
      trip: {
        id: trip.id,
        name: trip.name,
        types: trip.types || [],
        location: trip.location,
        startDate: trip.startDate,
        endDate: trip.endDate,
        privacy: trip.privacy,
        status: trip.status,
        ownerId: trip.ownerId,
        createdAt: trip.createdAt,
        updatedAt: trip.updatedAt,
      },
      locations: trip.locations || [],
      events: trip.events || [],
      entries: trip.entries || [],
      track: trip.track || [],
      trackSessions: trip.trackSessions || [],
      collaborators: trip.collaborators || [],
      gearItems: trip.gearItems || [],
      meals: trip.meals || [],
      expenses: trip.expenses || [],
      shoppingItems: trip.shoppingItems || [],
    }),
  };
}

export async function readTripUpdateFile(file) {
  if (!file) throw new Error('Choose a TripReport update file first.');
  const text = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  validateTripUpdate(parsed);
  return parsed;
}

export function mergeTripUpdate(localTrip, update) {
  validateTripUpdate(update);
  if (!localTrip?.id) throw new Error('Open a trip before importing an update.');
  if (localTrip.id !== update.tripId) {
    throw new Error(`This update belongs to a different trip: ${update.tripName || update.tripId}.`);
  }

  const payload = update.payload || {};
  const summary = {
    added: 0,
    updated: 0,
    ignored: 0,
    byCollection: {},
  };

  const merged = { ...localTrip };
  for (const name of COLLECTIONS) {
    const result = mergeCollection(localTrip[name] || [], payload[name] || [], name);
    merged[name] = result.items;
    summary.added += result.added;
    summary.updated += result.updated;
    summary.ignored += result.ignored;
    summary.byCollection[name] = {
      added: result.added,
      updated: result.updated,
      ignored: result.ignored,
    };
  }

  const remoteTrip = payload.trip || {};
  if (remoteTrip.updatedAt && (!localTrip.updatedAt || remoteTrip.updatedAt > localTrip.updatedAt)) {
    for (const field of ['name', 'types', 'location', 'startDate', 'endDate', 'privacy']) {
      if (remoteTrip[field] !== undefined) merged[field] = remoteTrip[field];
    }
  }

  merged.updatedAt = Math.max(localTrip.updatedAt || 0, remoteTrip.updatedAt || 0, update.exportedAt || 0, Date.now());
  merged.syncState = 'pending';

  return {
    trip: merged,
    summary,
    sourceUserId: update.sourceUserId || null,
    exportedAt: update.exportedAt || null,
  };
}

export function formatMergeSummary(summary) {
  if (!summary) return 'No update imported.';
  const parts = [];
  for (const [name, counts] of Object.entries(summary.byCollection || {})) {
    const changed = (counts.added || 0) + (counts.updated || 0);
    if (changed > 0) parts.push(`${changed} ${labelForCollection(name)}`);
  }
  if (!parts.length) return 'No new changes found in that update.';
  return `Imported ${parts.join(', ')}.`;
}

function validateTripUpdate(update) {
  if (!update || typeof update !== 'object') throw new Error('That file is not a TripReport update.');
  if (update.app !== APP_ID || update.kind !== UPDATE_KIND) throw new Error('That file is not a TripReport update.');
  if (update.schemaVersion !== SCHEMA_VERSION) throw new Error('This TripReport update format is not supported.');
  if (!update.tripId || !update.payload) throw new Error('This update file is missing trip data.');
}

function mergeCollection(localItems, remoteItems, collectionName) {
  const items = [...localItems];
  const index = new Map();

  items.forEach((item, idx) => {
    index.set(recordKey(item, collectionName), idx);
  });

  let added = 0;
  let updated = 0;
  let ignored = 0;

  for (const remote of remoteItems) {
    if (!remote || typeof remote !== 'object') {
      ignored += 1;
      continue;
    }

    const key = recordKey(remote, collectionName);
    const existingIdx = index.get(key);
    if (existingIdx == null) {
      items.push(remote);
      index.set(key, items.length - 1);
      added += 1;
      continue;
    }

    const existing = items[existingIdx];
    if ((remote.updatedAt || remote.createdAt || remote.ts || 0) > (existing.updatedAt || existing.createdAt || existing.ts || 0)) {
      items[existingIdx] = { ...existing, ...remote };
      updated += 1;
    } else {
      ignored += 1;
    }
  }

  return { items, added, updated, ignored };
}

function recordKey(record, collectionName) {
  if (record.id) return record.id;
  if (collectionName === 'track') {
    return [record.sessionId || record.authorId || 'track', record.ts, record.lat, record.lng].join(':');
  }
  if (collectionName === 'collaborators') {
    return record.id || record.handle || record.name || JSON.stringify(record);
  }
  return JSON.stringify(record);
}

function sanitizeForExchange(value) {
  if (Array.isArray(value)) return value.map(sanitizeForExchange);
  if (!value || typeof value !== 'object') return value;

  const next = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'thumbDataUrl' || key === 'dataUrl') continue;
    next[key] = sanitizeForExchange(child);
  }
  return next;
}

function createUpdateFile(content, filename) {
  const blob = new Blob([content], { type: FILE_MIME });
  if (typeof File === 'undefined') return blob;
  return new File([blob], filename, {
    type: FILE_MIME,
    lastModified: Date.now(),
  });
}

async function shareUpdateFile(file, trip) {
  if (typeof navigator === 'undefined' || !navigator.share) return false;
  if (!navigator.canShare || !navigator.canShare({ files: [file] })) return false;

  try {
    await navigator.share({
      title: `${trip?.name || 'Trip'} offline update`,
      text: 'TripReport offline update file',
      files: [file],
    });
    return 'shared';
  } catch (e) {
    if (e?.name === 'AbortError') return 'cancelled';
    return false;
  }
}

function triggerDownload(file, filename) {
  const blob = file instanceof Blob ? file : new Blob([file], { type: FILE_MIME });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function slugify(value) {
  return String(value || 'trip')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'trip';
}

function labelForCollection(name) {
  const labels = {
    locations: 'locations',
    events: 'events',
    entries: 'entries',
    track: 'track points',
    trackSessions: 'track sessions',
    collaborators: 'participants',
    gearItems: 'gear items',
    meals: 'meals',
    expenses: 'expenses',
    shoppingItems: 'shopping items',
  };
  return labels[name] || name;
}
