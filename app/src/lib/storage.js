// Local storage data layer — trips, entries, GPS tracks

const TRIPS_KEY = 'tr_trips';
const ACTIVE_KEY = 'tr_active_trip_id';
const USER_KEY = 'tr_user_id';
const CONTACTS_KEY = 'tr_contacts';

import { getSignedInUserId, getSignedInDisplayName } from './authUser';
import { defaultEventName } from './eventTypes';
import { captureChanges, materialize } from './tripSync';

export function getContacts() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CONTACTS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

export function saveContact(name) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const existing = getContacts();
  if (existing.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) return;
  const next = [...existing, { id: crypto.randomUUID(), name: trimmed, createdAt: Date.now() }];
  localStorage.setItem(CONTACTS_KEY, JSON.stringify(next));
}

export function deleteContact(id) {
  const next = getContacts().filter((c) => c.id !== id);
  localStorage.setItem(CONTACTS_KEY, JSON.stringify(next));
}

export function getAnonymousUserId() {
  let id = localStorage.getItem(USER_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(USER_KEY, id);
  }
  return id;
}

export function getCurrentUserId() {
  const authId = getSignedInUserId();
  if (authId) return authId;
  return getAnonymousUserId();
}

/** Reassign trips created before sign-in (anonymous / missing owner) to the signed-in account. */
export function claimAnonymousTripsForUser(signedInUserId) {
  if (!signedInUserId) return 0;
  const anonId = localStorage.getItem(USER_KEY);

  let claimed = 0;
  for (const trip of getTrips()) {
    const unowned = !trip.ownerId;
    const ownedByAnon = anonId && trip.ownerId === anonId;
    const ownedBySelf = trip.ownerId === signedInUserId;
    if (ownedBySelf) continue;
    if (!unowned && !ownedByAnon) continue;
    saveTrip({
      ...trip,
      ownerId: signedInUserId,
      syncState: 'pending',
      updatedAt: Date.now(),
    });
    claimed += 1;
  }
  return claimed;
}

export function isTripOwner(trip, userId) {
  if (!trip || !userId) return false;
  if (trip.ownerId === userId) return true;
  const anonId = localStorage.getItem(USER_KEY);
  if (!trip.ownerId && getSignedInUserId() === userId) return true;
  if (anonId && trip.ownerId === anonId && getSignedInUserId() === userId) return true;
  return false;
}

/** Owner or anyone who joined via invite / appears in trip collaborators. */
export function isTripMember(trip, userId) {
  if (!trip || !userId) return false;
  if (isTripOwner(trip, userId)) return true;
  if (trip.memberProfiles?.[userId]) return true;
  return (trip.collaborators || []).some((c) => {
    const id = c?.userId || c?.id;
    return Boolean(id) && id === userId;
  });
}

/** Names from past trips for quick re-invite when creating a new trip. */
export function getPastTripParticipants({ excludeTripId = null } = {}) {
  const excludeMemberIds = new Set();
  const excludeNames = new Set();

  if (excludeTripId) {
    const trip = getTrips().find((t) => t.id === excludeTripId);
    if (trip?.ownerId) excludeMemberIds.add(trip.ownerId);
    for (const c of trip?.collaborators || []) {
      const id = c?.userId || c?.id;
      if (id) excludeMemberIds.add(id);
      const name = (c.handle || c.name || '').trim().toLowerCase();
      if (name) excludeNames.add(name);
    }
    for (const [uid, name] of Object.entries(trip?.memberProfiles || {})) {
      excludeMemberIds.add(uid);
      const label = (name || '').trim().toLowerCase();
      if (label) excludeNames.add(label);
    }
  }

  const candidates = [];

  for (const trip of getTrips()) {
    for (const c of trip.collaborators || []) {
      const name = (c.handle || c.name || '').trim();
      if (!name) continue;
      const userId = c.userId || (isUuid(c.id) ? c.id : null);
      if (userId && excludeMemberIds.has(userId)) continue;
      if (!userId && excludeNames.has(name.toLowerCase())) continue;
      candidates.push({
        id: userId || c.id || name.toLowerCase(),
        name,
        userId,
        hasAccount: Boolean(userId),
      });
    }
    for (const [uid, name] of Object.entries(trip.memberProfiles || {})) {
      if (uid === trip.ownerId) continue;
      if (excludeMemberIds.has(uid)) continue;
      const label = (name || '').trim();
      if (!label) continue;
      if (excludeNames.has(label.toLowerCase())) continue;
      candidates.push({ id: uid, name: label, userId: uid, hasAccount: true });
    }
  }

  return dedupePastCrew(candidates).sort((a, b) => a.name.localeCompare(b.name));
}

function dedupePastCrew(people) {
  const seenUids = new Set();
  const seenNames = new Set();
  const out = [];

  const list = [...people].sort((a, b) => (b.userId ? 1 : 0) - (a.userId ? 1 : 0));
  for (const p of list) {
    const nameKey = (p.name || '').trim().toLowerCase();
    if (p.userId) {
      if (seenUids.has(p.userId)) continue;
      seenUids.add(p.userId);
      if (nameKey) seenNames.add(nameKey);
      out.push(p);
      continue;
    }
    if (!nameKey || seenNames.has(nameKey)) continue;
    seenNames.add(nameKey);
    out.push(p);
  }
  return out;
}

/** Add a name-only roster entry (gear/meals lists — not the same as a cloud invite). */
export function addTripCollaborator(tripId, { name, craft = null }) {
  const label = (name || '').trim();
  if (!label) return null;
  return mutateTrip(tripId, (trip) => {
    const key = label.toLowerCase();
    const exists = (trip.collaborators || []).some(
      (c) => (c.handle || c.name || '').toLowerCase() === key,
    );
    const inProfiles = Object.values(trip.memberProfiles || {}).some(
      (n) => (n || '').trim().toLowerCase() === key,
    );
    if (exists || inProfiles) return null;
    const collab = {
      id: crypto.randomUUID(),
      handle: label,
      name: label,
      role: 'contributor',
      ...(craft ? { craft: String(craft).trim() } : {}),
    };
    trip.collaborators = [...(trip.collaborators || []), collab];
    return collab;
  });
}

