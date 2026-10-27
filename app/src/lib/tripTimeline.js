export function tripDayKey(ts,timeZone='UTC') {
  if(!ts) return 'unknown';
  const date=new Date(ts);
  if(!Number.isFinite(date.getTime()))return 'unknown';
  try {
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
    const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
    return p.year+'-'+p.month+'-'+p.day;
  } catch { return date.toISOString().slice(0,10); }
}
const READING_EVENT_TYPES = new Set(['gauge', 'weather', 'conditions']);

/** A river-flow or weather visit is the reading itself, so the journal should not list both. */
function eventCoveredByReading(event, entries) {
  if (!READING_EVENT_TYPES.has(event?.type)) return false;
  return (entries || []).some((entry) => entry.eventId === event.id);
}

export function buildTripTimeline(trip) {
  const entries = trip.entries || [];
  const result=[];
  for(const [collection,kind] of [['locations','location'],['events','event'],['entries','entry']])
    for(const item of trip[collection]||[]) {
      if (kind === 'event' && eventCoveredByReading(item, entries)) continue;
      const time=item.observedAt||item.observedStartAt||item.createdAt;
      result.push({id:kind+':'+item.id,kind,item,time,day:tripDayKey(time,tripTimeZone(trip)),
        authorId:item.authorId||item.createdBy||null});
    }
  for(const session of trip.trackSessions||[]) {
    const item={...session,name:session.label||'Recorded route',type:'route',locationId:session.attachLocationId,
      observedAt:session.startedAt,notes:(session.pointsCount||0)+' saved GPS points'+(session.endedAt?' · session finished':' · session unfinished')};
    result.push({id:'route:'+session.id,kind:'route',item,time:session.startedAt,day:tripDayKey(session.startedAt,tripTimeZone(trip)),authorId:session.createdBy||null});
  }
  return result.sort((a,b)=>(new Date(a.time||0)-new Date(b.time||0))||a.id.localeCompare(b.id));
}

/**
 * Group journal rows so a visit and its logs sit inside the place they were tagged to.
 * `points` are already in display order and carry `_kind`, `_day`, and the record fields.
 */
export function groupJournalDays(points, locations = []) {
  const locById = new Map((locations || []).map((loc) => [loc.id, loc]));
  const days = [];
  const dayMap = new Map();
  for (const point of points || []) {
    const day = point._day || 'unknown';
    if (!dayMap.has(day)) {
      const bucket = { day, points: [] };
      dayMap.set(day, bucket);
      days.push(bucket);
    }
    dayMap.get(day).points.push(point);
  }
  return days.map((bucket) => ({ day: bucket.day, ...nestDayPoints(bucket.points, locById) }));
}

function nestDayPoints(points, locById) {
  const placeOrder = [];
  const places = new Map();
  const loose = [];

  function placeFor(locationId, hintedName) {
    if (!locationId) return null;
    if (!places.has(locationId)) {
      const known = locById.get(locationId);
      const group = {
        id: locationId,
        location: known || { id: locationId, name: hintedName || 'Saved place' },
        events: [],
        eventIndex: new Map(),
        loose: [],
      };
      places.set(locationId, group);
      placeOrder.push(group);
    }
    return places.get(locationId);
  }

  function eventFor(place, eventPoint) {
    const id = eventPoint.id;
    if (!id) return null;
    if (!place.eventIndex.has(id)) {
      const group = { id, event: eventPoint, entries: [] };
      place.eventIndex.set(id, group);
      place.events.push(group);
    }
    return place.eventIndex.get(id);
  }

  for (const point of points) {
    if (point._kind === 'location') placeFor(point.id, point.name || point.title);
  }
  for (const point of points) {
    if (point._kind !== 'event') continue;
    const place = placeFor(point.locationId, point.locationName);
    if (place) eventFor(place, point);
    else loose.push(point);
  }
  for (const point of points) {
    if (point._kind !== 'entry' && point._kind !== 'route') continue;
    const place = placeFor(point.locationId, point.locationName);
    if (!place) {
      loose.push(point);
      continue;
    }
    if (point._kind === 'route' || !point.eventId) {
      place.loose.push(point);
      continue;
    }
    let group = place.eventIndex.get(point.eventId);
    if (!group) {
      group = eventFor(place, {
        id: point.eventId,
        _kind: 'event',
        _key: 'event:' + point.eventId,
        name: point.eventName || 'Visit',
        title: point.eventName || 'Visit',
        type: point.eventType || point.type,
        locationId: point.locationId,
        observedAt: point.observedAt,
        authorId: point.authorId,
        createdAt: point.createdAt,
      });
    }
    group?.entries.push(point);
  }
  return { places: placeOrder, loose };
}
export function distanceMeters(lat1, lng1, lat2, lng2) {
  const mid = ((Number(lat1) + Number(lat2)) / 2) * Math.PI / 180;
  const dy = (Number(lat1) - Number(lat2)) * 111320;
  const dx = (Number(lng1) - Number(lng2)) * 111320 * Math.cos(mid);
  return Math.hypot(dx, dy);
}

