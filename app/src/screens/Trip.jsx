import { useEffect, useMemo, useRef, useState } from 'react';
import { BottomNav } from '../components/BottomNav';
import { TripMap } from '../components/TripMap';
import { SyncChip } from '../components/SyncChip';
import { TripExpenses } from '../components/TripExpenses';
import { Ic } from '../components/Ic';
import { T, F, ICONS } from '../tokens';
import { addLocation, finalizeTrip, getCurrentUserId, getContacts, reopenTrip, saveContact, saveTrip, startGpsSession, startTrip, stopGpsSession } from '../lib/storage';
import { createCoverPhotoFromFile } from '../lib/media';
import { shareEntity } from '../lib/share';
import { exportGpx, exportHtmlReport } from '../lib/export';
import { exportTripUpdateFile, formatMergeSummary, mergeTripUpdate, readTripUpdateFile } from '../lib/offlineExchange';
import { LocationPage } from './LocationPage';

export function Trip({ trip, onNav, onFab, onTripUpdate }) {
  const currentUserId = getCurrentUserId();
  const participants = useMemo(() => buildParticipantOptions(trip, currentUserId), [trip, currentUserId]);
  const [typeFilter, setTypeFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('all');
  const [locationFilter, setLocationFilter] = useState('all');
  const [entryLocationId, setEntryLocationId] = useState('all');
  const [userFilter, setUserFilter] = useState('all');
  const [mediaFilter, setMediaFilter] = useState('all');
  const [showFilters, setShowFilters] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedLocationId, setSelectedLocationId] = useState(trip?.locations?.[0]?.id || null);
  const [addingLocation, setAddingLocation] = useState(false);
  const [locationDraft, setLocationDraft] = useState({
    name: '',
    type: 'campsite',
    icon: '⛺',
    notes: '',
    timeMode: 'current',
    observedAt: toDatetimeLocal(new Date()),
    observedStartAt: toDatetimeLocal(new Date()),
    observedEndAt: toDatetimeLocal(addHours(new Date(), 1)),
  });
  const [locationPin, setLocationPin] = useState(null);
  const [locationSource, setLocationSource] = useState('map');
  const [currentPos, setCurrentPos] = useState(null);
  const [currentPosError, setCurrentPosError] = useState(null);
  const [locationError, setLocationError] = useState(null);
  const [locationPageId, setLocationPageId] = useState(null);
  const [locationPageEventId, setLocationPageEventId] = useState(null);
  const [editingTrip, setEditingTrip] = useState(false);
  const [participantInput, setParticipantInput] = useState('');
  const [contacts, setContacts] = useState(() => getContacts());
  const [tripDraft, setTripDraft] = useState(() => buildTripDraft(trip));
  const [tripCoverBusy, setTripCoverBusy] = useState(false);
  const [locCoverPhoto, setLocCoverPhoto] = useState(null);
  const [exchangeStatus, setExchangeStatus] = useState(null);
  const importUpdateRef = useRef(null);
  const entries = useMemo(() => trip?.entries ?? [], [trip?.entries]);
  const locations = useMemo(() => trip?.locations ?? [], [trip?.locations]);
  const track = useMemo(() => trip?.track ?? [], [trip?.track]);
  const tripSyncState = trip?.syncState || (entries.some(e => e.syncState === 'pending') ? 'pending' : 'synced');
  const isPlanning = trip?.status === 'planning';
  const isActive = trip?.status === 'active';
  const isCompleted = trip?.status === 'completed';

  useEffect(() => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCurrentPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setCurrentPosError(null);
      },
      (err) => setCurrentPosError(err.message),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }, [addingLocation]);

  function startAddLocation() {
    setAddingLocation(true);
    setLocationError(null);
    setLocationSource('map');
    setLocationPin(track[track.length - 1] ? { lng: track[track.length - 1].lng, lat: track[track.length - 1].lat } : null);
  }

  function startAddLocationAt(pos) {
    setAddingLocation(true);
    setLocationError(null);
    setLocationSource('map');
    setLocationPin(pos);
  }

  function addParticipant(nameOverride) {
    const name = (nameOverride || participantInput).trim();
    if (!name || !trip) return;
    const existing = trip.collaborators || [];
    if (existing.some((c) => (c.handle || c.name || '').toLowerCase() === name.toLowerCase())) {
      setParticipantInput('');
      return;
    }
    saveTrip({ ...trip, collaborators: [...existing, { id: crypto.randomUUID(), handle: name, name, role: 'contributor' }], updatedAt: Date.now(), syncState: 'pending' });
    saveContact(name);
    setContacts(getContacts());
    setParticipantInput('');
    onTripUpdate?.();
  }

  function removeParticipant(id) {
    if (!trip) return;
    saveTrip({ ...trip, collaborators: (trip.collaborators || []).filter((c) => (c.id || c.handle) !== id), updatedAt: Date.now(), syncState: 'pending' });
    onTripUpdate?.();
  }

  function saveTripDetails() {
    if (!trip) return;
    const nextName = tripDraft.name.trim();
    if (!nextName) return;
    saveTrip({
      ...trip,
      name: nextName,
      location: tripDraft.location,
      startDate: tripDraft.startDate,
      endDate: tripDraft.endDate,
      privacy: tripDraft.privacy,
      gpsTrackingEnabled: tripDraft.gpsTrackingEnabled,
      gpsBackgroundTracking: tripDraft.gpsTrackingEnabled ? tripDraft.gpsBackgroundTracking : false,
      gpsIntervalMs: tripDraft.gpsIntervalMs,
      coverPhoto: tripDraft.coverPhoto || null,
      updatedAt: Date.now(),
      syncState: 'pending',
    });
    setEditingTrip(false);
    onTripUpdate?.();
  }

  async function onTripCoverSelected(files) {
    const file = Array.from(files || [])[0];
    if (!file) return;
    setTripCoverBusy(true);
    const nextCover = await createCoverPhotoFromFile(file);
    setTripDraft((d) => ({ ...d, coverPhoto: nextCover }));
    setTripCoverBusy(false);
  }

  function clearTripCover() {
    setTripDraft((d) => ({ ...d, coverPhoto: null }));
  }

  function handleFinalizeTrip() {
    if (!trip?.id) return;
    finalizeTrip(trip.id);
    onTripUpdate?.();
  }

  function handleReopenTrip() {
    if (!trip?.id) return;
    reopenTrip(trip.id);
    onTripUpdate?.();
  }

  function handleStartTrip() {
    if (!trip?.id) return;
    startTrip(trip.id);
    onTripUpdate?.();
  }

  async function shareTrip() {
    if (!trip) return;
    await shareEntity({
      title: `Trip: ${trip.name}`,
      text: `${trip.name}\n${trip.location || 'Unknown location'}\n${(trip.types || []).join(', ')}`,
    });
  }

  async function exportOfflineUpdate() {
    if (!trip) return;
    const result = await exportTripUpdateFile(trip, currentUserId);
    const message = result.delivery === 'shared'
      ? 'Offline update ready to share. Choose AirDrop, Nearby Share, Files, or another app.'
      : result.delivery === 'cancelled'
        ? 'Offline update share was cancelled.'
        : 'Offline update downloaded. Share the file with nearby participants.';
    setExchangeStatus({
      kind: result.delivery === 'cancelled' ? 'error' : 'success',
      message,
    });
  }

  async function importOfflineUpdate(files) {
    const file = Array.from(files || [])[0];
    if (!file || !trip) return;

    try {
      const update = await readTripUpdateFile(file);
      const result = mergeTripUpdate(trip, update);
      saveTrip(result.trip);
      onTripUpdate?.();
      setExchangeStatus({
        kind: 'success',
        message: formatMergeSummary(result.summary),
      });
    } catch (e) {
      setExchangeStatus({
        kind: 'error',
        message: e?.message || 'Could not import that update file.',
      });
    } finally {
      if (importUpdateRef.current) importUpdateRef.current.value = '';
    }
  }

  function handleStartTrackingSession() {
    if (!trip?.id) return;
    startGpsSession(trip.id);
    onTripUpdate?.();
  }

  function handleStopTrackingSession(attachLocationId = null) {
    if (!trip?.id) return;
    stopGpsSession(trip.id, { attachLocationId });
    onTripUpdate?.();
  }

  async function onLocationCoverSelected(files) {
    const file = Array.from(files || [])[0];
    if (!file) return;
    const nextCover = await createCoverPhotoFromFile(file);
    setLocCoverPhoto(nextCover);
  }

  function saveLocation() {
    if (!trip) return;
    if (!locationDraft.name.trim()) {
      setLocationError('Give this location a name.');
      return;
    }
    const resolved = locationSource === 'current' ? currentPos : locationPin;
    if (!resolved?.lat || !resolved?.lng) {
      setLocationError(locationSource === 'current' ? 'Current GPS location is not available yet.' : 'Place a pin for this location on the map.');
      return;
    }
    const created = addLocation(trip.id, {
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
      lat: resolved.lat,
      lng: resolved.lng,
      coverPhoto: locCoverPhoto,
    });
    if (created?.id) {
      if (trip?.gpsSessionActive && trip?.gpsSessionId) {
        const shouldAttachAndEnd = window.confirm('Tracking session is active. End this session and attach it to this new location?');
        if (shouldAttachAndEnd) {
          handleStopTrackingSession(created.id);
        }
      }
      setSelectedLocationId(created.id);
      setAddingLocation(false);
      setLocationDraft({
        name: '',
        type: 'campsite',
        icon: '⛺',
        notes: '',
        timeMode: 'current',
        observedAt: toDatetimeLocal(new Date()),
        observedStartAt: toDatetimeLocal(new Date()),
        observedEndAt: toDatetimeLocal(addHours(new Date(), 1)),
      });
      setLocationPin(null);
      setLocCoverPhoto(null);
      setLocationError(null);
      onTripUpdate?.();
    }
  }

  const filteredEntries = useMemo(() => {
    const now = new Date().getTime();
    return entries.filter((e) => {
      if (typeFilter !== 'all' && e.type !== typeFilter) return false;
      if (locationFilter === 'linked' && !e.locationId) return false;
      if (locationFilter === 'unlinked' && e.locationId) return false;
      if (entryLocationId !== 'all' && e.locationId !== entryLocationId) return false;
      if (userFilter !== 'all' && e.authorId !== userFilter) return false;
      if (mediaFilter === 'with-media' && !entryHasMedia(e)) return false;
      if (mediaFilter === 'no-media' && entryHasMedia(e)) return false;

      const ts = e.observedAt ? new Date(e.observedAt).getTime() : (e.createdAt || 0);
      if (dateFilter === 'today') {
        const d = new Date(ts);
        const n = new Date(now);
        if (d.toDateString() !== n.toDateString()) return false;
      }
      if (dateFilter === '7d' && ts < now - 7 * 864e5) return false;
      if (dateFilter === '30d' && ts < now - 30 * 864e5) return false;

      if (search.trim()) {
        const q = search.toLowerCase();
        const locName = locationNameForEntry(e, locations);
        const hay = `${e.title || ''} ${e.type || ''} ${e.notes || ''} ${e.featureType || ''} ${locName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [entries, locations, typeFilter, dateFilter, locationFilter, entryLocationId, userFilter, mediaFilter, search]);

  const orderedLocations = useMemo(() => {
    return [...locations].sort((a, b) => locationSortTs(a) - locationSortTs(b));
  }, [locations]);

  const locationOptions = useMemo(() => orderedLocations.map((l) => l.id), [orderedLocations]);

  const locationEntryCount = useMemo(() => {
    const counts = new Map();
    for (const e of entries) {
      if (!e.locationId) continue;
      counts.set(e.locationId, (counts.get(e.locationId) || 0) + 1);
    }
    return counts;
  }, [entries]);

  const locationEventCount = useMemo(() => {
    const counts = new Map();
    for (const ev of trip?.events || []) {
      if (!ev.locationId) continue;
      counts.set(ev.locationId, (counts.get(ev.locationId) || 0) + 1);
    }
    return counts;
  }, [trip?.events]);

  const typeOptions = useMemo(() => {
    const set = new Set(entries.map(e => e.type).filter(Boolean));
    return ['all', ...Array.from(set)];
  }, [entries]);

  const userOptions = useMemo(() => {
    const set = new Set(entries.map(e => e.authorId).filter(Boolean));
    return ['all', ...Array.from(set)];
  }, [entries]);

  const mapEntries = locations
    .filter((l) => l.lat && l.lng)
    .map((l) => ({
      id: l.id,
      lng: l.lng,
      lat: l.lat,
      type: l.type,
      title: l.name,
      col: selectedLocationId === l.id ? '#2A5C8E' : '#3A72A8',
      symbol: l.icon || locationSymbol(l.type),
    }));

  const activeSession = trip?.gpsSessionId
    ? ((trip.trackSessions || []).find((s) => s.id === trip.gpsSessionId) || null)
    : null;

  const activeSessionPointCount = trip?.gpsSessionId
    ? track.filter((p) => p.sessionId === trip.gpsSessionId).length
    : 0;

  if (addingLocation && locationSource === 'map' && locationPin?.lat && locationPin?.lng) {
    mapEntries.push({
      id: '__draft_location__',
      lng: locationPin.lng,
      lat: locationPin.lat,
      type: 'draft',
      title: `Draft: ${locationDraft.name || 'New Location'}`,
      col: '#B8702E',
      symbol: locationDraft.icon || '📍',
    });
  }

  if (addingLocation && locationSource === 'current' && currentPos?.lat && currentPos?.lng) {
    mapEntries.push({
      id: '__draft_location__',
      lng: currentPos.lng,
      lat: currentPos.lat,
      type: 'draft',
      title: `Draft: ${locationDraft.name || 'New Location'}`,
      col: '#B8702E',
      symbol: locationDraft.icon || '📍',
    });
  }

  const selectedLocation = locations.find((l) => l.id === selectedLocationId) || null;
  const draftCenter = addingLocation
    ? (locationSource === 'current'
      ? (currentPos ? { lng: currentPos.lng, lat: currentPos.lat } : null)
      : (locationPin ? { lng: locationPin.lng, lat: locationPin.lat } : null))
    : null;

  const mapCenter = draftCenter || (selectedLocation
    ? { lng: selectedLocation.lng, lat: selectedLocation.lat }
    : (mapEntries[0] ? { lng: mapEntries[0].lng, lat: mapEntries[0].lat } : undefined));

  if (locationPageId) {
    const pageLocation = locations.find((l) => l.id === locationPageId) || null;
    return (
      <LocationPage
        trip={trip}
        location={pageLocation}
        onBack={() => { setLocationPageId(null); setLocationPageEventId(null); }}
        onNav={onNav}
        onFab={onFab}
        onTripUpdate={onTripUpdate}
        initialEventId={locationPageEventId}
      />
    );
  }

  if (!trip) {
    return (
      <div style={{ height: '100%', background: T.bg, display: 'flex', flexDirection: 'column', fontFamily: F }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.textFaint }}>
          No active trip
        </div>
        <BottomNav active="home" onNav={onNav} onFab={onFab} trip={trip} />
      </div>
    );
  }

  return (
    <div style={{ height: '100%', background: T.bg, display: 'flex', flexDirection: 'column', fontFamily: F, overflow: 'hidden' }}>
      <div style={{ background: T.card, padding: '12px 16px 14px', borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: T.text, letterSpacing: -.4 }}>{trip.name}</div>
            <div style={{ fontSize: 11, color: T.textSub }}>{entries.length} entries · {track.length} GPS pts</div>
            <div style={{ marginTop: 4, fontSize: 10.5, color: isCompleted ? '#2E6D3A' : isPlanning ? '#2A5C8E' : '#2A5C8E', fontWeight: 700 }}>
              {isCompleted ? 'Finalized trip (still editable)' : isPlanning ? `Planning · starts ${formatTripDate(trip.startDate)}` : 'Active trip'}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
            <div onClick={shareTrip}
                 style={{ background: '#EAF3FB', border: '1px solid #C7DDEF', borderRadius: 9, padding: '6px 10px', fontSize: 10.5, fontWeight: 700, color: '#2A5C8E', cursor: 'pointer' }}>
              Share
            </div>
            <div onClick={() => exportGpx(trip)}
                 style={{ background: '#EAF3FB', border: '1px solid #C7DDEF', borderRadius: 9, padding: '6px 10px', fontSize: 10.5, fontWeight: 700, color: '#2A5C8E', cursor: 'pointer' }}>
              GPX
            </div>
            <div onClick={() => exportHtmlReport(trip)}
                 style={{ background: '#EAF3FB', border: '1px solid #C7DDEF', borderRadius: 9, padding: '6px 10px', fontSize: 10.5, fontWeight: 700, color: '#2A5C8E', cursor: 'pointer' }}>
              Report
            </div>
            <div onClick={exportOfflineUpdate}
                 style={{ background: T.accentLight, border: `1px solid ${T.accent}40`, borderRadius: 9, padding: '6px 10px', fontSize: 10.5, fontWeight: 700, color: T.accent, cursor: 'pointer' }}>
              Export Update
            </div>
            <div onClick={() => importUpdateRef.current?.click()}
                 style={{ background: T.accentLight, border: `1px solid ${T.accent}40`, borderRadius: 9, padding: '6px 10px', fontSize: 10.5, fontWeight: 700, color: T.accent, cursor: 'pointer' }}>
              Import Update
            </div>
            <div onClick={isCompleted ? handleReopenTrip : isActive ? handleFinalizeTrip : undefined}
                 style={{ background: isCompleted ? '#E5F4E8' : isActive ? '#FFF1E4' : '#E4EFF8', border: `1px solid ${isCompleted ? '#A4CFAD' : isActive ? '#E4C5A8' : '#C7DDEF'}`, borderRadius: 9, padding: '6px 10px', fontSize: 10.5, fontWeight: 700, color: isCompleted ? '#2E6D3A' : isActive ? '#8A5526' : '#2A5C8E', cursor: isPlanning ? 'default' : 'pointer', opacity: isPlanning ? 0.55 : 1 }}>
              {isCompleted ? 'Reopen Trip' : isActive ? 'Finish Trip' : 'Planning'}
            </div>
            {isPlanning && (
              <div onClick={handleStartTrip}
                   style={{ background: T.accent, borderRadius: 9, padding: '6px 10px', fontSize: 10.5, fontWeight: 800, color: 'white', cursor: 'pointer' }}>
                Start Trip
              </div>
            )}
            <div onClick={() => {
              if (editingTrip) {
                setEditingTrip(false);
                return;
              }
              setTripDraft(buildTripDraft(trip));
              setEditingTrip(true);
            }}
                 style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 9, padding: '6px 10px', fontSize: 10.5, fontWeight: 700, color: T.textSub, cursor: 'pointer' }}>
              {editingTrip ? 'Close Edit' : 'Edit Trip'}
            </div>
            <SyncChip state={tripSyncState} compact />
          </div>
        </div>
        <input
          ref={importUpdateRef}
          type="file"
          accept=".json,.tripreport-update.json,application/json"
          style={{ display: 'none' }}
          onChange={(e) => void importOfflineUpdate(e.target.files)}
        />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
        {!!exchangeStatus && (
          <div style={{
            background: exchangeStatus.kind === 'error' ? '#FBE4E4' : T.accentLight,
            border: `1px solid ${exchangeStatus.kind === 'error' ? '#E7B5B5' : `${T.accent}40`}`,
            borderRadius: 12,
            padding: '10px 12px',
            marginBottom: 12,
            fontSize: 11.5,
            fontWeight: 700,
            color: exchangeStatus.kind === 'error' ? '#8A1414' : T.accent,
          }}>
            {exchangeStatus.message}
          </div>
        )}
        {isPlanning && (
          <div style={{ background: '#E4EFF8', border: '1px solid #C7DDEF', borderRadius: 12, padding: '12px 14px', marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#2A5C8E', marginBottom: 4 }}>Trip is in planning mode</div>
            <div style={{ fontSize: 11, color: T.textSub, marginBottom: 10 }}>
              Coordinate gear, meals, and expenses now. Start the trip when you leave to unlock map tracking and field journal capture.
            </div>
            <div onClick={handleStartTrip}
                 style={{ background: T.accent, borderRadius: 10, padding: '11px 14px', textAlign: 'center', cursor: 'pointer', boxShadow: `0 4px 14px ${T.accent}40` }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: 'white' }}>Start Trip Now</span>
            </div>
          </div>
        )}
        <div onClick={() => onNav('plan')}
             style={{ background: T.accent, borderRadius: 12, padding: '12px 14px', marginBottom: 8,
                      display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
                      boxShadow: `0 4px 16px ${T.accent}35` }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,.2)',
                         display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Ic d={ICONS.users} size={18} color="white" sw={1.9} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'white' }}>Plan This Trip</div>
            <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,.7)' }}>Gear, meals, shopping & shared expenses</div>
          </div>
          <Ic d={ICONS.chevR} size={16} color="white" sw={2.2} />
        </div>

        {isActive && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
          <div onClick={() => onNav('map')}
               style={{ background: T.card, borderRadius: 12, padding: '11px 12px', border: `1px solid ${T.border}`,
                        display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: '#E4EFF8',
                           display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Ic d={ICONS.map} d2={ICONS.map2} size={17} color="#2A5C8E" sw={1.9} />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: T.text }}>Live Map</div>
              <div style={{ fontSize: 10, color: T.textFaint }}>GPS track & navigation</div>
            </div>
          </div>
          <div onClick={() => onNav('log')}
               style={{ background: T.card, borderRadius: 12, padding: '11px 12px', border: `1px solid ${T.border}`,
                        display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: T.accentLight,
                           display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Ic d={ICONS.journal} d2={ICONS.journal2} size={17} color={T.accent} sw={1.9} />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: T.text }}>Field Journal</div>
              <div style={{ fontSize: 10, color: T.textFaint }}>Quick capture & entries</div>
            </div>
          </div>
        </div>
        )}

        {isPlanning && (
          <div style={{ background: T.card, borderRadius: 12, padding: '11px 12px', marginBottom: 12, border: `1px dashed ${T.border}` }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: T.textSub, marginBottom: 4 }}>Field tools locked until start</div>
            <div style={{ fontSize: 10.5, color: T.textFaint }}>Live Map and Field Journal unlock when you start this trip.</div>
          </div>
        )}

        <div style={{ background: T.card, borderRadius: 12, border: `1px solid ${T.border}`, padding: '12px 14px', marginBottom: 12 }}>
          <TripExpenses trip={trip} onTripUpdate={onTripUpdate} showTitle scope="all" />
        </div>

        {trip?.coverPhoto?.thumbDataUrl && (
          <div style={{ background: T.card, borderRadius: 12, border: `1px solid ${T.border}`, padding: 8, marginBottom: 12 }}>
            <img src={trip.coverPhoto.thumbDataUrl} alt="Trip cover" style={{ width: '100%', maxHeight: 280, objectFit: 'contain', borderRadius: 10, display: 'block', background: '#F0EDE8' }} />
          </div>
        )}

        {isCompleted && <TripSummaryCard trip={trip} entries={entries} locations={locations} track={track} />}

        {isActive && (
        <div style={{ background: trip.gpsSessionActive ? '#EAF3FB' : T.card, borderRadius: 12, border: `1px solid ${trip.gpsSessionActive ? '#BFD9EF' : T.border}`, padding: '10px 12px', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: T.text }}>
                {trip.gpsSessionActive ? 'Tracking Session Active' : 'Tracking Session Inactive'}
              </div>
              <div style={{ fontSize: 10.5, color: T.textFaint }}>
                {trip.gpsSessionActive
                  ? `${activeSessionPointCount} points · started ${new Date(activeSession?.startedAt || trip.gpsSessionStartedAt || 0).toLocaleTimeString()}`
                  : 'Start when leaving a location, then stop at destination to capture a clean path.'}
              </div>
            </div>
            {trip.gpsSessionActive ? (
              <div onClick={() => handleStopTrackingSession(null)}
                   style={{ background: '#FFEDE6', border: '1px solid #F2C8B4', borderRadius: 9, padding: '7px 10px', fontSize: 10.5, fontWeight: 700, color: '#8A5526', cursor: 'pointer', flexShrink: 0 }}>
                Stop Tracking
              </div>
            ) : (
              <div onClick={handleStartTrackingSession}
                   style={{ background: '#E5F4E8', border: '1px solid #A4CFAD', borderRadius: 9, padding: '7px 10px', fontSize: 10.5, fontWeight: 700, color: '#2E6D3A', cursor: 'pointer', flexShrink: 0 }}>
                Start Tracking
              </div>
            )}
          </div>
        </div>
        )}

        {editingTrip && (
          <div style={{ background: T.card, borderRadius: 12, border: `1px solid ${T.border}`, padding: '11px 12px', marginBottom: 12 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: T.text, marginBottom: 8 }}>Edit Trip Details</div>
            <input
              value={tripDraft.name}
              onChange={(e) => setTripDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="Trip name"
              style={{ width: '100%', border: `1.5px solid ${T.border}`, borderRadius: 10, padding: '8px 10px', fontSize: 12, fontFamily: F, marginBottom: 8, boxSizing: 'border-box', outline: 'none', background: T.bg }}
            />
            <input
              value={tripDraft.location}
              onChange={(e) => setTripDraft((d) => ({ ...d, location: e.target.value }))}
              placeholder="Region / area"
              style={{ width: '100%', border: `1.5px solid ${T.border}`, borderRadius: 10, padding: '8px 10px', fontSize: 12, fontFamily: F, marginBottom: 8, boxSizing: 'border-box', outline: 'none', background: T.bg }}
            />
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input
                type="date"
                value={tripDraft.startDate || ''}
                onChange={(e) => setTripDraft((d) => ({ ...d, startDate: e.target.value }))}
                style={{ flex: 1, border: `1.5px solid ${T.border}`, borderRadius: 10, padding: '8px 10px', fontSize: 12, fontFamily: F, boxSizing: 'border-box', outline: 'none', background: T.bg }}
              />
              <input
                type="date"
                value={tripDraft.endDate || ''}
                onChange={(e) => setTripDraft((d) => ({ ...d, endDate: e.target.value }))}
                style={{ flex: 1, border: `1.5px solid ${T.border}`, borderRadius: 10, padding: '8px 10px', fontSize: 12, fontFamily: F, boxSizing: 'border-box', outline: 'none', background: T.bg }}
              />
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              {['private', 'friends', 'public'].map((p) => (
                <div key={p} onClick={() => setTripDraft((d) => ({ ...d, privacy: p }))}
                     style={{ padding: '5px 10px', borderRadius: 14, cursor: 'pointer', fontSize: 10.5, fontWeight: 700,
                              background: tripDraft.privacy === p ? '#2A5C8E' : T.bg,
                              color: tripDraft.privacy === p ? 'white' : T.textSub,
                              border: tripDraft.privacy === p ? 'none' : `1px solid ${T.border}` }}>
                  {p}
                </div>
              ))}
            </div>
            <div style={{ fontSize: 10.5, color: T.textSub, marginBottom: 6, fontWeight: 700 }}>GPS Tracking (Optional)</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              {[{ id: false, label: 'Off' }, { id: true, label: 'On' }].map((opt) => (
                <div key={String(opt.id)} onClick={() => setTripDraft((d) => ({ ...d, gpsTrackingEnabled: opt.id, gpsBackgroundTracking: opt.id ? d.gpsBackgroundTracking : false }))}
                     style={{ padding: '5px 10px', borderRadius: 14, cursor: 'pointer', fontSize: 10.5, fontWeight: 700,
                              background: tripDraft.gpsTrackingEnabled === opt.id ? '#2A5C8E' : T.bg,
                              color: tripDraft.gpsTrackingEnabled === opt.id ? 'white' : T.textSub,
                              border: tripDraft.gpsTrackingEnabled === opt.id ? 'none' : `1px solid ${T.border}` }}>
                  {opt.label}
                </div>
              ))}
            </div>
            {tripDraft.gpsTrackingEnabled && (
              <>
                <div style={{ fontSize: 10.5, color: T.textSub, marginBottom: 6, fontWeight: 700 }}>Sample Interval</div>
                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                  {[{ ms: 5000, label: '5s' }, { ms: 15000, label: '15s' }, { ms: 30000, label: '30s' }].map((it) => (
                    <div key={it.ms} onClick={() => setTripDraft((d) => ({ ...d, gpsIntervalMs: it.ms }))}
                         style={{ padding: '5px 10px', borderRadius: 14, cursor: 'pointer', fontSize: 10.5, fontWeight: 700,
                                  background: tripDraft.gpsIntervalMs === it.ms ? '#2A5C8E' : T.bg,
                                  color: tripDraft.gpsIntervalMs === it.ms ? 'white' : T.textSub,
                                  border: tripDraft.gpsIntervalMs === it.ms ? 'none' : `1px solid ${T.border}` }}>
                      {it.label}
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 10.5, color: T.textSub, marginBottom: 6, fontWeight: 700 }}>Track In Background</div>
                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                  {[{ id: false, label: 'No' }, { id: true, label: 'Yes' }].map((opt) => (
                    <div key={String(opt.id)} onClick={() => setTripDraft((d) => ({ ...d, gpsBackgroundTracking: opt.id }))}
                         style={{ padding: '5px 10px', borderRadius: 14, cursor: 'pointer', fontSize: 10.5, fontWeight: 700,
                                  background: tripDraft.gpsBackgroundTracking === opt.id ? T.amber : T.bg,
                                  color: tripDraft.gpsBackgroundTracking === opt.id ? 'white' : T.textSub,
                                  border: tripDraft.gpsBackgroundTracking === opt.id ? 'none' : `1px solid ${T.border}` }}>
                      {opt.label}
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 10.5, color: T.textFaint, marginBottom: 8 }}>
                  Background tracking records while you use other screens and may use more battery.
                </div>
              </>
            )}
            <div style={{ fontSize: 10.5, color: T.textSub, marginBottom: 6, fontWeight: 700 }}>Trip Cover Photo</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <label style={{ background: '#E4EFF8', border: '1px solid #3A72A840', borderRadius: 10, padding: '7px 10px', fontSize: 10.5, fontWeight: 700, color: '#2A5C8E', cursor: 'pointer' }}>
                {tripCoverBusy ? 'Processing...' : 'Choose Photo'}
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => onTripCoverSelected(e.target.files)} disabled={tripCoverBusy} />
              </label>
              {!!tripDraft.coverPhoto && (
                <span onClick={clearTripCover} style={{ fontSize: 10.5, color: T.textFaint, cursor: 'pointer' }}>Remove</span>
              )}
            </div>
            {!!tripDraft.coverPhoto && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: T.bg, border: `1px solid ${T.border}`, borderRadius: 10, padding: '8px 9px', marginBottom: 8 }}>
                {tripDraft.coverPhoto.thumbDataUrl ? (
                  <img src={tripDraft.coverPhoto.thumbDataUrl} alt="Trip cover preview" style={{ width: 42, height: 42, borderRadius: 8, objectFit: 'cover' }} />
                ) : (
                  <div style={{ width: 42, height: 42, borderRadius: 8, background: T.card, border: `1px solid ${T.border}` }} />
                )}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: T.text, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tripDraft.coverPhoto.name}</div>
                  <div style={{ fontSize: 10, color: T.textFaint }}>{Math.round((tripDraft.coverPhoto.size || 0) / 1024)} KB</div>
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <div onClick={() => setEditingTrip(false)}
                   style={{ flex: 1, height: 34, borderRadius: 9, border: `1px solid ${T.border}`, background: T.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 11, fontWeight: 700, color: T.textSub }}>
                Cancel
              </div>
              <div onClick={saveTripDetails}
                   style={{ flex: 1, height: 34, borderRadius: 9, background: '#2A5C8E', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 11, fontWeight: 700, color: 'white' }}>
                Save Trip
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Trip Map</span>
          <span onClick={() => onNav('map')} style={{ fontSize: 12, color: T.accent, fontWeight: 700, cursor: 'pointer' }}>Open Map →</span>
        </div>
        <div style={{ borderRadius: 14, overflow: 'hidden', height: 220, border: `1px solid ${T.border}`, marginBottom: 8 }}>
          <TripMap
            style="outdoors-v12"
            track={track}
            entries={mapEntries}
            center={mapCenter}
            zoom={11}
            interactive
            selectedEntryId={selectedLocationId}
            showHoverPopup
            onEntrySelect={(entry) => {
              if (entry.id === '__draft_location__') return;
              setSelectedLocationId(entry.id);
              setLocationPageId(entry.id);
            }}
            onMapClick={(pos) => {
              if (addingLocation && locationSource === 'map') {
                setLocationPin(pos);
                return;
              }
              startAddLocationAt(pos);
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
          <span style={{ fontSize: 10.5, color: T.textFaint }}>{track.length} track points</span>
          <span style={{ fontSize: 10.5, color: T.textFaint }}>{mapEntries.length} saved locations</span>
          <span style={{ fontSize: 10.5, color: T.textFaint }}>{filteredEntries.length} entries</span>
        </div>

        <div style={{ background: T.card, borderRadius: 12, border: `1px solid ${T.border}`, padding: '10px 12px', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: T.textSub, letterSpacing: .7, textTransform: 'uppercase' }}>Locations</div>
          </div>
          <div onClick={startAddLocation}
               style={{ marginTop: 8, height: 38, borderRadius: 10, border: `1px dashed ${T.border}`, background: T.card,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: T.textSub }}>Log New Location</span>
          </div>
          <div style={{ fontSize: 10.5, color: T.textFaint, marginTop: 8 }}>
            Tip: click directly on the map to start a new location marker.
          </div>
        </div>

        {addingLocation && (
          <div style={{ background: T.card, borderRadius: 12, border: `1px solid ${T.border}`, padding: '11px 12px', marginBottom: 12 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: T.text, marginBottom: 8 }}>Create Location</div>
            <input
              value={locationDraft.name}
              onChange={(e) => setLocationDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="Location name (Put-In, Camp 2, etc.)"
              style={{ width: '100%', border: `1.5px solid ${T.border}`, borderRadius: 10, padding: '8px 10px', fontSize: 12, fontFamily: F, marginBottom: 8, boxSizing: 'border-box', outline: 'none', background: T.bg }}
            />
            <div style={{ display: 'flex', gap: 6, marginBottom: 8, overflowX: 'auto' }}>
              {[
                { id: 'campsite', icon: '⛺', label: 'Campsite' },
                { id: 'river-feature', icon: '🌊', label: 'River Feature' },
                { id: 'amazing-find', icon: '✨', label: 'Amazing Find' },
                { id: 'hiking-location', icon: '🥾', label: 'Hiking Location' },
              ].map((tp) => (
                <div key={tp.id} onClick={() => setLocationDraft((d) => ({ ...d, type: tp.id }))}
                     style={{ flexShrink: 0, padding: '5px 9px', borderRadius: 14, cursor: 'pointer', fontSize: 10.5, fontWeight: 700,
                              background: locationDraft.type === tp.id ? '#3A72A8' : T.bg,
                              color: locationDraft.type === tp.id ? 'white' : T.textSub,
                              border: locationDraft.type === tp.id ? 'none' : `1px solid ${T.border}` }}>
                  {tp.icon} {tp.label}
                </div>
              ))}
            </div>
            <div style={{ fontSize: 10.5, color: T.textSub, marginBottom: 6, fontWeight: 700 }}>Choose Icon</div>
            <div style={{ display: 'flex', gap: 7, marginBottom: 8, flexWrap: 'wrap' }}>
              {['📍', '⛺', '🌊', '✨', '🥾', '🦌', '📈', '⚠', '🍴', '🔥'].map((ic) => (
                <div key={ic} onClick={() => setLocationDraft((d) => ({ ...d, icon: ic }))}
                     style={{ width: 34, height: 34, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center',
                              cursor: 'pointer', fontSize: 15,
                              border: `2px solid ${locationDraft.icon === ic ? '#2A5C8E' : T.border}`,
                              background: locationDraft.icon === ic ? '#E4EFF8' : T.bg }}>
                  {ic}
                </div>
              ))}
            </div>
            <textarea
              value={locationDraft.notes}
              onChange={(e) => setLocationDraft((d) => ({ ...d, notes: e.target.value }))}
              placeholder="Optional location notes"
              rows={2}
              style={{ width: '100%', border: `1.5px solid ${T.border}`, borderRadius: 10, padding: '8px 10px', fontSize: 12, fontFamily: F, marginBottom: 8, boxSizing: 'border-box', outline: 'none', background: T.bg, resize: 'vertical' }}
            />
            <div style={{ fontSize: 10.5, color: T.textSub, marginBottom: 6, fontWeight: 700 }}>Location Cover Photo</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <label style={{ background: '#E4EFF8', border: '1px solid #3A72A840', borderRadius: 10, padding: '7px 10px', fontSize: 10.5, fontWeight: 700, color: '#2A5C8E', cursor: 'pointer' }}>
                Choose Photo
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => onLocationCoverSelected(e.target.files)} />
              </label>
              {!!locCoverPhoto && (
                <span onClick={() => setLocCoverPhoto(null)} style={{ fontSize: 10.5, color: T.textFaint, cursor: 'pointer' }}>Remove</span>
              )}
            </div>
            {!!locCoverPhoto && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: T.bg, border: `1px solid ${T.border}`, borderRadius: 10, padding: '8px 9px', marginBottom: 8 }}>
                {locCoverPhoto.thumbDataUrl ? (
                  <img src={locCoverPhoto.thumbDataUrl} alt="Location cover preview" style={{ width: 42, height: 42, borderRadius: 8, objectFit: 'cover' }} />
                ) : (
                  <div style={{ width: 42, height: 42, borderRadius: 8, background: T.card, border: `1px solid ${T.border}` }} />
                )}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: T.text, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{locCoverPhoto.name}</div>
                  <div style={{ fontSize: 10, color: T.textFaint }}>{Math.round((locCoverPhoto.size || 0) / 1024)} KB</div>
                </div>
              </div>
            )}
            <div style={{ fontSize: 10.5, color: T.textSub, marginBottom: 6, fontWeight: 700 }}>Location Time</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              {[{ id: 'current', label: 'Current Time' }, { id: 'custom', label: 'Custom Time' }, { id: 'range', label: 'Time Range' }].map((opt) => (
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
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              {[{ id: 'map', label: 'Pick On Map' }, { id: 'current', label: 'Use Current Location' }].map((opt) => (
                <div key={opt.id} onClick={() => setLocationSource(opt.id)}
                     style={{ padding: '5px 10px', borderRadius: 14, cursor: 'pointer', fontSize: 10.5, fontWeight: 700,
                              background: locationSource === opt.id ? '#2A5C8E' : T.bg,
                              color: locationSource === opt.id ? 'white' : T.textSub,
                              border: locationSource === opt.id ? 'none' : `1px solid ${T.border}` }}>
                  {opt.label}
                </div>
              ))}
            </div>
            <div style={{ fontSize: 10.5, color: T.textFaint, marginBottom: 8 }}>
              {locationSource === 'map'
                ? (locationPin ? `Map pin: ${locationPin.lat.toFixed(5)}, ${locationPin.lng.toFixed(5)}` : 'Tap the map below to place this location pin.')
                : (currentPos
                  ? `Current GPS: ${currentPos.lat.toFixed(5)}, ${currentPos.lng.toFixed(5)}`
                  : (currentPosError || 'Fetching current GPS...'))}
            </div>
            {locationError && <div style={{ fontSize: 10.5, color: T.amber, marginBottom: 8 }}>{locationError}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <div onClick={() => { setAddingLocation(false); setLocationError(null); setLocCoverPhoto(null); }}
                   style={{ flex: 1, height: 34, borderRadius: 9, border: `1px solid ${T.border}`, background: T.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 11, fontWeight: 700, color: T.textSub }}>
                Cancel
              </div>
              <div onClick={saveLocation}
                   style={{ flex: 1, height: 34, borderRadius: 9, background: '#2A5C8E', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 11, fontWeight: 700, color: 'white' }}>
                Save Location
              </div>
            </div>
          </div>
        )}

        <div style={{ background: T.card, borderRadius: 12, border: `1px solid ${T.border}`, padding: '10px 12px', marginBottom: 12 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: T.textSub, letterSpacing: .7, textTransform: 'uppercase', marginBottom: 8 }}>Participants</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {participants.map((p) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 9px', borderRadius: 14, fontSize: 10.5, fontWeight: 700, color: p.isOwner ? '#2E6D3A' : T.textSub, background: p.isOwner ? '#E5F4E8' : T.bg, border: `1px solid ${p.isOwner ? '#A4CFAD' : T.border}` }}>
                {p.label}
                {!p.isOwner && (
                  <span onClick={() => removeParticipant(p.id)} style={{ marginLeft: 2, cursor: 'pointer', color: T.textFaint, fontSize: 10, lineHeight: 1 }}>✕</span>
                )}
              </div>
            ))}
            {participants.length === 0 && <span style={{ fontSize: 10.5, color: T.textFaint }}>No participants yet.</span>}
          </div>
          {(() => {
            const currentCollaboratorNames = new Set((trip?.collaborators || []).map((c) => (c.handle || c.name || '').toLowerCase()));
            const suggestions = contacts.filter((c) => {
              if (currentCollaboratorNames.has(c.name.toLowerCase())) return false;
              if (!participantInput.trim()) return true;
              return c.name.toLowerCase().includes(participantInput.toLowerCase());
            });
            return (
              <div style={{ position: 'relative' }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    value={participantInput}
                    onChange={(e) => setParticipantInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') addParticipant(); }}
                    placeholder="Search or add by name"
                    style={{ flex: 1, border: `1.5px solid ${T.border}`, borderRadius: 9, padding: '7px 9px', fontSize: 11.5, fontFamily: F, boxSizing: 'border-box', outline: 'none', background: T.bg }}
                  />
                  <div onClick={() => addParticipant()} style={{ padding: '7px 12px', borderRadius: 9, background: T.accent, color: 'white', fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>Add</div>
                </div>
                {suggestions.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 48, background: T.card, border: `1px solid ${T.border}`, borderRadius: 9, marginTop: 3, zIndex: 20, boxShadow: '0 4px 12px rgba(0,0,0,.10)', overflow: 'hidden' }}>
                    {suggestions.map((c) => (
                      <div key={c.id} onClick={() => addParticipant(c.name)}
                           style={{ padding: '8px 12px', fontSize: 12, color: T.text, cursor: 'pointer', borderBottom: `1px solid ${T.border}` }}
                           onMouseEnter={(e) => e.currentTarget.style.background = T.bg}
                           onMouseLeave={(e) => e.currentTarget.style.background = T.card}>
                        {c.name}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 8 }}>Trip Locations</div>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 10 }}>
          {locationOptions.map((id) => (
            <div key={id} onClick={() => { setSelectedLocationId(id); setLocationPageId(id); }}
                 style={{ flexShrink: 0, padding: '5px 10px', borderRadius: 16, cursor: 'pointer', fontSize: 10.5, fontWeight: 700,
                          background: selectedLocationId === id ? '#2A5C8E' : T.bg, color: selectedLocationId === id ? 'white' : T.textSub,
                          border: selectedLocationId === id ? 'none' : `1px solid ${T.border}`,
                          display: 'flex', alignItems: 'center', gap: 6 }}>
              {(() => {
                const loc = orderedLocations.find((l) => l.id === id);
                const num = orderedLocations.findIndex((l) => l.id === id) + 1;
                return (
                  <>
                    {loc?.coverPhoto?.thumbDataUrl && (
                      <img src={loc.coverPhoto.thumbDataUrl} alt={loc.name || 'Location cover'} style={{ width: 20, height: 20, borderRadius: 6, objectFit: 'cover' }} />
                    )}
                    <span>{`${num}. ${loc?.icon || '📍'} ${loc?.name || 'Location'}`}</span>
                  </>
                );
              })()}
            </div>
          ))}
        </div>

        <div style={{ marginBottom: 12 }}>
          {orderedLocations.length === 0 && (
            <div style={{ background: T.card, borderRadius: 12, border: `1px solid ${T.border}`, padding: '12px 11px', fontSize: 11.5, color: T.textFaint }}>
              No locations yet. Add your first location from the button above or by tapping the map.
            </div>
          )}
          {orderedLocations.map((loc, idx) => (
            <div key={loc.id} onClick={() => { setSelectedLocationId(loc.id); setLocationPageId(loc.id); }}
                 style={{ background: T.card, borderRadius: 11, border: `1px solid ${selectedLocationId === loc.id ? '#2A5C8E' : T.border}`, padding: '9px 10px', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, cursor: 'pointer' }}>
              <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                {loc.coverPhoto?.thumbDataUrl ? (
                  <img src={loc.coverPhoto.thumbDataUrl} alt={`${loc.name} cover`} style={{ width: 34, height: 34, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 34, height: 34, borderRadius: 8, background: T.bg, border: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <span style={{ fontSize: 14 }}>{loc.icon || '📍'}</span>
                  </div>
                )}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {idx + 1}. {loc.icon || '📍'} {loc.name}
                  </div>
                  <div style={{ fontSize: 10.5, color: T.textFaint }}>{loc.type}</div>
                  <div style={{ fontSize: 10, color: T.textFaint }}>Logged: {formatLocationLoggedAt(loc)}</div>
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 10.5, color: T.textSub }}>{locationEntryCount.get(loc.id) || 0} entries</div>
                <div style={{ fontSize: 10, color: T.textFaint }}>{locationEventCount.get(loc.id) || 0} events</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Trip Entries</span>
          <span onClick={() => onNav('log')} style={{ fontSize: 12, color: T.accent, fontWeight: 700, cursor: 'pointer' }}>Open Journal →</span>
        </div>

        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: '10px 11px', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title, notes, feature, location"
              style={{ flex: 1, border: `1.5px solid ${T.border}`, borderRadius: 10, padding: '9px 11px', fontSize: 12, fontFamily: F, boxSizing: 'border-box', outline: 'none', background: T.bg }}
            />
            <div onClick={() => setShowFilters((v) => !v)}
                 style={{ flexShrink: 0, border: `1px solid ${showFilters ? '#2A5C8E' : T.border}`, background: showFilters ? '#EAF3FB' : T.bg, borderRadius: 10, padding: '8px 10px', fontSize: 10.5, fontWeight: 700, color: showFilters ? '#2A5C8E' : T.textSub, cursor: 'pointer' }}>
              {showFilters ? 'Hide Filters' : 'Filters'}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
            <div onClick={() => setEntryLocationId('all')}
                 style={{ flexShrink: 0, padding: '5px 10px', borderRadius: 16, cursor: 'pointer', fontSize: 10.5, fontWeight: 700,
                          background: entryLocationId === 'all' ? '#2A5C8E' : T.bg, color: entryLocationId === 'all' ? 'white' : T.textSub,
                          border: entryLocationId === 'all' ? 'none' : `1px solid ${T.border}` }}>
              All Locations
            </div>
            {orderedLocations.map((loc) => (
              <div key={loc.id} onClick={() => setEntryLocationId(loc.id)}
                   style={{ flexShrink: 0, padding: '5px 10px', borderRadius: 16, cursor: 'pointer', fontSize: 10.5, fontWeight: 700,
                            background: entryLocationId === loc.id ? '#2A5C8E' : T.bg, color: entryLocationId === loc.id ? 'white' : T.textSub,
                            border: entryLocationId === loc.id ? 'none' : `1px solid ${T.border}` }}>
                {loc.icon || '📍'} {loc.name}
              </div>
            ))}
          </div>

          {showFilters && (
            <>
              <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginTop: 8 }}>
                {typeOptions.map((type) => (
                  <div key={type} onClick={() => setTypeFilter(type)}
                       style={{ flexShrink: 0, padding: '5px 10px', borderRadius: 16, cursor: 'pointer', fontSize: 10.5, fontWeight: 700,
                                background: typeFilter === type ? T.accent : T.bg, color: typeFilter === type ? 'white' : T.textSub,
                                border: typeFilter === type ? 'none' : `1px solid ${T.border}` }}>
                    {type === 'all' ? 'All Types' : type}
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginTop: 8 }}>
                {[{ id: 'all', label: 'Any Date' }, { id: 'today', label: 'Today' }, { id: '7d', label: 'Last 7d' }, { id: '30d', label: 'Last 30d' }].map((d) => (
                  <div key={d.id} onClick={() => setDateFilter(d.id)}
                       style={{ flexShrink: 0, padding: '5px 10px', borderRadius: 16, cursor: 'pointer', fontSize: 10.5, fontWeight: 700,
                                background: dateFilter === d.id ? '#3A72A8' : T.bg, color: dateFilter === d.id ? 'white' : T.textSub,
                                border: dateFilter === d.id ? 'none' : `1px solid ${T.border}` }}>
                    {d.label}
                  </div>
                ))}

                {[{ id: 'all', label: 'Any Link' }, { id: 'linked', label: 'Linked' }, { id: 'unlinked', label: 'Unlinked' }].map((l) => (
                  <div key={l.id} onClick={() => setLocationFilter(l.id)}
                       style={{ flexShrink: 0, padding: '5px 10px', borderRadius: 16, cursor: 'pointer', fontSize: 10.5, fontWeight: 700,
                                background: locationFilter === l.id ? T.amber : T.bg, color: locationFilter === l.id ? 'white' : T.textSub,
                                border: locationFilter === l.id ? 'none' : `1px solid ${T.border}` }}>
                    {l.label}
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginTop: 8 }}>
                {userOptions.map((uid) => (
                  <div key={uid} onClick={() => setUserFilter(uid)}
                       style={{ flexShrink: 0, padding: '5px 10px', borderRadius: 16, cursor: 'pointer', fontSize: 10.5, fontWeight: 700,
                                background: userFilter === uid ? '#2A5C8E' : T.bg, color: userFilter === uid ? 'white' : T.textSub,
                                border: userFilter === uid ? 'none' : `1px solid ${T.border}` }}>
                    {uid === 'all' ? 'Any User' : userLabel(uid, currentUserId)}
                  </div>
                ))}

                {[{ id: 'all', label: 'Any Media' }, { id: 'with-media', label: 'With Media' }, { id: 'no-media', label: 'No Media' }].map((m) => (
                  <div key={m.id} onClick={() => setMediaFilter(m.id)}
                       style={{ flexShrink: 0, padding: '5px 10px', borderRadius: 16, cursor: 'pointer', fontSize: 10.5, fontWeight: 700,
                                background: mediaFilter === m.id ? T.accent : T.bg, color: mediaFilter === m.id ? 'white' : T.textSub,
                                border: mediaFilter === m.id ? 'none' : `1px solid ${T.border}` }}>
                    {m.label}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {filteredEntries.map((e, i) => {
          const entryLocationId = e.locationId || null;
          const canView = !!e.eventId && !!entryLocationId;
          return (
            <div key={e.id || i}
                 onClick={() => { if (canView) { setLocationPageEventId(e.eventId); setLocationPageId(entryLocationId); } }}
                 style={{ background: T.card, borderRadius: 12, padding: '11px 12px', marginBottom: 8, border: `1px solid ${T.border}`, display: 'flex', gap: 10, alignItems: 'flex-start', cursor: canView ? 'pointer' : 'default' }}>
              <div style={{ width: 34, height: 34, borderRadius: 9, background: `${entryColor(e.type)}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <span style={{ fontSize: 15 }}>{e.mapTagSymbol || defaultTagSymbol(e.type, e.featureType)}</span>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: T.text }}>{e.title || e.type}</div>
                <div style={{ fontSize: 11, color: T.textFaint, textTransform: 'capitalize' }}>{e.type}</div>
                <div style={{ fontSize: 10.5, color: authorColor(e.authorId || '') }}>By {userLabel(e.authorId, currentUserId)}</div>
                <div style={{ fontSize: 10.5, color: '#2A5C8E' }}>Location: {locationLabelForEntry(e, locations)}</div>
                {e.observedAt && <div style={{ fontSize: 10.5, color: T.textFaint }}>Observed: {new Date(e.observedAt).toLocaleString()}</div>}
                {e.lat && e.lng && <div style={{ fontSize: 10.5, color: T.textFaint }}>📍 {e.lat.toFixed(4)}, {e.lng.toFixed(4)}</div>}
                {entryHasMedia(e) && <div style={{ fontSize: 10.5, color: T.textFaint }}>📷🎥🎙 media attached</div>}
                {canView && (
                  <div style={{ display: 'flex', gap: 12, marginTop: 5 }}>
                    <span style={{ fontSize: 10.5, color: '#2A5C8E', fontWeight: 700 }}>View Event →</span>
                  </div>
                )}
              </div>
              <SyncChip state={e.syncState || 'pending'} compact />
            </div>
          );
        })}

        {filteredEntries.length === 0 && (
          <div style={{ textAlign: 'center', padding: '20px 0', color: T.textFaint, fontSize: 12 }}>
            No entries match current filters.
          </div>
        )}
      </div>

      <BottomNav active="trip" onNav={onNav} onFab={onFab} trip={trip} />
    </div>
  );
}