export function updateCollaboratorCraft(tripId, participantId, craft) {
  if (!tripId || !participantId) return null;
  const nextCraft = (craft || '').trim() || null;
  return mutateTrip(tripId, (trip, now) => {
    const list = trip.collaborators || [];
    const idx = list.findIndex((c) => c.id === participantId || c.userId === participantId);
    if (idx >= 0) {
      const updated = {
        ...list[idx],
        craft: nextCraft,
        updatedAt: now,
        syncState: 'pending',
      };
      trip.collaborators = list.map((c, i) => (i === idx ? updated : c));
      return updated;
    }
    if (trip.ownerId === participantId || trip.memberProfiles?.[participantId]) {
      const displayName = trip.memberProfiles?.[participantId] || getSignedInDisplayName() || 'Owner';
      const created = {
        id: participantId,
        userId: participantId,
        handle: displayName,
        name: displayName,
        role: trip.ownerId === participantId ? 'owner' : 'contributor',
        joinedViaInvite: trip.ownerId !== participantId,
        craft: nextCraft,
        updatedAt: now,
        syncState: 'pending',
      };
      trip.collaborators = [...list, created];
      return created;
    }
    return null;
  });
}

export function getSharedTripCountsByPerson() {
  const byId = {};
  const byName = {};
  for (const trip of getTrips()) {
    const seenIdsInTrip = new Set();
    const seenNamesInTrip = new Set();
    if (trip.ownerId) {
      seenIdsInTrip.add(trip.ownerId);
      const ownerName = (trip.memberProfiles?.[trip.ownerId] || '').trim().toLowerCase();
      if (ownerName) seenNamesInTrip.add(ownerName);
    }
    for (const [uid, name] of Object.entries(trip.memberProfiles || {})) {
      seenIdsInTrip.add(uid);
      const key = (name || '').trim().toLowerCase();
      if (key) seenNamesInTrip.add(key);
    }
    for (const c of trip.collaborators || []) {
      const id = c?.userId || c?.id;
      if (id) seenIdsInTrip.add(id);
      const key = (c?.handle || c?.name || '').trim().toLowerCase();
      if (key) seenNamesInTrip.add(key);
    }
    for (const id of seenIdsInTrip) {
      byId[id] = (byId[id] || 0) + 1;
    }
    for (const key of seenNamesInTrip) {
      byName[key] = (byName[key] || 0) + 1;
    }
  }
  return { byId, byName };
}

export function removeTripCollaborator(tripId, collaboratorId) {
  return mutateTrip(tripId, (trip) => {
    const target = (trip.collaborators || []).find((c) => c.id === collaboratorId);
    if (!target || target.userId) return null;
    trip.collaborators = (trip.collaborators || []).filter((c) => c.id !== collaboratorId);
    return true;
  });
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

export function getTrips() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TRIPS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.map(normalizeTripShape) : [];
  } catch {
    return [];
  }
}

export function getTrip(id) {
  return getTrips().find(t => t.id === id) || null;
}

export function saveTrip(trip, { capture = true, schedule = capture } = {}) {
  const trips = getTrips();
  const latest = trips.find(t => t.id === trip.id);
  const nextTrip = normalizeTripShape(capture
    ? captureChanges(trip, latest, { authorId: getCurrentUserId() })
    : materialize(trip));
  const idx = trips.findIndex(t => t.id === nextTrip.id);
  if (idx >= 0) trips[idx] = nextTrip;
  else trips.unshift(nextTrip);
  try {
    localStorage.setItem(TRIPS_KEY, JSON.stringify(trips));
  } catch (e) {
    if (e.name === 'QuotaExceededError' || e.code === 22) {
      throw new Error('Device storage is full. This change was not saved; the previous trip is intact. Export a backup before freeing browser storage.');
    }
    throw e;
  }

  if (schedule && nextTrip.syncState === 'pending' && nextTrip.id) {
    queueMicrotask(() => {
      import('./tripAutoSync.js')
        .then((m) => m.scheduleTripCloudSync(nextTrip.id))
        .catch(() => {});
    });
  }

  return nextTrip;
}

export function createTrip({
  name,
  types,
  location,
  startDate,
  endDate,
  privacy,
  status = 'planning',
  collaborators = [],
  offlineRegions = [],
  gpsTrackingEnabled = false,
  gpsBackgroundTracking = false,
  gpsIntervalMs = 5000,
  coverPhoto = null,
  mapArea = null,
}) {
  const now = Date.now();
  const ownerId = getCurrentUserId();
  const ownerName = getSignedInDisplayName();
  const tripStatus = status === 'planning' ? 'planning' : 'active';
  const trip = {
    id: crypto.randomUUID(),
    name,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    types,        // string[] e.g. ['Backpacking', 'Rafting']
    location,
    startDate,
    endDate,
    privacy,      // 'private' | 'friends' | 'public'
    status: tripStatus,
    startedAt: tripStatus === 'active' ? now : null,
    ownerId,
    memberProfiles: ownerId && ownerName ? { [ownerId]: ownerName } : {},
    createdAt: now,
    updatedAt: now,
    syncState: 'pending',
    entries: [],
    locations: [],
    events: [],
    track: [],    // [{lng, lat, alt, ts}]
    collaborators,
    offlineRegions,
    gpsTrackingEnabled,
    gpsBackgroundTracking,
    gpsIntervalMs,
    gpsSessionActive: false,
    gpsSessionId: null,
    gpsSessionStartedAt: null,
    trackSessions: [],
    gearItems: [],
    meals: [],
    expenses: [],
    expenseGroups: [],
    shoppingItems: [],
    coverPhoto,
    mapArea,
  };
  const saved = saveTrip(trip);
  setActiveTrip(trip.id);
  return saved;
}

function latestVisitAtLocation(trip, locationId) {
  const events = (trip.events || []).filter((event) => event.locationId === locationId);
  if (!events.length) return null;
  return events.reduce((best, event) => {
    const bestObserved = new Date(best.observedAt || 0).getTime() || best.createdAt || 0;
    const nextObserved = new Date(event.observedAt || 0).getTime() || event.createdAt || 0;
    if (nextObserved !== bestObserved) return nextObserved > bestObserved ? event : best;
    return (event.createdAt || 0) >= (best.createdAt || 0) ? event : best;
  });
}

