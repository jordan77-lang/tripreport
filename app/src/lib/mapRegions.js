/**
 * Offline map regions — local fallback when Supabase is unavailable.
 * Main Salmon River: Corn Creek launch through Riggins corridor.
 */

export const MAIN_SALMON_RIVER = {
  id: 'main-salmon-river',
  name: 'Main Salmon River',
  description: 'Wilderness section from Corn Creek (launch) through Riggins area.',
  river: 'Salmon River',
  bounds: {
    sw: { lat: 44.95, lng: -116.55 },
    ne: { lat: 46.05, lng: -114.15 },
  },
  center: { lat: 45.45, lng: -115.35 },
  default_zoom: 9,
  pmtiles_path: '/maps/main-salmon-river.pmtiles',
  size_mb: null,
  active: true,
  sort_order: 1,
  // Key launch / take-out references for planning UI
  landmarks: [
    { name: 'Corn Creek Launch', lat: 45.385, lng: -114.859 },
    { name: 'Loon Creek', lat: 45.47, lng: -115.12 },
    { name: 'Campbell\'s Ferry', lat: 45.52, lng: -115.28 },
    { name: 'Riggins (take-out area)', lat: 45.42, lng: -116.32 },
  ],
};

export const LOCAL_MAP_REGIONS = [MAIN_SALMON_RIVER];

export function getMapRegion(id) {
  return LOCAL_MAP_REGIONS.find((r) => r.id === id) || null;
}

export function normalizeMapRegion(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    river: row.river,
    bounds: row.bounds,
    center: row.center,
    default_zoom: row.default_zoom,
    pmtiles_path: row.pmtiles_path,
    size_mb: row.size_mb,
    active: row.active,
    sort_order: row.sort_order,
    landmarks: row.landmarks || getMapRegion(row.id)?.landmarks || [],
  };
}