function TripSummaryCard({ trip, entries, locations, track }) {
  const startDate = trip.startDate ? new Date(trip.startDate + 'T00:00:00') : null;
  const endDate = trip.endDate ? new Date(trip.endDate + 'T00:00:00') : (trip.endedAt ? new Date(trip.endedAt) : null);
  const days = startDate && endDate ? Math.max(1, Math.round((endDate - startDate) / 864e5) + 1) : null;

  let distanceM = 0;
  for (let i = 1; i < track.length; i++) {
    distanceM += haversineM(track[i - 1].lat, track[i - 1].lng, track[i].lat, track[i].lng);
  }
  const distanceMi = (distanceM / 1609.34).toFixed(1);

  const typeCounts = {};
  for (const e of entries) {
    typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
  }

  const temps = entries.filter((e) => e.weatherTempC != null).map((e) => e.weatherTempC);
  const minTempC = temps.length ? Math.round(Math.min(...temps)) : null;
  const maxTempC = temps.length ? Math.round(Math.max(...temps)) : null;

  const flows = entries.filter((e) => e.cfs != null).map((e) => e.cfs);
  const minCfs = flows.length ? Math.round(Math.min(...flows)) : null;
  const maxCfs = flows.length ? Math.round(Math.max(...flows)) : null;

  const topTypes = Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  const statStyle = {
    background: T.bg, border: `1px solid ${T.border}`, borderRadius: 10,
    padding: '10px 12px', textAlign: 'center', flex: '1 1 0', minWidth: 0,
  };

  return (
    <div style={{ background: T.card, borderRadius: 12, border: `2px solid #A4CFAD`, padding: '12px 14px', marginBottom: 12 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: '#2E6D3A', letterSpacing: .7, textTransform: 'uppercase', marginBottom: 10 }}>
        Trip Summary
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        {days != null && (
          <div style={statStyle}>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#2E6D3A' }}>{days}</div>
            <div style={{ fontSize: 9.5, color: T.textFaint, marginTop: 2 }}>Days</div>
          </div>
        )}
        <div style={statStyle}>
          <div style={{ fontSize: 22, fontWeight: 800, color: T.text }}>{entries.length}</div>
          <div style={{ fontSize: 9.5, color: T.textFaint, marginTop: 2 }}>Entries</div>
        </div>
        <div style={statStyle}>
          <div style={{ fontSize: 22, fontWeight: 800, color: T.text }}>{locations.length}</div>
          <div style={{ fontSize: 9.5, color: T.textFaint, marginTop: 2 }}>Locations</div>
        </div>
        <div style={statStyle}>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#2A5C8E' }}>{distanceMi}</div>
          <div style={{ fontSize: 9.5, color: T.textFaint, marginTop: 2 }}>mi tracked</div>
        </div>
      </div>

      {(minTempC != null || minCfs != null) && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          {minTempC != null && (
            <div style={statStyle}>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#517EA3' }}>{minTempC}–{maxTempC}°C</div>
              <div style={{ fontSize: 9.5, color: T.textFaint, marginTop: 2 }}>Temp range</div>
            </div>
          )}
          {minCfs != null && (
            <div style={statStyle}>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#2A5C8E' }}>{minCfs}–{maxCfs}</div>
              <div style={{ fontSize: 9.5, color: T.textFaint, marginTop: 2 }}>CFS range</div>
            </div>
          )}
        </div>
      )}

      {topTypes.length > 0 && (
        <div>
          <div style={{ fontSize: 9.5, color: T.textFaint, marginBottom: 5 }}>Entry breakdown</div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {topTypes.map(([type, count]) => (
              <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 4, background: T.bg, border: `1px solid ${T.border}`, borderRadius: 8, padding: '3px 8px', fontSize: 10.5 }}>
                <span>{defaultTagSymbol(type)}</span>
                <span style={{ fontWeight: 700, color: T.text }}>{count}</span>
                <span style={{ color: T.textFaint }}>{type}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function defaultTagSymbol(type, featureType) {
  if (type === 'river-feature') {
    const map = {
      rapid: '🌊', obstruction: '⚠', 'possible camp': '⛺', wildlife: '🦌', hazard: '⛔', portage: '🛶',
    };
    return map[featureType] || '🌊';
  }
  const map = {
    campsite: '⛺',
    water: '💧',
    wildlife: '🦌',
    weather: '⛅',
    rapid: '🌊',
    note: '📝',
    food: '🍴',
    voice: '🎙',
    video: '🎥',
    gauge: '📈',
  };
  return map[type] || '📍';
}

function authorColor(authorId) {
  const palette = ['#3A72A8', '#B8702E', '#4A7A34', '#7A4ACF', '#C05050', '#2A5C8E', '#9A6D1A'];
  if (!authorId) return palette[0];
  let hash = 0;
  for (let i = 0; i < authorId.length; i++) hash = ((hash << 5) - hash) + authorId.charCodeAt(i);
  const idx = Math.abs(hash) % palette.length;
  return palette[idx];
}

function userLabel(uid, currentUserId) {
  if (!uid) return 'Unknown';
  if (uid === currentUserId) return 'You';
  return `User ${uid.slice(0, 6)}`;
}

function entryHasMedia(e) {
  return Boolean(
    (e.photoFiles && e.photoFiles.length) ||
    (e.videoFiles && e.videoFiles.length) ||
    (e.voiceFiles && e.voiceFiles.length) ||
    e.photoNotes || e.videoNotes || e.voiceNotes
  );
}

function entryColor(type) {
  const map = {
    campsite: '#B8702E',
    water: '#4A8BC4',
    wildlife: '#4A7A34',
    weather: '#517EA3',
    rapid: '#3A72A8',
    'river-feature': '#3A72A8',
    note: '#6B6763',
    food: '#B06030',
    voice: '#5B8DD9',
    video: '#C05050',
    gauge: '#2A5C8E',
    'custom-event': '#2C5F3E',
  };
  return map[type] || T.accent;
}

function locationNameForEntry(entry, locations) {
  if (!entry?.locationId) return '';
  const found = locations.find((l) => l.id === entry.locationId);
  return found?.name || '';
}

function locationLabelForEntry(entry, locations) {
  const linkedName = locationNameForEntry(entry, locations);
  if (linkedName) return linkedName;
  if (entry?.locationName) return entry.locationName;
  return 'No location logged';
}

function locationSortTs(location) {
  if (!location) return 0;
  if (location.observedAt) return new Date(location.observedAt).getTime();
  if (location.observedStartAt) return new Date(location.observedStartAt).getTime();
  return location.createdAt || 0;
}

function formatLocationLoggedAt(location) {
  const ts = locationSortTs(location);
  if (!ts) return 'Time unknown';
  return new Date(ts).toLocaleString();
}

function locationSymbol(type) {
  const map = {
    'put-in': '🟢',
    'take-out': '🔴',
    camp: '⛺',
    hazard: '⚠',
    'point-of-interest': '📍',
  };
  return map[type] || '📍';
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

function addHours(date, hours) {
  const d = new Date(date);
  d.setHours(d.getHours() + hours);
  return d;
}

function formatTripDate(value) {
  if (!value) return 'TBD';
  const d = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return 'TBD';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function buildTripDraft(trip) {
  return {
    name: trip?.name || '',
    location: trip?.location || '',
    startDate: trip?.startDate || '',
    endDate: trip?.endDate || '',
    privacy: trip?.privacy || 'private',
    gpsTrackingEnabled: Boolean(trip?.gpsTrackingEnabled),
    gpsBackgroundTracking: Boolean(trip?.gpsBackgroundTracking),
    gpsIntervalMs: trip?.gpsIntervalMs || 5000,
    coverPhoto: trip?.coverPhoto || null,
  };
}

function buildParticipantOptions(trip, currentUserId) {
  if (!trip) return [];
  const out = [];
  const seen = new Set();

  if (trip.ownerId) {
    const ownerLabel = trip.ownerId === currentUserId ? 'You' : 'Trip Owner';
    out.push({ id: trip.ownerId, label: ownerLabel, role: 'owner', isOwner: true });
    seen.add(trip.ownerId);
  }

  for (const c of trip.collaborators || []) {
    const id = c?.id || c?.handle;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: c.handle || 'Participant', role: c.role || 'contributor', isOwner: false });
  }

  return out;
}
