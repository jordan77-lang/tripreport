import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { Ic } from './Ic';
import { T, F, ICONS } from '../tokens';
import { ts } from '../lib/textScale';

/**
 * Place search that MOVES THE MAP but never sets the coordinate.
 *
 * Logging a camp after the fact means you know roughly where ("Corn Creek") but
 * the exact spot is somewhere you have to eyeball on the map. So picking a result
 * only flies the viewport there — the pin stays wherever the user puts it.
 *
 * onPick receives { lng, lat, bbox, label } so the caller can flyTo/fitBounds.
 */
export function PlaceSearch({
  onPick,
  placeholder = 'Search a place to move the map…',
  hint = 'Search moves the map only — tap or drag to set the exact spot.',
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef(null);
  const requestIdRef = useRef(0);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  function runSearch(q) {
    const trimmed = q.trim();
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

      {searching && (
        <div style={{ fontSize: ts(11), color: T.textFaint, marginTop: 5 }}>Searching…</div>
      )}
      {!searching && error && (
        <div style={{ fontSize: ts(11), color: T.amber, marginTop: 5 }}>{error}</div>
      )}
      {!searching && !error && hint && (
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
