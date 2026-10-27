import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CaptureActions } from '../components/CaptureActions';
import { BottomNav } from '../components/BottomNav';
import { AddExpenseSheet } from '../components/AddExpenseSheet';
import { ConditionsSheet } from '../components/ConditionsSheet';
import { LocationSaveForm } from '../components/LocationSaveForm';
import { TripMap } from '../components/TripMap';
import { EntryForm } from './EntryForm';
import { addEntry, addLocation, getCurrentUserId, isTripMember, isTripOpen } from '../lib/storage';
import { createPhotoMediaFromFile } from '../lib/media';
import { defaultLocationKind } from '../lib/locationTypes';
import { T, F } from '../tokens';
import { ts } from '../lib/textScale';

export function QuickCapture({ trip, initialType = null, locationId = null, eventId = null, onCancel, onSaved, onNav }) {
  const [type, setType] = useState(initialType === 'event' ? null : initialType);
  const [addingEvent, setAddingEvent] = useState(Boolean(locationId || eventId || (initialType && initialType !== 'location')));
  const [error, setError] = useState(null);
  const event = (trip?.events || []).find(e => e.id === eventId) || null;
  const [selectedLocationId, setSelectedLocationId] = useState(event?.locationId || locationId || null);
  const location = (trip?.locations || []).find(l => l.id === (event?.locationId || selectedLocationId)) || null;
  const canCapture = isTripOpen(trip) && isTripMember(trip, getCurrentUserId());

  function save(entry) {
    setError(null);
    try {
      if (!canCapture) throw new Error('Select an open trip you belong to before logging.');
      if (!location) throw new Error('Add or choose a location before saving an entry.');
      const saved = addEntry(trip.id, { ...entry, locationId: location.id, eventId: event?.id, newVisit: !event });
      if (!saved) throw new Error('This trip is no longer available. Your entry has not been saved.');
      onSaved(`Entry saved at ${saved.locationName} on this phone.`, { locationId: saved.locationId });
    } catch (e) {
      setError(e.message || 'Could not save. Please try again.');
    }
  }

  if (canCapture && type === 'location') {
    return (
      <LogLocation
        trip={trip}
        onCancel={() => { if (initialType === 'location') onCancel(); else setType(null); }}
        onSaved={onSaved}
      />
    );
  }

  if (canCapture && location && type === 'conditions') {
    return <ConditionsSheet trip={trip} defaultLocationId={location.id} lockLocation
      onCancel={() => setType(null)} onSaved={notice => onSaved(notice, { locationId: location.id })} />;
  }

  if (canCapture && location && type && type !== 'expense' && type !== 'campsite') {
    return <EntryForm type={type} trip={trip} event={event} locations={[location]}
      defaultLocationId={location.id} lockLocation
      saveError={error} onSave={save} onCancel={() => setType(null)} />;
  }

  return <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: T.bg, fontFamily: F }}><div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 20 }}>
    <div className="screen-content-inner">
    <button type="button" onClick={onCancel} style={{ minHeight: 44, padding: '8px 12px', border: '1px solid ' + T.border,
      borderRadius: 10, background: T.card, color: T.text, fontSize: ts(14), cursor: 'pointer' }}>← Back</button>
    <h1 style={{ fontSize: ts(24), marginTop: 20, color: T.text }}>{!addingEvent ? 'Add' : location ? `Add event to ${location.name}` : 'Choose a location first'}</h1>
    <p style={{ fontSize: ts(16), color: T.textSub, lineHeight: 1.5, margin: '8px 0 20px' }}>
      {trip?.name || 'No trip selected'}{location ? ' · ' + location.name : ''}
    </p>
    {canCapture ? <>
      {!addingEvent ? <>
        <p className="dashboard-description" style={{ marginBottom: 20 }}>Build your trip with locations, then add what happened at each place.</p>
        <button className="dashboard-button primary" type="button" onClick={() => setType('location')} style={{ width: '100%', minHeight: 90, justifyContent: 'flex-start', textAlign: 'left', padding: 20, marginBottom: 14 }}>
          <span aria-hidden="true" style={{ fontSize: 28 }}>+</span><span><span style={{ display: 'block', fontSize: ts(18) }}>Add a location</span><span style={{ display: 'block', marginTop: 6, fontSize: ts(13), fontWeight: 500 }}>A campsite, stop, or point of interest</span></span>
        </button>
        <button className="dashboard-button secondary" type="button" onClick={() => setAddingEvent(true)} style={{ width: '100%', minHeight: 90, justifyContent: 'flex-start', textAlign: 'left', padding: 20 }}>
          <span aria-hidden="true" style={{ fontSize: 28 }}>+</span><span><span style={{ display: 'block', fontSize: ts(18) }}>Add an event to a location</span><span style={{ display: 'block', marginTop: 6, fontSize: ts(13), fontWeight: 500 }}>Photo, meal, sighting, conditions, or Custom</span></span>
        </button>
      </> : !location ? <>
        <p className="dashboard-description" style={{ marginBottom: 18 }}>Start with a campsite, stop, or other place. Then add its meals, sightings, photos, notes, and trip entries.</p>
        <button className="dashboard-button primary" type="button" onClick={() => setType('location')}>+ Add a location</button>
        {(trip.locations || []).length > 0 && <div style={{ marginTop: 24 }}><h2 style={{ fontSize: ts(17), marginBottom: 12 }}>Or open a saved location</h2>
          {trip.locations.map(place => <button key={place.id} type="button" onClick={() => setSelectedLocationId(place.id)}
            style={{ width: '100%', minHeight: 64, display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, padding: '14px 16px', background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, fontFamily: F, textAlign: 'left', color: T.text, cursor: 'pointer' }}>
            <span aria-hidden="true" style={{ fontSize: 24 }}>{place.icon || '📍'}</span><span style={{ flex: 1, fontSize: ts(15), fontWeight: 800 }}>{place.name}</span><span aria-hidden="true">→</span>
          </button>)}
        </div>}
      </> : <>
        <p style={{ fontSize: ts(14), color: T.accent, fontWeight: 700, marginBottom: 16 }}>Entries will be saved at {location.name}{event ? ` · ${event.name}` : ''}.</p>
        {!event && <button className="dashboard-text-button" type="button" onClick={() => setSelectedLocationId(null)}>Choose another location</button>}
        <CaptureActions trip={trip} onCapture={setType} />
        {type === 'expense' && <AddExpenseSheet trip={trip} location={location} event={event} lockLocation
          onClose={() => setType(null)} onSaved={() => onSaved(`Expense saved at ${location.name} on this phone.`, { locationId: location.id })} />}
      </>}
    </> : <p style={{ color: T.textSub }}>Choose an open trip you belong to before adding a moment.</p>}
    </div>
  </div><BottomNav active="capture" trip={trip} onNav={onNav} /></div>;
}

