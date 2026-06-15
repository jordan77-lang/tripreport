import { useEffect, useMemo, useState } from 'react';
import { Ic } from '../components/Ic';
import { TripMap } from '../components/TripMap';
import { T, F, ICONS } from '../tokens';
import { fetchGauge, fetchGaugeHistory, fetchGaugeHistoryRange, KNOWN_GAUGES, fetchNearbyGaugesByGps, fetchGaugeStationsByText, parseGaugeSearchQuery } from '../lib/usgs';

const FAV_KEY = 'tr_favorite_gauges';
const PRESET_DAYS = { '7d': 7, '14d': 14, '30d': 30 };

function TimeSeriesChart({ history, metric, zoom = 1, w = 320, h = 170 }) {
  if (!history.length) {
    return <div style={{ height: h, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.textFaint, fontSize: 12 }}>No data in this date range.</div>;
  }

  const visibleCount = Math.max(10, Math.floor(history.length / zoom));
  const view = history.slice(-visibleCount);
  const vals = view.map(v => v.value);
  const rawMin = Math.min(...vals);
  const rawMax = Math.max(...vals);
  const pad = Math.max((rawMax - rawMin) * 0.1, rawMax * 0.03, 1);
  const min = rawMin - pad;
  const max = rawMax + pad;

  const m = { left: 42, right: 12, top: 12, bottom: 30 };
  const innerW = w - m.left - m.right;
  const innerH = h - m.top - m.bottom;
  const y = (v) => m.top + (1 - (v - min) / (max - min || 1)) * innerH;
  const x = (i) => m.left + (i / Math.max(1, view.length - 1)) * innerW;

  const pts = view.map((v, i) => [x(i), y(v.value)]);
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]},${p[1]}`).join(' ');
  const area = `${line} L${m.left + innerW},${m.top + innerH} L${m.left},${m.top + innerH} Z`;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const v = min + (max - min) * t;
    return { v, y: y(v) };
  });

  const xTickIdx = [0, Math.floor((view.length - 1) / 2), Math.max(0, view.length - 1)];

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ width: '100%' }}>
      <text x={8} y={12} fontSize="10" fill="#6B6763" fontWeight="700">{metric === 'cfs' ? 'CFS' : 'ft'}</text>

      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={m.left} y1={t.y} x2={m.left + innerW} y2={t.y} stroke="#E8E5E0" strokeWidth="1" />
          <text x={m.left - 6} y={t.y + 3} fontSize="9" textAnchor="end" fill="#A09D99">
            {formatAxisValue(t.v, metric)}
          </text>
        </g>
      ))}

      <path d={area} fill="#3A72A8" opacity="0.11" />
      <path d={line} fill="none" stroke="#3A72A8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="3.8" fill="#3A72A8" />

      {xTickIdx.map((idx, i) => (
        <text key={i} x={x(idx)} y={h - 10} fontSize="9" textAnchor="middle" fill="#A09D99">
          {formatShortDate(view[idx]?.ts)}
        </text>
      ))}

      <text x={w / 2} y={h - 1} fontSize="9" textAnchor="middle" fill="#6B6763">Date</text>
    </svg>
  );
}

export function RiverIntel({ onBack }) {
  const geolocationSupported = typeof navigator !== 'undefined' && Boolean(navigator.geolocation);
  const [siteId, setSiteId]     = useState(KNOWN_GAUGES[0].id);
  const [query, setQuery]       = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [metric, setMetric]     = useState('cfs'); // cfs | gaugeHt
  const [datePreset, setDatePreset] = useState('7d');
  const [zoomLevel, setZoomLevel] = useState(1);
  const [refreshTick, setRefreshTick] = useState(0);
  const [customStart, setCustomStart] = useState(toDateInput(daysAgoDate(14)));
  const [customEnd, setCustomEnd] = useState(toDateInput(new Date()));
  const [favoriteIds, setFavoriteIds] = useState(() => loadFavoriteGauges());
  const [userPos, setUserPos]   = useState(null);
  const [locationError, setLocationError] = useState(geolocationSupported ? null : 'Location unavailable on this device.');
  const [nearbyStations, setNearbyStations] = useState([]);
  const [searchStations, setSearchStations] = useState([]);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchScope, setSearchScope] = useState('all'); // all | nearby
  const [gauge, setGauge]       = useState(null);
  const [history, setHistory]   = useState([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [lastFetch, setLastFetch] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(null);
      try {
        const parameterCd = metric === 'cfs' ? '00060' : '00065';
        const historyPromise = datePreset === 'custom'
          ? fetchGaugeHistoryRange(siteId, customStart, customEnd, parameterCd)
          : fetchGaugeHistory(siteId, PRESET_DAYS[datePreset] || 7, parameterCd);
        const [g, h] = await Promise.all([fetchGauge(siteId), historyPromise]);
        if (cancelled) return;
        setGauge(g);
        setHistory(h);
        setLastFetch(new Date());
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => { cancelled = true; };
  }, [siteId, metric, datePreset, customStart, customEnd, refreshTick]);

  // Auto-refresh every 15 min
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const parameterCd = metric === 'cfs' ? '00060' : '00065';
        const historyPromise = datePreset === 'custom'
          ? fetchGaugeHistoryRange(siteId, customStart, customEnd, parameterCd)
          : fetchGaugeHistory(siteId, PRESET_DAYS[datePreset] || 7, parameterCd);
        const [g, h] = await Promise.all([fetchGauge(siteId), historyPromise]);
        setGauge(g);
        setHistory(h);
        setLastFetch(new Date());
      } catch {
        // Keep previous data when background refresh fails.
      }
    }, 15 * 60 * 1000);
    return () => clearInterval(t);
  }, [siteId, metric, datePreset, customStart, customEnd]);

  useEffect(() => {
    if (!geolocationSupported) return;
    const onPos = (pos) => {
      setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      setLocationError(null);
    };

    navigator.geolocation.getCurrentPosition(
      onPos,
      (err) => setLocationError(err.message || 'Could not get location.'),
      { enableHighAccuracy: true, timeout: 10000 },
    );

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        onPos(pos);
      },
      (err) => setLocationError(err.message || 'Could not get location.'),
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 12000 },
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [geolocationSupported]);

  useEffect(() => {
    if (!userPos?.lat || !userPos?.lng) return;
    let cancelled = false;

    async function loadNearby() {
      setNearbyLoading(true);
      try {
        const tight = await fetchNearbyGaugesByGps(userPos.lat, userPos.lng, { radiusMiles: 50, limit: 25 });
        const wider = tight.length >= 6
          ? tight
          : await fetchNearbyGaugesByGps(userPos.lat, userPos.lng, { radiusMiles: 150, limit: 60 });
        if (!cancelled) setNearbyStations(wider);
      } catch {
        if (!cancelled) setNearbyStations([]);
      } finally {
        if (!cancelled) setNearbyLoading(false);
      }
    }

    loadNearby();
    return () => { cancelled = true; };
  }, [userPos?.lat, userPos?.lng]);

  const WATER = '#3A72A8';
  const flowStatus = gauge ? classifyFlow(gauge.cfs) : null;
  const gaugesPool = useMemo(() => {
    const map = new Map();
    [...searchStations, ...nearbyStations, ...KNOWN_GAUGES].forEach((g) => {
      if (!g?.id) return;
      if (!map.has(g.id)) map.set(g.id, g);
    });
    return Array.from(map.values());
  }, [searchStations, nearbyStations]);

  const selectedGaugeMeta = gaugesPool.find(g => g.id === siteId) || KNOWN_GAUGES.find(g => g.id === siteId);
  const favorites = gaugesPool.filter(g => favoriteIds.includes(g.id));
  const draftMatches = useMemo(() => {
    const { siteName } = parseGaugeSearchQuery(searchDraft);
    return searchGaugeMatches(siteName || searchDraft, gaugesPool);
  }, [searchDraft, gaugesPool]);

  const filtered = useMemo(() => {
    if (!query) return gaugesPool;
    if (query === 'nearby' && searchStations.length) return searchStations;
    const { siteName } = parseGaugeSearchQuery(query);
    const matchText = siteName || query;
    const source = searchStations.length
      ? [...searchStations, ...KNOWN_GAUGES]
      : gaugesPool;
    return searchGaugeMatches(matchText, source);
  }, [query, gaugesPool, searchStations]);
  const nearby = nearbyStations.filter(g => g.id !== siteId);

  const mapEntries = useMemo(() => {
    const map = new Map();

    filtered
      .filter((g) => g?.lat != null && g?.lng != null)
      .forEach((g) => {
        map.set(g.id, {
          id: g.id,
          type: 'gauge',
          title: g.name,
          lng: g.lng,
          lat: g.lat,
          col: g.id === siteId ? '#3A72A8' : '#6B6763',
        });
      });

    // Keep currently selected gauge pinned even when filtered results don't include it.
    if (selectedGaugeMeta?.id && selectedGaugeMeta?.lat != null && selectedGaugeMeta?.lng != null) {
      map.set(selectedGaugeMeta.id, {
        id: selectedGaugeMeta.id,
        type: 'gauge',
        title: selectedGaugeMeta.name,
        lng: selectedGaugeMeta.lng,
        lat: selectedGaugeMeta.lat,
        col: '#3A72A8',
      });
    }

    return Array.from(map.values());
  }, [filtered, selectedGaugeMeta, siteId]);

  function toggleFavorite(id) {
    const next = favoriteIds.includes(id)
      ? favoriteIds.filter(x => x !== id)
      : [...favoriteIds, id];
    setFavoriteIds(next);
    saveFavoriteGauges(next);
  }

  async function runSearch() {
    const q = searchDraft.trim();
    if (!q && searchScope !== 'nearby') {
      setQuery('');
      setError(null);
      setSearchStations([]);
      return;
    }

    if (searchScope === 'nearby' && (userPos?.lat == null || userPos?.lng == null)) {
      setError('Location needed for nearby search. Allow GPS access and try again.');
      return;
    }

    const { siteName } = parseGaugeSearchQuery(q);
    const matchText = siteName || q;
    setSearchLoading(true);
    setError(null);
    let matches = searchGaugeMatches(matchText, gaugesPool);

    try {
      const remote = await fetchGaugeStationsByText(q, {
        limit: 200,
        lat: userPos?.lat ?? null,
        lng: userPos?.lng ?? null,
        scope: searchScope,
      });
      if (remote.length) {
        setSearchStations(remote);
        matches = remote;
      } else {
        setSearchStations([]);
        matches = searchScope === 'nearby'
          ? []
          : searchGaugeMatches(matchText, gaugesPool);
      }
    } catch {
      matches = searchScope === 'nearby' ? [] : searchGaugeMatches(matchText, gaugesPool);
    } finally {
      setSearchLoading(false);
    }

    if (matches.length === 1) {
      const top = matches[0];
      setQuery(top.name);
      setSearchDraft(top.name);
      setSiteId(top.id);
      setError(null);
    } else if (matches.length > 1) {
      setQuery(q || (searchScope === 'nearby' ? 'nearby' : ''));
      setSearchDraft(q);
      setError(null);
    } else {
      // Numeric fallback: attempt direct USGS station lookup by site ID.
      const numeric = q.replace(/\D/g, '');
      if (numeric.length >= 6) {
        try {
          const g = await fetchGauge(numeric);
          if (g?.siteName) {
            const site = { id: numeric, name: g.siteName, cfs: g.cfs, gaugeHt: g.gaugeHt, updatedAt: g.updatedAt };
            setNearbyStations((prev) => {
              const next = Array.isArray(prev) ? [...prev] : [];
              if (!next.some((x) => x.id === site.id)) next.unshift(site);
              return next;
            });
            setQuery(site.name);
            setSearchDraft(site.name);
            setSiteId(site.id);
            setError(null);
            return;
          }
        } catch {
          // Fall through to no results error.
        }
      }

      setSearchStations([]);
      setQuery(q || (searchScope === 'nearby' ? 'nearby' : ''));
      setError(searchScope === 'nearby'
        ? (q ? `No nearby gauges found matching "${q}"` : 'No gauges found within 150 miles.')
        : `No gauges found matching "${q}"`);
    }
  }

  async function loadNearbyBrowse() {
    if (userPos?.lat == null || userPos?.lng == null) {
      setError('Location needed for nearby search. Allow GPS access and try again.');
      return;
    }
    setSearchScope('nearby');
    setSearchDraft('');
    setSearchLoading(true);
    setError(null);
    try {
      const remote = await fetchGaugeStationsByText('', {
        lat: userPos.lat,
        lng: userPos.lng,
        scope: 'nearby',
        limit: 100,
      });
      setSearchStations(remote);
      setQuery('nearby');
      if (!remote.length) setError('No gauges found within 150 miles.');
    } catch {
      setError('Could not load nearby gauges.');
    } finally {
      setSearchLoading(false);
    }
  }

  function applyDateRange() {
    setDatePreset('custom');
    setRefreshTick((n) => n + 1);
  }

  async function selectGaugeFromMapLocation(pos) {
    if (!pos?.lat || !pos?.lng) return;
    setLoading(true);
    try {
      const near = await fetchNearbyGaugesByGps(pos.lat, pos.lng, { radiusMiles: 50, limit: 1 });
      const pick = near[0] || (await fetchNearbyGaugesByGps(pos.lat, pos.lng, { radiusMiles: 150, limit: 1 }))[0];
      if (pick?.id) {
        setSiteId(pick.id);
        setError(null);
      } else {
        setError('No USGS gauge found near tapped map location.');
      }
    } catch {
      setError('Could not select gauge from map location.');
    } finally {
      setLoading(false);
    }
  }

  const currentValue = metric === 'cfs' ? gauge?.cfs : gauge?.gaugeHt;
  const currentUnit = metric === 'cfs' ? 'CFS' : 'ft';
  const sparklineTitle = metric === 'cfs' ? '7-Day Flow (CFS)' : '7-Day Gauge Height (ft)';

  return (
    <div style={{ height: '100%', background: T.bg, display: 'flex', flexDirection: 'column', fontFamily: F, overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ background: T.card, padding: '10px 16px 14px', borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <div onClick={onBack} style={{ width: 34, height: 34, borderRadius: 17, background: T.bg,
                                         display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <Ic d="M19 12H5 M12 5l-7 7 7 7" size={17} color={T.text} sw={2} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: T.text, letterSpacing: -.4 }}>River Conditions</div>
            <div style={{ fontSize: 11, color: T.textSub }}>USGS Live Data</div>
          </div>
          <div onClick={() => setRefreshTick((n) => n + 1)}
               style={{ display: 'flex', alignItems: 'center', gap: 5, background: loading ? T.bg : T.accentLight,
                         borderRadius: 8, padding: '4px 9px', cursor: 'pointer', border: `1px solid ${T.accent}30` }}>
            <div style={{ width: 6, height: 6, borderRadius: 3, background: loading ? T.textFaint : '#4A7A34',
                           animation: loading ? 'pulse 1s infinite' : 'none' }} />
            <span style={{ fontSize: 9.5, fontWeight: 700, color: loading ? T.textFaint : T.accent }}>
              {loading ? 'LOADING' : 'LIVE'}
            </span>
          </div>
          <div onClick={onBack}
               style={{ background: '#E4EFF8', border: `1px solid #3A72A840`, borderRadius: 8, padding: '4px 9px',
                        fontSize: 9.5, fontWeight: 700, color: '#2A5C8E', cursor: 'pointer' }}>
            HOME
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
          <div style={{ display: 'flex', background: T.bg, borderRadius: 9, padding: 2, border: `1px solid ${T.border}` }}>
            {[
              { id: 'all', label: 'All' },
              { id: 'nearby', label: 'Nearby' },
            ].map((opt) => (
              <div key={opt.id} onClick={() => setSearchScope(opt.id)}
                   style={{ padding: '6px 10px', borderRadius: 7, fontSize: 10.5, fontWeight: 700, cursor: 'pointer',
                            background: searchScope === opt.id ? WATER : 'transparent',
                            color: searchScope === opt.id ? 'white' : T.textFaint }}>
                {opt.label}
              </div>
            ))}
          </div>
          <div onClick={loadNearbyBrowse}
               style={{ background: searchScope === 'nearby' ? '#E4EFF8' : T.bg, border: `1px solid ${T.border}`,
                        borderRadius: 9, padding: '6px 10px', fontSize: 10.5, fontWeight: 700,
                        color: '#2A5C8E', cursor: searchLoading ? 'wait' : 'pointer' }}>
            Near me
          </div>
          <span style={{ fontSize: 10, color: T.textFaint, flex: 1 }}>
            {searchScope === 'nearby' ? 'Within ~150 mi of your GPS' : 'Nationwide USGS gauges'}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input
            value={searchDraft}
            onChange={e => setSearchDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
            placeholder={searchScope === 'nearby'
              ? 'Search nearby rivers, stations, or gauge ID'
              : 'Search all USGS rivers, stations, or gauge ID'}
            style={{
              flex: 1,
              border: `1.5px solid ${T.border}`,
              borderRadius: 10,
              padding: '8px 11px',
              fontSize: 12,
              fontFamily: F,
              background: T.bg,
              color: T.text,
              outline: 'none',
            }}
          />
          <div onClick={runSearch}
               style={{ background: '#E4EFF8', border: `1px solid #3A72A840`, borderRadius: 10, padding: '8px 11px',
                        fontSize: 11, fontWeight: 700, color: '#2A5C8E', cursor: searchLoading ? 'wait' : 'pointer',
                        display: 'flex', alignItems: 'center', opacity: searchLoading ? 0.7 : 1 }}>
            {searchLoading ? 'Searching…' : 'Search'}
          </div>
          <div style={{ display: 'flex', background: T.bg, borderRadius: 9, padding: 2, border: `1px solid ${T.border}` }}>
            {[
              { id: 'cfs', label: 'CFS' },
              { id: 'gaugeHt', label: 'Ht' },
            ].map(opt => (
              <div key={opt.id} onClick={() => setMetric(opt.id)}
                   style={{ padding: '6px 10px', borderRadius: 7, fontSize: 10.5, fontWeight: 700, cursor: 'pointer',
                            background: metric === opt.id ? WATER : 'transparent',
                            color: metric === opt.id ? 'white' : T.textFaint }}>
                {opt.label}
              </div>
            ))}
          </div>
        </div>

        {!!searchDraft.trim() && !!draftMatches.length && (
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: '6px', marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: T.textFaint, fontWeight: 700, padding: '2px 6px 6px' }}>Close matches</div>
            {draftMatches.map((g) => (
              <div key={g.id} onClick={() => { setSearchDraft(g.name); setQuery(g.name); setSiteId(g.id); }}
                   style={{ padding: '7px 8px', borderRadius: 8, cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11.5, color: T.text }}>{g.name}</span>
                <span style={{ fontSize: 10.5, color: T.textFaint }}>#{g.id}</span>
              </div>
            ))}
          </div>
        )}

        {!!favorites.length && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10.5, color: T.textSub, fontWeight: 700, letterSpacing: .4, marginBottom: 5, textTransform: 'uppercase' }}>Favorites</div>
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
              {favorites.map(g => (
                <div key={g.id} onClick={() => setSiteId(g.id)}
                     style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 18,
                              border: `1px solid ${siteId === g.id ? WATER : T.border}`,
                              background: siteId === g.id ? '#E4EFF8' : T.bg,
                              cursor: 'pointer' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: siteId === g.id ? WATER : T.textSub }}>{g.name.split(',')[0]}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Gauge selector */}
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
          {filtered.map(g => (
            <div key={g.id} onClick={() => setSiteId(g.id)}
                 style={{ flexShrink: 0, padding: '5px 11px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                           cursor: 'pointer', transition: 'all .15s',
                           background: siteId === g.id ? WATER : T.bg,
                           color: siteId === g.id ? 'white' : T.textSub,
                           border: siteId === g.id ? 'none' : `1px solid ${T.border}`,
                           display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span>{g.name.split(',')[0]}</span>
              <span onClick={(e) => { e.stopPropagation(); toggleFavorite(g.id); }} style={{ fontSize: 12 }}>
                {favoriteIds.includes(g.id) ? '★' : '☆'}
              </span>
            </div>
          ))}
        </div>

        {query && filtered.length > 0 && (
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: '6px 8px', marginBottom: 8, maxHeight: 220, overflowY: 'auto' }}>
            <div style={{ fontSize: 10, color: T.textFaint, fontWeight: 700, padding: '2px 4px 6px' }}>
              {searchScope === 'nearby' || query === 'nearby'
                ? `${filtered.length} gauge${filtered.length === 1 ? '' : 's'} within ~150 mi`
                : `${filtered.length} gauge${filtered.length === 1 ? '' : 's'} found nationwide`}
            </div>
            {filtered.map((g) => (
              <div key={g.id} onClick={() => { setSearchDraft(g.name); setQuery(g.name); setSiteId(g.id); }}
                   style={{ padding: '7px 8px', borderRadius: 8, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 8,
                            background: siteId === g.id ? '#E4EFF8' : 'transparent' }}>
                <span style={{ fontSize: 11.5, color: T.text }}>{g.name}</span>
                <span style={{ fontSize: 10.5, color: T.textFaint, flexShrink: 0 }}>
                  {g.distanceMiles != null ? `${g.distanceMiles.toFixed(1)} mi` : `#${g.id}`}
                </span>
              </div>
            ))}
          </div>
        )}

        {query && filtered.length === 0 && (
          <div style={{ fontSize: 11, color: T.textFaint, marginBottom: 8 }}>No gauges match your search.</div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>

        {error && (
          <div style={{ background: '#FBF0E4', borderRadius: 12, padding: '12px 14px', marginBottom: 12,
                        fontSize: 12, color: T.amber }}>
            ⚠ {error} — check network connection
          </div>
        )}

        {/* Live gauge card */}
        {gauge && (
          <div style={{ background: T.card, borderRadius: 14, padding: '14px', marginBottom: 12,
                        border: `1px solid ${T.border}` }}>
            <div style={{ fontSize: 11, color: T.textSub, marginBottom: 4 }}>
              {gauge.siteName}
              {lastFetch && <span style={{ color: T.textFaint }}> · Updated {lastFetch.toLocaleTimeString()}</span>}
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <div onClick={() => toggleFavorite(siteId)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer',
                         background: '#FBF0E4', border: `1px solid ${T.border}`, borderRadius: 8, padding: '4px 8px' }}>
                <span style={{ fontSize: 12 }}>{favoriteIds.includes(siteId) ? '★' : '☆'}</span>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: T.textSub }}>{favoriteIds.includes(siteId) ? 'Favorited' : 'Add Favorite'}</span>
              </div>
              <div style={{ fontSize: 10.5, color: T.textFaint, alignSelf: 'center' }}>ID #{siteId}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: T.textSub, letterSpacing: .6,
                               marginBottom: 4, textTransform: 'uppercase' }}>{metric === 'cfs' ? 'Current Flow' : 'Current Gauge Ht'}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontSize: 38, fontWeight: 800, color: WATER, letterSpacing: -2, lineHeight: 1 }}>
                    {currentValue != null ? currentValue.toLocaleString(undefined, { maximumFractionDigits: metric === 'cfs' ? 0 : 1 }) : '—'}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: T.textSub }}>{currentUnit}</span>
                </div>
              </div>
              {gauge.gaugeHt != null && metric === 'cfs' && (
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: T.textSub, letterSpacing: .6,
                                 marginBottom: 4, textTransform: 'uppercase' }}>Gauge Ht</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: T.text, letterSpacing: -.5 }}>
                    {gauge.gaugeHt.toFixed(1)}<span style={{ fontSize: 13, color: T.textSub }}> ft</span>
                  </div>
                </div>
              )}
            </div>

            {flowStatus && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
                             background: flowStatus.bg, borderRadius: 10, padding: '6px 12px', marginBottom: 14 }}>
                <div style={{ width: 8, height: 8, borderRadius: 4, background: flowStatus.dot }} />
                <span style={{ fontSize: 12, fontWeight: 800, color: flowStatus.text }}>{flowStatus.label}</span>
              </div>
            )}

            <div style={{ marginBottom: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 10.5, fontWeight: 600, color: T.textSub }}>{sparklineTitle}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span onClick={() => setZoomLevel(z => Math.max(1, z - 1))}
                        style={{ fontSize: 10.5, color: '#2A5C8E', fontWeight: 700, cursor: 'pointer' }}>Zoom -</span>
                  <span style={{ fontSize: 10, color: T.textFaint }}>{zoomLevel}x</span>
                  <span onClick={() => setZoomLevel(z => Math.min(6, z + 1))}
                        style={{ fontSize: 10.5, color: '#2A5C8E', fontWeight: 700, cursor: 'pointer' }}>Zoom +</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8, overflowX: 'auto' }}>
                {[
                  { id: '7d', label: '7d' },
                  { id: '14d', label: '14d' },
                  { id: '30d', label: '30d' },
                  { id: 'custom', label: 'Custom' },
                ].map((p) => (
                  <div key={p.id} onClick={() => setDatePreset(p.id)}
                       style={{ padding: '4px 8px', borderRadius: 8, fontSize: 10.5, fontWeight: 700, cursor: 'pointer',
                                background: datePreset === p.id ? '#3A72A8' : T.bg,
                                color: datePreset === p.id ? 'white' : T.textSub,
                                border: datePreset === p.id ? 'none' : `1px solid ${T.border}` }}>
                    {p.label}
                  </div>
                ))}
              </div>

              {datePreset === 'custom' && (
                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                  <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)}
                         style={{ flex: 1, border: `1px solid ${T.border}`, borderRadius: 8, padding: '6px 7px', fontSize: 11, fontFamily: F, background: T.bg }} />
                  <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)}
                         style={{ flex: 1, border: `1px solid ${T.border}`, borderRadius: 8, padding: '6px 7px', fontSize: 11, fontFamily: F, background: T.bg }} />
                  <div onClick={applyDateRange}
                       style={{ background: '#E4EFF8', border: `1px solid #3A72A840`, borderRadius: 8, padding: '6px 8px', fontSize: 10.5, fontWeight: 700, color: '#2A5C8E', cursor: 'pointer' }}>
                    Apply
                  </div>
                </div>
              )}

              <TimeSeriesChart history={history} metric={metric} zoom={zoomLevel} h={170} />
            </div>
          </div>
        )}

        {!!nearby.length && (
          <div style={{ background: T.card, borderRadius: 12, padding: '10px 12px', marginBottom: 12, border: `1px solid ${T.border}` }}>
            <div style={{ fontSize: 10.5, color: T.textSub, fontWeight: 700, letterSpacing: .6, textTransform: 'uppercase', marginBottom: 8 }}>Closest Stations (From Your GPS)</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {nearby.map(g => (
                <div key={g.id} onClick={() => setSiteId(g.id)}
                     style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer',
                              padding: '7px 8px', borderRadius: 8, background: '#F8F9FB' }}>
                  <span style={{ fontSize: 11.5, color: T.text }}>{g.name.split(',')[0]}</span>
                  <span style={{ fontSize: 10.5, color: T.textFaint }}>{g.distanceMiles.toFixed(1)} mi</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {!nearby.length && !locationError && (
          <div style={{ background: '#F8F9FB', borderRadius: 10, padding: '9px 11px', marginBottom: 12, fontSize: 11, color: T.textSub }}>
            {nearbyLoading ? 'Looking for nearby stations using your GPS...' : 'No nearby stations were returned for your current GPS location.'}
          </div>
        )}

        {!nearby.length && locationError && (
          <div style={{ background: '#FBF0E4', borderRadius: 10, padding: '9px 11px', marginBottom: 12, fontSize: 11, color: T.amber }}>
            Location needed for nearby stations: {locationError}
          </div>
        )}

        {/* Map */}
        <div style={{ borderRadius: 14, overflow: 'hidden', marginBottom: 12, height: 200 }}>
          <TripMap
            style="outdoors-v12"
            zoom={10}
            interactive
            entries={mapEntries}
            selectedEntryId={siteId}
            onEntrySelect={(entry) => setSiteId(entry.id)}
            onMapClick={selectGaugeFromMapLocation}
            showHoverPopup
            center={selectedGaugeMeta?.lat != null ? { lng: selectedGaugeMeta.lng, lat: selectedGaugeMeta.lat } : undefined}
          />
        </div>
        <div style={{ fontSize: 10.5, color: T.textFaint, marginTop: -8, marginBottom: 10 }}>
          Tap a station marker or tap map to select nearest gauge at that location.
        </div>

        {!gauge && !loading && !error && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: T.textFaint }}>Select a gauge above</div>
        )}
      </div>
    </div>
  );
}