function hasCoords(item) {
  return item != null
    && item.lat !== null && item.lat !== '' && item.lng !== null && item.lng !== ''
    && Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lng));
}

function normName(name) {
  return String(name || '').trim().toLowerCase();
}

function sameName(a, b) {
  const na = normName(a);
  const nb = normName(b);
  return Boolean(na && nb && na === nb);
}

/** Closest saved place within maxMeters, or null. */
export function nearestLocation(locations, lat, lng, maxMeters = 200) {
  if (lat === null || lat === '' || lng === null || lng === '' || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
    return null;
  }
  let best = null;
  let bestDistance = maxMeters;
  for (const loc of locations || []) {
    if (!hasCoords(loc)) continue;
    const distance = distanceMeters(lat, lng, loc.lat, loc.lng);
    if (distance <= bestDistance) {
      best = loc;
      bestDistance = distance;
    }
  }
  return best;
}

/** Find an existing location within maxMeters of (lat, lng) or with the exact same name. */
export function findMatchingLocation(locations, { lat, lng, name } = {}, maxMeters = 200) {
  const byCoords = nearestLocation(locations, lat, lng, maxMeters);
  if (byCoords) {
    return {
      location: byCoords,
      distanceMeters: Math.round(distanceMeters(lat, lng, byCoords.lat, byCoords.lng)),
      reason: 'distance',
    };
  }
  if (normName(name)) {
    const byName = (locations || []).find((loc) => sameName(loc?.name, name));
    if (byName) {
      const dist = hasCoords(byName) && hasCoords({ lat, lng })
        ? Math.round(distanceMeters(lat, lng, byName.lat, byName.lng))
        : null;
      return { location: byName, distanceMeters: dist, reason: 'name' };
    }
  }
  return null;
}

const dismissedPairsMemory = new Set();

function pairKey(tripId, aId, bId) {
  const [x, y] = [String(aId || ''), String(bId || '')].sort();
  return `${tripId || 'trip'}:${x}:${y}`;
}

export function dismissDuplicateLocationPair(tripId, aId, bId) {
  const key = pairKey(tripId, aId, bId);
  dismissedPairsMemory.add(key);
  try {
    const raw = JSON.parse(localStorage.getItem('tr_dismissed_location_pairs') || '[]');
    const next = Array.isArray(raw) ? [...new Set([...raw, key])] : [key];
    localStorage.setItem('tr_dismissed_location_pairs', JSON.stringify(next));
  } catch {
    // Session memory fallback is already updated.
  }
}

function isDismissedPair(tripId, aId, bId) {
  const key = pairKey(tripId, aId, bId);
  if (dismissedPairsMemory.has(key)) return true;
  try {
    const raw = JSON.parse(localStorage.getItem('tr_dismissed_location_pairs') || '[]');
    return Array.isArray(raw) && raw.includes(key);
  } catch {
    return false;
  }
}

