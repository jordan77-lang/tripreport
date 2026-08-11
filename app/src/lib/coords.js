/**
 * Parse coordinates a person would actually type or paste.
 *
 * Backcountry spots frequently have no POI in any geocoder — Bargamin Creek
 * Campground on the Main Salmon is a real example: Mapbox returns nothing and
 * OSM knows only the creek, 7 miles upstream. When someone has the exact
 * coordinate, searching by name is hopeless but the number is authoritative.
 * So a coordinate typed into the search box must be treated as an answer, not
 * as a query to send to a geocoder.
 *
 * Accepted forms (lat first, which is how coordinates are written and shared):
 *   45.56750, -115.19301
 *   45.56750 -115.19301
 *   45.5675°N, 115.19301°W        (hemisphere letters, either order of sign)
 *   N45.5675 W115.19301
 *   45 34 3.0 N, 115 11 34.8 W    (degrees minutes seconds)
 *   45°34'03"N 115°11'34.8"W
 *   -115.19301, 45.56750          (only when lat-first is impossible)
 *
 * Returns { lat, lng, format, swapped } or null.
 */

const DEC = String.raw`[-+]?\d{1,3}(?:\.\d+)?`;

/** Bare decimal pair: "45.5675, -115.19301" */
const RE_DECIMAL = new RegExp(
  String.raw`^\s*(${DEC})\s*[,\s]\s*(${DEC})\s*$`,
);

/** Hemisphere-tagged decimals: "45.5675°N, 115.19301°W" or "N45.5675 W115.193" */
const RE_HEMI = new RegExp(
  String.raw`^\s*([NSEW])?\s*(${DEC})\s*°?\s*([NSEW])?\s*[,\s]\s*([NSEW])?\s*(${DEC})\s*°?\s*([NSEW])?\s*$`,
  'i',
);

/**
 * DMS with optional symbols. Seconds may be separated by a symbol OR by plain
 * whitespace ("45 34 3.0 N"), which is how GPS units and guidebooks print it.
 */
const RE_DMS_PART = String.raw`(\d{1,3})\s*[°:\s]\s*(\d{1,2}(?:\.\d+)?)\s*(?:(?:['’′:]|\s)\s*(\d{1,2}(?:\.\d+)?)\s*["”″]?\s*)?([NSEW])?`;
const RE_DMS = new RegExp(
  String.raw`^\s*([NSEW])?\s*${RE_DMS_PART}\s*[,\s]\s*([NSEW])?\s*${RE_DMS_PART}\s*$`,
  'i',
);

export function parseCoordinates(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const text = raw.replace(/[()[\]]/g, ' ').trim();
  if (!/\d/.test(text)) return null;

  const direct = parseDms(text) || parseHemisphere(text) || parseDecimal(text);
  if (direct) return direct;

  // Pasted with a label ("Camp @ 45.5675, -115.19301", "loc: 45.5, -115.2").
  // Retry on the trailing coordinate-shaped fragment rather than giving up.
  const tail = extractCoordinateFragment(text);
  if (tail && tail !== text) {
    return parseDms(tail) || parseHemisphere(tail) || parseDecimal(tail);
  }
  return null;
}

/**
 * Pull the last coordinate-looking run out of a longer string. Anchored to the
 * end because labels lead ("Camp @ <coords>"), not trail.
 */
function extractCoordinateFragment(text) {
  const m = /[-+NSEWnsew\d][-+\d\s.,°'’′"”″:NSEWnsew]*$/.exec(text);
  if (!m) return null;
  return m[0].replace(/^[\s,:@]+/, '').trim() || null;
}

function parseDecimal(text) {
  const m = RE_DECIMAL.exec(text);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return orient(a, b, 'decimal');
}

function parseHemisphere(text) {
  const m = RE_HEMI.exec(text);
  if (!m) return null;
  const [, pre1, num1, post1, pre2, num2, post2] = m;
  const h1 = (pre1 || post1 || '').toUpperCase();
  const h2 = (pre2 || post2 || '').toUpperCase();
  // Without any hemisphere letter this is just a decimal pair.
  if (!h1 && !h2) return null;

  const v1 = applyHemisphere(Number(num1), h1);
  const v2 = applyHemisphere(Number(num2), h2);
  if (v1 == null || v2 == null) return null;

  // Hemisphere letters say which value is which — no guessing needed.
  const firstIsLat = h1 === 'N' || h1 === 'S' || h2 === 'E' || h2 === 'W';
  const lat = firstIsLat ? v1 : v2;
  const lng = firstIsLat ? v2 : v1;
  if (!inRange(lat, lng)) return null;
  return { lat, lng, format: 'hemisphere', swapped: !firstIsLat };
}

function parseDms(text) {
  const m = RE_DMS.exec(text);
  if (!m) return null;
  const [, pre1, d1, mi1, s1, post1, pre2, d2, mi2, s2, post2] = m;
  const v1 = dmsToDecimal(d1, mi1, s1);
  const v2 = dmsToDecimal(d2, mi2, s2);
  if (v1 == null || v2 == null) return null;

  const h1 = (pre1 || post1 || '').toUpperCase();
  const h2 = (pre2 || post2 || '').toUpperCase();
  const a = applyHemisphere(v1, h1);
  const b = applyHemisphere(v2, h2);
  if (a == null || b == null) return null;

  if (h1 || h2) {
    const firstIsLat = h1 === 'N' || h1 === 'S' || h2 === 'E' || h2 === 'W';
    const lat = firstIsLat ? a : b;
    const lng = firstIsLat ? b : a;
    if (!inRange(lat, lng)) return null;
    return { lat, lng, format: 'dms', swapped: !firstIsLat };
  }
  return orient(a, b, 'dms');
}

function dmsToDecimal(deg, min, sec) {
  const d = Number(deg);
  const mi = min == null ? 0 : Number(min);
  const s = sec == null ? 0 : Number(sec);
  if (!Number.isFinite(d) || !Number.isFinite(mi) || !Number.isFinite(s)) return null;
  if (mi >= 60 || s >= 60) return null;
  return d + mi / 60 + s / 3600;
}

function applyHemisphere(value, hemi) {
  if (!Number.isFinite(value)) return null;
  if (hemi === 'S' || hemi === 'W') return -Math.abs(value);
  if (hemi === 'N' || hemi === 'E') return Math.abs(value);
  return value;
}

/**
 * Decide which number is latitude. Coordinates are conventionally written
 * lat-first, so that reading wins whenever it is valid; the pair is only
 * swapped when lat-first would be out of range and the reverse is not.
 */
function orient(a, b, format) {
  const latFirst = inRange(a, b);
  const lngFirst = inRange(b, a);

  if (latFirst) return { lat: a, lng: b, format, swapped: false };
  if (lngFirst) return { lat: b, lng: a, format, swapped: true };
  return null;
}

function inRange(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/** "45.56750, -115.19301" — the canonical way we echo a coordinate back. */
export function formatCoordinates(lat, lng, digits = 5) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '';
  return `${lat.toFixed(digits)}, ${lng.toFixed(digits)}`;
}