function ensureEntryEvent(trip, entry) {
  const direct = resolveEntryEvent(trip, entry.eventId);
  if (direct) return direct;
  const location = resolveEntryLocation(trip, entry.locationId);
  if (!location) return null;
  // Logging at a place joins its current visit. A new night is an explicit newVisit.
  if (!entry.newVisit) {
    const current = latestVisitAtLocation(trip, location.id);
    if (current) return current;
  }
  const entryType = entry.type || 'note';
  // A new visit is a new event. Explicit eventId links contributions to an existing visit.
  const now = Date.now();
  const created = {
    id: crypto.randomUUID(),
    locationId: location.id,
    locationName: location.name,
    lat: entry.lat ?? location.lat,
    lng: entry.lng ?? location.lng,
    type: entryType,
    name: entry.title || defaultEventName(entryType),
    mealId: entry.mealId || null,
    notes: '',
    coverPhoto: null,
    photos: [],
    taggedParticipantId: null,
    taggedParticipantLabel: null,
    // Prefer the entry's own observed time so a back-dated entry does not create
    // an event stamped "now".
    observedAt: entry.observedAt || new Date(now).toISOString(),
    createdBy: getCurrentUserId(),
    createdAt: now,
    updatedAt: now,
    syncState: 'pending',
  };
  if (!trip.events) trip.events = [];
  trip.events.unshift(created);
  return created;
}

export function addEntry(tripId, entry) {
  const trip = getTrip(tripId);
  if (!trip) return null;
  const now = Date.now();
  const linkedEvent = ensureEntryEvent(trip, entry);
  const linkedLocation = resolveEntryLocation(trip, linkedEvent?.locationId || entry.locationId);
  const fields = { ...entry };
  delete fields.newVisit;
  const full = {
    ...fields,
    id: crypto.randomUUID(),
    eventId: linkedEvent?.id || entry.eventId,
    eventName: linkedEvent?.name || entry.eventName,
    eventType: linkedEvent?.type || entry.eventType,
    locationId: linkedLocation?.id || entry.locationId,
    locationName: linkedLocation?.name || entry.locationName,
    locationType: linkedLocation?.type || entry.locationType,
    lng: linkedLocation?.lng ?? entry.lng,
    lat: linkedLocation?.lat ?? entry.lat,
    authorId: entry.authorId || getCurrentUserId(),
    createdAt: now,
    updatedAt: now,
    syncState: 'pending',
  };
  trip.entries.unshift(full);
  trip.updatedAt = now;
  trip.syncState = 'pending';
  saveTrip(trip);
  return full;
}

export function updateEntry(tripId, entryId, patch) {
  const trip = getTrip(tripId);
  if (!trip) return null;
  const idx = trip.entries.findIndex(e => e.id === entryId);
  if (idx < 0) return null;

  const now = Date.now();
  const existing = trip.entries[idx];
  const cleanPatch = { ...patch };
  delete cleanPatch.newVisit;
  const merged = { ...existing, ...cleanPatch, newVisit: patch.newVisit };
  const moved = Object.prototype.hasOwnProperty.call(patch, 'locationId') && (patch.locationId || null) !== (existing.locationId || null);
  // A visit belongs to one location. Moving this observation must not keep the
  // old visit, whose location would otherwise silently override the selection.
  if ((moved || patch.newVisit) && !patch.eventId) {
    merged.eventId = undefined;
    merged.eventName = undefined;
    merged.eventType = undefined;
  }
  const linkedEvent = ensureEntryEvent(trip, merged);
  const requestedEventId = linkedEvent?.id || merged.eventId;
  const requestedLocationId = linkedEvent?.locationId || merged.locationId;
  const linkedLocation = resolveEntryLocation(trip, requestedLocationId);
  const updated = {
    ...existing,
    ...cleanPatch,
    eventId: linkedEvent?.id || requestedEventId,
    eventName: linkedEvent?.name || merged.eventName,
    eventType: linkedEvent?.type || merged.eventType,
    locationId: linkedLocation?.id || requestedLocationId,
    locationName: linkedLocation?.name || (moved ? undefined : merged.locationName),
    locationType: linkedLocation?.type || (moved ? undefined : merged.locationType),
    lng: linkedLocation?.lng ?? patch.lng ?? existing.lng,
    lat: linkedLocation?.lat ?? patch.lat ?? existing.lat,
    id: existing.id,
    updatedAt: now,
    syncState: 'pending',
  };
  trip.entries[idx] = updated;
  trip.updatedAt = now;
  trip.syncState = 'pending';
  saveTrip(trip);
  return updated;
}

export function appendTrackPoint(tripId, point) {
  const trip = getTrip(tripId);
  if (!trip) return;
  const now = Date.now();
  const sessionId = point.sessionId;
  if(!isTripOpen(trip) || !trip.gpsSessionActive || !sessionId || sessionId!==trip.gpsSessionId || trip.gpsRecordingDeviceId!==getRecordingDeviceId())return false;
  trip.track.push({ ...point, deviceId: getRecordingDeviceId(), authorId: point.authorId || getCurrentUserId(), sessionId, id: point.id || crypto.randomUUID(), syncState: point.syncState || 'pending' });

  if (sessionId) {
    const sIdx = (trip.trackSessions || []).findIndex((s) => s.id === sessionId);
    if (sIdx >= 0) {
      const existing = trip.trackSessions[sIdx];
      trip.trackSessions[sIdx] = {
        ...existing,
        pointsCount: (existing.pointsCount || 0) + 1,
        updatedAt: now,
        syncState: 'pending',
      };
    }
  }

  trip.updatedAt = now;
  trip.syncState = 'pending';
  saveTrip(trip);
  return true;
}

