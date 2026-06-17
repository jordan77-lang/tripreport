import { useEffect, useMemo, useRef, useState } from 'react';
import { BottomNav } from '../components/BottomNav';
import { TripMap } from '../components/TripMap';
import { SyncChip } from '../components/SyncChip';
import { TripExpenses } from '../components/TripExpenses';
import { TripCrewList } from '../components/TripCrewList';
import { Ic } from '../components/Ic';
import { T, F, ICONS } from '../tokens';
import { addLocation, finalizeTrip, getCurrentUserId, isTripMember, isTripOwner, reopenTrip, saveTrip, startGpsSession, stopGpsSession } from '../lib/storage';
import { getSignedInUserId } from '../lib/authUser';
import { createPhotoMediaFromFile } from '../lib/media';
import { MediaThumb } from '../components/MediaThumb';
import { shareEntity } from '../lib/share';
import { exportGpx, exportHtmlReport } from '../lib/export';
import { exportTripUpdateFile, formatMergeSummary, mergeTripUpdate, readTripUpdateFile } from '../lib/offlineExchange';
import { TripOverflowMenu, tripMenuIcon } from '../components/TripOverflowMenu';
import { TripEditPanel } from '../components/TripEditPanel';
import { LocationSaveForm } from '../components/LocationSaveForm';
import { locationTypeLabel } from '../lib/locationTypes';
import { buildTripDraft, formatTripDate, formatTripDateRange } from '../lib/tripEdit';
import { ts } from '../lib/textScale';
import { deleteTripCompletely, pushTripToCloud } from '../lib/tripCloud';
import { supabaseConfigured } from '../lib/supabase';
import { useTripMembersSync } from '../hooks/useTripMembersSync';
import { resolveUserDisplayName } from '../lib/expenses';
import { LocationPage } from './LocationPage';

