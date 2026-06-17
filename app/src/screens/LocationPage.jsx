import { useMemo, useState } from 'react';
import { BottomNav } from '../components/BottomNav';
import { SyncChip } from '../components/SyncChip';
import { TripMap } from '../components/TripMap';
import { Ic } from '../components/Ic';
import { T, F } from '../tokens';
import { addEvent, getCurrentUserId, isTripMember, isTripOwner, removeLocation, updateLocation } from '../lib/storage';
import { getSignedInUserId } from '../lib/authUser';
import { savePlanningToCloud } from '../lib/planningSave';
import { createPhotoMediaFromFile } from '../lib/media';
import { MediaThumb } from '../components/MediaThumb';
import { shareEntity } from '../lib/share';
import { EventPage } from './EventPage';
import { TripExpenses } from '../components/TripExpenses';
import { LocationSaveForm } from '../components/LocationSaveForm';
import { EventTypePicker } from '../components/EventTypePicker';
import { EVENT_CAPTURE_TYPES, EVENT_COLORS, EVENT_SYMBOLS, defaultEventName } from '../lib/eventTypes';
import { locationTypeLabel } from '../lib/locationTypes';

export function LocationPage({ trip, location, onBack, onNav, onFab, onTripUpdate, initialEventId }) {
  const currentUserId = getCurrentUserId();
  const signedInUserId = getSignedInUserId();
  const isOwner = Boolean(trip && isTripOwner(trip, signedInUserId || currentUserId));
  const canEditEvents = isOwner;
  const canDeleteLocation = isOwner;
  const canEditLocation = Boolean(trip && isTripMember(trip, signedInUserId || currentUserId));
  const canAddToEvents = canEditLocation;
  const [editingLocation, setEditingLocation] = useState(false);
  const [newEventAddType, setNewEventAddType] = useState(null);
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
  const [viewEventId, setViewEventId] = useState(initialEventId || null);

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
        key={viewEventId}
        trip={trip}
        location={location}
        event={selectedEvent}
        eventIndex={eventIdx >= 0 ? eventIdx : null}
        eventCount={events.length}
        onBack={() => { setViewEventId(null); setNewEventAddType(null); }}
        onPrev={prevEvent ? () => setViewEventId(prevEvent.id) : null}
        onNext={nextEvent ? () => setViewEventId(nextEvent.id) : null}
        onNav={onNav}
        onFab={onFab}
        onTripUpdate={onTripUpdate}
        canEditEvent={canEditEvents}
        canAddToEvent={canAddToEvents}
        initialAddType={newEventAddType}
      />
    );
  }

  function startNewEvent(type) {
    if (!canAddToEvents || !trip || !location) return;
    const created = addEvent(trip.id, {
      locationId: location.id,
      type,
      name: defaultEventName(type),
    });
    if (!created) return;
    onTripUpdate?.();
    setNewEventAddType(type);
    setViewEventId(created.id);
  }

  function openViewEvent(eventId) {
    if (!eventId) return;
    setNewEventAddType(null);
    setViewEventId(eventId);
  }

  async function saveLocationDetails() {
    if (!trip || !location || !locationDraft.name.trim()) return;
    await savePlanningToCloud(trip.id, () => {
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
    });
    setEditingLocation(false);
    onTripUpdate?.();
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <div onClick={shareLocation} style={{ fontSize: 10.5, color: '#2A5C8E', fontWeight: 700, cursor: 'pointer' }}>Share</div>
                {canEditLocation && (
                <div onClick={() => setEditingLocation((v) => !v)} style={{ fontSize: 10.5, color: '#2A5C8E', fontWeight: 700, cursor: 'pointer' }}>
                  {editingLocation ? 'Close Edit' : 'Edit'}
                </div>
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
        {!!location.coverPhoto && (
          <div style={{ background: T.card, borderRadius: 12, border: `1px solid ${T.border}`, padding: 8, marginBottom: 12 }}>
            <MediaThumb media={location.coverPhoto} alt="Location cover" style={{ width: '100%', maxHeight: 280, objectFit: 'contain', borderRadius: 10, display: 'block', background: '#F0EDE8' }} />
          </div>
        )}

        {editingLocation && (
          <LocationSaveForm
            title="Edit location"
            showPinControls={false}
            draft={locationDraft}
            onDraftChange={setLocationDraft}
            locationSource="map"
            onLocationSourceChange={() => {}}
            locationPin={{ lat: location.lat, lng: location.lng }}
            coverPhoto={locationDraft.coverPhoto}
            onCoverPhotoChange={(files) => {
              if (!files) { setLocationDraft((d) => ({ ...d, coverPhoto: null })); return; }
              void onLocationCoverSelected(files);
            }}
            onCancel={() => setEditingLocation(false)}
            onSave={() => void saveLocationDetails()}
            saveLabel="Save changes"
          />
        )}

        {canDeleteLocation && editingLocation && (
          <button type="button" onClick={() => void handleDeleteLocation()} style={{ width: '100%', border: 'none', background: 'transparent', color: '#8A1414', fontSize: 11, fontWeight: 700, cursor: 'pointer', padding: '0 0 12px', fontFamily: F, textAlign: 'left' }}>
            Delete location and its events
          </button>
        )}

        {events.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Events here</span>
              <span style={{ fontSize: 11.5, color: T.textSub }}>{events.length}</span>
            </div>
            {events.length > 1 && (
              <div onClick={() => openViewEvent(events[0].id)}
                   style={{ background: T.accent, borderRadius: 11, padding: '10px 14px', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'white' }}>View all in order</div>
                  <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,.7)', marginTop: 2 }}>Step through with Next</div>
                </div>
                <Ic d="M9 18l6-6-6-6" size={18} color="white" sw={2.2} />
              </div>
            )}
            {events.map((ev, idx) => {
              const sym = EVENT_SYMBOLS[ev.type] || '📍';
              const typeLabel = EVENT_CAPTURE_TYPES.find((t) => t.type === ev.type)?.label || ev.type;
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
                      <span style={{ background: (EVENT_COLORS[ev.type] || T.accent) + '18', color: EVENT_COLORS[ev.type] || T.accent, borderRadius: 5, padding: '1px 6px', fontWeight: 700 }}>{typeLabel}</span>
                      <span style={{ marginLeft: 6 }}>{entryCount} {entryCount === 1 ? 'entry' : 'entries'}</span>
                    </div>
                    {ev.notes && <div style={{ fontSize: 10.5, color: T.textSub, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ev.notes}</div>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                    <span style={{ fontSize: 10, color: T.textFaint }}>{idx + 1}/{events.length}</span>
                    <Ic d="M9 18l6-6-6-6" size={14} color={T.textFaint} sw={2} />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {canAddToEvents && (
          <div style={{ background: T.card, borderRadius: 12, border: `1px solid ${T.border}`, padding: '12px 13px', marginBottom: 12 }}>
            {events.length === 0 && (
              <div style={{ fontSize: 11.5, color: T.textFaint, lineHeight: 1.45, marginBottom: 10, textAlign: 'center' }}>
                No events yet — pick a type below to log your first one.
              </div>
            )}
            <EventTypePicker compact onSelect={startNewEvent} />
          </div>
        )}

        <div style={{ background: T.card, borderRadius: 12, border: `1px solid ${T.border}`, padding: '10px 12px', marginBottom: 12 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: T.textSub, letterSpacing: 0.7, textTransform: 'uppercase', marginBottom: 8 }}>Map</div>
          <div style={{ borderRadius: 12, overflow: 'hidden', height: 180 }}>
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

        <div style={{ padding: '0 0 12px' }}>
          <TripExpenses
            trip={trip}
            onTripUpdate={onTripUpdate}
            showTitle
            scope="location"
            location={location}
          />
        </div>

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