export function getRecordingDeviceId() {
  const key='tr_gps_device_id';
  let id=localStorage.getItem(key);
  if(!id){id=crypto.randomUUID();localStorage.setItem(key,id);}
  return id;
}
export function startGpsSession(tripId,{label}={}) {
  const trip=getTrip(tripId);
  if(!trip || !isTripOpen(trip))throw new Error('Open a trip before recording.');
  const deviceId=getRecordingDeviceId();
  const other=getTrips().find(t=>t.id!==tripId && t.gpsSessionId && t.gpsRecordingDeviceId===deviceId);
  if(other)throw new Error('Finish the recording in '+other.name+' before starting another.');
  if(trip.gpsSessionId && trip.gpsRecordingDeviceId===deviceId){
    if(!trip.gpsSessionActive)resumeGpsSession(tripId);
    return getTrip(tripId).trackSessions.find(s=>s.id===trip.gpsSessionId);
  }
  const now=Date.now();
  const session={id:crypto.randomUUID(),deviceId,label:label||null,startedAt:now,endedAt:null,
    activeMs:0,resumedAt:now,attachLocationId:null,pointsCount:0,createdBy:getCurrentUserId(),createdAt:now};
  saveTrip({...trip,gpsTrackingEnabled:true,gpsBackgroundTracking:false,gpsSessionActive:true,
    gpsRecordingDeviceId:deviceId,gpsSessionId:session.id,gpsSessionStartedAt:now,
    trackSessions:[session,...(trip.trackSessions||[])]});
  return session;
}
export function pauseGpsSession(tripId) {
  const trip=getTrip(tripId);
  if(!trip || !trip.gpsSessionId || trip.gpsRecordingDeviceId!==getRecordingDeviceId())return null;
  const now=Date.now();
  return saveTrip({...trip,gpsSessionActive:false,gpsTrackingEnabled:false,gpsBackgroundTracking:false,
    trackSessions:trip.trackSessions.map(s=>s.id===trip.gpsSessionId?
      {...s,activeMs:(s.activeMs||0)+(trip.gpsSessionActive?Math.max(0,now-(s.resumedAt||now)):0),resumedAt:null,pausedAt:now}:s)});
}
export function resumeGpsSession(tripId) {
  const trip=getTrip(tripId);
  if(!trip || !isTripOpen(trip) || !trip.gpsSessionId || trip.gpsRecordingDeviceId!==getRecordingDeviceId())return null;
  if(trip.gpsSessionActive)return trip;
  return saveTrip({...trip,gpsSessionActive:true,gpsTrackingEnabled:true,
    trackSessions:trip.trackSessions.map(s=>s.id===trip.gpsSessionId?{...s,resumedAt:Date.now(),pausedAt:null}:s)});
}
export function stopGpsSession(tripId,{attachLocationId=null}={}) {
  let trip=getTrip(tripId);
  if(!trip)return null;
  if(trip.gpsSessionId && trip.gpsRecordingDeviceId!==getRecordingDeviceId())return null;
  if(trip.gpsSessionActive)trip=pauseGpsSession(tripId);
  const activeId=trip.gpsSessionId;
  return saveTrip({...trip,gpsSessionActive:false,gpsTrackingEnabled:false,gpsBackgroundTracking:false,
    gpsSessionId:null,gpsSessionStartedAt:null,
    trackSessions:(trip.trackSessions||[]).map(s=>s.id===activeId?{...s,endedAt:Date.now(),resumedAt:null,attachLocationId:attachLocationId||s.attachLocationId||null}:s)});
}
export function updateGpsSession(tripId,sessionId,patch) {
  const trip=getTrip(tripId);
  if(!trip)return null;
  return saveTrip({...trip,trackSessions:trip.trackSessions.map(s=>s.id===sessionId?
    {...s,label:patch.label??s.label,attachLocationId:patch.attachLocationId??s.attachLocationId}:s)});
}

export function addLocation(tripId, location) {
  const trip = getTrip(tripId);
  if (!trip) return null;

  const now = Date.now();
  const full = {
    id: crypto.randomUUID(),
    name: location.name || 'Untitled Location',
    type: location.type || 'point-of-interest',
    icon: location.icon || '📍',
    notes: location.notes || '',
    timeMode: location.timeMode || 'current',
    observedAt: location.observedAt,
    observedStartAt: location.observedStartAt,
    observedEndAt: location.observedEndAt,
    lng: location.lng,
    lat: location.lat,
    visitStatus: location.visitStatus || (trip.status === 'planning' ? 'planned' : 'visited'),
    votes: Array.isArray(location.votes) ? location.votes : [],
    comments: Array.isArray(location.comments) ? location.comments : [],
    createdBy: location.createdBy || getCurrentUserId(),
    createdAt: now,
    updatedAt: now,
    syncState: 'pending',
    coverPhoto: location.coverPhoto || null,
    // Full gallery — coverPhoto stays as the denormalised first image.
    photos: Array.isArray(location.photos) ? location.photos : [],
  };

  trip.locations.unshift(full);
  trip.updatedAt = now;
  trip.syncState = 'pending';
  saveTrip(trip);
  return full;
}

export function toggleLocationVote(tripId, locationId, userId = getCurrentUserId()) {
  if (!tripId || !locationId || !userId) return null;
  const trip = getTrip(tripId);
  if (!trip) return null;
  const loc = (trip.locations || []).find((l) => l.id === locationId);
  if (!loc) return null;
  const votes = Array.isArray(loc.votes) ? loc.votes : [];
  const nextVotes = votes.includes(userId)
    ? votes.filter((id) => id !== userId)
    : [...votes, userId];
  return updateLocation(tripId, locationId, { votes: nextVotes });
}

export function markLocationVisited(tripId, locationId) {
  if (!tripId || !locationId) return null;
  const trip = getTrip(tripId);
  if (!trip) return null;
  const loc = (trip.locations || []).find((l) => l.id === locationId);
  if (!loc) return null;
  return updateLocation(tripId, locationId, {
    visitStatus: 'visited',
    observedAt: loc.observedAt || new Date().toISOString(),
  });
}