export function Trip({ trip, onNav, onFab, onTripUpdate, onTripDeleted, onOpenRecap }) {
  const currentUserId = getCurrentUserId();
  const signedInUserId = getSignedInUserId();
  const canEditTrip = Boolean(trip && isTripMember(trip, signedInUserId || currentUserId));
  const canSyncTrip = Boolean(supabaseConfigured && signedInUserId && trip && isTripMember(trip, signedInUserId));
  const canDeleteTrip = Boolean(trip && isTripOwner(trip, signedInUserId || currentUserId));
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
    customLat: '',
    customLng: '',
  });
  const [locationPin, setLocationPin] = useState(null);
  const [locationSource, setLocationSource] = useState('map');
  const [currentPos, setCurrentPos] = useState(null);
  const [currentPosError, setCurrentPosError] = useState(null);
  const [locationError, setLocationError] = useState(null);
  const [locationPageId, setLocationPageId] = useState(null);
  const [locationPageEventId, setLocationPageEventId] = useState(null);
  const [editingTrip, setEditingTrip] = useState(false);
  const [tripDraft, setTripDraft] = useState(() => buildTripDraft(trip));
  const [locCoverPhoto, setLocCoverPhoto] = useState(null);
  const [exchangeStatus, setExchangeStatus] = useState(null);
  const [cloudSyncStatus, setCloudSyncStatus] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [tripSection, setTripSection] = useState('overview');
  const importUpdateRef = useRef(null);
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
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCurrentPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setCurrentPosError(null);
      },
      (err) => setCurrentPosError(err.message),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }, [addingLocation]);

  function startAddLocationAt(pos) {
    setAddingLocation(true);
    setLocationError(null);
    setLocationSource('map');
    setLocationPin(pos);
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
    { id: 'share', label: 'Share trip summary', icon: tripMenuIcon('share'), onClick: shareTrip },
    { id: 'gpx', label: 'Export GPX track', icon: tripMenuIcon('export'), onClick: () => exportGpx(trip) },
    { id: 'report', label: 'Export HTML report', icon: tripMenuIcon('export'), onClick: () => exportHtmlReport(trip) },
    ...(supabaseConfigured && canSyncTrip ? [{ id: 'sync', label: 'Sync to cloud', icon: tripMenuIcon('sync'), onClick: () => void syncToCloud() }] : []),
    { id: 'export', label: 'Export offline update', icon: tripMenuIcon('export'), onClick: exportOfflineUpdate },
    { id: 'import', label: 'Import offline update', icon: tripMenuIcon('import'), onClick: () => importUpdateRef.current?.click() },
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
      onClick: () => { setTripSection('overview'); setDeleteConfirm(true); },
    }] : []),
  ];

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
    if (!resolved?.lat || !resolved?.lng) {
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
        customLat: '',
        customLng: '',
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
      <div style={{ background: T.card, padding: '14px 16px 12px', borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
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
              {formatTripDateRange(trip.startDate, trip.endDate)} · Edit trip details
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
              Edit trip details
            </button>
            )}
            <TripOverflowMenu items={overflowItems} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          {isOpen && (
            <button type="button" onClick={handleFinalizeTrip}
                 style={{ flex: 1, minWidth: 120, border: 'none', borderRadius: 10, padding: '11px 14px', fontSize: ts(14), fontWeight: 800, color: '#8A5526', cursor: 'pointer', background: '#FFF1E4', border: '1px solid #E4C5A8' }}>
              Finish Trip
            </button>
          )}
          {isCompleted && (
            <button type="button" onClick={handleReopenTrip}
                 style={{ flex: 1, minWidth: 120, border: 'none', borderRadius: 10, padding: '11px 14px', fontSize: ts(14), fontWeight: 800, color: '#2E6D3A', cursor: 'pointer', background: '#E5F4E8', border: '1px solid #A4CFAD' }}>
              Reopen Trip
            </button>
          )}
          <button type="button" onClick={() => onNav('plan')}
               style={{ flex: 1, minWidth: 120, border: `1px solid ${T.border}`, borderRadius: 10, padding: '11px 14px', fontSize: ts(14), fontWeight: 700, color: T.text, cursor: 'pointer', background: T.bg }}>
            Trip Plan
          </button>
          {isCompleted && onOpenRecap && (
            <button type="button" onClick={() => onOpenRecap(trip.id)}
                 style={{ flex: 1, minWidth: 120, border: 'none', borderRadius: 10, padding: '11px 14px', fontSize: ts(14), fontWeight: 800, color: 'white', cursor: 'pointer', background: '#2E6D3A' }}>
              Recap & Share
            </button>
          )}
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

        <div style={{ background: T.card, borderRadius: 12, border: `1px solid ${T.border}`, padding: '12px 14px', marginBottom: 14 }}>
          <TripExpenses
            trip={trip}
            onTripUpdate={onTripUpdate}
            scope="all"
            layout="compact"
            onOpenFull={() => onNav('plan')}
          />
        </div>

        <TripCrewList
          trip={trip}
          currentUserId={currentUserId}
          canManage={canEditTrip && isTripOwner(trip, signedInUserId || currentUserId)}
          onManageCrew={() => onNav('plan-participants')}
        />

        {tripSection === 'overview' && (
        <>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: ts(14), fontWeight: 700, color: T.text }}>Map</span>
          <span onClick={() => onNav('map')} style={{ fontSize: ts(12), color: T.accent, fontWeight: 700, cursor: 'pointer' }}>Full map →</span>
        </div>
        <div style={{ fontSize: ts(12), color: T.textSub, marginBottom: 8, lineHeight: 1.45 }}>
          {addingLocation
            ? 'Place the pin, name the spot, then save. Add events after you open the location.'
            : 'Tap the map to log a new location, or open one below to add events.'}
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
        <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: ts(11), color: T.textFaint }}>{locations.length} locations</span>
          <span style={{ fontSize: ts(11), color: T.textFaint }}>{track.length} track pts</span>
          {!addingLocation && isOpen && canEditTrip && (
            <span onClick={() => { setAddingLocation(true); setLocationError(null); setLocationSource('map'); }} style={{ fontSize: ts(11), color: T.accent, fontWeight: 700, cursor: 'pointer' }}>
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
            onCancel={() => { setAddingLocation(false); setLocationError(null); setLocCoverPhoto(null); }}
            onSave={saveLocation}
          />
        )}

        <div style={{ fontSize: ts(13), fontWeight: 700, color: T.text, marginBottom: 8 }}>Saved locations</div>
        <div style={{ marginBottom: 14 }}>
          {orderedLocations.length === 0 && !addingLocation && (
            <div style={{ background: T.card, borderRadius: 12, border: `1px dashed ${T.border}`, padding: '16px 14px', textAlign: 'center' }}>
              <div style={{ fontSize: ts(13), fontWeight: 700, color: T.textSub, marginBottom: 4 }}>No locations yet</div>
              <div style={{ fontSize: ts(12), color: T.textFaint, lineHeight: 1.45 }}>Tap the map above to drop your first pin.</div>
            </div>
          )}
          {orderedLocations.map((loc, idx) => (
            <div key={loc.id} onClick={() => { setSelectedLocationId(loc.id); setLocationPageId(loc.id); }}
                 style={{ background: T.card, borderRadius: 11, border: `1px solid ${selectedLocationId === loc.id ? '#2A5C8E' : T.border}`, padding: '10px 11px', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
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
            </div>
          ))}
        </div>

        {entries.length > 0 && (
          <button
            type="button"
            onClick={() => setTripSection('entries')}
            style={{
              width: '100%',
              border: `1px solid ${T.border}`,
              borderRadius: 11,
              padding: '11px 14px',
              marginBottom: 14,
              background: T.card,
              fontSize: ts(13),
              fontWeight: 700,
              color: T.accent,
              cursor: 'pointer',
              fontFamily: F,
              textAlign: 'left',
            }}
          >
            All entries ({entries.length}) →
          </button>
        )}

        {isCompleted && <TripSummaryCard trip={trip} entries={entries} locations={locations} track={track} />}

        {isOpen && (
        <div style={{ background: trip.gpsSessionActive ? '#EAF3FB' : T.card, borderRadius: 12, border: `1px solid ${trip.gpsSessionActive ? '#BFD9EF' : T.border}`, padding: '10px 12px', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: T.text }}>
                {trip.gpsSessionActive ? 'GPS tracking active' : 'GPS tracking'}
              </div>
              <div style={{ fontSize: 10.5, color: T.textFaint }}>
                {trip.gpsSessionActive
                  ? `${activeSessionPointCount} points · started ${new Date(activeSession?.startedAt || trip.gpsSessionStartedAt || 0).toLocaleTimeString()}`
                  : 'Record your route between locations.'}
              </div>
            </div>
            {trip.gpsSessionActive ? (
              <div onClick={() => handleStopTrackingSession(null)}
                   style={{ background: '#FFEDE6', border: '1px solid #F2C8B4', borderRadius: 9, padding: '7px 10px', fontSize: 10.5, fontWeight: 700, color: '#8A5526', cursor: 'pointer', flexShrink: 0 }}>
                Stop
              </div>
            ) : (
              <div onClick={handleStartTrackingSession}
                   style={{ background: '#E5F4E8', border: '1px solid #A4CFAD', borderRadius: 9, padding: '7px 10px', fontSize: 10.5, fontWeight: 700, color: '#2E6D3A', cursor: 'pointer', flexShrink: 0 }}>
                Start
              </div>
            )}
          </div>
        </div>
        )}

        {canDeleteTrip && !deleteConfirm && (
          <div style={{ marginTop: 8, marginBottom: 4, paddingTop: 16, borderTop: `1px dashed ${T.border}` }}>
            <div style={{ fontSize: ts(12), fontWeight: 700, color: T.textFaint, marginBottom: 8, letterSpacing: 0.4 }}>
              TRIP OWNER
            </div>
            <button type="button" onClick={() => setDeleteConfirm(true)}
              style={{ width: '100%', border: '1px solid #E7B5B5', borderRadius: 10, padding: '11px 14px', fontSize: ts(14), fontWeight: 700, color: '#B03030', background: '#FFF5F5', cursor: 'pointer' }}>
              Delete this trip
            </button>
          </div>
        )}

        </>
        )}

        {tripSection === 'entries' && (
        <>

        <button
          type="button"
          onClick={() => setTripSection('overview')}
          style={{
            border: 'none',
            background: 'transparent',
            padding: '0 0 10px',
            fontSize: ts(13),
            fontWeight: 700,
            color: T.accent,
            cursor: 'pointer',
            fontFamily: F,
          }}
        >
          ← Map & locations
        </button>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: ts(15), fontWeight: 700, color: T.text }}>Trip Entries</span>
          <span onClick={() => onNav('log')} style={{ fontSize: ts(13), color: T.accent, fontWeight: 700, cursor: 'pointer' }}>Open Journal →</span>
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

                {[{ id: 'all', label: 'Any location' }, { id: 'linked', label: 'At location' }, { id: 'unlinked', label: 'No location' }].map((l) => (
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
                    {uid === 'all' ? 'Any User' : userLabel(uid, currentUserId, trip)}
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
          const canViewEvent = !!e.eventId && !!entryLocationId;
          const canViewLocation = !!entryLocationId;
          const canNavigate = canViewEvent || canViewLocation;
          return (
            <div key={e.id || i}
                 onClick={() => {
                   if (canViewEvent) {
                     setLocationPageEventId(e.eventId);
                     setLocationPageId(entryLocationId);
                   } else if (canViewLocation) {
                     setLocationPageEventId(null);
                     setLocationPageId(entryLocationId);
                   }
                 }}
                 style={{ background: T.card, borderRadius: 12, padding: '11px 12px', marginBottom: 8, border: `1px solid ${T.border}`, display: 'flex', gap: 10, alignItems: 'flex-start', cursor: canNavigate ? 'pointer' : 'default' }}>
              <div style={{ width: 34, height: 34, borderRadius: 9, background: `${entryColor(e.type)}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <span style={{ fontSize: 15 }}>{e.mapTagSymbol || defaultTagSymbol(e.type, e.featureType)}</span>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: T.text }}>{e.title || e.type}</div>
                <div style={{ fontSize: 11, color: T.textFaint, textTransform: 'capitalize' }}>{e.type}</div>
                <div style={{ fontSize: 10.5, color: authorColor(e.authorId || '') }}>By {userLabel(e.authorId, currentUserId, trip)}</div>
                <div style={{ fontSize: 10.5, color: '#2A5C8E' }}>Location: {locationLabelForEntry(e, locations)}</div>
                {e.observedAt && <div style={{ fontSize: 10.5, color: T.textFaint }}>Observed: {new Date(e.observedAt).toLocaleString()}</div>}
                {e.lat && e.lng && <div style={{ fontSize: 10.5, color: T.textFaint }}>📍 {e.lat.toFixed(4)}, {e.lng.toFixed(4)}</div>}
                {entryHasMedia(e) && <div style={{ fontSize: 10.5, color: T.textFaint }}>📷🎥🎙 media attached</div>}
                {canNavigate && (
                  <div style={{ display: 'flex', gap: 12, marginTop: 5 }}>
                    <span style={{ fontSize: 10.5, color: '#2A5C8E', fontWeight: 700 }}>
                      {canViewEvent ? 'View event →' : 'View location →'}
                    </span>
                  </div>
                )}
              </div>
              <SyncChip state={e.syncState || 'pending'} compact />
            </div>
          );
        })}

        {filteredEntries.length === 0 && (
          <div style={{ textAlign: 'center', padding: '20px 0', color: T.textFaint, fontSize: ts(13) }}>
            No entries match current filters.
          </div>
        )}

        </>
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

function userLabel(uid, currentUserId, trip) {
  if (!uid) return 'Unknown';
  return resolveUserDisplayName(trip, uid, currentUserId);
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
