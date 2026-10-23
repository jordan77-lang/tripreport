import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BottomNav } from '../components/BottomNav';
import { TripMap } from '../components/TripMap';
import { SyncChip } from '../components/SyncChip';
import { TripCrewList } from '../components/TripCrewList';
import { UnassignedEntries } from '../components/UnassignedEntries';
import { Ic } from '../components/Ic';
import { T, F, ICONS } from '../tokens';
import { addLocation, finalizeTrip, getCurrentUserId, isTripMember, isTripOwner, reopenTrip } from '../lib/storage';
import { getSignedInUserId } from '../lib/authUser';
import { createPhotoMediaFromFile } from '../lib/media';
import { MediaThumb } from '../components/MediaThumb';
import { shareEntity } from '../lib/share';
import { exportGpx, exportHtmlReport } from '../lib/export';
import { TripSyncPanel } from '../components/TripSyncPanel';
import { DuplicatePlacesBanner } from '../components/DuplicatePlacesBanner';
import { TripOverflowMenu, tripMenuIcon } from '../components/TripOverflowMenu';
import { TripEditPanel } from '../components/TripEditPanel';
import { LocationSaveForm } from '../components/LocationSaveForm';
import { defaultLocationKind, locationTypeLabel } from '../lib/locationTypes';
import { buildTripDraft, formatTripDate, formatTripDateRange } from '../lib/tripEdit';
import { ts } from '../lib/textScale';
import { deleteTripCompletely, pushTripToCloud } from '../lib/tripCloud';
import { supabaseConfigured } from '../lib/supabase';
import { useTripMembersSync } from '../hooks/useTripMembersSync';
import { buildTripParticipants, computeBalances, money } from '../lib/expenses';