export function addLocationComment(tripId, locationId, text, { authorId = null, authorName = null } = {}) {
  const trimmed = (text || '').trim();
  if (!tripId || !locationId || !trimmed) return null;
  const trip = getTrip(tripId);
  if (!trip) return null;
  const loc = (trip.locations || []).find((l) => l.id === locationId);
  if (!loc) return null;
  const uid = authorId || getCurrentUserId();
  const displayName = authorName
    || trip.memberProfiles?.[uid]
    || (trip.collaborators || []).find((c) => c.userId === uid || c.id === uid)?.name
    || getSignedInDisplayName()
    || 'Crew';
  const comment = {
    id: crypto.randomUUID(),
    authorId: uid,
    authorName: displayName,
    text: trimmed,
    createdAt: Date.now(),
  };
  const comments = Array.isArray(loc.comments) ? loc.comments : [];
  return updateLocation(tripId, locationId, { comments: [...comments, comment] });
}

export function updateLocation(tripId, locationId, patch) {
  const trip = getTrip(tripId);
  if (!trip) return null;
  const idx = trip.locations.findIndex((l) => l.id === locationId);
  if (idx < 0) return null;

  const now = Date.now();
  const existing = trip.locations[idx];
  const updated = {
    ...existing,
    ...patch,
    id: existing.id,
    updatedAt: now,
    syncState: 'pending',
  };

  trip.locations[idx] = updated;

  trip.events = trip.events.map((event) => {
    if (event.locationId !== locationId) return event;
    return {
      ...event,
      locationName: updated.name,
      updatedAt: now,
      syncState: 'pending',
    };
  });

  trip.entries = trip.entries.map((entry) => {
    if (entry.locationId !== locationId) return entry;
    return {
      ...entry,
      locationName: updated.name,
      locationType: updated.type,
      lng: updated.lng ?? entry.lng,
      lat: updated.lat ?? entry.lat,
      updatedAt: now,
      syncState: 'pending',
    };
  });

  trip.updatedAt = now;
  trip.syncState = 'pending';
  saveTrip(trip);
  return updated;
}

export function removeLocation(tripId, locationId) {
  return mutateTrip(tripId, (trip) => {
    const before = (trip.locations || []).length;
    trip.locations = (trip.locations || []).filter((l) => l.id !== locationId);
    trip.events = (trip.events || []).filter((e) => e.locationId !== locationId);
    trip.entries = (trip.entries || []).filter((e) => e.locationId !== locationId);
    return trip.locations.length < before;
  });
}

export function addEvent(tripId, event) {
  const trip = getTrip(tripId);
  if (!trip) return null;
  const location = resolveEntryLocation(trip, event.locationId);
  if (!location) return null;

  const now = Date.now();
  const full = {
    id: crypto.randomUUID(),
    locationId: location.id,
    locationName: location.name,
    lat: event.lat ?? location.lat,
    lng: event.lng ?? location.lng,
    type: event.type || 'note',
    name: event.name || defaultEventName(event.type),
    notes: event.notes || '',
    coverPhoto: event.coverPhoto,
    photos: Array.isArray(event.photos) ? event.photos : [],
    taggedParticipantId: event.taggedParticipantId || null,
    taggedParticipantLabel: event.taggedParticipantLabel || null,
    memberIds: Array.isArray(event.memberIds) ? event.memberIds : [],
    // Every event is timestamped — entries inherit this for weather/gauge lookups
    // and for "when did this happen" without asking the user again.
    observedAt: event.observedAt || new Date(now).toISOString(),
    weatherTempC: event.weatherTempC ?? null,
    weatherFeelsLikeC: event.weatherFeelsLikeC ?? null,
    weatherWindKph: event.weatherWindKph ?? null,
    weatherWindDirectionDeg: event.weatherWindDirectionDeg ?? null,
    weatherCode: event.weatherCode ?? null,
    weatherSummary: event.weatherSummary || null,
    weatherFetchedAt: event.weatherFetchedAt || null,
    weatherSource: event.weatherSource || null,
    weatherObservation: event.weatherObservation || '',
    weatherSyncPending: Boolean(event.weatherSyncPending),
    createdBy: event.createdBy || getCurrentUserId(),
    createdAt: now,
    updatedAt: now,
    syncState: 'pending',
  };

  trip.events.unshift(full);
  trip.updatedAt = now;
  trip.syncState = 'pending';
  saveTrip(trip);
  return full;
}

export function updateEvent(tripId, eventId, patch) {
  const trip = getTrip(tripId);
  if (!trip) return null;
  const idx = trip.events.findIndex((e) => e.id === eventId);
  if (idx < 0) return null;

  const now = Date.now();
  const existing = trip.events[idx];
  const location = resolveEntryLocation(trip, patch.locationId || existing.locationId);
  const updated = {
    ...existing,
    ...patch,
    id: existing.id,
    locationId: location?.id || existing.locationId,
    locationName: location?.name || existing.locationName,
    updatedAt: now,
    syncState: 'pending',
  };
  trip.events[idx] = updated;

  trip.entries = trip.entries.map((entry) => {
    if (entry.eventId !== eventId) return entry;
    return {
      ...entry,
      eventName: updated.name,
      eventType: updated.type,
      locationId: updated.locationId,
      locationName: updated.locationName,
      updatedAt: now,
      syncState: 'pending',
    };
  });

  trip.updatedAt = now;
  trip.syncState = 'pending';
  saveTrip(trip);
  return updated;
}

export function removeEvent(tripId, eventId) {
  return mutateTrip(tripId, (trip) => {
    const before = (trip.events || []).length;
    trip.events = (trip.events || []).filter((e) => e.id !== eventId);
    trip.entries = (trip.entries || []).filter((e) => e.eventId !== eventId);
    return trip.events.length < before;
  });
}

/**
 * Apply a gallery patch (from lib/gallery) to a location or event.
 *
 * Photo contributions are deliberately separate from "edit the entity": any
 * member may add photos to someone else's location or event, and the record of
 * who contributed is kept on the entity so the UI can credit them.
 */
