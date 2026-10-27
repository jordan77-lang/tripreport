import { getMapRegion, listMapRegions } from './mapRegions';

const CACHE_NAME = 'tripreport-offline-maps-v1';
const STATUS_KEY = 'tr_offline_map_status';

function resolvePmtilesUrl(region) {
  const path = region.pmtilesPath || region.pmtiles_path;
  if (!path) return null;
  if (path.startsWith('http')) return path;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}${path.startsWith('/') ? path : `/${path}`}`;
}

function readStatusMap() {
  try {
    return JSON.parse(localStorage.getItem(STATUS_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeStatusMap(map) {
  localStorage.setItem(STATUS_KEY, JSON.stringify(map));
}

export function getRegionDownloadStatus(regionId) {
  const map = readStatusMap();
  return map[regionId] || { state: 'idle', progress: 0, updatedAt: null, bytes: 0, verifiedAt: null };
}

function setRegionDownloadStatus(regionId, patch) {
  const map = readStatusMap();
  map[regionId] = { ...getRegionDownloadStatus(regionId), ...patch, updatedAt: Date.now() };
  writeStatusMap(map);
}

export function formatMapBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(n >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

/** Re-check the Cache API and refresh stored status for one region. */
export async function verifyRegionDownload(regionId) {
  const cached = await isRegionCached(regionId);
  const prev = getRegionDownloadStatus(regionId);
  if (cached) {
    setRegionDownloadStatus(regionId, {
      state: 'ready',
      progress: 100,
      verifiedAt: Date.now(),
      bytes: prev.bytes || null,
    });
    return {
      ok: true,
      cached: true,
      bytes: prev.bytes || null,
      verifiedAt: Date.now(),
    };
  }
  setRegionDownloadStatus(regionId, {
    state: prev.state === 'downloading' ? 'downloading' : 'idle',
    verifiedAt: null,
  });
  return { ok: false, cached: false };
}

export async function isRegionCached(regionId) {
  if (typeof caches === 'undefined') return false;
  const region = getMapRegion(regionId);
  const url = region ? resolvePmtilesUrl(region) : null;
  if (!url) return false;
  const cache = await caches.open(CACHE_NAME);
  const match = await cache.match(url);
  return Boolean(match);
}

export async function getCachedPmtilesBlobUrl(regionId) {
  if (typeof caches === 'undefined') return null;
  const region = getMapRegion(regionId);
  const url = region ? resolvePmtilesUrl(region) : null;
  if (!url) return null;

  const cache = await caches.open(CACHE_NAME);
  const match = await cache.match(url);
  if (!match) return null;

  const blob = await match.blob();
  return URL.createObjectURL(blob);
}

export async function preloadMapRegion(regionId, { onProgress } = {}) {
  const region = getMapRegion(regionId);
  if (!region) throw new Error('Unknown map region');

  const url = resolvePmtilesUrl(region);
  if (!url) throw new Error('This region has no map file configured');

  if (await isRegionCached(regionId)) {
    setRegionDownloadStatus(regionId, { state: 'ready', progress: 100, verifiedAt: Date.now() });
    return { regionId, cached: true };
  }

  setRegionDownloadStatus(regionId, { state: 'downloading', progress: 0 });

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Map file not available (${response.status})`);
    }

    const total = Number(response.headers.get('content-length')) || 0;
    const reader = response.body?.getReader();
    const cache = await caches.open(CACHE_NAME);

    if (!reader) {
      await cache.put(url, response.clone());
      setRegionDownloadStatus(regionId, { state: 'ready', progress: 100, bytes: total || null, verifiedAt: Date.now() });
      return { regionId, cached: false };
    }

    const chunks = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      const progress = total ? Math.min(99, Math.round((received / total) * 100)) : 0;
      setRegionDownloadStatus(regionId, { state: 'downloading', progress, bytes: received });
      onProgress?.(progress, received, total);
    }

    const blob = new Blob(chunks, { type: 'application/vnd.pmtiles' });
    await cache.put(url, new Response(blob, {
      headers: {
        'content-type': 'application/vnd.pmtiles',
        'content-length': String(blob.size),
      },
    }));

    setRegionDownloadStatus(regionId, { state: 'ready', progress: 100, bytes: blob.size, verifiedAt: Date.now() });
    return { regionId, cached: false, bytes: blob.size };
  } catch (e) {
    setRegionDownloadStatus(regionId, { state: 'error', progress: 0, error: e?.message || 'Download failed' });
    throw e;
  }
}

