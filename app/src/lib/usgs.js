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
  { id: '13317000', name: 'Salmon River at White Bird, ID', lat: 45.761, lng: -116.301 },
  { id: '13307000', name: 'Salmon River near Shoup, ID', lat: 45.384, lng: -114.348 },
  { id: '13302500', name: 'Salmon River at Salmon, ID', lat: 45.176, lng: -113.895 },
  { id: '13314300', name: 'South Fork Salmon River at Mouth near Mackay Bar, ID', lat: 45.417, lng: -115.283 },
  { id: '13310700', name: 'South Fork Salmon River near Krassel Ranger Station, ID', lat: 44.948, lng: -115.653 },
];

const US_STATE_CODES = {
  alabama: 'al', al: 'al',
  alaska: 'ak', ak: 'ak',
  arizona: 'az', az: 'az',
  arkansas: 'ar', ar: 'ar',
  california: 'ca', ca: 'ca',
  colorado: 'co', co: 'co',
  connecticut: 'ct', ct: 'ct',
  delaware: 'de', de: 'de',
  'district of columbia': 'dc', dc: 'dc',
  florida: 'fl', fl: 'fl',
  georgia: 'ga', ga: 'ga',
  hawaii: 'hi', hi: 'hi',
  idaho: 'id', id: 'id',
  illinois: 'il', il: 'il',
  indiana: 'in', in: 'in',
  iowa: 'ia', ia: 'ia',
  kansas: 'ks', ks: 'ks',
  kentucky: 'ky', ky: 'ky',
  louisiana: 'la', la: 'la',
  maine: 'me', me: 'me',
  maryland: 'md', md: 'md',
  massachusetts: 'ma', ma: 'ma',
  michigan: 'mi', mi: 'mi',
  minnesota: 'mn', mn: 'mn',
  mississippi: 'ms', ms: 'ms',
  missouri: 'mo', mo: 'mo',
  montana: 'mt', mt: 'mt',
  nebraska: 'ne', ne: 'ne',
  nevada: 'nv', nv: 'nv',
  'new hampshire': 'nh', nh: 'nh',
  'new jersey': 'nj', nj: 'nj',
  'new mexico': 'nm', nm: 'nm',
  'new york': 'ny', ny: 'ny',
  'north carolina': 'nc', nc: 'nc',
  'north dakota': 'nd', nd: 'nd',
  ohio: 'oh', oh: 'oh',
  oklahoma: 'ok', ok: 'ok',
  oregon: 'or', or: 'or',
  pennsylvania: 'pa', pa: 'pa',
  'rhode island': 'ri', ri: 'ri',
  'south carolina': 'sc', sc: 'sc',
  'south dakota': 'sd', sd: 'sd',
  tennessee: 'tn', tn: 'tn',
  texas: 'tx', tx: 'tx',
  utah: 'ut', ut: 'ut',
  vermont: 'vt', vt: 'vt',
  virginia: 'va', va: 'va',
  washington: 'wa', wa: 'wa',
  'west virginia': 'wv', wv: 'wv',
  wisconsin: 'wi', wi: 'wi',
  wyoming: 'wy', wy: 'wy',
};

const STATE_SEARCH_PRIORITY = [
  'id', 'or', 'wa', 'mt', 'wy', 'co', 'ut', 'az', 'nm', 'nv', 'ca', 'ak', 'hi',
  'al', 'ar', 'ct', 'de', 'fl', 'ga', 'ia', 'il', 'in', 'ks', 'ky', 'la', 'ma',
  'md', 'me', 'mi', 'mn', 'mo', 'ms', 'nc', 'nd', 'ne', 'nh', 'nj', 'ny', 'oh',
  'ok', 'pa', 'ri', 'sc', 'sd', 'tn', 'tx', 'va', 'vt', 'wi', 'wv', 'dc',
];

const STATE_SEARCH_BATCH_SIZE = 8;
const PER_STATE_SITE_LIMIT = 500;
const DEFAULT_TEXT_SEARCH_LIMIT = 200;

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

function formatBboxCoord(value) {
  return Number(value.toFixed(6));
}

function formatBboxArg(bbox) {
  return [
    formatBboxCoord(bbox.west),
    formatBboxCoord(bbox.south),
    formatBboxCoord(bbox.east),
    formatBboxCoord(bbox.north),
  ].join(',');
}

const MAX_BBOX_HALF_SPAN_DEG = 2.4; // USGS IV + site services reject boxes wider than ~5°

export async function fetchNearbyGaugesByGps(lat, lng, { radiusMiles = 50, limit = 10 } = {}) {
  if (lat == null || lng == null) return [];
  const tiles = tileCentersForRadius(lat, lng, radiusMiles);
  const bySite = new Map();

  for (let i = 0; i < tiles.length; i += 4) {
    const batch = tiles.slice(i, i + 4);
    const results = await Promise.all(
      batch.map((tile) => fetchNearbyGaugesByGpsOnce(tile.lat, tile.lng, {
        radiusMiles: tile.radiusMiles,
        limit: limit * 2,
      }).catch(() => [])),
    );
    for (const stations of results) {
      for (const g of stations) {
        if (g.lat == null || g.lng == null) continue;
        const distanceMiles = haversineMiles(lat, lng, g.lat, g.lng);
        if (distanceMiles > radiusMiles) continue;
        const prev = bySite.get(g.id);
        if (!prev || distanceMiles < prev.distanceMiles) {
          bySite.set(g.id, { ...g, distanceMiles });
        }
      }
    }
    if (bySite.size >= limit) break;
  }

  return Array.from(bySite.values())
    .sort((a, b) => a.distanceMiles - b.distanceMiles)
    .slice(0, limit);
}