export function updateEntityPhotos(tripId, { kind, id }, patch) {
  if (!patch || !kind || !id) return null;
  const collection = kind === 'location' ? 'locations' : kind === 'event' ? 'events' : null;
  if (!collection) return null;

  return mutateTrip(tripId, (trip) => {
    const list = trip[collection] || [];
    const idx = list.findIndex((item) => item.id === id);
    if (idx < 0) return null;

    const now = Date.now();
    const existing = list[idx];
    const userId = getCurrentUserId();
    const contributors = Array.isArray(existing.photoContributors) ? existing.photoContributors : [];
    const updated = {
      ...existing,
      ...patch,
      id: existing.id,
      photoContributors: userId && !contributors.includes(userId) ? [...contributors, userId] : contributors,
      updatedAt: now,
      syncState: 'pending',
    };
    trip[collection][idx] = updated;
    trip.updatedAt = now;
    trip.syncState = 'pending';
    return updated;
  });
}

export function getActiveTrip() {
  const id = localStorage.getItem(ACTIVE_KEY);
  return id ? getTrip(id) : null;
}

export function isTripOpen(trip) {
  return trip?.status === 'planning' || trip?.status === 'active';
}

export function finalizeTrip(tripId) {
  if(getTrip(tripId)?.gpsRecordingDeviceId===getRecordingDeviceId())stopGpsSession(tripId);
  const trip = getTrip(tripId);
  if (!trip) return null;
  const now = Date.now();
  trip.status = 'completed';
  trip.endedAt = now;
  trip.updatedAt = now;
  trip.syncState = 'pending';
  saveTrip(trip);
  return trip;
}

export function reopenTrip(tripId) {
  const trip = getTrip(tripId);
  if (!trip) return null;
  const now = Date.now();
  trip.status = 'planning';
  trip.updatedAt = now;
  trip.syncState = 'pending';
  saveTrip(trip);
  return trip;
}

// ── Trip planning: gear, meals, expenses, shopping list ──

function mutateTrip(tripId, fn) {
  const trip = getTrip(tripId);
  if (!trip) return null;
  const now = Date.now();
  const result = fn(trip, now);
  trip.updatedAt = now;
  trip.syncState = 'pending';
  saveTrip(trip);
  queueMicrotask(() => {
    import('./tripAutoSync.js')
      .then((m) => m.scheduleTripCloudSync(tripId, { debounceMs: 800 }))
      .catch(() => {});
  });
  return result;
}

function updatePlanningItem(tripId, collection, id, patch) {
  return mutateTrip(tripId, (trip, now) => {
    const list = trip[collection] || [];
    const idx = list.findIndex((x) => x.id === id);
    if (idx < 0) return null;
    const updated = { ...list[idx], ...patch, id, updatedAt: now, syncState: 'pending' };
    trip[collection] = list.map((x, i) => (i === idx ? updated : x));
    return updated;
  });
}

function removePlanningItem(tripId, collection, id) {
  return mutateTrip(tripId, (trip) => {
    trip[collection] = (trip[collection] || []).filter((x) => x.id !== id);
    return true;
  });
}

export function addGearItem(tripId, item) {
  return mutateTrip(tripId, (trip, now) => {
    const full = {
      id: crypto.randomUUID(),
      name: (item.name || '').trim() || 'Untitled gear',
      category: item.category || 'group',
      quantity: Number.isFinite(item.quantity) && item.quantity > 0 ? item.quantity : 1,
      shared: item.shared !== false,
      assignedTo: item.assignedTo || null,
      assignedToLabel: item.assignedToLabel || null,
      status: item.status || 'needed', // needed | have (legacy: claimed, packed)
      notes: item.notes || '',
      createdBy: item.createdBy || getCurrentUserId(),
      createdAt: now,
      updatedAt: now,
      syncState: 'pending',
    };
    trip.gearItems = [full, ...(trip.gearItems || [])];
    return full;
  });
}

export function updateGearItem(tripId, id, patch) {
  return updatePlanningItem(tripId, 'gearItems', id, patch);
}

export function removeGearItem(tripId, id) {
  return removePlanningItem(tripId, 'gearItems', id);
}

export function claimGearItem(tripId, gearId, { userId = null, label = null } = {}) {
  const trip = getTrip(tripId);
  if (!trip || !gearId) return null;
  const uid = userId || getCurrentUserId();
  const displayName = label
    || trip.memberProfiles?.[uid]
    || (trip.collaborators || []).find((c) => c.userId === uid || c.id === uid)?.name
    || getSignedInDisplayName()
    || 'Me';
  return updateGearItem(tripId, gearId, {
    assignedTo: uid,
    assignedToLabel: displayName,
  });
}

export function addMeal(tripId, meal) {
  return mutateTrip(tripId, (trip, now) => {
    const full = {
      id: crypto.randomUUID(),
      dayIndex: Number.isFinite(meal.dayIndex) ? meal.dayIndex : 1,
      slot: meal.slot || 'dinner', // breakfast | lunch | dinner | snack
      name: (meal.name || '').trim() || 'Untitled meal',
      assignedTo: meal.assignedTo || null,
      assignedToLabel: meal.assignedToLabel || null,
      coCooks: Array.isArray(meal.coCooks) ? meal.coCooks : [],
      servings: Number.isFinite(meal.servings) && meal.servings > 0 ? meal.servings : null,
      ingredients: Array.isArray(meal.ingredients) ? meal.ingredients : [],
      notes: meal.notes || '',
      createdBy: meal.createdBy || getCurrentUserId(),
      createdAt: now,
      updatedAt: now,
      syncState: 'pending',
    };
    trip.meals = [...(trip.meals || []), full];
    return full;
  });
}

export function updateMeal(tripId, id, patch) {
  return updatePlanningItem(tripId, 'meals', id, patch);
}

export function claimMeal(tripId, mealId, { asCoCook = false, userId = null, label = null } = {}) {
  const trip = getTrip(tripId);
  if (!trip || !mealId) return null;
  const meal = (trip.meals || []).find((m) => m.id === mealId);
  if (!meal) return null;
  const uid = userId || getCurrentUserId();
  const displayName = label
    || trip.memberProfiles?.[uid]
    || (trip.collaborators || []).find((c) => c.userId === uid || c.id === uid)?.name
    || getSignedInDisplayName()
    || 'Me';
  if (!asCoCook) {
    return updateMeal(tripId, mealId, {
      assignedTo: uid,
      assignedToLabel: displayName,
    });
  }
  const existing = Array.isArray(meal.coCooks) ? meal.coCooks : [];
  const nextCoCooks = existing.includes(uid)
    ? existing.filter((id) => id !== uid)
    : [...existing, uid];
  return updateMeal(tripId, mealId, { coCooks: nextCoCooks });
}