export function Trip({ trip, onNav, onFab, onTripUpdate, onTripDeleted, onOpenRecap, onOpenLocation, onOpenEvent }) {
  const currentUserId = getCurrentUserId();
  const signedInUserId = getSignedInUserId();
  const canEditTrip = Boolean(trip && isTripMember(trip, signedInUserId || currentUserId));
  const canSyncTrip = Boolean(supabaseConfigured && signedInUserId && trip && isTripMember(trip, signedInUserId));
  const canDeleteTrip = Boolean(trip && isTripOwner(trip, signedInUserId || currentUserId));
  const [selectedLocationId, setSelectedLocationId] = useState(trip?.locations?.[0]?.id || null);
  const [expandedLocationIds, setExpandedLocationIds] = useState(() => new Set());
  const [addingLocation, setAddingLocation] = useState(false);
  const [locationDraft, setLocationDraft] = useState({
    name: '',
    type: defaultLocationKind(trip).id,
    icon: defaultLocationKind(trip).icon,
    notes: '',
    timeMode: 'current',
    observedAt: toDatetimeLocal(new Date()),
    observedStartAt: toDatetimeLocal(new Date()),
    observedEndAt: toDatetimeLocal(addHours(new Date(), 1)),
    customLat: '',
    customLng: '',
  });
  const [locationPin, setLocationPin] = useState(null);
  const [locationSource, setLocationSource] = useState('map');
  const [currentPos, setCurrentPos] = useState(null);
  const [currentPosError, setCurrentPosError] = useState(null);
  const [locationError, setLocationError] = useState(null);
  const [editingTrip, setEditingTrip] = useState(false);
  const [tripDraft, setTripDraft] = useState(() => buildTripDraft(trip));
  const [locCoverPhoto, setLocCoverPhoto] = useState(null);
  const exchangeStatus = null;
  const [cloudSyncStatus, setCloudSyncStatus] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [showSync, setShowSync] = useState(true);
  // Imperative map handle, supplied by TripMap once its map exists.
  const mapApiRef = useRef(null);
  const handleMapReady = useCallback((api) => { mapApiRef.current = api; }, []);
  const entries = useMemo(() => trip?.entries ?? [], [trip?.entries]);
  const locations = useMemo(() => trip?.locations ?? [], [trip?.locations]);
  const track = useMemo(() => trip?.track ?? [], [trip?.track]);
  const tripSyncState = trip?.syncState || (entries.some(e => e.syncState === 'pending') ? 'pending' : 'synced');
  const isOpen = trip?.status !== 'completed';
  const isCompleted = trip?.status === 'completed';

  useTripMembersSync({
    tripId: trip?.id,
    enabled: Boolean(trip?.id),
    onSynced: onTripUpdate,
  });

  useEffect(() => {
    if(!addingLocation || locationSource !== 'current')return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCurrentPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setCurrentPosError(null);
      },
      (err) => setCurrentPosError(err.message),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }, [addingLocation, locationSource]);

  function startAddLocationAt(pos) {
    if (!canEditTrip || !isOpen) return;
    setAddingLocation(true);
    setLocationError(null);
    setLocationSource('map');
    const next = pos || mapApiRef.current?.getCenter?.() || null;
    if (next) setLocationPin(next);
  }

  function openTripEdit() {
    setTripDraft(buildTripDraft(trip));
    setEditingTrip(true);
  }

  function closeTripEdit() {
    setEditingTrip(false);
  }

  function handleTripEditSaved() {
    setEditingTrip(false);
    onTripUpdate?.();
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

  async function shareTrip() {
    if (!trip) return;
    await shareEntity({
      title: `Trip: ${trip.name}`,
      text: `${trip.name}\n${trip.location || 'Unknown location'}\n${(trip.types || []).join(', ')}`,
    });
  }

  async function syncToCloud() {
    if (!trip) return;
    try {
      await pushTripToCloud(trip);
      setCloudSyncStatus({ kind: 'success', message: 'Trip synced to cloud.' });
      onTripUpdate?.();
    } catch (e) {
      setCloudSyncStatus({ kind: 'error', message: e?.message || 'Cloud sync failed.' });
    }
  }

  async function confirmDeleteTrip() {
    if (!trip?.id || !canDeleteTrip || !deleteConfirm) return;
    setDeleteBusy(true);
    try {
      await deleteTripCompletely(trip.id);
      onTripDeleted?.();
    } catch (e) {
      setCloudSyncStatus({ kind: 'error', message: e?.message || 'Could not delete trip.' });
      setDeleteConfirm(false);
    } finally {
      setDeleteBusy(false);
    }
  }

  const overflowItems = [
    ...(canEditTrip ? [{ id: 'finish', label: isOpen ? 'Finish trip' : 'Reopen trip', icon: ICONS.compass, onClick: isOpen ? handleFinalizeTrip : handleReopenTrip }] : []),
    { id: 'share', label: 'Share trip summary', icon: tripMenuIcon('share'), onClick: shareTrip },
    { id: 'gpx', label: 'Export GPX track', icon: tripMenuIcon('export'), onClick: () => exportGpx(trip) },
    { id: 'report', label: 'Export HTML report', icon: tripMenuIcon('export'), onClick: () => exportHtmlReport(trip) },
    ...(supabaseConfigured && canSyncTrip ? [{ id: 'sync', label: 'Sync to cloud', icon: tripMenuIcon('sync'), onClick: () => void syncToCloud() }] : []),
    { id: 'exchange', label: 'Sync & offline sharing', icon: tripMenuIcon('sync'), onClick: () => setShowSync(v=>!v) },
    ...(canEditTrip ? [{
      id: 'edit',
      label: editingTrip ? 'Close edit' : 'Edit trip details',
      icon: tripMenuIcon('edit'),
      onClick: () => {
        if (editingTrip) closeTripEdit();
        else openTripEdit();
      },
    }] : []),
    ...(canDeleteTrip ? [{
      id: 'delete',
      label: 'Delete trip',
      danger: true,
      icon: 'M3 6h18 M8 6V4h8v2 M19 6l-1 14H6L5 6',
      onClick: () => setDeleteConfirm(true),
    }] : []),
  ];

  async function onLocationCoverSelected(files) {
    const file = Array.from(files || [])[0];
    if (!file) return;
    const nextCover = trip?.id ? await createPhotoMediaFromFile(file, trip.id, { maxThumbSide: 320, maxFullSide: 1200 }) : null;
    setLocCoverPhoto(nextCover);
  }

  function saveLocation() {
    if (!trip) return;
    if (!locationDraft.name.trim()) {
      setLocationError('Give this location a name.');
      return;
    }
    let resolved = null;
    if (locationSource === 'current') {
      resolved = currentPos;
    } else if (locationSource === 'custom') {
      const lat = parseFloat(locationDraft.customLat);
      const lng = parseFloat(locationDraft.customLng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        setLocationError('Enter valid latitude and longitude.');
        return;
      }
      resolved = { lat, lng };
    } else {
      resolved = locationPin;
    }
    if (resolved?.lat == null || resolved?.lng == null) {
      setLocationError(
        locationSource === 'current'
          ? 'Current GPS location is not available yet.'
          : locationSource === 'custom'
            ? 'Enter coordinates for this custom location.'
            : 'Tap the map to place a pin for this location.',
      );
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

      setSelectedLocationId(created.id);
      setAddingLocation(false);
      setLocationDraft({
        name: '',
        type: defaultLocationKind(trip).id,
        icon: defaultLocationKind(trip).icon,
        notes: '',
        timeMode: 'current',
        observedAt: toDatetimeLocal(new Date()),
        observedStartAt: toDatetimeLocal(new Date()),
        observedEndAt: toDatetimeLocal(addHours(new Date(), 1)),
        customLat: '',
        customLng: '',
      });
      setLocationPin(null);
      setLocCoverPhoto(null);
      setLocationError(null);
      onTripUpdate?.();
      onOpenLocation?.(created.id);
    }
  }

  const orderedLocations = useMemo(() => {
    return [...locations].sort((a, b) => locationSortTs(a) - locationSortTs(b));
  }, [locations]);

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

  const eventsByLocation = useMemo(() => {
    const map = new Map();
    const events = [...(trip?.events || [])].sort(
      (a, b) => new Date(a.observedAt || a.createdAt || 0) - new Date(b.observedAt || b.createdAt || 0),
    );
    for (const ev of events) {
      if (!ev.locationId) continue;
      if (!map.has(ev.locationId)) map.set(ev.locationId, []);
      map.get(ev.locationId).push(ev);
    }
    return map;
  }, [trip?.events]);

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
      <div style={{ background: T.card, padding: '14px 16px 12px', borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: ts(12), fontWeight: 800, color: T.accent, marginBottom: 4 }}>Locations</div>
            <div style={{ fontSize: ts(22), fontWeight: 800, color: T.text, letterSpacing: -.4, lineHeight: 1.2 }}>{trip.name}</div>
            <div style={{ fontSize: ts(14), color: T.textSub, marginTop: 4 }}>{entries.length} entries · {track.length} GPS pts</div>
            {canEditTrip && (
            <button
              type="button"
              onClick={openTripEdit}
              style={{
                marginTop: 6,
                border: 'none',
                background: 'none',
                padding: 0,
                fontSize: ts(14),
                color: T.accent,
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: F,
                textAlign: 'left',
              }}
            >
              {formatTripDateRange(trip.startDate, trip.endDate)}
            </button>
            )}
            <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{
                fontSize: ts(13), fontWeight: 700,
                color: isCompleted ? '#2E6D3A' : '#2A5C8E',
                background: isCompleted ? '#E5F4E8' : '#E4EFF8',
                borderRadius: 8, padding: '4px 8px',
              }}>
                {isCompleted ? 'Completed' : (trip.startDate ? `Starts ${formatTripDate(trip.startDate)}` : 'Open')}
              </span>
              <SyncChip state={tripSyncState} compact />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            {canEditTrip && (
            <button
              type="button"
              onClick={openTripEdit}
              aria-label="Edit trip details"
              style={{
                height: 40,
                padding: '0 12px',
                borderRadius: 10,
                border: `1px solid ${T.border}`,
                background: editingTrip ? '#E4EFF8' : T.bg,
                fontSize: ts(13),
                fontWeight: 700,
                color: '#2A5C8E',
                cursor: 'pointer',
                fontFamily: F,
              }}
            >
              Edit
            </button>
            )}
            <TripOverflowMenu items={overflowItems} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          {isOpen && canEditTrip && (
            <button type="button" onClick={() => onNav?.('add-location')}
                 style={{ flex: 1, minHeight: 48, border: 'none', borderRadius: 12, padding: '11px 14px', fontSize: ts(15), fontWeight: 800, color: 'white', cursor: 'pointer', background: T.accent }}>
              + Add a location
            </button>
          )}
          {isCompleted && onOpenRecap && (
            <button type="button" onClick={() => onOpenRecap(trip.id)}
                 style={{ flex: 1, minWidth: 120, border: 'none', borderRadius: 10, padding: '11px 14px', fontSize: ts(14), fontWeight: 800, color: 'white', cursor: 'pointer', background: '#2E6D3A' }}>
              Recap & Share
            </button>
          )}
        </div>


      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
        {/* Always reachable from the ⋮ menu; shown inline only when there are conflicts to review. */}
        {trip?._sync?.conflicts?.length > 0 && (
          <button type="button" onClick={() => setShowSync(v=>!v)} aria-expanded={showSync}
            style={{ width: '100%', marginBottom: 10, padding: '10px 12px', borderRadius: 12, border: '1px solid #E8C9A0',
                     background: '#FBF0E4', color: '#7A4A14', fontSize: ts(13), fontWeight: 700, fontFamily: F, textAlign: 'left', cursor: 'pointer' }}>
            {trip._sync.conflicts.length} sync {trip._sync.conflicts.length === 1 ? 'conflict' : 'conflicts'} to review →
          </button>
        )}
        <DuplicatePlacesBanner trip={trip} onCombined={onTripUpdate} /> 
        {deleteConfirm && canDeleteTrip && (
          <div style={{
            background: '#FFF0F0',
            border: '1px solid #E7B5B5',
            borderRadius: 12,
            padding: '12px 14px',
            marginBottom: 12,
          }}>
            <div style={{ fontSize: ts(14), fontWeight: 800, color: '#8A1414', marginBottom: 6 }}>
              Delete this trip?
            </div>
            <div style={{ fontSize: ts(13), color: '#6B3535', lineHeight: 1.45, marginBottom: 10 }}>
              Permanently removes &ldquo;{trip.name}&rdquo;, all entries, photos, and tracks. This cannot be undone.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => setDeleteConfirm(false)} disabled={deleteBusy}
                style={{ flex: 1, border: `1px solid ${T.border}`, borderRadius: 10, padding: '10px 12px', fontSize: ts(14), fontWeight: 700, color: T.textSub, background: T.card, cursor: 'pointer' }}>
                Cancel
              </button>
              <button type="button" onClick={() => void confirmDeleteTrip()} disabled={deleteBusy}
                style={{ flex: 1, border: 'none', borderRadius: 10, padding: '10px 12px', fontSize: ts(14), fontWeight: 800, color: 'white', background: '#B03030', cursor: deleteBusy ? 'wait' : 'pointer', opacity: deleteBusy ? 0.7 : 1 }}>
                {deleteBusy ? 'Deleting…' : 'Delete forever'}
              </button>
            </div>
          </div>
        )}
        {!!cloudSyncStatus && (
          <div style={{
            background: cloudSyncStatus.kind === 'error' ? '#FBE4E4' : '#E8F2EA',
            border: `1px solid ${cloudSyncStatus.kind === 'error' ? '#E7B5B5' : '#A8CFB2'}`,
            borderRadius: 12,
            padding: '10px 12px',
            marginBottom: 12,
            fontSize: 11.5,
            fontWeight: 700,
            color: cloudSyncStatus.kind === 'error' ? '#8A1414' : '#2E6D3A',
          }}>
            {cloudSyncStatus.message}
          </div>
        )}
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

        {canEditTrip && editingTrip && (
          <TripEditPanel
            trip={trip}
            draft={tripDraft}
            onCancel={closeTripEdit}
            onSaved={handleTripEditSaved}
            onDraftChange={setTripDraft}
          />
        )}

        <UnassignedEntries trip={trip} onTripUpdate={onTripUpdate} onAddLocation={() => onNav?.('add-location')} />
        <div style={{ fontSize: ts(17), fontWeight: 800, color: T.text, marginBottom: 8 }}>Your locations</div>
        <p style={{ fontSize: ts(14), color: T.textSub, lineHeight: 1.5, marginBottom: 14 }}>Open a location to add its information and trip entries.</p>
        <div style={{ marginBottom: 14 }}>
          {orderedLocations.length === 0 && !addingLocation && (
            <div style={{ background: T.card, borderRadius: 12, border: `1px dashed ${T.border}`, padding: '16px 14px', textAlign: 'center' }}>
              <div style={{ fontSize: ts(13), fontWeight: 700, color: T.textSub, marginBottom: 4 }}>No locations yet</div>
              <div style={{ fontSize: ts(14), color: T.textSub, lineHeight: 1.5 }}>Add your first location above — a campsite, stop, or point of interest. Then add entries inside it.</div>
            </div>
          )}
          {orderedLocations.map((loc, idx) => {
            const placeEvents = eventsByLocation.get(loc.id) || [];
            const eventsOpen = expandedLocationIds.has(loc.id);
            return (
            <div key={loc.id}
                 style={{ background: T.card, borderRadius: 11, border: `1px solid ${selectedLocationId === loc.id ? '#2A5C8E' : T.border}`, marginBottom: 6, overflow: 'hidden' }}>
              <div style={{ padding: '10px 11px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <button type="button" onClick={() => { setSelectedLocationId(loc.id); onOpenLocation?.(loc.id); }}
                   style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', padding: 0, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontFamily: F, textAlign: 'left' }}>
              <div style={{ width: 36, height: 36, borderRadius: 9, background: T.bg, border: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
                {loc.coverPhoto ? (
                  <MediaThumb media={loc.coverPhoto} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <span style={{ fontSize: 16 }}>{loc.icon || '📍'}</span>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: ts(13), fontWeight: 700, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {idx + 1}. {loc.name}
                </div>
                <div style={{ fontSize: ts(11), color: T.textFaint }}>
                  {locationTypeLabel(loc.type)}
                  {' · '}{locationEventCount.get(loc.id) || 0} events
                  {' · '}{locationEntryCount.get(loc.id) || 0} entries
                </div>
              </div>
              <Ic d="M9 18l6-6-6-6" size={16} color={T.textFaint} sw={2} />
              </button>
              {canEditTrip && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedLocationId(loc.id);
                    onOpenLocation?.(loc.id, null, { edit: true });
                  }}
                  style={{
                    flexShrink: 0,
                    minHeight: 36,
                    padding: '0 12px',
                    borderRadius: 9,
                    border: `1px solid ${T.border}`,
                    background: T.bg,
                    color: T.accent,
                    fontWeight: 800,
                    fontSize: ts(12),
                    cursor: 'pointer',
                    fontFamily: F,
                  }}
                >
                  Edit
                </button>
              )}
              {placeEvents.length > 0 && (
                <button
                  type="button"
                  aria-expanded={eventsOpen}
                  aria-label={eventsOpen ? `Hide events at ${loc.name}` : `Show events at ${loc.name}`}
                  onClick={() => {
                    setSelectedLocationId(loc.id);
                    setExpandedLocationIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(loc.id)) next.delete(loc.id);
                      else next.add(loc.id);
                      return next;
                    });
                  }}
                  style={{
                    flexShrink: 0,
                    width: 36,
                    height: 36,
                    borderRadius: 9,
                    border: `1px solid ${T.border}`,
                    background: eventsOpen ? T.accentLight : T.bg,
                    color: T.textSub,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: F,
                  }}
                >
                  <Ic d={eventsOpen ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} size={16} color={T.textSub} sw={2} />
                </button>
              )}
              </div>
              {eventsOpen && placeEvents.length > 0 && (
                <div style={{ borderTop: `1px solid ${T.border}`, padding: '6px 11px 8px 46px' }}>
                  {placeEvents.map((ev) => (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={() => { setSelectedLocationId(loc.id); onOpenEvent?.(loc.id, ev.id); }}
                      style={{
                        width: '100%',
                        minHeight: 36,
                        marginTop: 4,
                        border: 'none',
                        borderLeft: `2px solid ${T.border}`,
                        background: 'transparent',
                        color: T.text,
                        fontWeight: 700,
                        fontSize: ts(13),
                        cursor: 'pointer',
                        fontFamily: F,
                        textAlign: 'left',
                        padding: '4px 0 4px 10px',
                      }}
                    >
                      <div>{ev.name || ev.type}</div>
                      <div style={{ fontSize: ts(11), color: T.textFaint, fontWeight: 600, marginTop: 1 }}>{formatEventWhen(ev)}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: ts(14), fontWeight: 700, color: T.text }}>Map</span>
          <button type="button" onClick={() => onNav?.('map')} style={{ minHeight: 44, padding: '8px 0 8px 12px', border: 'none', background: 'transparent', fontFamily: F, fontSize: ts(13), color: T.accent, fontWeight: 700, cursor: 'pointer' }}>Full map →</button>
        </div>
        <div style={{ fontSize: ts(12), color: T.textSub, marginBottom: 8, lineHeight: 1.45 }}>
          {addingLocation
            ? 'Search to jump the map, then tap or drag the pin to the exact spot and save.'
            : 'Tap the map to add a location, or open one above.'}
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
            onReady={handleMapReady}
            pin={addingLocation && locationSource === 'map' && locationPin ? { ...locationPin, symbol: locationDraft.icon || '📍' } : null}
            onPinChange={(pos) => setLocationPin(pos)}
            onEntrySelect={(entry) => {
              if (entry.id === '__draft_location__') return;
              setSelectedLocationId(entry.id);
              onOpenLocation?.(entry.id);
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
        <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: ts(11), color: T.textFaint }}>{locations.length} locations</span>
          <span style={{ fontSize: ts(11), color: T.textFaint }}>{track.length} track pts</span>
          {!addingLocation && isOpen && canEditTrip && (
            <span onClick={() => startAddLocationAt()} style={{ fontSize: ts(11), color: T.accent, fontWeight: 700, cursor: 'pointer' }}>
              + Add location
            </span>
          )}
        </div>

        {addingLocation && (
          <LocationSaveForm
            draft={locationDraft}
            onDraftChange={setLocationDraft}
            locationSource={locationSource}
            onLocationSourceChange={(id) => {
              setLocationSource(id);
              setLocationError(null);
              if (id === 'current' && currentPos) setLocationPin(null);
            }}
            locationPin={locationPin}
            currentPos={currentPos}
            currentPosError={currentPosError}
            coverPhoto={locCoverPhoto}
            onCoverPhotoChange={(files) => {
              if (!files) { setLocCoverPhoto(null); return; }
              void onLocationCoverSelected(files);
            }}
            error={locationError}
            onSearchPick={({ lng, lat, bbox, setPin }) => {
              if (setPin) {
                setLocationSource('map');
                setLocationPin({ lat, lng });
                setLocationError(null);
              }
              mapApiRef.current?.flyTo({ lng, lat, bbox, zoom: setPin ? 15 : undefined });
            }}
            onCancel={() => { setAddingLocation(false); setLocationError(null); setLocCoverPhoto(null); }}
            onSave={saveLocation}
          />
        )}

        <TripCrewList
          trip={trip}
          currentUserId={currentUserId}
          canManage={canEditTrip && isTripOwner(trip, signedInUserId || currentUserId)}
          onManageCrew={() => onNav('plan-participants')}
        />

        <ExpenseSummaryLink trip={trip} onOpen={() => onNav('plan')} />

        {isCompleted && <TripSummaryCard trip={trip} entries={entries} locations={locations} track={track} />}

        {showSync && (
          <div style={{ marginTop: 8 }}>
            <TripSyncPanel trip={trip} onTripUpdate={onTripUpdate} />
          </div>
        )}

      </div>

      <BottomNav active="trip" onNav={onNav} onFab={onFab} trip={trip} />
    </div>
  );
}

/**
 * Read-only expense pulse on the trip overview. Deliberately not a ledger —
 * adding, editing, and settling all happen in Plan → Expenses so there is exactly
 * one place that owns the numbers.
 */
function ExpenseSummaryLink({ trip, onOpen }) {
  const currentUserId = getCurrentUserId();
  const expenses = useMemo(() => trip?.expenses || [], [trip?.expenses]);
  const participants = useMemo(() => buildTripParticipants(trip, currentUserId), [trip, currentUserId]);
  const total = expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const myNet = useMemo(() => {
    const balances = computeBalances(expenses, participants, { trip });
    return balances[currentUserId] ?? 0;
  }, [expenses, participants, trip, currentUserId]);

  const owed = Math.abs(myNet) >= 0.01;
  const subtitle = expenses.length === 0
    ? 'No expenses logged yet'
    : owed
      ? (myNet < 0 ? `You owe ${money(-myNet)}` : `You are owed ${money(myNet)}`)
      : 'All settled up';

  return (
    <div onClick={onOpen}
         style={{ background: T.card, borderRadius: 12, border: `1px solid ${T.border}`, padding: '12px 14px',
                  marginBottom: 14, display: 'flex', alignItems: 'center', gap: 11, cursor: 'pointer' }}>
      <div style={{ width: 32, height: 32, borderRadius: 9, background: T.accentLight, display: 'flex',
                    alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 15 }}>
        💵
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: ts(13), fontWeight: 700, color: T.text }}>
          Expenses{expenses.length > 0 ? ` · ${money(total)}` : ''}
        </div>
        <div style={{ fontSize: ts(11), color: owed ? T.amber : T.textFaint, marginTop: 1 }}>{subtitle}</div>
      </div>
      <Ic d="M9 18l6-6-6-6" size={15} color={T.textFaint} sw={2} />
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

function formatEventWhen(event) {
  if (event?.timeMode === 'range' && event.observedStartAt) {
    const start = formatShortWhen(event.observedStartAt);
    const end = event.observedEndAt ? formatShortWhen(event.observedEndAt) : '';
    return end ? `${start} – ${end}` : start;
  }
  return formatShortWhen(event?.observedAt || event?.createdAt);
}

function formatShortWhen(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Time not set';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
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