export function duplicateLocations(trip, maxMeters = 200) {
  const pairs = [];
  const locs = trip?.locations || [];
  for (let i = 0; i < locs.length; i++) {
    for (let j = i + 1; j < locs.length; j++) {
      const a = locs[i];
      const b = locs[j];
      if (!a || !b || isDismissedPair(trip?.id, a.id, b.id)) continue;
      const bothCoords = hasCoords(a) && hasCoords(b);
      const dist = bothCoords ? distanceMeters(a.lat, a.lng, b.lat, b.lng) : null;
      const namesMatch = sameName(a.name, b.name);
      if ((dist != null && dist <= maxMeters) || (namesMatch && (dist == null || dist <= 1000))) {
        pairs.push([a, b]);
      }
    }
  }
  return pairs.slice(0, 20);
}

export function combineLocations(trip,keepId,removeId) {
  const keep=trip.locations.find(l=>l.id===keepId),other=trip.locations.find(l=>l.id===removeId);
  if(!keep||!other)return trip;
  const photos=[...new Map([...(keep.photos||[]),...(other.photos||[]),...(other.coverPhoto?[other.coverPhoto]:[])].map(p=>[p.id,p])).values()];
  const moved = (item) => item.locationId === removeId ? { ...item, locationId: keepId, locationName: keep.name } : item;
  return {...trip,locations:trip.locations.filter(l=>l.id!==removeId).map(l=>l.id===keepId?
    {...l,photos,notes:[l.notes,other.notes].filter(Boolean).filter((s,i,a)=>a.indexOf(s)===i).join('\n\n')}:l),
    events:(trip.events||[]).map(moved),
    entries:(trip.entries||[]).map(moved),
    expenses:(trip.expenses||[]).map(moved)};
}

/** Incoming places within this distance offer add-or-merge. Farther stops stay separate. */
export const IMPORT_NEAR_METERS = 200;

function resolveItemCoords(kind, item, trip) {
  if (hasCoords(item)) return { lat: Number(item.lat), lng: Number(item.lng) };
  if (kind === 'events') {
    const child = (trip?.entries || []).find((entry) => entry.eventId === item.id && hasCoords(entry));
    if (child) return { lat: Number(child.lat), lng: Number(child.lng) };
  }
  if (item?.locationId) {
    const loc = (trip?.locations || []).find((l) => l.id === item.locationId);
    if (hasCoords(loc)) return { lat: Number(loc.lat), lng: Number(loc.lng) };
  }
  return null;
}

/**
 * Find events or unlinked entries in a trip whose coordinates are within maxMeters
 * of a saved location (e.g. after online cloud sync or when an event along a hike
 * happened near a saved stop).
 */