async function fetchNearbyGaugesByGpsOnce(lat, lng, { radiusMiles = 50, limit = 10 } = {}) {
  const bbox = buildBbox(lat, lng, radiusMiles);
  const url = buildIvUrl({
    format: 'json',
    bBox: formatBboxArg(bbox),
    parameterCd: '00060,00065',
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
  const tiles = tileCentersForRadius(lat, lng, radiusMiles);
  const seen = new Map();

  for (let i = 0; i < tiles.length; i += 4) {
    const batch = tiles.slice(i, i + 4);
    const results = await Promise.all(
      batch.map(async (tile) => {
        const bbox = buildBbox(tile.lat, tile.lng, tile.radiusMiles);
        return fetchGaugeStationsRdb({
          bBox: formatBboxArg(bbox),
        }, { limit: limit * 2 }).catch(() => []);
      }),
    );
    for (const stations of results) {
      for (const g of stations) {
        if (!g?.id || g.lat == null || g.lng == null) continue;
        const distanceMiles = haversineMiles(lat, lng, g.lat, g.lng);
        if (distanceMiles > radiusMiles) continue;
        const prev = seen.get(g.id);
        if (!prev || distanceMiles < prev.distanceMiles) {
          seen.set(g.id, { ...g, distanceMiles });
        }
      }
    }
    if (seen.size >= limit) break;
  }

  return Array.from(seen.values())
    .sort((a, b) => a.distanceMiles - b.distanceMiles)
    .slice(0, limit);
}

export function parseGaugeSearchQuery(text) {
  const raw = String(text || '').trim();
  if (!raw) return { siteName: '', stateCd: null };

  const tokens = raw
    .toLowerCase()
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (!tokens.length) return { siteName: '', stateCd: null };

  let stateCd = null;
  let end = tokens.length;

  const trailingPair = `${tokens[end - 2] || ''} ${tokens[end - 1] || ''}`.trim();
  if (end >= 2 && US_STATE_CODES[trailingPair]) {
    stateCd = US_STATE_CODES[trailingPair];
    end -= 2;
  } else if (US_STATE_CODES[tokens[end - 1]]) {
    stateCd = US_STATE_CODES[tokens[end - 1]];
    end -= 1;
  }

  const siteName = tokens.slice(0, end).join(' ').trim() || raw;
  return { siteName, stateCd };
}

export async function fetchNearbyGaugeStationsByText(text, lat, lng, { radiusMiles = 150, limit = 100 } = {}) {
  if (lat == null || lng == null) return [];
  const { siteName } = parseGaugeSearchQuery(text);
  const searchText = siteName || String(text || '').trim();

  const stations = await fetchGaugeStationsByBbox(lat, lng, { radiusMiles, limit: limit * 4 });
  if (!searchText) return stations.slice(0, limit);

  const filtered = filterStationsByText(stations, searchText);
  const ranked = rankStationsByText(filtered.length ? filtered : stations, searchText);
  return ranked.slice(0, limit);
}

export async function fetchGaugeStationsByText(text, {
  limit = DEFAULT_TEXT_SEARCH_LIMIT,
  lat = null,
  lng = null,
  scope = 'all',
} = {}) {
  const q = String(text || '').trim();
  if (scope === 'nearby') {
    if (lat == null || lng == null) return [];
    return fetchNearbyGaugeStationsByText(q, lat, lng, { radiusMiles: 150, limit });
  }
  if (!q) return [];

  const { siteName, stateCd } = parseGaugeSearchQuery(q);
  const seen = new Set();
  const merged = [];

  function addStations(stations) {
    for (const station of stations) {
      if (!station?.id || seen.has(station.id)) continue;
      seen.add(station.id);
      merged.push(station);
    }
  }

  async function searchAllStates(name) {
    for (let i = 0; i < STATE_SEARCH_PRIORITY.length; i += STATE_SEARCH_BATCH_SIZE) {
      const batch = STATE_SEARCH_PRIORITY.slice(i, i + STATE_SEARCH_BATCH_SIZE);
      const results = await Promise.all(
        batch.map((code) => fetchGaugeStationsRdb(
          { stateCd: code, siteName: name },
          { limit: PER_STATE_SITE_LIMIT },
        ).catch(() => [])),
      );
      results.forEach(addStations);
    }
  }

  if (stateCd) {
    addStations(await fetchGaugeStationsRdb({ stateCd, siteName }, { limit: PER_STATE_SITE_LIMIT }));
  } else {
    await searchAllStates(siteName);
  }

  const filtered = filterStationsByText(merged, siteName);
  const ranked = rankStationsByText(filtered.length ? filtered : merged, siteName);
  return ranked.slice(0, limit);
}

async function fetchGaugeStationsRdb(filters, { limit = 40 } = {}) {
  const url = new URL('https://waterservices.usgs.gov/nwis/site/');
  url.searchParams.set('format', 'rdb');
  url.searchParams.set('siteOutput', 'expanded');
  url.searchParams.set('hasDataTypeCd', 'iv');
  Object.entries(filters).forEach(([key, value]) => {
    if (value != null && value !== '') url.searchParams.set(key, String(value));
  });

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const details = body ? ` :: ${body.slice(0, 220)}` : '';
    throw new Error(`USGS station search failed (${res.status})${details}`);
  }

  return parseSiteRdb(await res.text(), { limit });
}

function parseSiteRdb(raw, { limit = 40 } = {}) {
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
    out.push({
      id,
      name,
      lat: Number.isFinite(siteLat) ? siteLat : null,
      lng: Number.isFinite(siteLng) ? siteLng : null,
    });
    if (out.length >= limit) break;
  }

  return out;
}