export function removeMeal(tripId, id) {
  return removePlanningItem(tripId, 'meals', id);
}

export function toggleEntryReaction(tripId, targetId, emoji, { kind = 'entry', userId = null } = {}) {
  if (!tripId || !targetId || !emoji) return null;
  const uid = userId || getCurrentUserId();
  const trip = getTrip(tripId);
  if (!trip) return null;
  const collection = kind === 'event' ? 'events' : 'entries';
  const item = (trip[collection] || []).find((x) => x.id === targetId);
  if (!item) return null;
  const reactions = item.reactions && typeof item.reactions === 'object' ? { ...item.reactions } : {};
  const current = Array.isArray(reactions[emoji]) ? reactions[emoji] : [];
  const nextList = current.includes(uid)
    ? current.filter((id) => id !== uid)
    : [...current, uid];
  if (nextList.length > 0) {
    reactions[emoji] = nextList;
  } else {
    delete reactions[emoji];
  }
  return kind === 'event'
    ? updateEvent(tripId, targetId, { reactions })
    : updateEntry(tripId, targetId, { reactions });
}

export function toggleEntryHighlight(tripId, targetId, { kind = 'entry' } = {}) {
  if (!tripId || !targetId) return null;
  const trip = getTrip(tripId);
  if (!trip) return null;
  const collection = kind === 'event' ? 'events' : 'entries';
  const item = (trip[collection] || []).find((x) => x.id === targetId);
  if (!item) return null;
  const nextVal = !item.highlighted;
  return kind === 'event'
    ? updateEvent(tripId, targetId, { highlighted: nextVal })
    : updateEntry(tripId, targetId, { highlighted: nextVal });
}

export function addTripMemory(tripId, text, { authorId = null, authorName = null } = {}) {
  const trimmed = (text || '').trim();
  if (!tripId || !trimmed) return null;
  return mutateTrip(tripId, (trip, now) => {
    const uid = authorId || getCurrentUserId();
    const displayName = authorName
      || trip.memberProfiles?.[uid]
      || (trip.collaborators || []).find((c) => c.userId === uid || c.id === uid)?.name
      || getSignedInDisplayName()
      || 'Crew';
    const memory = {
      id: crypto.randomUUID(),
      authorId: uid,
      authorName: displayName,
      text: trimmed,
      createdAt: now,
    };
    const existingRecap = trip.recap && typeof trip.recap === 'object' ? trip.recap : {};
    const memories = Array.isArray(existingRecap.memories) ? existingRecap.memories : [];
    trip.recap = {
      ...existingRecap,
      memories: [...memories, memory],
      updatedAt: now,
    };
    return memory;
  });
}

export function forkTripAsTemplate(sourceTripId, { name = null, startDate = '', endDate = '' } = {}) {
  const source = getTrip(sourceTripId);
  if (!source) return null;
  const baseName = (name || '').trim() || `${source.name || 'Trip'} (New Run)`;
  const forked = createTrip({
    name: baseName,
    types: Array.isArray(source.types) ? [...source.types] : [],
    location: source.location || '',
    startDate,
    endDate,
    privacy: 'private',
    status: 'planning',
    mapArea: source.mapArea || null,
  });
  for (const loc of [...(source.locations || [])].reverse()) {
    addLocation(forked.id, {
      name: loc.name,
      type: loc.type,
      icon: loc.icon,
      notes: loc.notes || '',
      lat: loc.lat,
      lng: loc.lng,
      visitStatus: 'planned',
      votes: [],
      comments: [],
    });
  }
  for (const meal of source.meals || []) {
    addMeal(forked.id, {
      dayIndex: meal.dayIndex || 1,
      slot: meal.slot || 'dinner',
      name: meal.name,
      servings: meal.servings || null,
      ingredients: Array.isArray(meal.ingredients) ? meal.ingredients.map((i) => ({ ...i })) : [],
      notes: meal.notes || '',
      assignedTo: null,
      assignedToLabel: null,
      coCooks: [],
    });
  }
  for (const gear of source.gearItems || []) {
    if (gear.shared === false || gear.category === 'personal') continue;
    addGearItem(forked.id, {
      name: gear.name,
      category: gear.category || 'group',
      quantity: gear.quantity || 1,
      shared: true,
      assignedTo: null,
      assignedToLabel: null,
      status: 'needed',
      notes: gear.notes || '',
    });
  }
  return getTrip(forked.id);
}

export function addExpense(tripId, expense) {
  return mutateTrip(tripId, (trip, now) => {
    const full = {
      id: crypto.randomUUID(),
      description: (expense.description || '').trim() || 'Expense',
      amount: Number.isFinite(expense.amount) ? expense.amount : 0,
      currency: expense.currency || 'USD',
      paidBy: expense.paidBy || getCurrentUserId(),
      paidByLabel: expense.paidByLabel || null,
      splitAmong: Array.isArray(expense.splitAmong) ? expense.splitAmong : (expense.splitAmong === 'all' ? 'all' : 'all'),
      splitGroupId: expense.splitGroupId || null,
      splitGroupName: expense.splitGroupName || null,
      category: expense.category || 'general',
      locationId: expense.locationId || null,
      locationName: expense.locationName || null,
      eventId: expense.eventId || null,
      eventName: expense.eventName || null,
      createdBy: expense.createdBy || getCurrentUserId(),
      createdAt: now,
      updatedAt: now,
      syncState: 'pending',
    };
    trip.expenses = [full, ...(trip.expenses || [])];
    return full;
  });
}

export function updateExpense(tripId, id, patch) {
  return updatePlanningItem(tripId, 'expenses', id, patch);
}

export function removeExpense(tripId, id) {
  return removePlanningItem(tripId, 'expenses', id);
}