function extractMapArea(tripOrArea) {
  if (!tripOrArea || typeof tripOrArea !== 'object') return null;
  const area = tripOrArea.mapArea ? tripOrArea.mapArea : tripOrArea;
  if (!area || typeof area !== 'object') return null;
  const sw = area.sw;
  const ne = area.ne;
  const center = area.center;
  if (sw && Number.isFinite(sw.lat) && Number.isFinite(sw.lng) && ne && Number.isFinite(ne.lat) && Number.isFinite(ne.lng)) {
    return area;
  }
  if (center && Number.isFinite(center.lat) && Number.isFinite(center.lng)) {
    return {
      ...area,
      sw: { lat: center.lat - 0.12, lng: center.lng - 0.15 },
      ne: { lat: center.lat + 0.12, lng: center.lng + 0.15 },
    };
  }
  return null;
}

export function getTripMapAreaId(tripOrArea) {
  const area = extractMapArea(tripOrArea);
  if (!area) return null;
  const swLat = Number(area.sw.lat).toFixed(2);
  const swLng = Number(area.sw.lng).toFixed(2);
  const neLat = Number(area.ne.lat).toFixed(2);
  const neLng = Number(area.ne.lng).toFixed(2);
  const maxZ = Math.min(13, Math.max(8, Number(area.maxZoom) || 12));
  return `area:${swLat},${swLng}:${neLat},${neLng}:z${maxZ}`;
}

export function getTripMapAreaLabel(trip) {
  const area = extractMapArea(trip);
  if (area?.label && String(area.label).trim()) return String(area.label).trim();
  if (trip?.location && String(trip.location).trim()) return String(trip.location).trim();
  if (trip?.name && String(trip.name).trim()) return `${String(trip.name).trim()} map area`;
  return 'Custom trip map area';
}

function lng2tile(lng, z) {
  return Math.floor(((lng + 180) / 360) * Math.pow(2, z));
}

function lat2tile(lat, z) {
  const clamped = Math.max(-85.0511, Math.min(85.0511, lat));
  const rad = (clamped * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, z),
  );
}

export function getTripMapAreaTiles(tripOrArea, { maxTiles = 220 } = {}) {
  const area = extractMapArea(tripOrArea);
  if (!area) return [];
  const minLat = Math.min(area.sw.lat, area.ne.lat);
  const maxLat = Math.max(area.sw.lat, area.ne.lat);
  const minLng = Math.min(area.sw.lng, area.ne.lng);
  const maxLng = Math.max(area.sw.lng, area.ne.lng);
  const maxZ = Math.min(13, Math.max(9, Number(area.maxZoom) || 12));
  const tiles = [];

  for (let z = 8; z <= maxZ; z += 1) {
    const xMin = lng2tile(minLng, z);
    const xMax = lng2tile(maxLng, z);
    const yMin = lat2tile(maxLat, z);
    const yMax = lat2tile(minLat, z);
    for (let x = xMin; x <= xMax; x += 1) {
      for (let y = yMin; y <= yMax; y += 1) {
        tiles.push({ z, x, y });
        if (tiles.length >= maxTiles) return tiles;
      }
    }
  }
  return tiles;
}

export function cachedTileKey(z, x, y) {
  return `https://offline.tripreport.local/tiles/${z}/${x}/${y}.png`;
}

export function remoteTileUrl(z, x, y) {
  return `https://basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}.png`;
}

export async function getCachedTileBuffer(z, x, y) {
  if (typeof caches === 'undefined') return null;
  const cache = await caches.open(CACHE_NAME);
  const key = cachedTileKey(z, x, y);
  const hit = await cache.match(key);
  if (hit) {
    return hit.arrayBuffer();
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return null;
  }
  try {
    const res = await fetch(remoteTileUrl(z, x, y), { mode: 'cors' });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    await cache.put(
      key,
      new Response(buf.slice(0), {
        headers: {
          'content-type': 'image/png',
          'content-length': String(buf.byteLength),
        },
      }),
    );
    return buf;
  } catch {
    return null;
  }
}