function riverNameFromStation(name) {
  const txt = name || '';
  const cutAt = [' at ', ' above ', ' near ', ','].find((p) => txt.toLowerCase().includes(p));
  if (!cutAt) return txt;
  const idx = txt.toLowerCase().indexOf(cutAt);
  return idx > -1 ? txt.slice(0, idx).trim() : txt;
}

function searchTokens(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function filterStationsByText(stations, text) {
  const tokens = searchTokens(text);
  if (!tokens.length) return stations;
  return stations.filter((g) => stationMatchesTokens(g, tokens));
}

function stationMatchesTokens(gauge, tokens) {
  const name = String(gauge?.name || '').toLowerCase();
  const river = riverNameFromStation(gauge?.name || '').toLowerCase();
  const id = String(gauge?.id || '').toLowerCase();
  const haystack = `${name} ${river} ${id}`;
  return tokens.every((token) => haystack.includes(token));
}

function rankStationsByText(stations, text) {
  const tokens = searchTokens(text);
  if (!tokens.length) return stations;
  const q = tokens.join(' ');
  return [...stations]
    .map((g) => {
      const name = String(g?.name || '').toLowerCase();
      const river = riverNameFromStation(g?.name || '').toLowerCase();
      const id = String(g?.id || '').toLowerCase();
      const exactId = id === q ? 5 : 0;
      const starts = tokens.some((token) => name.startsWith(token) || river.startsWith(token) || id.startsWith(token)) ? 3 : 0;
      const includes = stationMatchesTokens(g, tokens) ? 1 : 0;
      const phrase = name.includes(q) || river.includes(q) ? 2 : 0;
      return { g, score: exactId + starts + phrase + includes };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || String(a.g.name || '').localeCompare(String(b.g.name || '')))
    .map((x) => x.g);
}

function buildBbox(lat, lng, radiusMiles) {
  const latDegPerMile = 1 / 69;
  const lngDegPerMile = 1 / (Math.cos((lat * Math.PI) / 180) * 69 || 1);
  const latDelta = Math.min(radiusMiles * latDegPerMile, MAX_BBOX_HALF_SPAN_DEG);
  const lngDelta = Math.min(radiusMiles * lngDegPerMile, MAX_BBOX_HALF_SPAN_DEG);
  return {
    south: Math.max(lat - latDelta, -90),
    north: Math.min(lat + latDelta, 90),
    west: Math.max(lng - lngDelta, -180),
    east: Math.min(lng + lngDelta, 180),
  };
}

function maxBboxRadiusMiles(lat) {
  const latCap = MAX_BBOX_HALF_SPAN_DEG * 69;
  const lngCap = MAX_BBOX_HALF_SPAN_DEG * Math.cos((lat * Math.PI) / 180) * 69;
  return Math.floor(Math.min(latCap, lngCap) * 0.98);
}

function tileCentersForRadius(lat, lng, radiusMiles) {
  const tileRadius = maxBboxRadiusMiles(lat);
  if (radiusMiles <= tileRadius) {
    return [{ lat, lng, radiusMiles }];
  }

  const centers = [{ lat, lng, radiusMiles: tileRadius }];
  const latStep = (tileRadius * 1.4) / 69;
  const lngStep = (tileRadius * 1.4) / (Math.cos((lat * Math.PI) / 180) * 69 || 1);
  const ringCount = Math.min(3, Math.ceil(radiusMiles / tileRadius));

  for (let dLatIdx = -ringCount; dLatIdx <= ringCount; dLatIdx += 1) {
    for (let dLngIdx = -ringCount; dLngIdx <= ringCount; dLngIdx += 1) {
      if (dLatIdx === 0 && dLngIdx === 0) continue;
      const cLat = lat + dLatIdx * latStep;
      const cLng = lng + dLngIdx * lngStep;
      if (haversineMiles(lat, lng, cLat, cLng) <= radiusMiles + tileRadius * 0.25) {
        centers.push({ lat: cLat, lng: cLng, radiusMiles: tileRadius });
      }
    }
  }

  return centers;
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
