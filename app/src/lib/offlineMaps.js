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
  const region = getMapRegion(regionId);
  const url = region ? resolvePmtilesUrl(region) : null;
  if (!url) return false;
  const cache = await caches.open(CACHE_NAME);
  const match = await cache.match(url);
  return Boolean(match);
}

export async function getCachedPmtilesBlobUrl(regionId) {
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
        return { regionId: id, blobUrl, region: getMapRegion(id) };
      }
    }
  }
  return null;
}

export function pickMapRegionForTrip(trip) {
  const ids = trip?.offlineRegions || [];
  if (!ids.length) return null;
  return getMapRegion(ids[0]);
}

/** Whether trip's selected offline packs are actually on this device. */
export async function getTripOfflineMapReadiness(trip) {
  const ids = trip?.offlineRegions || [];
  if (!ids.length) {
    return { configured: false, ready: false, anyCached: false, regions: [] };
  }

  const regions = [];
  for (const id of ids) {
    const region = getMapRegion(id);
    const cached = await isRegionCached(id);
    const status = getRegionDownloadStatus(id);
    regions.push({
      id,
      name: region?.name || id,
      cached,
      bytes: status.bytes || null,
      verifiedAt: status.verifiedAt || (cached ? status.updatedAt : null),
    });
  }

  return {
    configured: true,
    ready: regions.length > 0 && regions.every((r) => r.cached),
    anyCached: regions.some((r) => r.cached),
    regions,
  };
}