export function nearbyEventsForLocations(trip, maxMeters = IMPORT_NEAR_METERS) {
  const locations = (trip?.locations || []).filter(hasCoords);
  if (!locations.length) return [];
  const locById = new Map((trip?.locations || []).map((l) => [l.id, l]));
  const suggestions = [];
  const coveredEventIds = new Set();

  for (const event of trip?.events || []) {
    if (isDismissedPair(trip?.id, 'evt:' + event.id, event.locationId || 'none')) continue;
    const coords = hasCoords(event)
      ? { lat: Number(event.lat), lng: Number(event.lng) }
      : (() => {
        const child = (trip?.entries || []).find((e) => e.eventId === event.id && hasCoords(e));
        return child ? { lat: Number(child.lat), lng: Number(child.lng) } : null;
      })();
    if (!coords) continue;
    const nearest = nearestLocation(locations, coords.lat, coords.lng, maxMeters);
    if (!nearest || nearest.id === event.locationId) continue;
    if ( isDismissedPair(trip?.id, 'evt:' + event.id, nearest.id) ) continue;
    const currentLoc = event.locationId ? locById.get(event.locationId) : null;
    if (currentLoc && hasCoords(currentLoc) && distanceMeters(currentLoc.lat, currentLoc.lng, nearest.lat, nearest.lng) <= maxMeters) {
      // Handled by duplicate/nearby location banner.
      continue;
    }
    coveredEventIds.add(event.id);
    suggestions.push({
      kind: 'events',
      id: event.id,
      name: event.name || event.title || event.type || 'Event',
      currentLocationId: event.locationId || null,
      currentLocationName: currentLoc?.name || event.locationName || null,
      targetId: nearest.id,
      targetName: nearest.name,
      distanceMeters: Math.round(distanceMeters(coords.lat, coords.lng, nearest.lat, nearest.lng)),
    });
  }

  for (const entry of trip?.entries || []) {
    if (entry.eventId && coveredEventIds.has(entry.eventId)) continue;
    if (!hasCoords(entry)) continue;
    const nearest = nearestLocation(locations, entry.lat, entry.lng, maxMeters);
    if (!nearest || nearest.id === entry.locationId) continue;
    if (isDismissedPair(trip?.id, 'ent:' + entry.id, nearest.id)) continue;
    const currentLoc = entry.locationId ? locById.get(entry.locationId) : null;
    if (currentLoc && hasCoords(currentLoc) && distanceMeters(currentLoc.lat, currentLoc.lng, nearest.lat, nearest.lng) <= maxMeters) {
      continue;
    }
    suggestions.push({
      kind: 'entries',
      id: entry.id,
      name: entry.title || entry.name || entry.type || 'Entry',
      currentLocationId: entry.locationId || null,
      currentLocationName: currentLoc?.name || entry.locationName || null,
      targetId: nearest.id,
      targetName: nearest.name,
      distanceMeters: Math.round(distanceMeters(entry.lat, entry.lng, nearest.lat, nearest.lng)),
    });
  }

  return suggestions.slice(0, 20);
}

/**
 * Offline sync defaults a new place, event, or entry to the nearest saved place.
 * The person importing can add onto that place, merge the two places, or keep the new one.
 */
export function suggestImportPlacements(local, merged, maxMeters = IMPORT_NEAR_METERS) {
  const localPlaces = local?.locations || [];
  const localIds = new Set(localPlaces.map((loc) => loc.id));
  const seen = {
    events: new Set((local?.events || []).map((item) => item.id)),
    entries: new Set((local?.entries || []).map((item) => item.id)),
    expenses: new Set((local?.expenses || []).map((item) => item.id)),
  };
  const places = (merged?.locations || []).filter((loc) => !localIds.has(loc.id)).map((loc) => {
    const match = findMatchingLocation(localPlaces, loc, maxMeters);
    const nearest = match?.location || null;
    const placeEvents = (merged?.events || [])
      .filter((e) => !seen.events.has(e.id) && e.locationId === loc.id)
      .map((e) => ({ id: e.id, name: e.name || e.title || e.type || 'Event' }));
    return {
      incomingId: loc.id,
      name: loc.name || 'Untitled place',
      nearestId: nearest?.id || null,
      nearestName: nearest?.name || null,
      distanceMeters: match?.distanceMeters ?? null,
      events: placeEvents,
      action: nearest ? 'add' : 'keep',
      targetId: nearest?.id || null,
    };
  });
  const matchedIncomingPlaceTarget = new Map(
    places.filter((place) => place.nearestId).map((place) => [place.incomingId, place.nearestId]),
  );
  const items = [];
  const matchedEventIds = new Set();
  for (const kind of ['events', 'entries', 'expenses']) {
    for (const item of merged?.[kind] || []) {
      if (seen[kind].has(item.id)) continue;
      if (kind === 'entries' && item.eventId && matchedEventIds.has(item.eventId)) continue;
      const coords = resolveItemCoords(kind, item, merged);
      if (!coords) continue;
      const nearest = nearestLocation(localPlaces, coords.lat, coords.lng, maxMeters);
      if (!nearest || nearest.id === item.locationId) continue;
      // Skip only if the item's incoming place is already being added/merged into this same saved place.
      if (item.locationId && matchedIncomingPlaceTarget.get(item.locationId) === nearest.id) continue;
      if (kind === 'events') matchedEventIds.add(item.id);
      items.push({
        kind,
        id: item.id,
        name: item.name || item.title || item.description || item.type || 'Item',
        currentLocationId: item.locationId || null,
        currentLocationName: item.locationName || null,
        nearestId: nearest.id,
        nearestName: nearest.name,
        distanceMeters: Math.round(distanceMeters(coords.lat, coords.lng, nearest.lat, nearest.lng)),
        action: 'add',
        targetId: nearest.id,
      });
    }
  }
  return { places, items };
}

