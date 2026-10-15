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

/** Closest saved place within maxMeters, or null. */
export function nearestLocation(locations, lat, lng, maxMeters = 200) {
  let best = null;
  let bestDistance = maxMeters;
  for (const loc of locations || []) {
    if (!Number.isFinite(Number(loc?.lat)) || !Number.isFinite(Number(loc?.lng))) continue;
    const distance = distanceMeters(lat, lng, loc.lat, loc.lng);
    if (distance <= bestDistance) {
      best = loc;
      bestDistance = distance;
    }
  }
  return best;
}

export function duplicateLocations(trip) {
  const pairs=[],locs=trip.locations||[];
  for(let i=0;i<locs.length;i++)for(let j=i+1;j<locs.length;j++) {
    const a=locs[i],b=locs[j];
    if(a.name?.trim().toLowerCase()===b.name?.trim().toLowerCase() &&
       Number.isFinite(a.lat)&&Number.isFinite(b.lat)&&Number.isFinite(a.lng)&&Number.isFinite(b.lng)&&
       Math.hypot(a.lat-b.lat,(a.lng-b.lng)*Math.cos(a.lat*Math.PI/180))<0.001)
      pairs.push([a,b]);
  }
  return pairs.slice(0,20);
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

/**
 * Offline sync defaults a new place, event, or entry to the nearest saved place.
 * The person importing can add onto that place, merge the two places, or keep the new one.
 */
export function suggestImportPlacements(local, merged, maxMeters = IMPORT_NEAR_METERS) {
  const localPlaces = local?.locations || [];
  const localIds = new Set(localPlaces.map((loc) => loc.id));
  const places = (merged?.locations || []).filter((loc) => !localIds.has(loc.id)).map((loc) => {
    const nearest = nearestLocation(localPlaces, loc.lat, loc.lng, maxMeters);
    return {
      incomingId: loc.id,
      name: loc.name || 'Untitled place',
      nearestId: nearest?.id || null,
      nearestName: nearest?.name || null,
      action: nearest ? 'add' : 'keep',
      targetId: nearest?.id || null,
    };
  });
  const incomingIds = new Set(places.map((place) => place.incomingId));
  const seen = {
    events: new Set((local?.events || []).map((item) => item.id)),
    entries: new Set((local?.entries || []).map((item) => item.id)),
    expenses: new Set((local?.expenses || []).map((item) => item.id)),
  };
  const items = [];
  for (const kind of ['events', 'entries', 'expenses']) {
    for (const item of merged?.[kind] || []) {
      if (seen[kind].has(item.id)) continue;
      if (item.locationId && incomingIds.has(item.locationId)) continue;
      const nearest = nearestLocation(localPlaces, item.lat, item.lng, maxMeters);
      if (!nearest || nearest.id === item.locationId) continue;
      items.push({
        kind,
        id: item.id,
        name: item.name || item.title || item.type || 'Item',
        targetId: nearest.id,
        nearestName: nearest.name,
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
    if (!item.targetId || !Array.isArray(next[item.kind])) continue;
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
