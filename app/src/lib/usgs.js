// USGS Water Services API — live gauge data
// Docs: https://waterservices.usgs.gov/rest/IV-Service.html

const BASE = 'https://waterservices.usgs.gov/nwis/iv/';

function buildIvUrl(params) {
  const url = new URL(BASE);
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== '') url.searchParams.set(k, String(v));
  });
  return url.toString();
}

async function fetchJson(url, context) {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const details = body ? ` :: ${body.slice(0, 220)}` : '';
    throw new Error(`${context} failed (${res.status})${details}`);
  }
  return res.json();
}

// Fetch current flow (CFS) and gauge height (ft) for a site
export async function fetchGauge(siteId) {
  const url = buildIvUrl({
    format: 'json',
    sites: siteId,
    parameterCd: '00060,00065',
    siteStatus: 'active',
  });
  const data = await fetchJson(url, 'USGS gauge fetch');

  const series = data?.value?.timeSeries ?? [];
  const result = { siteId, siteName: null, cfs: null, gaugeHt: null, updatedAt: null };

  for (const s of series) {
    const code = s.variable?.variableCode?.[0]?.value;
    const val  = parseFloat(s.values?.[0]?.value?.[0]?.value);
    const dt   = s.values?.[0]?.value?.[0]?.dateTime;
    result.siteName = result.siteName || s.sourceInfo?.siteName;
    result.updatedAt = result.updatedAt || dt;
    if (code === '00060') result.cfs = isNaN(val) ? null : val;
    if (code === '00065') result.gaugeHt = isNaN(val) ? null : val;
  }
  return result;
}

// Fetch 7-day historical values for sparkline chart
export async function fetchGaugeHistory(siteId, days = 7, parameterCd = '00060') {
  const end = new Date();
  const start = new Date(end - days * 864e5);
  return fetchGaugeHistoryRange(siteId, start, end, parameterCd);
}

export async function fetchGaugeHistoryRange(siteId, startDate, endDate, parameterCd = '00060') {
  const start = startDate instanceof Date ? startDate : new Date(startDate);
  const end = endDate instanceof Date ? endDate : new Date(endDate);
  const fmt = d => d.toISOString().split('T')[0];
  const url = buildIvUrl({
    format: 'json',
    sites: siteId,
    parameterCd,
    startDT: fmt(start),
    endDT: fmt(end),
  });
  const data = await fetchJson(url, 'USGS history fetch');
  const values = data?.value?.timeSeries?.[0]?.values?.[0]?.value ?? [];
  return values
    .filter((_, i) => i % 4 === 0) // sample every 4th point (~hourly → 6-hourly)
    .map(v => ({ ts: v.dateTime, value: parseFloat(v.value) }))
    .filter(v => !isNaN(v.value));
}

// Common gauge IDs for quick access
export const KNOWN_GAUGES = [
  { id: '09498500', name: 'Salt River above Canyon Lake, AZ', lat: 33.521, lng: -111.442 },
  { id: '09380000', name: 'Colorado River at Lees Ferry, AZ', lat: 36.864, lng: -111.586 },
  { id: '09402500', name: 'Little Colorado River, AZ', lat: 35.936, lng: -111.582 },
  { id: '14138900', name: 'Sandy River near Marmot, OR', lat: 45.396, lng: -122.131 },
];

export function findNearbyKnownGauges(lat, lng, { limit = 3, maxMiles = 200 } = {}) {
  if (lat == null || lng == null) return [];
  return KNOWN_GAUGES
    .filter(g => g.lat != null && g.lng != null)
    .map(g => ({
      ...g,
      distanceMiles: haversineMiles(lat, lng, g.lat, g.lng),
    }))
    .filter(g => g.distanceMiles <= maxMiles)
    .sort((a, b) => a.distanceMiles - b.distanceMiles)
    .slice(0, limit);
}

export async function fetchNearbyGaugesByGps(lat, lng, { radiusMiles = 50, limit = 10 } = {}) {
  if (lat == null || lng == null) return [];
  const bbox = buildBbox(lat, lng, radiusMiles);
  const url = buildIvUrl({
    format: 'json',
    bBox: `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`,
    parameterCd: '00060,00065',
    siteStatus: 'active',
  });
  const data = await fetchJson(url, 'USGS nearby gauges fetch');
  const series = data?.value?.timeSeries ?? [];

  const bySite = new Map();
  for (const s of series) {
    const siteNo = s.sourceInfo?.siteCode?.[0]?.value;
    if (!siteNo) continue;
    const siteName = s.sourceInfo?.siteName || siteNo;
    const siteLat = parseFloat(s.sourceInfo?.geoLocation?.geogLocation?.latitude);
    const siteLng = parseFloat(s.sourceInfo?.geoLocation?.geogLocation?.longitude);
    const code = s.variable?.variableCode?.[0]?.value;
    const value = parseFloat(s.values?.[0]?.value?.[0]?.value);
    const updatedAt = s.values?.[0]?.value?.[0]?.dateTime || null;

    const existing = bySite.get(siteNo) || {
      id: siteNo,
      name: siteName,
      lat: Number.isFinite(siteLat) ? siteLat : null,
      lng: Number.isFinite(siteLng) ? siteLng : null,
      cfs: null,
      gaugeHt: null,
      updatedAt: null,
    };
    if (code === '00060' && Number.isFinite(value)) existing.cfs = value;
    if (code === '00065' && Number.isFinite(value)) existing.gaugeHt = value;
    existing.updatedAt = existing.updatedAt || updatedAt;
    bySite.set(siteNo, existing);
  }

  return Array.from(bySite.values())
    .filter(g => g.lat != null && g.lng != null)
    .map(g => ({ ...g, distanceMiles: haversineMiles(lat, lng, g.lat, g.lng) }))
    .sort((a, b) => a.distanceMiles - b.distanceMiles)
    .slice(0, limit);
}

