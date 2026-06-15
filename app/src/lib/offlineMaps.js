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
  return map[regionId] || { state: 'idle', progress: 0, updatedAt: null, bytes: 0 };
}

function setRegionDownloadStatus(regionId, patch) {
  const map = readStatusMap();
  map[regionId] = { ...getRegionDownloadStatus(regionId), ...patch, updatedAt: Date.now() };
  writeStatusMap(map);
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
    setRegionDownloadStatus(regionId, { state: 'ready', progress: 100 });
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
      setRegionDownloadStatus(regionId, { state: 'ready', progress: 100, bytes: total || null });
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

    setRegionDownloadStatus(regionId, { state: 'ready', progress: 100, bytes: blob.size });
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
