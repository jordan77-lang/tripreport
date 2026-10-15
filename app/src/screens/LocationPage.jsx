import { useEffect, useMemo, useState } from 'react';
import { BottomNav } from '../components/BottomNav';
import { SyncChip } from '../components/SyncChip';
import { TripMap } from '../components/TripMap';
import { Ic } from '../components/Ic';
import { T, F } from '../tokens';
import { getCurrentUserId, isTripMember, isTripOwner, removeLocation, updateLocation } from '../lib/storage';
import { getSignedInUserId } from '../lib/authUser';
import { savePlanningToCloud } from '../lib/planningSave';
import { createPhotoMediaFromFile } from '../lib/media';
import { PhotoGallery } from '../components/PhotoGallery';
import { shareEntity } from '../lib/share';
import { LocationSaveForm } from '../components/LocationSaveForm';
import { collectTripPhotos } from '../lib/tripPhotos';
import { EVENT_CAPTURE_TYPES, EVENT_COLORS } from '../lib/eventTypes';
import { locationTypeLabel } from '../lib/locationTypes';
import { resolveUserDisplayName } from '../lib/tripParticipants';

export function LocationPage({ trip, location, onBack, onNav, onFab, onTripUpdate, onOpenEvent, initialEventId, initialEdit = false }) {
  const currentUserId = getCurrentUserId();
  const signedInUserId = getSignedInUserId();
  const userId = signedInUserId || currentUserId;
  const isOwner = Boolean(trip && isTripOwner(trip, userId));
  const isMember = Boolean(trip && isTripMember(trip, userId));
  // Members add locations and events; the owner can also delete the whole stop.
  const canDeleteLocation = isOwner;
  const canEditLocation = isMember;
  const canAddToEvents = isMember;
  const [editingLocation, setEditingLocation] = useState(Boolean(initialEdit));
  const [locationSaveError, setLocationSaveError] = useState(null);
  const [locationSource, setLocationSource] = useState('map');
  const [locationPin, setLocationPin] = useState(() => (
    location?.lat != null && location?.lng != null ? { lat: location.lat, lng: location.lng } : null
  ));
  const [currentPos, setCurrentPos] = useState(null);
  const [currentPosError, setCurrentPosError] = useState(null);
  const [viewingMedia, setViewingMedia] = useState(false);
  const [locationDraft, setLocationDraft] = useState(() => locationDraftFrom(location));
  // Chronological order for prev/next navigation
  const events = useMemo(() => {
    const list = (trip?.events || []).filter((e) => e.locationId === location?.id);
    return list.sort((a, b) => new Date(a.observedAt || a.createdAt || 0) - new Date(b.observedAt || b.createdAt || 0));
  }, [trip?.events, location?.id]);
  const placeCosts = useMemo(
    () => (trip?.expenses || []).filter((cost) => cost.locationId === location?.id),
    [trip?.expenses, location?.id],
  );

  // Arriving from an entry that belongs to an event — go straight to it.
  useEffect(() => {
    if (initialEventId) onOpenEvent?.(location?.id, initialEventId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEventId]);

  useEffect(() => {
    if (!editingLocation || locationSource !== 'current' || typeof navigator === 'undefined' || !navigator.geolocation) return undefined;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCurrentPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setCurrentPosError(null);
      },
      (err) => setCurrentPosError(err.message),
      { enableHighAccuracy: true, timeout: 8000 },
    );
    return undefined;
  }, [editingLocation, locationSource]);

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

  function openViewEvent(eventId) {
    if (!eventId) return;
    onOpenEvent?.(location.id, eventId);
  }

  function beginEditLocation() {
    setLocationDraft(locationDraftFrom(location));
    setLocationPin(location?.lat != null && location?.lng != null ? { lat: location.lat, lng: location.lng } : null);
    setLocationSource('map');
    setCurrentPos(null);
    setCurrentPosError(null);
    setLocationSaveError(null);
    setEditingLocation(true);
  }

  async function saveLocationDetails() {
    if (!trip || !location) return;
    if (!locationDraft.name.trim()) {
      setLocationSaveError('Give this place a name.');
      return;
    }
    let resolved = null;
    if (locationSource === 'current') {
      resolved = currentPos;
    } else if (locationSource === 'custom') {
      const lat = parseFloat(locationDraft.customLat);
      const lng = parseFloat(locationDraft.customLng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        setLocationSaveError('Enter valid latitude and longitude.');
        return;
      }
      resolved = { lat, lng };
    } else {
      resolved = locationPin;
    }
    if (resolved?.lat == null || resolved?.lng == null) {
      setLocationSaveError(
        locationSource === 'current'
          ? (currentPosError || 'Current GPS location is not available yet.')
          : 'Set a pin or coordinates for this place.',
      );
      return;
    }
    const keepSavedTime = locationDraft.timeMode === 'current' && location.timeMode === 'current' && location.observedAt;
    setLocationSaveError(null);
    try {
      await savePlanningToCloud(trip.id, () => {
        updateLocation(trip.id, location.id, {
          name: locationDraft.name.trim(),
          type: locationDraft.type,
          icon: locationDraft.icon,
          notes: locationDraft.notes,
          timeMode: locationDraft.timeMode,
          observedAt: locationDraft.timeMode === 'current'
            ? (keepSavedTime ? location.observedAt : new Date().toISOString())
            : (locationDraft.timeMode === 'custom' ? new Date(locationDraft.observedAt).toISOString() : undefined),
          observedStartAt: locationDraft.timeMode === 'range' ? new Date(locationDraft.observedStartAt).toISOString() : undefined,
          observedEndAt: locationDraft.timeMode === 'range' ? new Date(locationDraft.observedEndAt).toISOString() : undefined,
          coverPhoto: locationDraft.coverPhoto || null,
          lat: resolved.lat,
          lng: resolved.lng,
        });
      });
      setEditingLocation(false);
      onTripUpdate?.();
    } catch (e) {
      onTripUpdate?.();
      setLocationSaveError(e?.message || 'Saved on this phone. Cloud sync did not finish — use Sync now when you have service.');
    }
  }

  async function handleDeleteLocation() {
    if (!canDeleteLocation || !trip || !location) return;
    if (!window.confirm(`Delete "${location.name}" and all events here?`)) return;
    await savePlanningToCloud(trip.id, () => {
      removeLocation(trip.id, location.id);
    });
    onTripUpdate?.();
    onBack();
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
      text: `${location.name}\n${locationTypeLabel(location.type)}\n${location.lat?.toFixed(5)}, ${location.lng?.toFixed(5)}`,
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <button type="button" onClick={shareLocation} style={headerBtn(false)}>Share</button>
                {canEditLocation && (
                  <button
                    type="button"
                    onClick={() => {
                      if (editingLocation) {
                        setEditingLocation(false);
                        setLocationSaveError(null);
                      } else {
                        beginEditLocation();
                      }
                    }}
                    style={headerBtn(!editingLocation)}
                  >
                    {editingLocation ? 'Close' : 'Edit'}
                  </button>
                )}
              </div>
            </div>
            <div style={{ fontSize: 11, color: T.textSub }}>{locationTypeLabel(location.type)} · {events.length} events</div>
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
        {editingLocation && (
          <LocationSaveForm
            title="Edit location"
            showPinControls
            draft={locationDraft}
            onDraftChange={setLocationDraft}
            locationSource={locationSource}
            onLocationSourceChange={setLocationSource}
            locationPin={locationPin}
            currentPos={currentPos}
            currentPosError={currentPosError}
            nowHint={location.observedAt ? 'Keeps the time already saved. Choose Set time to change it.' : null}
            error={locationSaveError}
            coverPhoto={locationDraft.coverPhoto}
            onCoverPhotoChange={(files) => {
              if (!files) { setLocationDraft((d) => ({ ...d, coverPhoto: null })); return; }
              void onLocationCoverSelected(files);
            }}
            onCancel={() => { setEditingLocation(false); setLocationSaveError(null); }}
            onSave={() => void saveLocationDetails()}
            saveLabel="Save changes"
          />
        )}

        {canDeleteLocation && editingLocation && (
          <button type="button" onClick={() => void handleDeleteLocation()} style={{ width: '100%', border: 'none', background: 'transparent', color: '#8A1414', fontSize: 11, fontWeight: 700, cursor: 'pointer', padding: '0 0 12px', fontFamily: F, textAlign: 'left' }}>
            Delete location and its events
          </button>
        )}

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {canAddToEvents && (
            <button type="button" onClick={() => onNav?.('capture')} style={placeActionBtn(true)}>
              Add
            </button>
          )}
          <button type="button" onClick={() => setViewingMedia(true)} style={placeActionBtn(false)}>
            Photos & videos
          </button>
        </div>

        {viewingMedia && (
          <div style={{ marginBottom: 12 }}>
            <button type="button" onClick={() => setViewingMedia(false)}
              style={{ minHeight: 36, marginBottom: 8, border: 'none', background: 'transparent', color: T.accent, fontWeight: 800, fontSize: 13, cursor: 'pointer', fontFamily: F, padding: 0 }}>
              ← Hide photos
            </button>
            <PhotoGallery
              entity={{ photos: mediaAtLocation(trip, location.id) }}
              title="Photos & videos"
              canAdd={false}
              emptyHint="None yet. Use Add to put a photo or video here."
            />
          </div>
        )}

        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>At this place</span>
            <span style={{ fontSize: 11.5, color: T.textSub }}>{events.length} {events.length === 1 ? 'visit' : 'visits'}</span>
          </div>
          {events.length === 0 && (
            <div style={{ fontSize: 12, color: T.textFaint, lineHeight: 1.45, marginBottom: 10 }}>
              Nothing here yet. A put-in, hike, hotel, shop, or meeting all work the same way. Everyone on the trip can add to this stop.
            </div>
          )}
          {events.map((ev) => {
            const typeLabel = EVENT_CAPTURE_TYPES.find((t) => t.type === ev.type)?.label || ev.type;
            const moments = (trip?.entries || [])
              .filter((entry) => entry.eventId === ev.id)
              .sort((a, b) => new Date(a.observedAt || a.createdAt || 0) - new Date(b.observedAt || b.createdAt || 0));
            const who = resolveUserDisplayName(trip, ev.createdBy, currentUserId) || 'Crew member';
            return (
              <div key={ev.id} style={{ background: T.card, borderRadius: 12, border: `1px solid ${T.border}`, padding: '12px 13px', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <button type="button" onClick={() => openViewEvent(ev.id)}
                    style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', padding: 0, textAlign: 'left', cursor: 'pointer', fontFamily: F }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: T.text }}>{ev.name}</div>
                    <div style={{ fontSize: 12, color: EVENT_COLORS[ev.type] || T.accent, fontWeight: 700, marginTop: 2 }}>{typeLabel} · {who}</div>
                    <div style={{ fontSize: 12, color: T.textSub, marginTop: 2 }}>{formatEventWhen(ev)}</div>
                  </button>
                  {canEditLocation && (
                    <button
                      type="button"
                      onClick={() => onOpenEvent?.(location.id, ev.id, { edit: true })}
                      style={headerBtn(false)}
                    >
                      Edit
                    </button>
                  )}
                </div>
                {moments.map((entry) => (
                  <div key={entry.id} style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${T.border}` }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{entry.title || entry.type}</div>
                    <div style={{ fontSize: 12, color: '#2A5C8E', marginTop: 2 }}>
                      {resolveUserDisplayName(trip, entry.authorId, currentUserId) || 'Crew member'}
                    </div>
                    {entry.notes && <div style={{ fontSize: 13, color: T.textSub, marginTop: 2, lineHeight: 1.4 }}>{entry.notes}</div>}
                    {(entry.weatherSummary || entry.weatherTempC != null) && (
                      <div style={{ fontSize: 12, color: '#2A5C8E', marginTop: 2 }}>
                        {entry.weatherSummary || 'Weather'}{entry.weatherTempC != null ? ` · ${Math.round(entry.weatherTempC * 9 / 5 + 32)}°F` : ''}
                      </div>
                    )}
                    {entry.cfs != null && <div style={{ fontSize: 12, color: '#3A72A8', fontWeight: 700, marginTop: 2 }}>{entry.cfs} CFS{entry.gaugeSiteName ? ` · ${entry.gaugeSiteName}` : ''}</div>}
                    {(entry.weatherSyncPending || entry.gaugeSyncPending) && (
                      <div style={{ fontSize: 12, color: T.textFaint, marginTop: 2 }}>Reading will fill in when you have service</div>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
          {placeCosts.length > 0 && (
            <div style={{ fontSize: 12, color: T.textSub, marginTop: 4 }}>
              {placeCosts.length} {placeCosts.length === 1 ? 'cost' : 'costs'} tagged here · settle in Money
            </div>
          )}
        </div>

        <div style={{ background: T.card, borderRadius: 12, border: `1px solid ${T.border}`, padding: '10px 12px', marginBottom: 12 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: T.textSub, letterSpacing: 0.7, textTransform: 'uppercase', marginBottom: 8 }}>Map</div>
          <div style={{ borderRadius: 12, overflow: 'hidden', height: 180 }}>
            <TripMap
              style="outdoors-v12"
              entries={markerEntries}
              center={editingLocation && locationPin ? { lng: locationPin.lng, lat: locationPin.lat } : { lng: location.lng, lat: location.lat }}
              selectedEntryId={location.id}
              showHoverPopup
              interactive
              zoom={12}
              pin={editingLocation && locationSource === 'map' && locationPin ? { ...locationPin, symbol: locationDraft.icon || '📍' } : null}
              onPinChange={(pos) => setLocationPin(pos)}
              onMapClick={(pos) => {
                if (editingLocation && locationSource === 'map') setLocationPin(pos);
              }}
            />
          </div>
        </div>

      </div>

      <BottomNav active="trip" onNav={onNav} onFab={onFab} trip={trip} />
    </div>
  );
}

function locationDraftFrom(location) {
  return {
    name: location?.name || '',
    type: location?.type || 'interest',
    icon: location?.icon || '📍',
    notes: location?.notes || '',
    timeMode: location?.timeMode || 'current',
    observedAt: location?.observedAt ? toDatetimeLocal(new Date(location.observedAt)) : toDatetimeLocal(new Date()),
    observedStartAt: location?.observedStartAt ? toDatetimeLocal(new Date(location.observedStartAt)) : toDatetimeLocal(new Date()),
    observedEndAt: location?.observedEndAt ? toDatetimeLocal(new Date(location.observedEndAt)) : toDatetimeLocal(addHours(new Date(), 1)),
    coverPhoto: location?.coverPhoto || null,
    customLat: location?.lat != null ? String(location.lat) : '',
    customLng: location?.lng != null ? String(location.lng) : '',
  };
}

function mediaAtLocation(trip, locationId) {
  const photos = collectTripPhotos(trip, { scope: 'location', locationId }).map((item) => ({
    ...item.media,
    caption: item.media?.caption || item.caption || '',
  }));
  const seen = new Set(photos.map((item) => item.id).filter(Boolean));
  const videos = [];
  for (const entry of trip?.entries || []) {
    const event = (trip.events || []).find((ev) => ev.id === entry.eventId);
    if (entry.locationId !== locationId && event?.locationId !== locationId) continue;
    for (const file of entry.videoFiles || []) {
      if (!file || (file.id && seen.has(file.id))) continue;
      if (file.id) seen.add(file.id);
      videos.push(file);
    }
  }
  return [...photos, ...videos];
}

function placeActionBtn(filled) {
  return {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    border: filled ? 'none' : `1px solid ${T.border}`,
    background: filled ? T.accent : T.card,
    color: filled ? 'white' : T.text,
    fontWeight: 800,
    fontSize: 14,
    cursor: 'pointer',
    fontFamily: F,
  };
}

function formatEventWhen(event) {
  if (event?.timeMode === 'range' && event.observedStartAt) {
    const start = formatWhen(event.observedStartAt);
    const end = event.observedEndAt ? formatWhen(event.observedEndAt) : '';
    return end ? `${start} – ${end}` : start;
  }
  return formatWhen(event?.observedAt || event?.createdAt);
}

function formatWhen(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Time not set';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function headerBtn(filled) {
  return {
    minHeight: 36,
    padding: '0 12px',
    borderRadius: 9,
    border: filled ? 'none' : `1px solid ${T.border}`,
    background: filled ? '#2A5C8E' : T.bg,
    color: filled ? 'white' : '#2A5C8E',
    fontWeight: 800,
    fontSize: 13,
    cursor: 'pointer',
    fontFamily: F,
    flexShrink: 0,
  };
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
