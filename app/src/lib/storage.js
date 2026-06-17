// Local storage data layer — trips, entries, GPS tracks

const TRIPS_KEY = 'tr_trips';
const ACTIVE_KEY = 'tr_active_trip_id';
const USER_KEY = 'tr_user_id';
const CONTACTS_KEY = 'tr_contacts';

import { getSignedInUserId, getSignedInDisplayName } from './authUser';

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
  const seen = new Set();
  const out = [];
  const excludeMemberIds = new Set();

  if (excludeTripId) {
    const trip = getTrips().find((t) => t.id === excludeTripId);
    if (trip?.ownerId) excludeMemberIds.add(trip.ownerId);
    for (const c of trip?.collaborators || []) {
      const id = c?.userId || c?.id;
      if (id) excludeMemberIds.add(id);
    }
    for (const uid of Object.keys(trip?.memberProfiles || {})) {
      excludeMemberIds.add(uid);
    }
  }

  for (const trip of getTrips()) {
    for (const c of trip.collaborators || []) {
      const name = (c.handle || c.name || '').trim();
      if (!name) continue;
      const userId = c.userId || (isUuid(c.id) ? c.id : null);
      if (userId && excludeMemberIds.has(userId)) continue;
      const key = userId || name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ id: userId || c.id || key, name, userId, hasAccount: Boolean(userId) });
    }
    for (const [uid, name] of Object.entries(trip.memberProfiles || {})) {
      if (uid === trip.ownerId) continue;
      if (excludeMemberIds.has(uid)) continue;
      const label = (name || '').trim();
      if (!label) continue;
      const key = uid;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ id: uid, name: label, userId: uid, hasAccount: true });
    }
  }

  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Add a name-only roster entry (gear/meals lists — not the same as a cloud invite). */
