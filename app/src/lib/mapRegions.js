/**
 * Catalog of downloadable offline map regions.
 * Trips opt in via offlineRegions[] — the app is not tied to any single area.
 */

export const OFFLINE_MAP_REGIONS = [
  {
    id: 'main-salmon-river',
    name: 'Main Salmon River',
    description: 'Idaho wilderness river corridor — Corn Creek through Riggins.',
    area: 'Idaho, USA',
    activityTags: ['Rafting', 'River Camping', 'Paddling'],
    bounds: {
      sw: { lat: 44.95, lng: -116.55 },
      ne: { lat: 46.05, lng: -114.15 },
    },
    center: { lat: 45.45, lng: -115.35 },
    defaultZoom: 9,
    pmtilesPath: '/maps/main-salmon-river.pmtiles',
    estimatedMb: 85,
    sortOrder: 1,
  },
];

export function listMapRegions() {
  return [...OFFLINE_MAP_REGIONS].sort((a, b) => a.sortOrder - b.sortOrder);
}

export function getMapRegion(id) {
  return OFFLINE_MAP_REGIONS.find((r) => r.id === id) || null;
}

export function normalizeMapRegion(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    area: row.river || row.area,
    activityTags: row.activity_tags || row.activityTags || [],
    bounds: row.bounds,
    center: row.center,
    defaultZoom: row.default_zoom ?? row.defaultZoom ?? 10,
    pmtilesPath: row.pmtiles_path || row.pmtilesPath,
    estimatedMb: row.size_mb ?? row.estimatedMb ?? null,
    sortOrder: row.sort_order ?? row.sortOrder ?? 0,
  };
}

export function regionMatchesTripTypes(region, tripTypes = []) {
  if (!region.activityTags?.length || !tripTypes?.length) return true;
  return tripTypes.some((t) => region.activityTags.includes(t));
}
