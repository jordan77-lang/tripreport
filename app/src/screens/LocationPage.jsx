import { useEffect, useMemo, useRef, useState } from 'react';
import { BottomNav } from '../components/BottomNav';
import { SyncChip } from '../components/SyncChip';
import { TripMap } from '../components/TripMap';
import { Ic } from '../components/Ic';
import { T, F, ICONS } from '../tokens';
import { addEntry, addEvent, getCurrentUserId, updateEntry, updateLocation } from '../lib/storage';
import { buildTripParticipants } from '../lib/expenses';
import { createPhotoMediaFromFile } from '../lib/media';
import { MediaThumb } from '../components/MediaThumb';
import { VIDEO_ENABLED, VIDEO_DISABLED_HINT, disabledMediaStyle, mediaCaptureLabel } from '../lib/featureFlags';
import { shareEntity } from '../lib/share';
import { fetchWeatherAtTime } from '../lib/weather';
import { fetchGauge, fetchNearbyGaugesByGps, fetchGaugeStationsByBbox, findNearbyKnownGauges } from '../lib/usgs';
import { EventPage } from './EventPage';
import { TripExpenses } from '../components/TripExpenses';

const EVENT_SYMBOLS = { food: '🍴', wildlife: '🦌', gauge: '📈', weather: '⛅', note: '📝', 'custom-event': '✨' };
const EVENT_COLORS  = { food: '#B06030', wildlife: '#4A7A34', gauge: '#2A5C8E', weather: '#517EA3', note: '#6B6763', 'custom-event': '#2C5F3E' };

