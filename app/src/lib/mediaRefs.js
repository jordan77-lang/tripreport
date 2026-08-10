// Collect media refs from trips and mark sync state on JSON refs.

export function collectMediaRefsFromTrip(trip) {
  if (!trip) return [];
  const out = [];
  const seen = new Set();

  function add(ref) {
    if (!ref?.id || seen.has(ref.id)) return;
    seen.add(ref.id);
    out.push(ref);
  }

  function addAll(refs) {
    for (const ref of refs || []) add(ref);
  }

  if (trip.coverPhoto?.id) add(trip.coverPhoto);
  for (const loc of trip.locations || []) {
    if (loc.coverPhoto?.id) add(loc.coverPhoto);
    addAll(loc.photos);
  }
  for (const ev of trip.events || []) {
    if (ev.coverPhoto?.id) add(ev.coverPhoto);
    addAll(ev.photos);
  }
  for (const entry of trip.entries || []) {
    addAll(entry.photoFiles);
  }

  return out;
}

export function markMediaRefsSynced(trip, syncedIds) {
  if (!trip || !syncedIds?.size) return trip;
  const mark = (ref) => {
    if (!ref?.id || !syncedIds.has(ref.id)) return ref;
    return { ...ref, syncState: 'synced' };
  };
  const markList = (refs) => (Array.isArray(refs) ? refs.map(mark) : refs);

  return {
    ...trip,
    coverPhoto: trip.coverPhoto ? mark(trip.coverPhoto) : trip.coverPhoto,
    locations: (trip.locations || []).map((loc) => ({
      ...loc,
      coverPhoto: loc.coverPhoto ? mark(loc.coverPhoto) : loc.coverPhoto,
      photos: markList(loc.photos),
    })),
    events: (trip.events || []).map((ev) => ({
      ...ev,
      coverPhoto: ev.coverPhoto ? mark(ev.coverPhoto) : ev.coverPhoto,
      photos: markList(ev.photos),
    })),
    entries: (trip.entries || []).map((entry) => ({
      ...entry,
      photoFiles: (entry.photoFiles || []).map(mark),
    })),
  };
}
