import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { Ic } from './Ic';
import { T, F, ICONS } from '../tokens';
import { ts } from '../lib/textScale';
import { formatCoordinates, parseCoordinates } from '../lib/coords';

/**
 * Place search that MOVES THE MAP but never sets the coordinate — with one
 * deliberate exception: a typed coordinate.
 *
 * Logging a camp after the fact means you know roughly where ("Corn Creek") but
 * the exact spot is somewhere you have to eyeball on the map. So picking a named
 * result only flies the viewport there — the pin stays wherever the user puts it.
 *
 * A coordinate is different. Many backcountry sites have no POI in any geocoder
 * (Bargamin Creek Campground on the Main Salmon returns nothing from Mapbox, and
 * OSM knows only the creek 7 miles upstream), so searching by name cannot find
 * them — but the number the user has IS the answer. Coordinates therefore drop
 * the pin exactly and report what is nearby purely as confirmation.
 *
 * onPick receives { lng, lat, bbox, label, setPin } — setPin true means "this is
 * the coordinate", false/absent means "just move the viewport".
 */
export function PlaceSearch({
  onPick,
  placeholder = 'Search a place, or paste coordinates…',
  hint = 'Search moves the map only — tap or drag to set the exact spot. Coordinates drop the pin exactly.',
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);
  const [coordHit, setCoordHit] = useState(null);
  const debounceRef = useRef(null);
  const requestIdRef = useRef(0);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  /**
   * Coordinates win immediately: drop the pin, then fill in "what's around here"
   * from a reverse lookup. Works offline too — only the context needs network.
   */
  function applyCoordinate(parsed, { label = null } = {}) {
    const { lat, lng } = parsed;
    const id = ++requestIdRef.current;
    setResults([]);
    setOpen(false);
    setError(null);
    setCoordHit({ lat, lng, swapped: parsed.swapped, context: null, loading: false });

    onPick?.({ lng, lat, bbox: null, label: label || formatCoordinates(lat, lng), setPin: true });

    const offline = typeof navigator !== 'undefined' && !navigator.onLine;
    if (offline || !mapboxgl.accessToken) return;

    setCoordHit((c) => (c ? { ...c, loading: true } : c));
    // Reverse geocode purely for human confirmation ("Dixie, Idaho") — it never
    // moves or overrides the coordinate the user supplied.
    fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json`
      + `?access_token=${mapboxgl.accessToken}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (id !== requestIdRef.current || !data) return;
        const features = data.features || [];
        const near = features
          .filter((f) => !(f.place_type || []).includes('country'))
          .slice(0, 3)
          .map((f) => f.text)
          .filter(Boolean);
        setCoordHit((c) => (c ? { ...c, loading: false, context: near.join(' · ') || null } : c));
      })
      .catch(() => {
        if (id !== requestIdRef.current) return;
        setCoordHit((c) => (c ? { ...c, loading: false } : c));
      });
  }

  function runSearch(q) {
    const trimmed = q.trim();

    // Check for a coordinate before treating the text as a place name — sending
    // "45.5675, -115.19301" to the forward geocoder returns zero results.
    const parsed = parseCoordinates(trimmed);
    if (parsed) {
      applyCoordinate(parsed);
      setSearching(false);
      return;
    }
    setCoordHit(null);

    if (trimmed.length < 3) {
      setResults([]);
      setError(null);
      setSearching(false);
      return;
    }
    if (!mapboxgl.accessToken) {
      setError('Map search needs a Mapbox token.');
      return;
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setError('Offline — pan the map by hand to find the spot.');
      setResults([]);
      return;
    }

    const id = ++requestIdRef.current;
    setSearching(true);
    setError(null);

    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(trimmed)}.json`
      + `?access_token=${mapboxgl.accessToken}`
      + '&types=place,region,district,locality,neighborhood,poi,address'
      + '&limit=6';

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`Search failed (${res.status})`);
        return res.json();
      })
      .then((data) => {
        // Ignore responses from superseded keystrokes.
        if (id !== requestIdRef.current) return;
        const features = data.features || [];
        setResults(features);
        setOpen(true);
        if (!features.length) setError('No places found for that search.');
      })
      .catch((e) => {
        if (id !== requestIdRef.current) return;
        setError(e?.message || 'Could not search right now.');
        setResults([]);
      })
      .finally(() => {
        if (id === requestIdRef.current) setSearching(false);
      });
  }

  function onChange(value) {
    setQuery(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(value), 350);
  }

  function pick(feature) {
    const [lng, lat] = feature.center || [];
    if (lng == null || lat == null) return;
    setOpen(false);
    setResults([]);
    setQuery(feature.text || feature.place_name || '');
    onPick?.({
      lng,
      lat,
      bbox: feature.bbox || null,
      label: feature.place_name || feature.text || '',
    });
  }

  function clear() {
    clearTimeout(debounceRef.current);
    requestIdRef.current += 1;
    setQuery('');
    setResults([]);
    setError(null);
    setOpen(false);
    setSearching(false);
    setCoordHit(null);
  }

  return (
    <div style={{ position: 'relative', marginBottom: 8 }}>
      <div style={{ position: 'relative' }}>
        <div style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
          <Ic d={ICONS.compass} size={14} color={T.textFaint} sw={1.8} />
        </div>
        <input
          value={query}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => { if (results.length) setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              clearTimeout(debounceRef.current);
              runSearch(query);
            }
            if (e.key === 'Escape') clear();
          }}
          placeholder={placeholder}
          style={{
            width: '100%',
            border: `1.5px solid ${T.border}`,
            borderRadius: 10,
            padding: '9px 32px 9px 32px',
            fontSize: ts(13),
            fontFamily: F,
            boxSizing: 'border-box',
            outline: 'none',
            background: T.bg,
            color: T.text,
          }}
        />
        {(query || searching) && (
          <button
            type="button"
            onClick={clear}
            aria-label="Clear search"
            style={{
              position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
              width: 22, height: 22, borderRadius: 11, border: 'none', background: T.border,
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0,
            }}>
            <Ic d={ICONS.close} size={11} color={T.textSub} sw={2.2} />
          </button>
        )}
      </div>

      {/* A coordinate was recognised — the pin is already there. */}
      {coordHit && (
        <div style={{ marginTop: 6, background: '#EAF3FB', border: '1px solid #3A72A835',
                      borderRadius: 10, padding: '8px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Ic d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z M12 10a2 2 0 100-4 2 2 0 000 4z"
                size={12} color="#2A5C8E" sw={1.8} />
            <span style={{ fontSize: ts(12), fontWeight: 700, color: T.text }}>
              Pin set to {formatCoordinates(coordHit.lat, coordHit.lng)}
            </span>
          </div>
          {coordHit.swapped && (
            <div style={{ fontSize: ts(10.5), color: T.textSub, marginTop: 3 }}>
              Read as longitude first — swapped to latitude, longitude.
            </div>
          )}
          <div style={{ fontSize: ts(10.5), color: T.textFaint, marginTop: 3, lineHeight: 1.4 }}>
            {coordHit.loading
              ? 'Looking up what is nearby…'
              : coordHit.context
                ? `Near ${coordHit.context}`
                : 'No named place indexed here — the coordinate is used exactly as entered.'}
          </div>
        </div>
      )}

      {searching && (
        <div style={{ fontSize: ts(11), color: T.textFaint, marginTop: 5 }}>Searching…</div>
      )}
      {!searching && error && (
        <div style={{ fontSize: ts(11), color: T.amber, marginTop: 5 }}>{error}</div>
      )}
      {!searching && !error && !coordHit && hint && (
        <div style={{ fontSize: ts(11), color: T.textFaint, marginTop: 5, lineHeight: 1.4 }}>{hint}</div>
      )}

      {open && results.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 40, marginTop: 4,
          background: T.card, border: `1px solid ${T.border}`, borderRadius: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,.14)', overflow: 'hidden', maxHeight: 240, overflowY: 'auto',
        }}>
          {results.map((f) => {
            const primary = f.text || f.place_name;
            const context = (f.place_name || '').replace(`${primary}, `, '');
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => pick(f)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', border: 'none',
                  borderBottom: `1px solid ${T.border}`, background: 'transparent',
                  padding: '9px 11px', cursor: 'pointer', fontFamily: F,
                }}>
                <div style={{ fontSize: ts(12.5), fontWeight: 700, color: T.text }}>{primary}</div>
                {context && context !== primary && (
                  <div style={{ fontSize: ts(11), color: T.textFaint, marginTop: 1 }}>{context}</div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