export function LocationPage({ trip, location, onBack, onNav, onFab, onTripUpdate, initialEventId }) {
  const currentUserId = getCurrentUserId();
  const participantOptions = useMemo(() => {
    const people = buildTripParticipants(trip, currentUserId);
    return [{ id: 'everyone', label: 'Everyone on the trip' }, ...people];
  }, [trip, currentUserId]);
  const [editingLocation, setEditingLocation] = useState(false);
  const [composerType, setComposerType] = useState(null);
  const [editingEntry, setEditingEntry] = useState(null);
  const [composerDraft, setComposerDraft] = useState(() => buildComposerDraft('video', null));
  const [gaugeAuto, setGaugeAuto] = useState({ loading: false, error: null });
  const [gaugeCandidates, setGaugeCandidates] = useState([]);
  const [weatherPreview, setWeatherPreview] = useState({ loading: false, error: null, data: null, requestedAt: null });
  const [locationDraft, setLocationDraft] = useState({
    name: location?.name || '',
    type: location?.type || 'point-of-interest',
    icon: location?.icon || '📍',
    notes: location?.notes || '',
    timeMode: location?.timeMode || 'current',
    observedAt: location?.observedAt ? toDatetimeLocal(new Date(location.observedAt)) : toDatetimeLocal(new Date()),
    observedStartAt: location?.observedStartAt ? toDatetimeLocal(new Date(location.observedStartAt)) : toDatetimeLocal(new Date()),
    observedEndAt: location?.observedEndAt ? toDatetimeLocal(new Date(location.observedEndAt)) : toDatetimeLocal(addHours(new Date(), 1)),
    coverPhoto: location?.coverPhoto || null,
  });
  const [eventDraft, setEventDraft] = useState({ name: '', notes: '', coverPhoto: null, taggedParticipantId: 'none' });
  const [saveError, setSaveError] = useState(null);
  const [targetEventId, setTargetEventId] = useState(null);
  const [viewEventId, setViewEventId] = useState(initialEventId || null);
  const coverRef = useRef(null);
  const photoCaptureRef = useRef(null);
  const photoUploadRef = useRef(null);
  const videoCaptureRef = useRef(null);
  const videoUploadRef = useRef(null);

  const captureItems = [
    { icon: ICONS.camera, label: mediaCaptureLabel('Photo / Video'), col: '#C05050', type: 'video' },
    { icon: ICONS.fork, label: 'Meal Entry', col: '#B06030', type: 'food' },
    { icon: ICONS.leaf, label: 'Sighting', col: '#4A7A34', type: 'wildlife' },
    { icon: ICONS.compass, label: 'Weather Entry', col: '#517EA3', type: 'weather' },
    { icon: ICONS.gauge, label: 'Gauge Reading', col: '#2A5C8E', type: 'gauge' },
    { icon: ICONS.plus, label: 'Custom Event', col: '#2C5F3E', type: 'custom-event' },
  ];

  // Chronological order for prev/next navigation
  const events = useMemo(() => {
    const list = (trip?.events || []).filter((e) => e.locationId === location?.id);
    return list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }, [trip?.events, location?.id]);

  const eventsById = useMemo(() => {
    const m = new Map();
    for (const ev of events) m.set(ev.id, ev);
    return m;
  }, [events]);

  const canEditEvents = Boolean(trip?.ownerId && currentUserId === trip.ownerId);
  const canAddToEvents = useMemo(() => {
    if (!trip) return false;
    if (trip.ownerId && trip.ownerId === currentUserId) return true;
    return (trip.collaborators || []).some((c) => {
      const id = c?.id || c?.handle;
      return Boolean(id) && id === currentUserId;
    });
  }, [trip, currentUserId]);


  useEffect(() => {
    if (composerType !== 'weather') return;

    const lat = Number(location?.lat);
    const lng = Number(location?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      Promise.resolve().then(() => {
        setWeatherPreview({
          loading: false,
          error: 'Location coordinates unavailable for weather lookup.',
          data: null,
          requestedAt: null,
        });
      });
      return;
    }

    const when = composerDraft.timeMode === 'custom' && composerDraft.observedAt
      ? new Date(composerDraft.observedAt).toISOString()
      : new Date().toISOString();

    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) {
        setWeatherPreview({ loading: true, error: null, data: null, requestedAt: when });
      }
    });
    fetchWeatherAtTime(lat, lng, when)
      .then((data) => {
        if (cancelled) return;
        setWeatherPreview({ loading: false, error: null, data, requestedAt: when });
      })
      .catch(() => {
        if (cancelled) return;
        const offlineLike = typeof navigator !== 'undefined' && !navigator.onLine;
        setWeatherPreview({
          loading: false,
          error: offlineLike
            ? 'Offline: weather will sync when service returns.'
            : 'Could not fetch weather right now. It will retry on save/sync.',
          data: null,
          requestedAt: when,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [composerType, composerDraft.timeMode, composerDraft.observedAt, location?.lat, location?.lng]);

  if (!location) {
    return (
      <div style={{ height: '100%', background: T.bg, display: 'flex', flexDirection: 'column', fontFamily: F }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.textFaint }}>
          Location not found
        </div>
        <BottomNav active="trip" onNav={onNav} onFab={onFab} trip={trip} />
      </div>
    );
  }

  if (viewEventId) {
    const eventIdx = events.findIndex((e) => e.id === viewEventId);
    const selectedEvent = eventIdx >= 0 ? events[eventIdx] : (eventsById.get(viewEventId) || null);
    const prevEvent = eventIdx > 0 ? events[eventIdx - 1] : null;
    const nextEvent = eventIdx >= 0 && eventIdx < events.length - 1 ? events[eventIdx + 1] : null;
    return (
      <EventPage
        trip={trip}
        location={location}
        event={selectedEvent}
        eventIndex={eventIdx >= 0 ? eventIdx : null}
        eventCount={events.length}
        onBack={() => setViewEventId(null)}
        onPrev={prevEvent ? () => setViewEventId(prevEvent.id) : null}
        onNext={nextEvent ? () => setViewEventId(nextEvent.id) : null}
        onNav={onNav}
        onFab={onFab}
        onTripUpdate={onTripUpdate}
        canEditEvent={canEditEvents}
        canAddToEvent={canAddToEvents}
      />
    );
  }

  async function saveComposerEntry() {
    if (!trip || !location) return;
    if (!targetEventId && !editingEntry && !eventDraft.name.trim()) {
      setSaveError('Event name is required before saving.');
      return;
    }
    setSaveError(null);
    const payload = buildEntryPayloadFromComposer(composerType, composerDraft);
    if (!payload) return;
    let linkedEvent = null;
    if (targetEventId) {
      linkedEvent = eventsById.get(targetEventId) || null;
    } else if (!editingEntry) {
      const name = eventDraft.name.trim() || defaultEventName(composerType);
      const created = addEvent(trip.id, {
        locationId: location.id,
        type: composerType,
        name,
        notes: eventDraft.notes,
        coverPhoto: eventDraft.coverPhoto || undefined,
        taggedParticipantId: eventDraft.taggedParticipantId === 'none' ? null : eventDraft.taggedParticipantId,
        taggedParticipantLabel: eventDraft.taggedParticipantId === 'none'
          ? null
          : (participantOptions.find((p) => p.id === eventDraft.taggedParticipantId)?.label || null),
      });
      linkedEvent = created || null;
      setEventDraft({ name: '', notes: '', coverPhoto: null, taggedParticipantId: 'none' });
    } else if (editingEntry?.eventId) {
      linkedEvent = (trip?.events || []).find((e) => e.id === editingEntry.eventId) || null;
    }
    const next = {
      ...payload,
      title: eventDraft.name.trim() || payload.title || defaultEventName(composerType),
      notes: eventDraft.notes || payload.notes || '',
      locationId: location.id,
      locationName: location.name,
      locationType: location.type,
      eventId: linkedEvent?.id,
      eventName: linkedEvent?.name,
      eventType: linkedEvent?.type,
    };

    if (next.type === 'weather' && location.lat != null && location.lng != null) {
      const weatherWhen = next.observedAt || new Date().toISOString();
      next.weatherSyncPending = true;
      next.weatherRequestedAt = weatherWhen;
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        try {
          const weather = await fetchWeatherAtTime(location.lat, location.lng, weatherWhen);
          next.weatherTempC = weather.temperatureC;
          next.weatherFeelsLikeC = weather.feelsLikeC;
          next.weatherWindKph = weather.windKph;
          next.weatherWindDirectionDeg = weather.windDirectionDeg;
          next.weatherCode = weather.weatherCode;
          next.weatherSummary = weather.summary;
          next.weatherFetchedAt = weather.fetchedAt;
          next.weatherSource = weather.source;
          next.weatherSyncPending = false;
        } catch {
          // Keep weatherSyncPending=true and let reconnect sync resolve it.
        }
      }
    }

    if (next.type === 'gauge' && location.lat != null && location.lng != null) {
      next.gaugeSyncPending = true;
      next.gaugeRequestedAt = next.observedAt;
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        try {
          const lat = Number(location.lat);
          const lng = Number(location.lng);
          let siteId = composerDraft.gaugeSiteId || next.gaugeSiteId || null;
          let siteName = next.gaugeSiteName || null;
          if (!siteId && gaugeCandidates.length) {
            siteId = gaugeCandidates[0]?.id || null;
            siteName = siteName || gaugeCandidates[0]?.name || null;
          }
          if (!siteId && Number.isFinite(lat) && Number.isFinite(lng)) {
            const near = await fetchNearbyGaugesByGps(lat, lng, { radiusMiles: 120, limit: 1 });
            const pick = near[0] || (await fetchNearbyGaugesByGps(lat, lng, { radiusMiles: 300, limit: 1 }))[0];
            siteId = pick?.id || null;
            siteName = siteName || pick?.name || null;

            if (!siteId) {
              const known = findNearbyKnownGauges(lat, lng, { limit: 1, maxMiles: 500 });
              siteId = known[0]?.id || null;
              siteName = siteName || known[0]?.name || null;
            }
          }
          if (siteId) {
            const gauge = await fetchGauge(siteId);
            next.gaugeSiteId = siteId;
            next.gaugeSiteName = gauge.siteName || siteName || next.gaugeSiteName;
            next.cfs = gauge.cfs ?? next.cfs;
            next.gaugeHt = gauge.gaugeHt ?? next.gaugeHt;
            next.gaugeFetchedAt = gauge.updatedAt || new Date().toISOString();
            next.gaugeSyncPending = false;
          }
        } catch {
          // Keep gaugeSyncPending=true and let reconnect sync resolve it.
        }
      }
    }

    try {
      if (editingEntry?.id) updateEntry(trip.id, editingEntry.id, next);
      else addEntry(trip.id, next);
    } catch (e) {
      setSaveError(e.message || 'Failed to save — storage may be full.');
      return;
    }
    setComposerType(null);
    setComposerDraft(buildComposerDraft(composerType, null));
    setEditingEntry(null);
    setTargetEventId(null);
    onTripUpdate?.();
  }

  function openQuickEntry(type) {
    setEditingEntry(null);
    setTargetEventId(null);
    setSaveError(null);
    setComposerType(type);
    setComposerDraft(buildComposerDraft(type, null));
    setEventDraft({ name: defaultEventName(type), notes: '', coverPhoto: null, taggedParticipantId: 'none' });
    if (type === 'gauge') {
      void loadNearbyGaugeCandidates();
    } else {
      setGaugeAuto({ loading: false, error: null });
      setGaugeCandidates([]);
    }
  }

  function openEditComposer(entry) {
    if (!entry) return;
    setSaveError(null);
    setEditingEntry(entry);
    setComposerType(entry.type || 'note');
    setComposerDraft(buildComposerDraft(entry.type || 'note', entry));
    setEventDraft({
      name: entry?.eventName || entry?.title || defaultEventName(entry.type || 'note'),
      notes: entry?.notes || '',
      coverPhoto: null,
      taggedParticipantId: 'none',
    });
  }

  function closeComposer() {
    setComposerType(null);
    setEditingEntry(null);
    setTargetEventId(null);
    setSaveError(null);
    setGaugeAuto({ loading: false, error: null });
    setGaugeCandidates([]);
  }

  function openViewEvent(eventId) {
    if (!eventId) return;
    setViewEventId(eventId);
  }

  function openAddToEvent(eventId) {
    if (!eventId || !canAddToEvents) return;
    setSaveError(null);
    const ev = eventsById.get(eventId);
    setTargetEventId(eventId);
    setEditingEntry(null);
    setComposerType(ev?.type || 'custom-event');
    setComposerDraft(buildComposerDraft(ev?.type || 'custom-event', null));
    setEventDraft({
      name: ev?.name || defaultEventName(ev?.type || 'custom-event'),
      notes: '',
      coverPhoto: null,
      taggedParticipantId: 'none',
    });
  }

  async function chooseGaugeCandidate(candidate) {
    if (!candidate?.id) return;
    setComposerDraft((d) => ({
      ...d,
      gaugeSiteId: candidate.id,
      gaugeSiteName: candidate.name || d.gaugeSiteName,
    }));

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      try {
        const gauge = await fetchGauge(candidate.id);
        setComposerDraft((d) => ({
          ...d,
          gaugeSiteId: candidate.id,
          gaugeSiteName: gauge.siteName || candidate.name || d.gaugeSiteName,
          cfs: gauge.cfs == null ? d.cfs : String(gauge.cfs),
        }));
      } catch {
        // Keep selected candidate details even if live value fetch fails.
      }
    }
  }

  async function loadNearbyGaugeCandidates() {
    const lat = Number(location?.lat);
    const lng = Number(location?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setGaugeAuto({ loading: false, error: 'Location coordinates unavailable; gauge will sync when possible.' });
      setGaugeCandidates([]);
      return;
    }
    setGaugeAuto({ loading: true, error: null });
    try {
      const byId = new Map();
      const ivNear = await fetchNearbyGaugesByGps(lat, lng, { radiusMiles: 120, limit: 25 }).catch(() => []);
      const ivWide = ivNear.length >= 8
        ? ivNear
        : await fetchNearbyGaugesByGps(lat, lng, { radiusMiles: 300, limit: 60 }).catch(() => []);
      const bbox = await fetchGaugeStationsByBbox(lat, lng, { radiusMiles: 300, limit: 40 }).catch(() => []);
      const known = findNearbyKnownGauges(lat, lng, { limit: 10, maxMiles: 500 });

      [...ivNear, ...ivWide, ...bbox, ...known].forEach((g) => {
        if (!g?.id) return;
        const existing = byId.get(g.id);
        if (!existing) {
          byId.set(g.id, g);
        } else {
          byId.set(g.id, {
            ...existing,
            ...g,
            name: existing.name || g.name,
            lat: existing.lat ?? g.lat,
            lng: existing.lng ?? g.lng,
            distanceMiles: existing.distanceMiles ?? g.distanceMiles,
          });
        }
      });

      const picks = Array.from(byId.values())
        .map((g) => ({
          ...g,
          distanceMiles: Number.isFinite(g.distanceMiles)
            ? g.distanceMiles
            : (Number.isFinite(g.lat) && Number.isFinite(g.lng)
              ? calcMiles(lat, lng, g.lat, g.lng)
              : null),
        }))
        .sort((a, b) => (a.distanceMiles ?? Number.POSITIVE_INFINITY) - (b.distanceMiles ?? Number.POSITIVE_INFINITY))
        .slice(0, 8);

      setGaugeCandidates(picks);

      if (!picks.length) {
        setGaugeAuto({ loading: false, error: 'No nearby gauge found; this will sync when service is available.' });
        return;
      }

      await chooseGaugeCandidate(picks[0]);
      setGaugeAuto({ loading: false, error: null });
    } catch {
      setGaugeAuto({ loading: false, error: 'Could not find a nearby gauge right now. We will sync when online.' });
      setGaugeCandidates([]);
    }
  }

  async function onPhotoSelected(files) {
    const rawFiles = Array.from(files || []);
    if (!rawFiles.length || !trip?.id) return;
    const next = await Promise.all(rawFiles.map(async (f) => {
      if (f.type?.startsWith('image/')) {
        try {
          return await createPhotoMediaFromFile(f, trip.id);
        } catch {
          return { name: f.name, size: f.size, type: f.type };
        }
      }
      return { name: f.name, size: f.size, type: f.type };
    }));
    setComposerDraft((d) => ({ ...d, photoFiles: [...(d.photoFiles || []), ...next] }));
  }

  function onVideoSelected(files) {
    if (!VIDEO_ENABLED) return;
    const next = Array.from(files || []).map((f) => ({ name: f.name, size: f.size, type: f.type }));
    if (!next.length) return;
    setComposerDraft((d) => ({ ...d, videoFiles: [...(d.videoFiles || []), ...next] }));
  }

  function saveLocationDetails() {
    if (!trip || !location || !locationDraft.name.trim()) return;
    updateLocation(trip.id, location.id, {
      name: locationDraft.name.trim(),
      type: locationDraft.type,
      icon: locationDraft.icon,
      notes: locationDraft.notes,
      timeMode: locationDraft.timeMode,
      observedAt: locationDraft.timeMode === 'current'
        ? new Date().toISOString()
        : (locationDraft.timeMode === 'custom' ? new Date(locationDraft.observedAt).toISOString() : undefined),
      observedStartAt: locationDraft.timeMode === 'range' ? new Date(locationDraft.observedStartAt).toISOString() : undefined,
      observedEndAt: locationDraft.timeMode === 'range' ? new Date(locationDraft.observedEndAt).toISOString() : undefined,
      coverPhoto: locationDraft.coverPhoto || null,
    });
    setEditingLocation(false);
    onTripUpdate?.();
  }

  async function onCoverSelected(files) {
    const f = Array.from(files || [])[0];
    if (!f) return;
    const coverPhoto = trip?.id ? await createPhotoMediaFromFile(f, trip.id, { maxThumbSide: 320, maxFullSide: 1200 }) : null;
    setEventDraft((d) => ({ ...d, coverPhoto }));
  }

  async function onLocationCoverSelected(files) {
    const f = Array.from(files || [])[0];
    if (!f) return;
    const coverPhoto = trip?.id ? await createPhotoMediaFromFile(f, trip.id, { maxThumbSide: 320, maxFullSide: 1200 }) : null;
    setLocationDraft((d) => ({ ...d, coverPhoto }));
  }

  async function shareLocation() {
    if (!location) return;
    await shareEntity({
      title: `Location: ${location.name}`,
      text: `${location.name}\n${location.type}\n${location.lat?.toFixed(5)}, ${location.lng?.toFixed(5)}`,
    });
  }

  const markerEntries = [{
    id: location.id,
    lng: location.lng,
    lat: location.lat,
    type: location.type,
    title: location.name,
    col: '#2A5C8E',
    symbol: location.icon || '📍',
  }];

  return (
    <div style={{ height: '100%', background: T.bg, display: 'flex', flexDirection: 'column', fontFamily: F, overflow: 'hidden' }}>
      <div style={{ background: T.card, padding: '10px 16px 14px', borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div onClick={onBack} style={{ width: 36, height: 36, borderRadius: 18, background: T.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <Ic d="M19 12H5 M12 5l-7 7 7 7" size={18} color={T.text} sw={2} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: T.text, letterSpacing: -0.4, display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                <span>{location.icon || '📍'}</span>
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{location.name}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <div onClick={shareLocation} style={{ fontSize: 10.5, color: '#2A5C8E', fontWeight: 700, cursor: 'pointer' }}>Share</div>
                <div onClick={() => setEditingLocation((v) => !v)} style={{ fontSize: 10.5, color: '#2A5C8E', fontWeight: 700, cursor: 'pointer' }}>
                  {editingLocation ? 'Close Edit' : 'Edit'}
                </div>
              </div>
            </div>
            <div style={{ fontSize: 11, color: T.textSub }}>{location.type} · {events.length} events</div>
            {!!location.notes && <div style={{ fontSize: 10.5, color: T.textSub, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{location.notes}</div>}
            <div style={{ fontSize: 10.5, color: T.textFaint, marginTop: 2 }}>
              {location.lat?.toFixed(5)}, {location.lng?.toFixed(5)}
            </div>
            <div style={{ fontSize: 10.5, color: T.textFaint }}>{formatLocationTime(location)}</div>
          </div>
          <SyncChip state={location.syncState || 'pending'} compact />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
        {!!location.coverPhoto && (
          <div style={{ background: T.card, borderRadius: 12, border: `1px solid ${T.border}`, padding: 8, marginBottom: 12 }}>
            <MediaThumb media={location.coverPhoto} alt="Location cover" style={{ width: '100%', maxHeight: 280, objectFit: 'contain', borderRadius: 10, display: 'block', background: '#F0EDE8' }} />
          </div>
        )}

        {editingLocation && (
          <div style={{ background: T.card, borderRadius: 12, border: `1px solid ${T.border}`, padding: '10px 12px', marginBottom: 12 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: T.text, marginBottom: 8 }}>Edit Location</div>
            <>
              <input
                value={locationDraft.name}
                onChange={(e) => setLocationDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="Location name"
                style={{ width: '100%', border: `1.5px solid ${T.border}`, borderRadius: 10, padding: '8px 10px', fontSize: 12, fontFamily: F, marginBottom: 8, boxSizing: 'border-box', outline: 'none', background: T.bg }}
              />
              <div style={{ display: 'flex', gap: 6, marginBottom: 8, overflowX: 'auto' }}>
                {['campsite', 'river-feature', 'amazing-find', 'hiking-location', 'point-of-interest'].map((tp) => (
                  <div key={tp} onClick={() => setLocationDraft((d) => ({ ...d, type: tp }))}
                       style={{ flexShrink: 0, padding: '5px 10px', borderRadius: 14, cursor: 'pointer', fontSize: 10.5, fontWeight: 700,
                                background: locationDraft.type === tp ? '#2A5C8E' : T.bg,
                                color: locationDraft.type === tp ? 'white' : T.textSub,
                                border: locationDraft.type === tp ? 'none' : `1px solid ${T.border}` }}>
                    {tp}
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 7, marginBottom: 8, flexWrap: 'wrap' }}>
                {['📍', '⛺', '🌊', '✨', '🥾', '🦌', '📈', '⚠', '🍴', '🔥'].map((ic) => (
                  <div key={ic} onClick={() => setLocationDraft((d) => ({ ...d, icon: ic }))}
                       style={{ width: 34, height: 34, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 15,
                                border: `2px solid ${locationDraft.icon === ic ? '#2A5C8E' : T.border}`,
                                background: locationDraft.icon === ic ? '#E4EFF8' : T.bg }}>
                    {ic}
                  </div>
                ))}
              </div>
              <textarea
                value={locationDraft.notes}
                onChange={(e) => setLocationDraft((d) => ({ ...d, notes: e.target.value }))}
                placeholder="Location notes"
                rows={2}
                style={{ width: '100%', border: `1.5px solid ${T.border}`, borderRadius: 10, padding: '8px 10px', fontSize: 12, fontFamily: F, marginBottom: 8, boxSizing: 'border-box', outline: 'none', background: T.bg, resize: 'vertical' }}
              />
              <div style={{ fontSize: 10.5, color: T.textSub, marginBottom: 6, fontWeight: 700 }}>Location Cover Photo</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                <label style={{ background: '#E4EFF8', border: '1px solid #3A72A840', borderRadius: 10, padding: '8px 10px', fontSize: 11, fontWeight: 700, color: '#2A5C8E', cursor: 'pointer' }}>
                  Set Cover Photo
                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => onLocationCoverSelected(e.target.files)} />
                </label>
                {!!locationDraft.coverPhoto && (
                  <span onClick={() => setLocationDraft((d) => ({ ...d, coverPhoto: null }))} style={{ fontSize: 10.5, color: T.textFaint, cursor: 'pointer' }}>Remove</span>
                )}
              </div>
              {!!locationDraft.coverPhoto && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: `1px solid ${T.border}`, background: T.bg, borderRadius: 10, padding: '8px 9px', marginBottom: 8 }}>
                  {locationDraft.coverPhoto ? (
                    <MediaThumb media={locationDraft.coverPhoto} alt="Location cover preview" style={{ width: 42, height: 42, borderRadius: 8, objectFit: 'cover' }} />
                  ) : (
                    <div style={{ width: 42, height: 42, borderRadius: 8, background: T.card, border: `1px solid ${T.border}` }} />
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{locationDraft.coverPhoto.name}</div>
                    <div style={{ fontSize: 10, color: T.textFaint }}>{Math.round((locationDraft.coverPhoto.size || 0) / 1024)} KB</div>
                  </div>
                </div>
              )}
              <div style={{ fontSize: 10.5, color: T.textSub, marginBottom: 6, fontWeight: 700 }}>Location Time</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                {[{ id: 'current', label: 'Current' }, { id: 'custom', label: 'Custom' }, { id: 'range', label: 'Range' }].map((opt) => (
                  <div key={opt.id} onClick={() => setLocationDraft((d) => ({ ...d, timeMode: opt.id }))}
                       style={{ padding: '5px 10px', borderRadius: 14, cursor: 'pointer', fontSize: 10.5, fontWeight: 700,
                                background: locationDraft.timeMode === opt.id ? '#2A5C8E' : T.bg,
                                color: locationDraft.timeMode === opt.id ? 'white' : T.textSub,
                                border: locationDraft.timeMode === opt.id ? 'none' : `1px solid ${T.border}` }}>
                    {opt.label}
                  </div>
                ))}
              </div>
              {locationDraft.timeMode === 'custom' && (
                <input
                  type="datetime-local"
                  value={locationDraft.observedAt}
                  onChange={(e) => setLocationDraft((d) => ({ ...d, observedAt: e.target.value }))}
                  style={{ width: '100%', border: `1.5px solid ${T.border}`, borderRadius: 10, padding: '8px 10px', fontSize: 12, fontFamily: F, marginBottom: 8, boxSizing: 'border-box', outline: 'none', background: T.bg }}
                />
              )}
              {locationDraft.timeMode === 'range' && (
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <input
                    type="datetime-local"
                    value={locationDraft.observedStartAt}
                    onChange={(e) => setLocationDraft((d) => ({ ...d, observedStartAt: e.target.value }))}
                    style={{ flex: 1, border: `1.5px solid ${T.border}`, borderRadius: 10, padding: '8px 10px', fontSize: 12, fontFamily: F, boxSizing: 'border-box', outline: 'none', background: T.bg }}
                  />
                  <input
                    type="datetime-local"
                    value={locationDraft.observedEndAt}
                    onChange={(e) => setLocationDraft((d) => ({ ...d, observedEndAt: e.target.value }))}
                    style={{ flex: 1, border: `1.5px solid ${T.border}`, borderRadius: 10, padding: '8px 10px', fontSize: 12, fontFamily: F, boxSizing: 'border-box', outline: 'none', background: T.bg }}
                  />
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <div onClick={() => setEditingLocation(false)} style={{ flex: 1, height: 34, borderRadius: 9, border: `1px solid ${T.border}`, background: T.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 11, fontWeight: 700, color: T.textSub }}>
                  Cancel
                </div>
                <div onClick={saveLocationDetails} style={{ flex: 1, height: 34, borderRadius: 9, background: '#2A5C8E', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 11, fontWeight: 700, color: 'white' }}>
                  Save Location
                </div>
              </div>
            </>
          </div>
        )}

        <div style={{ background: T.card, borderRadius: 12, border: `1px solid ${T.border}`, padding: '10px 12px', marginBottom: 12 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: T.textSub, letterSpacing: 0.7, textTransform: 'uppercase', marginBottom: 8 }}>Location Map</div>
          <div style={{ borderRadius: 12, overflow: 'hidden', height: 220 }}>
            <TripMap
              style="outdoors-v12"
              entries={markerEntries}
              center={{ lng: location.lng, lat: location.lat }}
              selectedEntryId={location.id}
              showHoverPopup
              interactive
              zoom={12}
            />
          </div>
        </div>

        <div style={{ background: T.card, borderRadius: 12, border: `1px solid ${T.border}`, padding: '10px 12px', marginBottom: 12 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: T.textSub, letterSpacing: 0.7, textTransform: 'uppercase', marginBottom: 8 }}>Add Event At This Location</div>
          <div style={{ fontSize: 10.5, color: T.textSub, fontWeight: 700, marginBottom: 6 }}>Event Type</div>
          <select
            value={composerType || ''}
            onChange={(e) => {
              const nextType = e.target.value || null;
              if (!nextType) {
                closeComposer();
                return;
              }
              openQuickEntry(nextType);
            }}
            style={{ width: '100%', border: `1.5px solid ${T.border}`, borderRadius: 9, padding: '8px 9px', fontSize: 11.5, fontFamily: F, marginBottom: 8, boxSizing: 'border-box', outline: 'none', background: T.bg }}>
            <option value="">Select an event type</option>
            {captureItems.map((item) => (
              <option key={item.type} value={item.type}>{item.label}</option>
            ))}
          </select>

          {!!composerType && (
            <div style={{ marginTop: 10, border: `1px solid ${T.border}`, borderRadius: 10, background: T.bg, padding: '10px 10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: T.text }}>{editingEntry ? 'Edit Event' : 'Add Event'} · {composerType}</div>
                <div onClick={closeComposer} style={{ fontSize: 10.5, color: T.textFaint, cursor: 'pointer' }}>Close</div>
              </div>

              {!!targetEventId && (
                <div style={{ border: `1px solid ${T.border}`, borderRadius: 9, background: T.card, padding: '7px 8px', marginBottom: 8 }}>
                  <div style={{ fontSize: 10, color: T.textFaint, fontWeight: 700 }}>Adding To Event</div>
                  <div style={{ fontSize: 11.5, color: T.text, fontWeight: 700 }}>{eventsById.get(targetEventId)?.name || 'Selected event'}</div>
                </div>
              )}

              <input
                value={eventDraft.name}
                onChange={(e) => { setEventDraft((d) => ({ ...d, name: e.target.value })); if (e.target.value.trim()) setSaveError(null); }}
                placeholder="Event name (required)"
                style={{ width: '100%', border: `1.5px solid ${saveError ? '#C0392B' : T.border}`, borderRadius: 9, padding: '7px 9px', fontSize: 11.5, fontFamily: F, marginBottom: saveError ? 4 : 7, boxSizing: 'border-box', outline: 'none', background: T.card }}
              />
              {saveError && (
                <div style={{ fontSize: 11, color: '#C0392B', fontWeight: 600, marginBottom: 7, padding: '5px 9px', background: '#FFF0EE', borderRadius: 7, border: '1px solid #F5C6C0' }}>
                  {saveError}
                </div>
              )}
              <textarea
                value={eventDraft.notes}
                onChange={(e) => setEventDraft((d) => ({ ...d, notes: e.target.value }))}
                placeholder="Event details"
                rows={2}
                style={{ width: '100%', border: `1.5px solid ${T.border}`, borderRadius: 9, padding: '7px 9px', fontSize: 11.5, fontFamily: F, marginBottom: 7, boxSizing: 'border-box', outline: 'none', background: T.card, resize: 'vertical' }}
              />
              {!editingEntry && !targetEventId && (
                <>
                  <div style={{ fontSize: 10.5, color: T.textSub, fontWeight: 700, marginBottom: 6 }}>Tag Participant (Optional)</div>
                  <select
                    value={eventDraft.taggedParticipantId}
                    onChange={(e) => setEventDraft((d) => ({ ...d, taggedParticipantId: e.target.value }))}
                    style={{ width: '100%', border: `1.5px solid ${T.border}`, borderRadius: 9, padding: '8px 9px', fontSize: 11.5, fontFamily: F, marginBottom: 7, boxSizing: 'border-box', outline: 'none', background: T.card }}>
                    <option value="none">No specific person</option>
                    {participantOptions.map((p) => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 7 }}>
                    <div onClick={() => coverRef.current?.click()} style={{ background: '#E4EFF8', border: '1px solid #3A72A840', borderRadius: 9, padding: '7px 9px', fontSize: 10.5, fontWeight: 700, color: '#2A5C8E', cursor: 'pointer' }}>
                      Cover Photo
                    </div>
                    <input ref={coverRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => onCoverSelected(e.target.files)} />
                    {!!eventDraft.coverPhoto && <span style={{ fontSize: 10.5, color: T.textFaint }}>{eventDraft.coverPhoto.name}</span>}
                  </div>
                  {!!eventDraft.coverPhoto && (
                    <MediaThumb media={eventDraft.coverPhoto} alt="Event cover preview" style={{ width: 56, height: 56, borderRadius: 10, objectFit: 'cover', marginBottom: 7 }} />
                  )}
                </>
              )}

              <div style={{ fontSize: 10.5, color: T.textSub, fontWeight: 700, marginBottom: 6 }}>{mediaCaptureLabel('Photo / Video')}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
                <div onClick={() => photoCaptureRef.current?.click()} style={quickBtnStyle(T)}>Take Photo</div>
                <div onClick={() => photoUploadRef.current?.click()} style={quickBtnStyle(T)}>Upload Photo</div>
                <div onClick={() => VIDEO_ENABLED && videoCaptureRef.current?.click()} title={!VIDEO_ENABLED ? VIDEO_DISABLED_HINT : undefined} style={{ ...quickBtnStyle(T), ...disabledMediaStyle() }}>Take Video</div>
                <div onClick={() => VIDEO_ENABLED && videoUploadRef.current?.click()} title={!VIDEO_ENABLED ? VIDEO_DISABLED_HINT : undefined} style={{ ...quickBtnStyle(T), ...disabledMediaStyle() }}>Upload Video</div>
              </div>
              <input ref={photoCaptureRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => onPhotoSelected(e.target.files)} />
              <input ref={photoUploadRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => onPhotoSelected(e.target.files)} />
              <input ref={videoCaptureRef} type="file" accept="video/*" capture="environment" style={{ display: 'none' }} onChange={(e) => onVideoSelected(e.target.files)} />
              <input ref={videoUploadRef} type="file" accept="video/*" style={{ display: 'none' }} onChange={(e) => onVideoSelected(e.target.files)} />
              {!!composerDraft.photoFiles?.length && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                  {composerDraft.photoFiles.map((f, idx) => (
                    <div key={f.id || `${f.name}-${idx}`} style={{ position: 'relative' }}>
                      {f.id || f.thumbDataUrl ? (
                        <MediaThumb media={f} alt={f.name}
                             style={{ width: 64, height: 64, borderRadius: 8, objectFit: 'contain', background: '#F0EDE8', border: `1px solid ${T.border}`, display: 'block' }} />
                      ) : (
                        <div style={{ width: 64, height: 64, borderRadius: 8, background: T.card, border: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>📷</div>
                      )}
                      <div onClick={() => setComposerDraft((d) => ({ ...d, photoFiles: d.photoFiles.filter((_, i) => i !== idx) }))}
                           style={{ position: 'absolute', top: -5, right: -5, width: 18, height: 18, borderRadius: '50%', background: '#E04040', color: 'white', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>✕</div>
                    </div>
                  ))}
                </div>
              )}
              {!!composerDraft.videoFiles?.length && <div style={{ fontSize: 10.5, color: T.textFaint, marginBottom: 6 }}>{composerDraft.videoFiles.length} video(s) selected</div>}

              {composerType === 'gauge' && (
                <>
                  <div style={{ border: `1px solid ${T.border}`, borderRadius: 9, background: T.card, padding: '8px 9px', marginBottom: 8 }}>
                    <div style={{ fontSize: 10.5, color: T.textSub, fontWeight: 700, marginBottom: 4 }}>
                      {gaugeAuto.loading ? 'Finding nearby gauges...' : 'Nearby Gauges'}
                    </div>
                    <div style={{ fontSize: 11.5, color: T.text, fontWeight: 700, marginBottom: 2 }}>
                      {composerDraft.gaugeSiteName || 'Select from nearby gauges'}
                    </div>
                    <div style={{ fontSize: 10.5, color: T.textFaint }}>
                      {composerDraft.gaugeSiteId ? `USGS #${composerDraft.gaugeSiteId}` : 'Gauge ID pending'}
                      {composerDraft.cfs ? ` · ${composerDraft.cfs} cfs` : ''}
                    </div>
                    {!!gaugeAuto.error && <div style={{ fontSize: 10.5, color: T.amber, marginTop: 5 }}>{gaugeAuto.error}</div>}
                  </div>
                  {!!gaugeCandidates.length && (
                    <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 8 }}>
                      {gaugeCandidates.map((g) => (
                        <div key={g.id} onClick={() => { void chooseGaugeCandidate(g); }}
                             style={{ flexShrink: 0, padding: '6px 9px', borderRadius: 10, cursor: 'pointer',
                                      border: `1px solid ${composerDraft.gaugeSiteId === g.id ? '#2A5C8E' : T.border}`,
                                      background: composerDraft.gaugeSiteId === g.id ? '#EAF3FB' : T.card }}>
                          <div style={{ fontSize: 10.5, fontWeight: 700, color: T.text, maxWidth: 210, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.name || g.id}</div>
                          <div style={{ fontSize: 10, color: T.textFaint }}>
                            #{g.id}{Number.isFinite(g.distanceMiles) ? ` · ${g.distanceMiles.toFixed(1)} mi` : ''}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {composerType === 'weather' && (
                <>
                  <div style={{ border: `1px solid ${T.border}`, borderRadius: 9, background: T.card, padding: '8px 9px', marginBottom: 8 }}>
                    <div style={{ fontSize: 10.5, color: T.textSub, fontWeight: 700, marginBottom: 4 }}>
                      {weatherPreview.loading ? 'Fetching weather for event time...' : 'Weather Preview'}
                    </div>
                    {!!weatherPreview.data && (
                      <div style={{ fontSize: 11, color: T.text }}>
                        {weatherPreview.data.summary || 'Conditions'}
                        {weatherPreview.data.temperatureC != null ? ` · ${Math.round(cToF(weatherPreview.data.temperatureC))}°F` : ''}
                        {weatherPreview.data.windKph != null ? ` · Wind ${Math.round(weatherPreview.data.windKph)} kph` : ''}
                      </div>
                    )}
                    {!weatherPreview.loading && !weatherPreview.data && !weatherPreview.error && (
                      <div style={{ fontSize: 10.5, color: T.textFaint }}>No weather data yet.</div>
                    )}
                    {!!weatherPreview.error && <div style={{ fontSize: 10.5, color: T.amber }}>{weatherPreview.error}</div>}
                    {!!weatherPreview.requestedAt && (
                      <div style={{ fontSize: 10, color: T.textFaint, marginTop: 3 }}>
                        For: {new Date(weatherPreview.requestedAt).toLocaleString()}
                      </div>
                    )}
                  </div>
                  <input
                    value={composerDraft.weatherObservationSky}
                    onChange={(e) => setComposerDraft((d) => ({ ...d, weatherObservationSky: e.target.value }))}
                    placeholder="Personal observation: sky/conditions"
                    style={{ width: '100%', border: `1.5px solid ${T.border}`, borderRadius: 9, padding: '8px 9px', fontSize: 11.5, fontFamily: F, marginBottom: 8, boxSizing: 'border-box', outline: 'none', background: T.card }}
                  />
                  <input
                    value={composerDraft.weatherObservationWind}
                    onChange={(e) => setComposerDraft((d) => ({ ...d, weatherObservationWind: e.target.value }))}
                    placeholder="Personal observation: wind/temperature feel"
                    style={{ width: '100%', border: `1.5px solid ${T.border}`, borderRadius: 9, padding: '8px 9px', fontSize: 11.5, fontFamily: F, marginBottom: 8, boxSizing: 'border-box', outline: 'none', background: T.card }}
                  />
                  <input
                    value={composerDraft.weatherObservationWater}
                    onChange={(e) => setComposerDraft((d) => ({ ...d, weatherObservationWater: e.target.value }))}
                    placeholder="Personal observation: precipitation/water impact"
                    style={{ width: '100%', border: `1.5px solid ${T.border}`, borderRadius: 9, padding: '8px 9px', fontSize: 11.5, fontFamily: F, marginBottom: 8, boxSizing: 'border-box', outline: 'none', background: T.card }}
                  />
                </>
              )}

              <textarea
                value={composerDraft.caption}
                onChange={(e) => setComposerDraft((d) => ({ ...d, caption: e.target.value }))}
                placeholder="Caption"
                rows={2}
                style={{ width: '100%', border: `1.5px solid ${T.border}`, borderRadius: 9, padding: '8px 9px', fontSize: 11.5, fontFamily: F, marginBottom: 8, boxSizing: 'border-box', outline: 'none', background: T.card, resize: 'vertical' }}
              />

              <div style={{ fontSize: 10.5, color: T.textSub, marginBottom: 6, fontWeight: 700 }}>Time</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                {[{ id: 'now', label: 'Now' }, { id: 'custom', label: 'Custom' }].map((opt) => (
                  <div key={opt.id} onClick={() => setComposerDraft((d) => ({ ...d, timeMode: opt.id }))}
                       style={{ padding: '5px 10px', borderRadius: 14, cursor: 'pointer', fontSize: 10.5, fontWeight: 700,
                                background: composerDraft.timeMode === opt.id ? '#2A5C8E' : T.card,
                                color: composerDraft.timeMode === opt.id ? 'white' : T.textSub,
                                border: composerDraft.timeMode === opt.id ? 'none' : `1px solid ${T.border}` }}>
                    {opt.label}
                  </div>
                ))}
              </div>
              {composerDraft.timeMode === 'custom' && (
                <input
                  type="datetime-local"
                  value={composerDraft.observedAt}
                  onChange={(e) => setComposerDraft((d) => ({ ...d, observedAt: e.target.value }))}
                  style={{ width: '100%', border: `1.5px solid ${T.border}`, borderRadius: 9, padding: '8px 9px', fontSize: 11.5, fontFamily: F, marginBottom: 8, boxSizing: 'border-box', outline: 'none', background: T.card }}
                />
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                <div onClick={closeComposer} style={{ flex: 1, height: 32, borderRadius: 8, border: `1px solid ${T.border}`, background: T.card, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 10.5, fontWeight: 700, color: T.textSub }}>
                  Cancel
                </div>
                <div onClick={saveComposerEntry} style={{ flex: 1, height: 32, borderRadius: 8, background: '#2A5C8E', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 10.5, fontWeight: 700, color: 'white' }}>
                  {editingEntry ? 'Save Changes' : 'Save Event'}
                </div>
              </div>
            </div>
          )}

        </div>

        <div style={{ padding: '0 16px', marginBottom: 12 }}>
          <TripExpenses
            trip={trip}
            onTripUpdate={onTripUpdate}
            showTitle
            scope="location"
            location={location}
          />
        </div>

        {events.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Events at this Location</span>
              <span style={{ fontSize: 11.5, color: T.textSub }}>{events.length} {events.length === 1 ? 'event' : 'events'}</span>
            </div>
            {events.length > 1 && (
              <div onClick={() => openViewEvent(events[0].id)}
                   style={{ background: T.accent, borderRadius: 11, padding: '10px 14px', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'white' }}>View All Events In Order</div>
                  <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,.7)', marginTop: 2 }}>Start from the beginning · use Next to step through</div>
                </div>
                <Ic d="M9 18l6-6-6-6" size={18} color="white" sw={2.2} />
              </div>
            )}
            {events.map((ev, idx) => {
              const sym = EVENT_SYMBOLS[ev.type] || '📍';
              const entryCount = (trip?.entries || []).filter((e) => e.eventId === ev.id).length;
              return (
                <div key={ev.id} onClick={() => openViewEvent(ev.id)}
                     style={{ background: T.card, borderRadius: 11, border: `1px solid ${T.border}`, padding: '10px 12px', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                  {ev.coverPhoto ? (
                    <MediaThumb media={ev.coverPhoto} alt={ev.name}
                         style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: 44, height: 44, borderRadius: 10, background: (EVENT_COLORS[ev.type] || T.accent) + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 20 }}>
                      {sym}
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ev.name}</div>
                    <div style={{ fontSize: 10.5, color: T.textFaint, marginTop: 1 }}>
                      <span style={{ background: (EVENT_COLORS[ev.type] || T.accent) + '18', color: EVENT_COLORS[ev.type] || T.accent, borderRadius: 5, padding: '1px 6px', fontWeight: 700 }}>{ev.type}</span>
                      <span style={{ marginLeft: 6 }}>{entryCount} {entryCount === 1 ? 'entry' : 'entries'}</span>
                    </div>
                    {ev.notes && <div style={{ fontSize: 10.5, color: T.textSub, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ev.notes}</div>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                    <span style={{ fontSize: 10, color: T.textFaint }}>{idx + 1} of {events.length}</span>
                    <Ic d="M9 18l6-6-6-6" size={14} color={T.textFaint} sw={2} />
                  </div>
                </div>
              );
            })}
          </div>
        )}

      </div>

      <BottomNav active="trip" onNav={onNav} onFab={onFab} trip={trip} />
    </div>
  );
}

function toDatetimeLocal(date) {
  const pad = (n) => String(n).padStart(2, '0');
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());
  return `${y}-${m}-${d}T${h}:${min}`;
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


function formatLocationTime(location) {
  if (!location) return 'Time not set';
  if (location.timeMode === 'range' && location.observedStartAt && location.observedEndAt) {
    return `Time: ${new Date(location.observedStartAt).toLocaleString()} - ${new Date(location.observedEndAt).toLocaleString()}`;
  }
  if (location.observedAt) {
    return `Time: ${new Date(location.observedAt).toLocaleString()}`;
  }
  return 'Time: current';
}

function addHours(date, hours) {
  const d = new Date(date);
  d.setHours(d.getHours() + hours);
  return d;
}

function buildComposerDraft(type, entry) {
  const observedAt = entry?.observedAt ? toDatetimeLocal(new Date(entry.observedAt)) : toDatetimeLocal(new Date());
  return {
    title: entry?.title || '',
    notes: entry?.notes || '',
    caption: entry?.photoNotes || entry?.videoNotes || '',
    timeMode: entry?.observedAt ? 'custom' : 'now',
    observedAt,
    photoFiles: entry?.photoFiles || [],
    videoFiles: entry?.videoFiles || [],
    weatherObservationSky: entry?.weatherObservationSky || entry?.weatherObservation || '',
    weatherObservationWind: entry?.weatherObservationWind || '',
    weatherObservationWater: entry?.weatherObservationWater || '',
    gaugeSiteName: entry?.gaugeSiteName || '',
    gaugeSiteId: entry?.gaugeSiteId || '',
    cfs: entry?.cfs != null ? String(entry.cfs) : '',
    type,
  };
}

function buildEntryPayloadFromComposer(type, draft) {
  if (!type || !draft) return null;
  const observedAt = draft.timeMode === 'custom' && draft.observedAt
    ? new Date(draft.observedAt).toISOString()
    : new Date().toISOString();
  const base = {
    type,
    title: draft.title?.trim() || defaultEventName(type),
    notes: draft.notes || '',
    observedAt,
    photoFiles: draft.photoFiles || [],
    videoFiles: draft.videoFiles || [],
    photoNotes: draft.caption || '',
    videoNotes: draft.caption || '',
  };

  if (type === 'weather') {
    const weatherObservation = [draft.weatherObservationSky, draft.weatherObservationWind, draft.weatherObservationWater]
      .map((x) => (x || '').trim())
      .filter(Boolean)
      .join(' | ');
    return {
      ...base,
      weatherObservation,
      weatherObservationSky: draft.weatherObservationSky || '',
      weatherObservationWind: draft.weatherObservationWind || '',
      weatherObservationWater: draft.weatherObservationWater || '',
    };
  }
  if (type === 'gauge') {
    return {
      ...base,
      gaugeSiteName: draft.gaugeSiteName || '',
      gaugeSiteId: draft.gaugeSiteId || '',
      cfs: draft.cfs === '' ? undefined : Number(draft.cfs),
    };
  }
  return base;
}

function quickBtnStyle(T) {
  return {
    border: `1px solid ${T.border}`,
    background: T.card,
    borderRadius: 9,
    padding: '7px 8px',
    fontSize: 10.5,
    fontWeight: 700,
    color: T.textSub,
    textAlign: 'center',
    cursor: 'pointer',
  };
}

function calcMiles(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c * 0.621371;
}

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function cToF(c) {
  return (c * 9) / 5 + 32;
}