function blankLocationDraft(tripStatus = 'active') {
  const kind = defaultLocationKind();
  const now = toDatetimeLocal(new Date());
  return {
    name: '',
    type: kind.id,
    icon: kind.icon,
    notes: '',
    visitStatus: tripStatus === 'planning' ? 'planned' : 'visited',
    timeMode: 'current',
    observedAt: now,
    observedStartAt: now,
    observedEndAt: toDatetimeLocal(addHours(new Date(), 1)),
    customLat: '',
    customLng: '',
  };
}

function LogLocation({ trip, onCancel, onSaved }) {
  const [draft, setDraft] = useState(() => blankLocationDraft(trip?.status));
  const [source, setSource] = useState('map');
  const [pin, setPin] = useState(null);
  const [pos, setPos] = useState(null);
  const [posError, setPosError] = useState(null);
  const [cover, setCover] = useState(null);
  const [error, setError] = useState(null);
  const mapApiRef = useRef(null);
  const onMapReady = useCallback((api) => {
    mapApiRef.current = api;
    if (!api) return;
    setPin((current) => current || api.getCenter?.() || null);
  }, []);
  const onMapClick = useCallback((pos) => {
    setSource('map');
    setPin(pos);
    setError(null);
  }, []);
  const onPlaceTap = useCallback((entry) => {
    if (entry?.lng == null || entry?.lat == null) return;
    setSource('map');
    setPin({ lng: entry.lng, lat: entry.lat });
    setError(null);
  }, []);

  useEffect(() => {
    if (source !== 'current' || typeof navigator === 'undefined' || !navigator.geolocation) return undefined;
    navigator.geolocation.getCurrentPosition(
      (fix) => {
        setPos({ lat: fix.coords.latitude, lng: fix.coords.longitude });
        setPosError(null);
      },
      (err) => setPosError(err.message),
      { enableHighAccuracy: true, timeout: 8000 },
    );
    return undefined;
  }, [source]);

  async function onCover(files) {
    const file = files ? Array.from(files)[0] : null;
    if (!file) { setCover(null); return; }
    setCover(trip?.id ? await createPhotoMediaFromFile(file, trip.id, { maxThumbSide: 320, maxFullSide: 1200 }) : null);
  }

  function save() {
    if (!draft.name.trim()) {
      setError('Give this location a name.');
      return;
    }
    let resolved = null;
    if (source === 'custom') {
      const lat = parseFloat(draft.customLat);
      const lng = parseFloat(draft.customLng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        setError('Enter valid latitude and longitude.');
        return;
      }
      resolved = { lat, lng };
    } else if (source === 'current') {
      resolved = pos;
    } else {
      resolved = pin;
    }
    if (resolved?.lat == null || resolved?.lng == null) {
      setError(source === 'map'
        ? 'Tap the map to place this location.'
        : source === 'custom'
          ? 'Enter coordinates for this place.'
          : (posError || 'Current GPS location is not available yet.'));
      return;
    }
    const created = addLocation(trip.id, {
      name: draft.name.trim(),
      type: draft.type,
      icon: draft.icon,
      notes: draft.notes,
      visitStatus: draft.visitStatus,
      timeMode: draft.timeMode,
      observedAt: draft.timeMode === 'current'
        ? new Date().toISOString()
        : (draft.timeMode === 'custom' ? new Date(draft.observedAt).toISOString() : undefined),
      observedStartAt: draft.timeMode === 'range' ? new Date(draft.observedStartAt).toISOString() : undefined,
      observedEndAt: draft.timeMode === 'range' ? new Date(draft.observedEndAt).toISOString() : undefined,
      lat: resolved.lat,
      lng: resolved.lng,
      coverPhoto: cover,
    });
    if (!created) {
      setError('This trip is no longer available. The location was not saved.');
      return;
    }
    onSaved('Location saved. Add trip entries here.', { locationId: created.id });
  }

  const savedPlaces = useMemo(
    () => (trip?.locations || []).filter((loc) => loc.lat != null && loc.lng != null),
    [trip?.locations],
  );
  const mapEntries = useMemo(() => savedPlaces.map((loc) => ({
    id: loc.id,
    lng: loc.lng,
    lat: loc.lat,
    title: loc.name,
    symbol: loc.icon || '📍',
    col: '#3A72A8',
  })), [savedPlaces]);
  const mapCenter = savedPlaces[0] ? { lng: savedPlaces[0].lng, lat: savedPlaces[0].lat } : undefined;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: T.bg, fontFamily: F, overflow: 'hidden' }}>
      <div style={{ flexShrink: 0, padding: '16px 16px 0' }}>
        <button type="button" onClick={onCancel} style={{ minHeight: 44, padding: '8px 12px', border: '1px solid ' + T.border,
          borderRadius: 10, background: T.card, color: T.text, fontSize: ts(14), cursor: 'pointer' }}>← Back</button>
        <p style={{ fontSize: ts(14), color: T.textSub, lineHeight: 1.45, margin: '12px 0 8px' }}>
          Tap the map to drop the pin, then drag it to the exact spot.
        </p>
        <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', height: 240, border: '1px solid ' + T.border }}>
          <TripMap
            trip={trip}
            track={trip?.track || []}
            entries={mapEntries}
            center={mapCenter}
            zoom={13}
            interactive
            pin={source === 'map' && pin ? { ...pin, symbol: draft.icon || '📍' } : null}
            onPinChange={onMapClick}
            onMapClick={onMapClick}
            onEntrySelect={onPlaceTap}
            onReady={onMapReady}
          />
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
      <LocationSaveForm
        title="New location"
        draft={draft}
        onDraftChange={setDraft}
        locationSource={source}
        onLocationSourceChange={(id) => { setSource(id); setError(null); }}
        locationPin={pin}
        currentPos={pos}
        currentPosError={posError}
        coverPhoto={cover}
        onCoverPhotoChange={(files) => { void onCover(files); }}
        onSearchPick={({ lng, lat, bbox, setPin: dropPin }) => {
          if (dropPin) {
            setSource('map');
            setPin({ lat, lng });
          }
          mapApiRef.current?.flyTo({ lng, lat, bbox, zoom: dropPin ? 15 : undefined });
        }}
        error={error}
        existingLocations={trip?.locations || []}
        onUseExistingLocation={(existing) => {
          onSaved(`Using saved location ${existing.name}.`, { locationId: existing.id });
        }}
        onCancel={onCancel}
        onSave={save}
        saveLabel="Save location"
      />
      </div>
    </div>
  );
}

function toDatetimeLocal(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function addHours(date, hours) {
  const next = new Date(date);
  next.setHours(next.getHours() + hours);
  return next;
}