export async function fetchGaugeStationsByBbox(lat, lng, { radiusMiles = 150, limit = 40 } = {}) {
  if (lat == null || lng == null) return [];
  const bbox = buildBbox(lat, lng, radiusMiles);
  const url = new URL('https://waterservices.usgs.gov/nwis/site/');
  url.searchParams.set('format', 'rdb');
  url.searchParams.set('siteOutput', 'expanded');
  url.searchParams.set('hasDataTypeCd', 'iv');
  url.searchParams.set('bBox', `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const details = body ? ` :: ${body.slice(0, 220)}` : '';
    throw new Error(`USGS bbox station search failed (${res.status})${details}`);
  }

  const raw = await res.text();
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l && !l.startsWith('#'));
  if (!lines.length) return [];

  const header = lines[0].split('\t');
  const dataLines = lines.slice(2);
  const idx = {
    id: header.indexOf('site_no'),
    name: header.indexOf('station_nm'),
    lat: header.indexOf('dec_lat_va'),
    lng: header.indexOf('dec_long_va'),
  };
  if (idx.id < 0 || idx.name < 0) return [];

  const out = [];
  const seen = new Set();
  for (const line of dataLines) {
    const cols = line.split('\t');
    const id = cols[idx.id];
    const name = cols[idx.name];
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    const siteLat = idx.lat >= 0 ? parseFloat(cols[idx.lat]) : NaN;
    const siteLng = idx.lng >= 0 ? parseFloat(cols[idx.lng]) : NaN;
    const latNum = Number.isFinite(siteLat) ? siteLat : null;
    const lngNum = Number.isFinite(siteLng) ? siteLng : null;
    out.push({
      id,
      name,
      lat: latNum,
      lng: lngNum,
      distanceMiles: latNum != null && lngNum != null ? haversineMiles(lat, lng, latNum, lngNum) : null,
    });
    if (out.length >= limit) break;
  }

  return out.sort((a, b) => (a.distanceMiles ?? Number.POSITIVE_INFINITY) - (b.distanceMiles ?? Number.POSITIVE_INFINITY));
}

export async function fetchGaugeStationsByText(text, { limit = 40 } = {}) {
  const q = String(text || '').trim();
  if (!q) return [];

  const url = new URL('https://waterservices.usgs.gov/nwis/site/');
  url.searchParams.set('format', 'rdb');
  url.searchParams.set('siteOutput', 'expanded');
  url.searchParams.set('siteName', q);
  url.searchParams.set('hasDataTypeCd', 'iv');

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const details = body ? ` :: ${body.slice(0, 220)}` : '';
    throw new Error(`USGS station search failed (${res.status})${details}`);
  }

  const raw = await res.text();
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l && !l.startsWith('#'));
  if (!lines.length) return [];

  const header = lines[0].split('\t');
  const dataLines = lines.slice(2); // skip header + field-format line
  const idx = {
    id: header.indexOf('site_no'),
    name: header.indexOf('station_nm'),
    lat: header.indexOf('dec_lat_va'),
    lng: header.indexOf('dec_long_va'),
  };

  if (idx.id < 0 || idx.name < 0) return [];

  const out = [];
  const seen = new Set();
  for (const line of dataLines) {
    const cols = line.split('\t');
    const id = cols[idx.id];
    const name = cols[idx.name];
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    const lat = idx.lat >= 0 ? parseFloat(cols[idx.lat]) : NaN;
    const lng = idx.lng >= 0 ? parseFloat(cols[idx.lng]) : NaN;
    out.push({
      id,
      name,
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
    });
    if (out.length >= limit) break;
  }

  return out;
}

function buildBbox(lat, lng, radiusMiles) {
  // USGS rejects bounding boxes larger than ~8 degrees on any side
  const clampedMiles = Math.min(radiusMiles, 500);
  const latDelta = Math.min(clampedMiles / 69, 7.5);
  const lngDelta = Math.min(clampedMiles / (Math.cos((lat * Math.PI) / 180) * 69 || 1), 7.5);
  return {
    south: Math.max(lat - latDelta, -90),
    north: Math.min(lat + latDelta, 90),
    west: Math.max(lng - lngDelta, -180),
    east: Math.min(lng + lngDelta, 180),
  };
}

function haversineMiles(lat1, lng1, lat2, lng2) {
  const R = 6371; // km
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const km = R * c;
  return km * 0.621371;
}

function toRad(deg) {
  return deg * Math.PI / 180;
}
