import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CaptureActions } from '../components/CaptureActions';
import { AddExpenseSheet } from '../components/AddExpenseSheet';
import { ConditionsSheet } from '../components/ConditionsSheet';
import { LocationSaveForm } from '../components/LocationSaveForm';
import { TripMap } from '../components/TripMap';
import { EntryForm } from './EntryForm';
import { addEntry, addLocation, getCurrentUserId, isTripMember, isTripOpen } from '../lib/storage';
import { createPhotoMediaFromFile } from '../lib/media';
import { defaultLocationKind } from '../lib/locationTypes';
import { nearestLocation } from '../lib/tripTimeline';
import { T, F } from '../tokens';
import { ts } from '../lib/textScale';

export function QuickCapture({ trip, initialType = null, locationId = null, eventId = null, onCancel, onSaved }) {
  const [type, setType] = useState(initialType);
  const [error, setError] = useState(null);
  const [suggestedId, setSuggestedId] = useState(locationId);
  const [placeReady, setPlaceReady] = useState(() => Boolean(locationId || eventId) || typeof navigator === 'undefined' || !navigator.geolocation);
  const event = (trip?.events || []).find(e => e.id === eventId) || null;
  const location = (trip?.locations || []).find(l => l.id === (event?.locationId || suggestedId || locationId)) || null;

  useEffect(() => {
    if (locationId || eventId || typeof navigator === 'undefined' || !navigator.geolocation) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => { if (!cancelled) setPlaceReady(true); }, 4000);
    navigator.geolocation.getCurrentPosition((pos) => {
      if (cancelled) return;
      clearTimeout(timer);
      const nearest = nearestLocation(trip?.locations, pos.coords.latitude, pos.coords.longitude, 200);
      if (nearest) setSuggestedId(nearest.id);
      setPlaceReady(true);
    }, () => {
      if (cancelled) return;
      clearTimeout(timer);
      setPlaceReady(true);
    }, { enableHighAccuracy: true, timeout: 3500, maximumAge: 60000 });
    return () => { cancelled = true; clearTimeout(timer); };
  }, [locationId, eventId, trip?.locations]);
  const canCapture = isTripOpen(trip) && isTripMember(trip, getCurrentUserId());
  const fixedPlace = Boolean(locationId || eventId);

  function save(entry) {
    setError(null);
    try {
      if (!canCapture) throw new Error('Select an open trip you belong to before logging.');
      const saved = addEntry(trip.id, { ...entry, eventId: event?.id });
      if (!saved) throw new Error('This trip is no longer available. Your entry has not been saved.');
      onSaved('Entry saved on this phone.');
    } catch (e) {
      setError(e.message || 'Could not save. Please try again.');
    }
  }

  if (canCapture && type === 'location' && !fixedPlace) {
    return (
      <LogLocation
        trip={trip}
        onCancel={() => { if (initialType === 'location') onCancel(); else setType(null); }}
        onSaved={onSaved}
      />
    );
  }

  if (canCapture && type === 'conditions') {
    return <ConditionsSheet trip={trip} defaultLocationId={location?.id || null}
      onCancel={() => setType(null)} onSaved={onSaved} />;
  }

  if (canCapture && type && type !== 'expense' && !(fixedPlace && type === 'campsite')) {
    if (!placeReady) {
      return <div style={{ height: '100%', background: T.bg, fontFamily: F, padding: 20, color: T.textSub }}>Finding the nearest place…</div>;
    }
    const places = fixedPlace && location ? [location] : (trip.locations || []);
    return <EntryForm type={type} trip={trip} event={event} locations={places}
      defaultLocationId={location?.id || null} allowUnlinked={!fixedPlace} lockLocation={fixedPlace}
      saveError={error} onSave={save} onCancel={onCancel} />;
  }

  return <div style={{ height: '100%', overflowY: 'auto', background: T.bg, fontFamily: F, padding: 20 }}>
    <button type="button" onClick={onCancel} style={{ minHeight: 44, padding: '8px 12px', border: '1px solid ' + T.border,
      borderRadius: 10, background: T.card, color: T.text, fontSize: ts(14), cursor: 'pointer' }}>← Back</button>
    <h1 style={{ fontSize: ts(24), marginTop: 20, color: T.text }}>Add a moment</h1>
    <p style={{ fontSize: ts(16), color: T.textSub, lineHeight: 1.5, margin: '8px 0 20px' }}>
      {trip?.name || 'No trip selected'}{location ? ' · ' + location.name : ''}
    </p>
    {canCapture ? <>
      <CaptureActions trip={trip} hideLocation={fixedPlace} onCapture={setType} />
      <p style={{ fontSize: ts(14), color: T.textSub, lineHeight: 1.5, marginTop: 16 }}>
        {fixedPlace
          ? `This stays at ${location?.name || 'this place'}.`
          : 'Save now, organize later. A saved location is optional. Entries stay on this phone when you are offline.'}
      </p>
      {location && !event && <p style={{ fontSize: ts(14), color: T.accent, fontWeight: 700, marginTop: 12 }}>Adding to {location.name}</p>}
      {type === 'expense' && <AddExpenseSheet trip={trip} location={location} event={event}
        onClose={() => setType(null)} onSaved={() => onSaved('Expense saved on this phone. Find it in Plan → Expenses.')} />}
    </> : <p style={{ color: T.textSub }}>Choose an open trip you belong to before adding a moment.</p>}
  </div>;
}

function blankLocationDraft() {
  const kind = defaultLocationKind();
  const now = toDatetimeLocal(new Date());
  return {
    name: '',
    type: kind.id,
    icon: kind.icon,
    notes: '',
    timeMode: 'current',
    observedAt: now,
    observedStartAt: now,
    observedEndAt: toDatetimeLocal(addHours(new Date(), 1)),
    customLat: '',
    customLng: '',
  };
}

function LogLocation({ trip, onCancel, onSaved }) {
  const [draft, setDraft] = useState(blankLocationDraft);
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
    onSaved('Location saved on this phone.');
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
