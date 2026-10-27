import { useCallback, useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { Ic } from './Ic';
import { T, F, ICONS } from '../tokens';
import { listMapRegions } from '../lib/mapRegions';
import { saveTrip } from '../lib/storage';
import { savePlanningToCloud } from '../lib/planningSave';
import {
  formatMapBytes,
  getRegionDownloadStatus,
  getTripMapAreaId,
  getTripMapAreaLabel,
  getTripMapAreaTiles,
  getTripOfflineMapReadiness,
  isRegionCached,
  isTripMapAreaCached,
  preloadAllTripMaps,
  preloadMapRegion,
  preloadTripMapArea,
  verifyRegionDownload,
  verifyTripMapAreaDownload,
} from '../lib/offlineMaps';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const ZOOM_OPTIONS = [
  { level: 10, label: 'Region overview', detail: 'Roads, rivers, peaks', estimateMb: 4 },
  { level: 12, label: 'Trail detail', detail: 'Trails, campsites, terrain', estimateMb: 12 },
  { level: 13, label: 'High detail', detail: 'Fine terrain, rapids, features', estimateMb: 28 },
];

function formatVerifiedAt(ts) {
  if (!ts) return null;
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return null;
  }
}

export function OfflineMapsPanel({ trip, onTripUpdate, compact = false }) {
  const regions = listMapRegions();
  const selected = new Set(trip?.offlineRegions || []);
  const areaId = getTripMapAreaId(trip);
  const [readiness, setReadiness] = useState(null);
  const [statuses, setStatuses] = useState({});
  const [areaStatus, setAreaStatus] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [verifyId, setVerifyId] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [downloadingAll, setDownloadingAll] = useState(false);

  // Interactive Map Area Editor state
  const [editingArea, setEditingArea] = useState(false);
  const [areaLabel, setAreaLabel] = useState(() => trip?.mapArea?.label || trip?.location || '');
  const [mapSearch, setMapSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [maxZoom, setMaxZoom] = useState(() => Number(trip?.mapArea?.maxZoom) || 12);
  const [draftCenter, setDraftCenter] = useState(() => trip?.mapArea?.center || { lng: -111.5, lat: 34.0 });
  const [draftBounds, setDraftBounds] = useState(() => (
    trip?.mapArea?.sw && trip?.mapArea?.ne
      ? { sw: trip.mapArea.sw, ne: trip.mapArea.ne }
      : null
  ));
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);

  const refreshStatuses = useCallback(async () => {
    const next = {};
    for (const region of regions) {
      const cached = await isRegionCached(region.id);
      const stored = getRegionDownloadStatus(region.id);
      next[region.id] = {
        ...stored,
        cached,
        state: cached ? 'ready' : stored.state,
        progress: cached ? 100 : stored.progress,
      };
    }
    setStatuses(next);

    if (areaId) {
      const areaCached = await isTripMapAreaCached(trip);
      const storedArea = getRegionDownloadStatus(areaId);
      setAreaStatus({
        ...storedArea,
        cached: areaCached,
        state: areaCached ? 'ready' : storedArea.state,
        progress: areaCached ? 100 : storedArea.progress,
      });
    } else {
      setAreaStatus(null);
    }

    if (trip) {
      const r = await getTripOfflineMapReadiness(trip);
      setReadiness(r);
    }
  }, [regions, areaId, trip]);

  useEffect(() => {
    void refreshStatuses();
  }, [refreshStatuses, trip?.offlineRegions, trip?.mapArea]);

  // Initialize interactive Mapbox preview when editingArea is open
  useEffect(() => {
    if (!editingArea || !mapContainerRef.current || mapRef.current) return undefined;
    if (!mapboxgl.accessToken) return undefined;
    try {
      const map = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: 'mapbox://styles/mapbox/outdoors-v12',
        center: [draftCenter.lng, draftCenter.lat],
        zoom: 9,
      });
      mapRef.current = map;

      const syncBounds = () => {
        const c = map.getCenter();
        const b = map.getBounds();
        setDraftCenter({ lng: c.lng, lat: c.lat });
        setDraftBounds({
          sw: { lng: b.getWest(), lat: b.getSouth() },
          ne: { lng: b.getEast(), lat: b.getNorth() },
        });
      };

      map.on('load', () => {
        if (trip?.mapArea?.sw && trip?.mapArea?.ne) {
          map.fitBounds(
            [
              [trip.mapArea.sw.lng, trip.mapArea.sw.lat],
              [trip.mapArea.ne.lng, trip.mapArea.ne.lat],
            ],
            { padding: 20, duration: 0 },
          );
        }
        syncBounds();
      });
      map.on('moveend', syncBounds);

      return () => {
        map.remove();
        mapRef.current = null;
      };
    } catch {
      return undefined;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingArea]);

  async function searchPlace() {
    const q = mapSearch.trim();
    if (!q || !mapboxgl.accessToken) return;
    setSearching(true);
    setSearchResults([]);
    try {
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${mapboxgl.accessToken}&types=place,region,district,locality,neighborhood,poi&limit=5`;
      const res = await fetch(url);
      const data = await res.json();
      setSearchResults(data.features || []);
    } catch {
      // ignore
    } finally {
      setSearching(false);
    }
  }

  function pickPlace(feature) {
    setSearchResults([]);
    const placeLabel = feature.place_name || feature.text || '';
    setMapSearch(placeLabel);
    setAreaLabel(feature.text || placeLabel);
    const [lng, lat] = feature.center;
    const bbox = feature.bbox;
    setDraftCenter({ lng, lat });
    if (bbox) {
      setDraftBounds({
        sw: { lng: bbox[0], lat: bbox[1] },
        ne: { lng: bbox[2], lat: bbox[3] },
      });
    } else {
      setDraftBounds({
        sw: { lng: lng - 0.15, lat: lat - 0.12 },
        ne: { lng: lng + 0.15, lat: lat + 0.12 },
      });
    }
    if (mapRef.current) {
      if (bbox) {
        mapRef.current.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 30, duration: 600 });
      } else {
        mapRef.current.flyTo({ center: [lng, lat], zoom: 10, duration: 600 });
      }
    }
  }

  async function saveCustomMapArea({ downloadImmediately = true } = {}) {
    if (!trip?.id) return;
    const sw = draftBounds?.sw || { lng: draftCenter.lng - 0.15, lat: draftCenter.lat - 0.12 };
    const ne = draftBounds?.ne || { lng: draftCenter.lng + 0.15, lat: draftCenter.lat + 0.12 };
    const nextArea = {
      label: (areaLabel || mapSearch || trip.location || `${trip.name || 'Trip'} map area`).trim(),
      sw,
      ne,
      center: draftCenter,
      maxZoom: Number(maxZoom) || 12,
    };
    let updatedTrip = null;
    await savePlanningToCloud(trip.id, () => {
      updatedTrip = saveTrip({
        ...trip,
        mapArea: nextArea,
        location: trip.location || nextArea.label,
        updatedAt: Date.now(),
        syncState: 'pending',
      });
    });
    setEditingArea(false);
    onTripUpdate?.();
    if (downloadImmediately && updatedTrip) {
      await handleDownloadArea(updatedTrip);
    } else {
      void refreshStatuses();
    }
  }

  async function toggleTripRegion(regionId) {
    if (!trip?.id) return;
    const current = trip.offlineRegions || [];
    const adding = !current.includes(regionId);
    const next = adding
      ? [...current, regionId]
      : current.filter((id) => id !== regionId);
    await savePlanningToCloud(trip.id, () => {
      saveTrip({ ...trip, offlineRegions: next, updatedAt: Date.now(), syncState: 'pending' });
    });
    onTripUpdate?.();
    if (adding) {
      await handleDownload(regionId);
    }
  }

  async function handleDownload(regionId) {
    setBusyId(regionId);
    setConfirmId(null);
    try {
      const result = await preloadMapRegion(regionId, {
        onProgress: () => { void refreshStatuses(); },
      });
      if (result && !result.error) {
        setConfirmId(regionId);
      }
    } catch {
      // status stored in offlineMaps
    } finally {
      setBusyId(null);
      void refreshStatuses();
    }
  }

  async function handleDownloadArea(targetTrip = trip) {
    const id = getTripMapAreaId(targetTrip);
    if (!id) return;
    setBusyId(id);
    setConfirmId(null);
    try {
      const result = await preloadTripMapArea(targetTrip, {
        onProgress: () => { void refreshStatuses(); },
      });
      if (result && !result.error) {
        setConfirmId(id);
      }
    } catch {
      // status stored in offlineMaps
    } finally {
      setBusyId(null);
      void refreshStatuses();
    }
  }

  async function handleDownloadAllTripMaps() {
    if (!trip || downloadingAll) return;
    setDownloadingAll(true);
    try {
      await preloadAllTripMaps(trip, {
        onProgress: () => { void refreshStatuses(); },
      });
    } finally {
      setDownloadingAll(false);
      void refreshStatuses();
    }
  }

  async function handleVerify(regionId, isCustomArea = false) {
    setVerifyId(regionId);
    try {
      const result = isCustomArea
        ? await verifyTripMapAreaDownload(trip)
        : await verifyRegionDownload(regionId);
      if (result.ok) setConfirmId(regionId);
    } finally {
      setVerifyId(null);
      void refreshStatuses();
    }
  }

  const areaTiles = areaId ? getTripMapAreaTiles(trip) : [];
  const areaReady = Boolean(areaStatus?.cached || areaStatus?.state === 'ready');
  const areaDownloading = Boolean(areaStatus?.state === 'downloading' || (areaId && busyId === areaId));
  const areaSizeLabel = formatMapBytes(areaStatus?.bytes)
    || (areaTiles.length ? `~${Math.max(1, Math.round((areaTiles.length * 18) / 1024))} MB (${areaTiles.length} tiles)` : null);

  return (
    <div style={{
      background: T.card,
      borderRadius: 12,
      border: `1px solid ${T.border}`,
      padding: compact ? '10px 12px' : '14px',
      marginBottom: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
        <div style={{ fontSize: compact ? 12.5 : 14, fontWeight: 800, color: T.text }}>
          Trip Maps & Offline Storage
        </div>
        {readiness?.configured && (
          <span style={{
            fontSize: 10,
            fontWeight: 800,
            padding: '3px 8px',
            borderRadius: 999,
            background: readiness.ready ? '#E2F4E2' : '#FDF2E4',
            color: readiness.ready ? '#2A6A14' : '#9B5118',
            border: `1px solid ${readiness.ready ? '#9FD09F' : '#E8C59B'}`,
          }}>
            {readiness.ready ? '✓ Ready Offline' : '⚠️ Download Needed'}
          </span>
        )}
      </div>
      <div style={{ fontSize: 11, color: T.textSub, marginBottom: 12, lineHeight: 1.45 }}>
        Select a map for this trip so everyone in your crew is prompted to download the same map to their device before heading into no-service areas.
      </div>

      {/* Clear Device Readiness Banner */}
      {readiness?.configured ? (
        <div style={{
          marginBottom: 14,
          padding: '11px 12px',
          borderRadius: 11,
          background: readiness.ready ? '#EBF5EB' : '#FFF4E5',
          border: `1.5px solid ${readiness.ready ? '#A8D8A8' : '#E8B87D'}`,
        }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: readiness.ready ? '#2A6A14' : '#8A4812' }}>
            {readiness.ready
              ? `✓ Stored on this device: ${readiness.primaryLabel}`
              : `⚠️ Map not downloaded on this device yet (${readiness.totalCount - readiness.missingCount} of ${readiness.totalCount} ready)`}
          </div>
          <div style={{ fontSize: 11, color: readiness.ready ? '#345E28' : '#7A4A1D', marginTop: 3, lineHeight: 1.4 }}>
            {readiness.ready
              ? 'This phone has the trip map cached locally and will work without cell service.'
              : 'You will not have this map once you lose cell service unless you download it to this device now.'}
          </div>
          {!readiness.ready && (
            <button
              type="button"
              onClick={() => void handleDownloadAllTripMaps()}
              disabled={downloadingAll}
              style={{
                marginTop: 9,
                width: '100%',
                border: 'none',
                borderRadius: 9,
                padding: '9px 12px',
                background: T.accent,
                color: 'white',
                fontSize: 12,
                fontWeight: 800,
                fontFamily: F,
                cursor: downloadingAll ? 'wait' : 'pointer',
              }}
            >
              {downloadingAll ? 'Downloading map to this device…' : `Download "${readiness.primaryLabel}" to This Device`}
            </button>
          )}
        </div>
      ) : (
        <div style={{
          marginBottom: 14,
          padding: '11px 12px',
          borderRadius: 11,
          background: '#FBF0E4',
          border: '1px solid #E8D4B8',
          fontSize: 11.5,
          color: '#8A5526',
          lineHeight: 1.45,
        }}>
          <strong>No map selected for this trip yet.</strong> Choose a custom Trip Map Area or select a regional pack below so your crew gets prompted to download it.
        </div>
      )}

      {/* Section 1: Custom Trip Map Area (Framed on Map) */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 10.5, fontWeight: 800, color: T.textSub, letterSpacing: 0.5, textTransform: 'uppercase' }}>
            Trip Map Area
          </span>
          {trip?.id && (
            <button
              type="button"
              onClick={() => {
                setAreaLabel(trip?.mapArea?.label || trip?.location || '');
                setEditingArea((v) => !v);
              }}
              style={{
                border: `1px solid ${T.accent}55`,
                background: editingArea ? T.bg : T.accentLight,
                color: T.accent,
                borderRadius: 7,
                padding: '3px 9px',
                fontSize: 10.5,
                fontWeight: 800,
                fontFamily: F,
                cursor: 'pointer',
              }}
            >
              {editingArea ? 'Close map editor' : areaId ? 'Edit map area' : '+ Choose map area'}
            </button>
          )}
        </div>

        {editingArea && (
          <div style={{
            padding: 12,
            borderRadius: 11,
            border: `1.5px solid ${T.accent}`,
            background: T.bg,
            marginBottom: 10,
          }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: T.text, marginBottom: 4 }}>
              Choose or Edit Trip Map Area
            </div>
            <div style={{ fontSize: 11, color: T.textSub, marginBottom: 8, lineHeight: 1.4 }}>
              Search for your river, trailhead, or destination and frame the area on the map. Saving updates the trip map for everyone on the trip.
            </div>

            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <input
                value={mapSearch}
                onChange={(e) => setMapSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void searchPlace(); }}
                placeholder="Search river, canyon, trailhead, town…"
                style={{
                  flex: 1,
                  height: 36,
                  borderRadius: 9,
                  border: `1px solid ${T.border}`,
                  padding: '0 10px',
                  fontSize: 12,
                  fontFamily: F,
                  background: T.card,
                  color: T.text,
                }}
              />
              <button
                type="button"
                onClick={() => void searchPlace()}
                style={{
                  border: 'none',
                  borderRadius: 9,
                  padding: '0 12px',
                  background: T.accent,
                  color: 'white',
                  fontSize: 11.5,
                  fontWeight: 800,
                  fontFamily: F,
                  cursor: 'pointer',
                }}
              >
                {searching ? '…' : 'Search'}
              </button>
            </div>

            {searchResults.length > 0 && (
              <div style={{
                background: T.card,
                border: `1px solid ${T.border}`,
                borderRadius: 9,
                marginBottom: 8,
                overflow: 'hidden',
              }}>
                {searchResults.map((f) => (
                  <div
                    key={f.id}
                    onClick={() => pickPlace(f)}
                    style={{
                      padding: '8px 10px',
                      fontSize: 11.5,
                      color: T.text,
                      cursor: 'pointer',
                      borderBottom: `1px solid ${T.border}`,
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>{f.text}</div>
                    <div style={{ fontSize: 10, color: T.textFaint }}>{f.place_name}</div>
                  </div>
                ))}
              </div>
            )}

            <input
              value={areaLabel}
              onChange={(e) => setAreaLabel(e.target.value)}
              placeholder="Map label shown to crew (e.g. Rogue River Wild Section)"
              style={{
                width: '100%',
                height: 34,
                borderRadius: 9,
                border: `1px solid ${T.border}`,
                padding: '0 10px',
                fontSize: 11.5,
                fontFamily: F,
                background: T.card,
                color: T.text,
                boxSizing: 'border-box',
                marginBottom: 8,
              }}
            />

            {mapboxgl.accessToken && (
              <div
                ref={mapContainerRef}
                style={{
                  width: '100%',
                  height: 200,
                  borderRadius: 10,
                  overflow: 'hidden',
                  border: `1px solid ${T.border}`,
                  marginBottom: 8,
                }}
              />
            )}

            <div style={{ fontSize: 10, fontWeight: 700, color: T.textSub, textTransform: 'uppercase', marginBottom: 5 }}>
              Offline Detail Level
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              {ZOOM_OPTIONS.map((z) => (
                <button
                  key={z.level}
                  type="button"
                  onClick={() => setMaxZoom(z.level)}
                  style={{
                    flex: 1,
                    padding: '6px 4px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    border: `1.5px solid ${maxZoom === z.level ? T.accent : T.border}`,
                    background: maxZoom === z.level ? T.accentLight : T.card,
                    fontFamily: F,
                  }}
                >
                  <div style={{ fontSize: 10.5, fontWeight: 800, color: maxZoom === z.level ? T.accent : T.text }}>{z.label}</div>
                  <div style={{ fontSize: 9.5, color: T.textFaint }}>~{z.estimateMb} MB</div>
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                onClick={() => void saveCustomMapArea({ downloadImmediately: true })}
                style={{
                  flex: 1,
                  border: 'none',
                  borderRadius: 9,
                  padding: '9px 12px',
                  background: T.accent,
                  color: 'white',
                  fontSize: 11.5,
                  fontWeight: 800,
                  fontFamily: F,
                  cursor: 'pointer',
                }}
              >
                Save as Trip Map & Download
              </button>
              <button
                type="button"
                onClick={() => setEditingArea(false)}
                style={{
                  border: `1px solid ${T.border}`,
                  borderRadius: 9,
                  padding: '9px 12px',
                  background: T.card,
                  color: T.textSub,
                  fontSize: 11.5,
                  fontWeight: 700,
                  fontFamily: F,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {areaId ? (
          <div style={{
            border: `1.5px solid ${areaReady ? '#9FD09F' : `${T.accent}55`}`,
            borderRadius: 10,
            padding: '10px 12px',
            background: areaReady ? '#F3F8F4' : T.accentLight,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: T.text }}>
                  {getTripMapAreaLabel(trip)}
                </div>
                <div style={{ fontSize: 10.5, color: T.textSub, marginTop: 2 }}>
                  Selected trip map area · {areaSizeLabel || 'Custom bounds'}
                </div>
              </div>
              <div style={{
                fontSize: 10,
                fontWeight: 800,
                color: areaReady ? '#2A6A14' : areaDownloading ? '#2A5C8E' : '#9B5118',
                flexShrink: 0,
              }}>
                {areaReady
                  ? '✓ On this device'
                  : areaDownloading
                    ? `Downloading ${areaStatus?.progress || 0}%`
                    : 'Not on this device'}
              </div>
            </div>

            {areaDownloading && (
              <div style={{ marginTop: 8, height: 5, borderRadius: 99, background: T.border, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${areaStatus?.progress || 0}%`,
                  background: T.accent,
                  borderRadius: 99,
                  transition: 'width 0.2s ease',
                }} />
              </div>
            )}

            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              {!areaReady ? (
                <button
                  type="button"
                  onClick={() => !areaDownloading && void handleDownloadArea(trip)}
                  disabled={areaDownloading}
                  style={{
                    flex: 1,
                    border: 'none',
                    borderRadius: 8,
                    padding: '8px 10px',
                    background: T.accent,
                    color: 'white',
                    fontSize: 11,
                    fontWeight: 800,
                    fontFamily: F,
                    cursor: areaDownloading ? 'wait' : 'pointer',
                  }}
                >
                  {areaDownloading ? 'Downloading tiles…' : 'Download to this device'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleVerify(areaId, true)}
                  disabled={verifyId === areaId}
                  style={{
                    flex: 1,
                    border: `1px solid ${T.border}`,
                    borderRadius: 8,
                    padding: '7px 10px',
                    background: T.card,
                    color: T.textSub,
                    fontSize: 10.5,
                    fontWeight: 700,
                    fontFamily: F,
                    cursor: 'pointer',
                  }}
                >
                  {verifyId === areaId ? 'Verifying…' : `✓ Verified on device${formatVerifiedAt(areaStatus?.verifiedAt) ? ` (${formatVerifiedAt(areaStatus?.verifiedAt)})` : ' — Check again'}`}
                </button>
              )}
            </div>
          </div>
        ) : (
          !editingArea && (
            <div style={{
              border: `1px dashed ${T.border}`,
              borderRadius: 10,
              padding: '10px 12px',
              background: T.bg,
              fontSize: 11,
              color: T.textSub,
            }}>
              No custom map area framed yet. Tap <strong>+ Choose map area</strong> above to frame any river, trail, or destination for your crew.
            </div>
          )
        )}
      </div>

      {/* Section 2: Prebuilt Regional Offline Map Packs */}
      {regions.length > 0 && (
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 800, color: T.textSub, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 }}>
            Regional Offline Map Packs
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {regions.map((region) => {
              const st = statuses[region.id] || getRegionDownloadStatus(region.id);
              const isReady = st.state === 'ready' || st.cached;
              const isDownloading = st.state === 'downloading' || busyId === region.id;
              const isVerifying = verifyId === region.id;
              const onTrip = selected.has(region.id);
              const sizeLabel = formatMapBytes(st.bytes) || (region.estimatedMb ? `~${region.estimatedMb} MB` : null);
              const verifiedLabel = formatVerifiedAt(st.verifiedAt || st.updatedAt);
              const justConfirmed = confirmId === region.id && isReady;

              return (
                <div key={region.id} style={{
                  border: `1px solid ${onTrip ? `${T.accent}55` : T.border}`,
                  borderRadius: 10,
                  padding: '10px 12px',
                  background: onTrip ? T.accentLight : T.bg,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 800, color: T.text }}>{region.name}</div>
                      <div style={{ fontSize: 10.5, color: T.textSub, marginTop: 2 }}>{region.area}</div>
                      {sizeLabel && (
                        <div style={{ fontSize: 10, color: T.textFaint, marginTop: 3 }}>{sizeLabel}</div>
                      )}
                    </div>
                    <div style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: isReady ? '#2E6D3A' : isDownloading ? '#2A5C8E' : st.state === 'error' ? '#8A1414' : T.textFaint,
                      flexShrink: 0,
                      textAlign: 'right',
                    }}>
                      {isReady ? '✓ On device' : isDownloading ? `${st.progress || 0}%` : st.state === 'error' ? 'Failed' : 'Not on device'}
                    </div>
                  </div>

                  {isDownloading && (
                    <div style={{ marginTop: 8, height: 5, borderRadius: 99, background: T.border, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%',
                        width: `${st.progress || 0}%`,
                        background: T.accent,
                        borderRadius: 99,
                        transition: 'width 0.2s ease',
                      }} />
                    </div>
                  )}

                  {isReady && (
                    <div style={{
                      marginTop: 8,
                      padding: '9px 10px',
                      borderRadius: 9,
                      background: justConfirmed ? '#E2F4E2' : '#F3F8F4',
                      border: `1px solid ${justConfirmed ? '#9FD09F' : '#C8DFC8'}`,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                        <div style={{
                          width: 22,
                          height: 22,
                          borderRadius: '50%',
                          background: '#2A6A14',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}>
                          <Ic d="M20 6L9 17l-5-5" size={12} color="white" sw={3} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 11.5, fontWeight: 800, color: '#2A6A14' }}>
                            {justConfirmed ? 'Download complete' : 'Stored on this device'}
                          </div>
                          <div style={{ fontSize: 10.5, color: T.textSub, marginTop: 2, lineHeight: 1.4 }}>
                            {sizeLabel ? `${sizeLabel}` : 'Map pack verified'}
                            {verifiedLabel ? ` · ${verifiedLabel}` : ''}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleVerify(region.id, false)}
                        disabled={isVerifying}
                        style={{
                          marginTop: 8,
                          width: '100%',
                          border: `1px solid ${T.border}`,
                          borderRadius: 8,
                          background: T.card,
                          padding: '7px 10px',
                          fontSize: 10.5,
                          fontWeight: 700,
                          fontFamily: F,
                          color: T.textSub,
                          cursor: isVerifying ? 'wait' : 'pointer',
                        }}
                      >
                        {isVerifying ? 'Checking…' : 'Verify download again'}
                      </button>
                    </div>
                  )}

                  {!isReady && (
                    <button
                      type="button"
                      onClick={() => !isDownloading && void handleDownload(region.id)}
                      disabled={isDownloading}
                      style={{
                        marginTop: 8,
                        width: '100%',
                        textAlign: 'center',
                        padding: '8px 10px',
                        borderRadius: 8,
                        border: 'none',
                        background: T.accent,
                        color: 'white',
                        fontSize: 11,
                        fontWeight: 800,
                        fontFamily: F,
                        cursor: isDownloading ? 'wait' : 'pointer',
                        opacity: isDownloading ? 0.7 : 1,
                      }}
                    >
                      {isDownloading ? 'Downloading to this device…' : 'Download to this device'}
                    </button>
                  )}

                  {trip?.id && (
                    <button
                      type="button"
                      onClick={() => void toggleTripRegion(region.id)}
                      style={{
                        marginTop: 8,
                        width: '100%',
                        textAlign: 'center',
                        padding: '7px 10px',
                        borderRadius: 8,
                        border: `1px solid ${onTrip ? T.accent : T.border}`,
                        background: onTrip ? T.accentLight : T.card,
                        color: onTrip ? T.accent : T.textSub,
                        fontSize: 10.5,
                        fontWeight: 700,
                        fontFamily: F,
                        cursor: 'pointer',
                      }}
                    >
                      {onTrip ? '✓ Selected for this trip (crew prompted to download)' : 'Select for this trip & download'}
                    </button>
                  )}

                  {st.state === 'error' && (
                    <div style={{ fontSize: 10, color: '#8A1414', marginTop: 6 }}>{st.error}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