export async function isTripMapAreaCached(tripOrArea) {
  if (typeof caches === 'undefined') return false;
  const areaId = getTripMapAreaId(tripOrArea);
  if (!areaId) return false;
  const tiles = getTripMapAreaTiles(tripOrArea);
  if (!tiles.length) return false;
  const cache = await caches.open(CACHE_NAME);
  const first = await cache.match(cachedTileKey(tiles[0].z, tiles[0].x, tiles[0].y));
  const last = await cache.match(cachedTileKey(tiles[tiles.length - 1].z, tiles[tiles.length - 1].x, tiles[tiles.length - 1].y));
  return Boolean(first && last);
}

export async function verifyTripMapAreaDownload(tripOrArea) {
  const areaId = getTripMapAreaId(tripOrArea);
  if (!areaId) return { ok: false, cached: false };
  const cached = await isTripMapAreaCached(tripOrArea);
  const prev = getRegionDownloadStatus(areaId);
  if (cached) {
    setRegionDownloadStatus(areaId, {
      state: 'ready',
      progress: 100,
      verifiedAt: Date.now(),
      bytes: prev.bytes || null,
    });
    return { ok: true, cached: true, bytes: prev.bytes || null, verifiedAt: Date.now() };
  }
  setRegionDownloadStatus(areaId, {
    state: prev.state === 'downloading' ? 'downloading' : 'idle',
    verifiedAt: null,
  });
  return { ok: false, cached: false };
}

export async function preloadTripMapArea(tripOrArea, { onProgress } = {}) {
  const areaId = getTripMapAreaId(tripOrArea);
  if (!areaId) throw new Error('No map area selected for this trip');
  const tiles = getTripMapAreaTiles(tripOrArea);
  if (!tiles.length) throw new Error('Map area has no downloadable tiles');

  if (await isTripMapAreaCached(tripOrArea)) {
    const prev = getRegionDownloadStatus(areaId);
    setRegionDownloadStatus(areaId, {
      state: 'ready',
      progress: 100,
      verifiedAt: Date.now(),
      bytes: prev.bytes || tiles.length * 18432,
      tileCount: tiles.length,
    });
    return { areaId, cached: true, tileCount: tiles.length };
  }

  setRegionDownloadStatus(areaId, { state: 'downloading', progress: 0, tileCount: tiles.length });

  try {
    const cache = await caches.open(CACHE_NAME);
    let completed = 0;
    let totalBytes = 0;
    const batchSize = 8;

    for (let i = 0; i < tiles.length; i += batchSize) {
      const slice = tiles.slice(i, i + batchSize);
      await Promise.all(
        slice.map(async ({ z, x, y }) => {
          const key = cachedTileKey(z, x, y);
          const existing = await cache.match(key);
          if (existing) {
            const len = Number(existing.headers.get('content-length')) || 16384;
            totalBytes += len;
          } else {
            const res = await fetch(remoteTileUrl(z, x, y), { mode: 'cors' });
            if (!res.ok) throw new Error(`Tile fetch failed (${res.status})`);
            const buf = await res.arrayBuffer();
            totalBytes += buf.byteLength;
            await cache.put(
              key,
              new Response(buf, {
                headers: {
                  'content-type': 'image/png',
                  'content-length': String(buf.byteLength),
                },
              }),
            );
          }
          completed += 1;
        }),
      );
      const progress = Math.min(99, Math.round((completed / tiles.length) * 100));
      setRegionDownloadStatus(areaId, { state: 'downloading', progress, bytes: totalBytes, tileCount: tiles.length });
      onProgress?.(progress, totalBytes, tiles.length);
    }

    setRegionDownloadStatus(areaId, {
      state: 'ready',
      progress: 100,
      bytes: totalBytes,
      tileCount: tiles.length,
      verifiedAt: Date.now(),
    });
    onProgress?.(100, totalBytes, tiles.length);
    return { areaId, cached: false, bytes: totalBytes, tileCount: tiles.length };
  } catch (e) {
    setRegionDownloadStatus(areaId, {
      state: 'error',
      progress: 0,
      error: e?.message || 'Map area download failed',
    });
    throw e;
  }
}