export function addExpenseGroup(tripId, group) {
  return mutateTrip(tripId, (trip, now) => {
    const full = {
      id: crypto.randomUUID(),
      name: (group.name || '').trim() || 'Group',
      memberIds: Array.isArray(group.memberIds) ? group.memberIds : [],
      createdAt: now,
      updatedAt: now,
      syncState: 'pending',
    };
    trip.expenseGroups = [full, ...(trip.expenseGroups || [])];
    return full;
  });
}

export function updateExpenseGroup(tripId, id, patch) {
  return mutateTrip(tripId, (trip, now) => {
    const list = trip.expenseGroups || [];
    const idx = list.findIndex((g) => g.id === id);
    if (idx < 0) return null;
    const updated = {
      ...list[idx],
      ...patch,
      id,
      name: patch.name != null ? String(patch.name).trim() || list[idx].name : list[idx].name,
      memberIds: patch.memberIds != null
        ? (Array.isArray(patch.memberIds) ? patch.memberIds : list[idx].memberIds)
        : list[idx].memberIds,
      updatedAt: now,
      syncState: 'pending',
    };
    trip.expenseGroups = list.map((g, i) => (i === idx ? updated : g));
    return updated;
  });
}

export function removeExpenseGroup(tripId, id) {
  return mutateTrip(tripId, (trip) => {
    trip.expenseGroups = (trip.expenseGroups || []).filter((g) => g.id !== id);
    return true;
  });
}

export function addShoppingItem(tripId, item) {
  return mutateTrip(tripId, (trip, now) => {
    const full = {
      id: crypto.randomUUID(),
      name: (item.name || '').trim() || 'Item',
      qty: item.qty || '',
      category: item.category || 'food',
      source: item.source || 'manual', // manual | meal | gear
      sourceId: item.sourceId || null,
      checked: Boolean(item.checked),
      addedBy: item.addedBy || getCurrentUserId(),
      createdAt: now,
      updatedAt: now,
      syncState: 'pending',
    };
    trip.shoppingItems = [...(trip.shoppingItems || []), full];
    return full;
  });
}

export function updateShoppingItem(tripId, id, patch) {
  return updatePlanningItem(tripId, 'shoppingItems', id, patch);
}

export function removeShoppingItem(tripId, id) {
  return removePlanningItem(tripId, 'shoppingItems', id);
}

// Generate shopping items from meal ingredients (and optional "to buy" gear).
// Skips names already present in the shopping list (case-insensitive).
export function generateShoppingList(tripId) {
  return mutateTrip(tripId, (trip, now) => {
    const existing = new Set((trip.shoppingItems || []).map((s) => (s.name || '').trim().toLowerCase()));
    const additions = [];

    for (const meal of trip.meals || []) {
      for (const ing of meal.ingredients || []) {
        const name = (ing?.name || '').trim();
        if (!name) continue;
        const key = name.toLowerCase();
        if (existing.has(key)) continue;
        existing.add(key);
        additions.push({
          id: crypto.randomUUID(),
          name,
          qty: ing.qty || '',
          category: 'food',
          source: 'meal',
          sourceId: meal.id,
          checked: false,
          addedBy: getCurrentUserId(),
          createdAt: now,
          updatedAt: now,
          syncState: 'pending',
        });
      }
    }

    if (additions.length) {
      trip.shoppingItems = [...(trip.shoppingItems || []), ...additions];
    }
    return additions.length;
  });
}

export function setActiveTrip(id) {
  localStorage.setItem(ACTIVE_KEY, id);
}

export function clearActiveTrip() {
  localStorage.removeItem(ACTIVE_KEY);
}

export function deleteLocalTrip(tripId) {
  if (!tripId) return;
  const trips = getTrips().filter((t) => t.id !== tripId);
  localStorage.setItem(TRIPS_KEY, JSON.stringify(trips));
  if (localStorage.getItem(ACTIVE_KEY) === tripId) {
    clearActiveTrip();
  }
}

function normalizeTripShape(trip) {
  if (!trip || typeof trip !== 'object') return trip;
  return {
    ...trip,
    entries: Array.isArray(trip.entries) ? trip.entries : [],
    locations: Array.isArray(trip.locations) ? trip.locations : [],
    events: Array.isArray(trip.events) ? trip.events : [],
    track: Array.isArray(trip.track) ? trip.track : [],
    collaborators: Array.isArray(trip.collaborators) ? trip.collaborators : [],
    gpsTrackingEnabled: Boolean(trip.gpsTrackingEnabled),
    gpsBackgroundTracking: Boolean(trip.gpsBackgroundTracking),
    gpsIntervalMs: Number.isFinite(trip.gpsIntervalMs) && trip.gpsIntervalMs > 0 ? trip.gpsIntervalMs : 5000,
    gpsSessionActive: Boolean(trip.gpsSessionActive),
    gpsSessionId: trip.gpsSessionId || null,
    gpsSessionStartedAt: trip.gpsSessionStartedAt || null,
    trackSessions: Array.isArray(trip.trackSessions) ? trip.trackSessions : [],
    gearItems: Array.isArray(trip.gearItems) ? trip.gearItems : [],
    meals: Array.isArray(trip.meals) ? trip.meals : [],
    expenses: Array.isArray(trip.expenses) ? trip.expenses : [],
    shoppingItems: Array.isArray(trip.shoppingItems) ? trip.shoppingItems : [],
    status: trip.status || 'active',
    startedAt: trip.startedAt || null,
    coverPhoto: trip.coverPhoto || null,
    mapArea: trip.mapArea || null,
    offlineRegions: Array.isArray(trip.offlineRegions) ? trip.offlineRegions : [],
    recap: trip.recap && typeof trip.recap === 'object' ? trip.recap : null,
    ownerDeletedAt: trip.ownerDeletedAt || null,
  };
}

function resolveEntryLocation(trip, locationId) {
  if (!locationId) return null;
  return (trip.locations || []).find((l) => l.id === locationId) || null;
}

function resolveEntryEvent(trip, eventId) {
  if (!eventId) return null;
  return (trip.events || []).find((e) => e.id === eventId) || null;
}