function loadFavoriteGauges() {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveFavoriteGauges(ids) {
  localStorage.setItem(FAV_KEY, JSON.stringify(ids));
}

function riverNameFromStation(name) {
  const txt = name || '';
  const cutAt = [' at ', ' above ', ' near ', ','].find(p => txt.toLowerCase().includes(p));
  if (!cutAt) return txt;
  const idx = txt.toLowerCase().indexOf(cutAt);
  return idx > -1 ? txt.slice(0, idx).trim() : txt;
}

function searchGaugeMatches(text, source = KNOWN_GAUGES) {
  const tokens = String(text || '')
    .trim()
    .toLowerCase()
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (!tokens.length) return [];
  return source
    .map((g) => {
      const name = String(g?.name || '').toLowerCase();
      const river = riverNameFromStation(g?.name || '').toLowerCase();
      const id = String(g?.id || '').toLowerCase();
      const haystack = `${name} ${river} ${id}`;
      const q = tokens.join(' ');
      const exactId = id === q ? 5 : 0;
      const starts = tokens.some((token) => name.startsWith(token) || river.startsWith(token) || id.startsWith(token)) ? 3 : 0;
      const phrase = name.includes(q) || river.includes(q) ? 2 : 0;
      const includes = tokens.every((token) => haystack.includes(token)) ? 1 : 0;
      return { g, score: exactId + starts + phrase + includes };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || String(a.g.name || '').localeCompare(String(b.g.name || '')))
    .map((x) => x.g);
}

function classifyFlow(cfs) {
  if (cfs == null) return null;
  if (cfs < 200)  return { label: 'Too Low',     bg: '#F5EEE4', dot: T.amber,    text: '#7A4A14' };
  if (cfs < 800)  return { label: 'Low',         bg: '#FBF0E4', dot: T.amber,    text: '#7A4A14' };
  if (cfs < 1500) return { label: 'Optimal — Class III–IV', bg: '#EBF5EB', dot: '#4A8A34', text: '#2A6A14' };
  if (cfs < 3000) return { label: 'High — Expert only',    bg: '#FBF0E4', dot: T.amber,    text: '#7A4A14' };
  return              { label: 'Flood — Do not run',       bg: '#FBE4E4', dot: '#C04040',  text: '#8A1414' };
}

function formatAxisValue(v, metric) {
  if (!Number.isFinite(v)) return '-';
  return metric === 'cfs' ? Math.round(v).toLocaleString() : v.toFixed(1);
}

function formatShortDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function toDateInput(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysAgoDate(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}