export async function preloadMapRegions(regionIds = [], options = {}) {
  const results = [];
  for (const id of regionIds) {
    try {
      results.push(await preloadMapRegion(id, options));
    } catch (e) {
      results.push({ regionId: id, error: e?.message || 'Failed' });
    }
  }
  return results;
}

/** Download all maps selected for a trip (both custom mapArea and any catalog offlineRegions) onto this device. */
export async function preloadAllTripMaps(trip, { onProgress } = {}) {
  if (!trip) return [];
  const results = [];
  const ids = trip.offlineRegions || [];
  for (const id of ids) {
    try {
      results.push(await preloadMapRegion(id, { onProgress }));
    } catch (e) {
      results.push({ regionId: id, error: e?.message || 'Failed' });
    }
  }
  const areaId = getTripMapAreaId(trip);
  if (areaId) {
    try {
      results.push(await preloadTripMapArea(trip, { onProgress }));
    } catch (e) {
      results.push({ areaId, error: e?.message || 'Failed' });
    }
  }
  return results;
}

/** Background preload of all catalog regions (silent, non-blocking). */
export async function preloadAllCatalogRegions(options = {}) {
  return preloadMapRegions(listMapRegions().map((r) => r.id), options);
}

export async function resolveOfflineMapForTrip(trip) {
  const ids = trip?.offlineRegions || [];
  for (const id of ids) {
    if (await isRegionCached(id)) {
      const blobUrl = await getCachedPmtilesBlobUrl(id);
      if (blobUrl) {
        return { kind: 'pmtiles', regionId: id, blobUrl, region: getMapRegion(id) };
      }
    }
  }
  const area = extractMapArea(trip);
  if (area && (await isTripMapAreaCached(trip))) {
    return {
      kind: 'cached-area',
      areaId: getTripMapAreaId(trip),
      mapArea: area,
      center: area.center,
    };
  }
  return null;
}

export function pickMapRegionForTrip(trip) {
  const ids = trip?.offlineRegions || [];
  if (!ids.length) return null;
  return getMapRegion(ids[0]);
}

/** Whether trip's selected offline packs and/or custom mapArea are actually stored on this device. */
export async function getTripOfflineMapReadiness(trip) {
  const ids = trip?.offlineRegions || [];
  const area = extractMapArea(trip);
  const areaId = getTripMapAreaId(trip);

  if (!ids.length && !areaId) {
    return {
      configured: false,
      ready: false,
      anyCached: false,
      regions: [],
      missingCount: 0,
      totalCount: 0,
      primaryLabel: null,
    };
  }

  const regions = [];
  for (const id of ids) {
    const region = getMapRegion(id);
    const cached = await isRegionCached(id);
    const status = getRegionDownloadStatus(id);
    regions.push({
      id,
      kind: 'region',
      name: region?.name || id,
      area: region?.area || '',
      estimatedMb: region?.estimatedMb || null,
      cached,
      state: cached ? 'ready' : status.state,
      progress: cached ? 100 : (status.progress || 0),
      bytes: status.bytes || null,
      verifiedAt: status.verifiedAt || (cached ? status.updatedAt : null),
    });
  }

  if (areaId && area) {
    const cached = await isTripMapAreaCached(trip);
    const status = getRegionDownloadStatus(areaId);
    const tiles = getTripMapAreaTiles(trip);
    const estMb = Math.max(1, Math.round((tiles.length * 18) / 1024));
    regions.push({
      id: areaId,
      kind: 'area',
      name: getTripMapAreaLabel(trip),
      area: `Zoom up to z${Math.min(13, Math.max(9, Number(area.maxZoom) || 12))} · ${tiles.length} tiles`,
      estimatedMb: estMb,
      cached,
      state: cached ? 'ready' : status.state,
      progress: cached ? 100 : (status.progress || 0),
      bytes: status.bytes || null,
      verifiedAt: status.verifiedAt || (cached ? status.updatedAt : null),
    });
  }

  const missingCount = regions.filter((r) => !r.cached).length;
  return {
    configured: true,
    ready: regions.length > 0 && missingCount === 0,
    anyCached: regions.some((r) => r.cached),
    regions,
    missingCount,
    totalCount: regions.length,
    primaryLabel: regions.map((r) => r.name).join(' + '),
  };
}