export function applyImportPlacement(trip, placement) {
  if (!placement) return trip;
  let next = trip;
  const placeName = (id) => next.locations?.find((loc) => loc.id === id)?.name;
  for (const place of placement.places || []) {
    if (place.action === 'keep' || !place.targetId || place.targetId === place.incomingId) continue;
    const targetName = placeName(place.targetId);
    if (place.action === 'merge') {
      next = combineLocations(next, place.targetId, place.incomingId);
      continue;
    }
    const moved = (item) => item.locationId === place.incomingId
      ? { ...item, locationId: place.targetId, locationName: targetName || item.locationName }
      : item;
    next = {
      ...next,
      locations: (next.locations || []).filter((loc) => loc.id !== place.incomingId),
      events: (next.events || []).map(moved),
      entries: (next.entries || []).map(moved),
      expenses: (next.expenses || []).map(moved),
    };
  }
  for (const item of placement.items || []) {
    if (item.action === 'keep' || !item.targetId || !Array.isArray(next[item.kind])) continue;
    const targetName = placeName(item.targetId);
    next = {
      ...next,
      [item.kind]: next[item.kind].map((row) => row.id === item.id
        ? { ...row, locationId: item.targetId, locationName: targetName || row.locationName }
        : row),
    };
    if (item.kind === 'events') {
      next = {
        ...next,
        entries: (next.entries || []).map((entry) => entry.eventId === item.id
          ? { ...entry, locationId: item.targetId, locationName: targetName || entry.locationName }
          : entry),
      };
    }
  }
  return next;
}
export function trackSegments(track) {
  const groups=new Map();
  for(const p of track||[]) {
    // Unidentified legacy points have no reliable continuity; don't invent connecting legs.
    if(!p.sessionId)continue;
    const key=(p.authorId||'')+':'+(p.deviceId||'')+':'+p.sessionId+':'+(p.segmentId||'legacy');
    if(!groups.has(key))groups.set(key,[]);
    if(Number.isFinite(p.lat)&&Number.isFinite(p.lng)) groups.get(key).push(p);
  }
  return [...groups.values()].map(points=>points.sort((a,b)=>new Date(a.ts||a.createdAt||0)-new Date(b.ts||b.createdAt||0)));
}

/** Trip's own zone; trips saved before time zones were recorded use this phone's zone, not UTC. */
export function tripTimeZone(trip) {
  return trip?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/** "Mon, Oct 12 · Day 2" for a YYYY-MM-DD day key. */
export function formatTripDay(dayKey, startDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey || '')) return 'Undated';
  const date = new Date(dayKey + 'T12:00:00Z');
  const label = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const start = /^\d{4}-\d{2}-\d{2}/.test(startDate || '') ? new Date(startDate.slice(0, 10) + 'T12:00:00Z') : null;
  const dayNumber = start ? Math.round((date - start) / 86400000) + 1 : null;
  return dayNumber >= 1 ? `${label} · Day ${dayNumber}` : label;
}