export function addTripCollaborator(tripId, { name }) {
  const label = (name || '').trim();
  if (!label) return null;
  return mutateTrip(tripId, (trip) => {
    const key = label.toLowerCase();
    const exists = (trip.collaborators || []).some(
      (c) => (c.handle || c.name || '').toLowerCase() === key,
    );
    if (exists) return null;
    const collab = {
      id: crypto.randomUUID(),
      handle: label,
      name: label,
      role: 'contributor',
    };
    trip.collaborators = [...(trip.collaborators || []), collab];
    return collab;
  });
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

export function saveTrip(trip) {
  const trips = getTrips();
  const nextTrip = normalizeTripShape(trip);
  const idx = trips.findIndex(t => t.id === nextTrip.id);
  if (idx >= 0) trips[idx] = nextTrip;
  else trips.unshift(nextTrip);
  try {
    localStorage.setItem(TRIPS_KEY, JSON.stringify(trips));
  } catch (e) {
    if (e.name === 'QuotaExceededError' || e.code === 22) {
      throw new Error('Storage full — your trip photos are using too much space. Try removing some photos from older entries to free up room.');
    }
    throw e;
  }

  if (nextTrip.syncState === 'pending' && nextTrip.id) {
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
  status = 'active',
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
    shoppingItems: [],
    coverPhoto,
    mapArea,
  };
  saveTrip(trip);
  setActiveTrip(trip.id);
  return trip;
}

export function addEntry(tripId, entry) {
  const trip = getTrip(tripId);
  if (!trip) return null;
  const now = Date.now();
  const linkedEvent = resolveEntryEvent(trip, entry.eventId);
  const linkedLocation = resolveEntryLocation(trip, linkedEvent?.locationId || entry.locationId);
  const full = {
    ...entry,
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
  const requestedEventId = patch.eventId || existing.eventId;
  const linkedEvent = resolveEntryEvent(trip, requestedEventId);
  const requestedLocationId = linkedEvent?.locationId || patch.locationId || existing.locationId;
  const linkedLocation = resolveEntryLocation(trip, requestedLocationId);
  const updated = {
    ...existing,
    ...patch,
    eventId: linkedEvent?.id || requestedEventId,
    eventName: linkedEvent?.name || patch.eventName || existing.eventName,
    eventType: linkedEvent?.type || patch.eventType || existing.eventType,
    locationId: linkedLocation?.id || requestedLocationId,
    locationName: linkedLocation?.name || patch.locationName || existing.locationName,
    locationType: linkedLocation?.type || patch.locationType || existing.locationType,
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
  const sessionId = point.sessionId || trip.gpsSessionId || null;
  trip.track.push({ ...point, sessionId, id: point.id || crypto.randomUUID(), syncState: point.syncState || 'pending' });

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
}

export function startGpsSession(tripId, { label } = {}) {
  const trip = getTrip(tripId);
  if (!trip) return null;
  const now = Date.now();
  const sessionId = crypto.randomUUID();
  const session = {
    id: sessionId,
    label: label || null,
    startedAt: now,
    endedAt: null,
    attachLocationId: null,
    pointsCount: 0,
    createdBy: getCurrentUserId(),
    createdAt: now,
    updatedAt: now,
    syncState: 'pending',
  };

  trip.gpsTrackingEnabled = true;
  trip.gpsSessionActive = true;
  trip.gpsSessionId = sessionId;
  trip.gpsSessionStartedAt = now;
  trip.trackSessions = [session, ...(trip.trackSessions || [])];
  trip.updatedAt = now;
  trip.syncState = 'pending';
  saveTrip(trip);
  return session;
}

export function stopGpsSession(tripId, { attachLocationId = null } = {}) {
  const trip = getTrip(tripId);
  if (!trip) return null;
  const activeId = trip.gpsSessionId;
  if (!activeId) return null;
  const now = Date.now();

  const idx = (trip.trackSessions || []).findIndex((s) => s.id === activeId);
  if (idx >= 0) {
    const existing = trip.trackSessions[idx];
    trip.trackSessions[idx] = {
      ...existing,
      endedAt: now,
      attachLocationId: attachLocationId || existing.attachLocationId || null,
      updatedAt: now,
      syncState: 'pending',
    };
  }

  trip.gpsSessionActive = false;
  trip.gpsSessionId = null;
  trip.gpsSessionStartedAt = null;
  trip.updatedAt = now;
  trip.syncState = 'pending';
  saveTrip(trip);
  return trip;
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
    createdBy: location.createdBy || getCurrentUserId(),
    createdAt: now,
    updatedAt: now,
    syncState: 'pending',
    coverPhoto: location.coverPhoto || null,
  };

  trip.locations.unshift(full);
  trip.updatedAt = now;
  trip.syncState = 'pending';
  saveTrip(trip);
  return full;
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
    type: event.type || 'note',
    name: event.name || defaultEventName(event.type),
    notes: event.notes || '',
    coverPhoto: event.coverPhoto,
    taggedParticipantId: event.taggedParticipantId || null,
    taggedParticipantLabel: event.taggedParticipantLabel || null,
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

export function getActiveTrip() {
  const id = localStorage.getItem(ACTIVE_KEY);
  return id ? getTrip(id) : null;
}

export function startTrip(tripId) {
  const trip = getTrip(tripId);
  if (!trip || trip.status === 'completed') return null;
  if (trip.status === 'active') return trip;

  const now = Date.now();
  trip.status = 'active';
  trip.startedAt = now;
  if (!trip.startDate) {
    trip.startDate = new Date(now).toISOString().slice(0, 10);
  }
  trip.updatedAt = now;
  trip.syncState = 'pending';
  saveTrip(trip);
  return trip;
}

export function finalizeTrip(tripId) {
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
  trip.status = 'active';
  if (!trip.startedAt) trip.startedAt = now;
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
      status: item.status || 'needed', // needed | claimed | packed
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

export function addMeal(tripId, meal) {
  return mutateTrip(tripId, (trip, now) => {
    const full = {
      id: crypto.randomUUID(),
      dayIndex: Number.isFinite(meal.dayIndex) ? meal.dayIndex : 1,
      slot: meal.slot || 'dinner', // breakfast | lunch | dinner | snack
      name: (meal.name || '').trim() || 'Untitled meal',
      assignedTo: meal.assignedTo || null,
      assignedToLabel: meal.assignedToLabel || null,
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

export function removeMeal(tripId, id) {
  return removePlanningItem(tripId, 'meals', id);
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
      splitAmong: Array.isArray(expense.splitAmong) ? expense.splitAmong : 'all',
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

function defaultEventName(type) {
  const map = {
    food: 'Meal',
    wildlife: 'Wildlife',
    gauge: 'River Flow',
    weather: 'Weather',
    note: 'Event',
    'custom-event': 'Custom Event',
  };
  return map[type] || 'Event';
}
