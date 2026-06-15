import { useState } from 'react';
import { TripMap } from '../components/TripMap';
import { BottomNav } from '../components/BottomNav';
import { Ic } from '../components/Ic';
import { T, F, ICONS } from '../tokens';

export function Navigator({ trip, onNav, onFab, gps }) {
  const [mapStyle, setMapStyle] = useState('outdoors-v12');
  const { position, tracking, error } = gps || {};

  const track = trip?.track ?? [];
  const locations = (trip?.locations ?? [])
    .filter(l => l.lng && l.lat)
    .map(l => ({ ...l, title: l.name, col: '#3A72A8', symbol: l.icon || locationSymbol(l.type) }));
  const legacyEntries = locations.length
    ? []
    : (trip?.entries ?? [])
      .filter(e => e.lng && e.lat)
      .map(e => ({ ...e, col: entryColor(e.type) }));

  const stats = computeStats(track);

  return (
    <div style={{ height: '100%', background: '#000', display: 'flex', flexDirection: 'column', fontFamily: F }}>

      {/* Full-bleed map */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <TripMap
          style={mapStyle}
          position={position}
          track={track}
          entries={locations.length ? locations : legacyEntries}
          zoom={13}
          showHoverPopup
          trip={trip}
          offlineRegionIds={trip?.offlineRegions}
        />

        {/* Top pill */}
        <div style={{ position: 'absolute', top: 10, left: 12, right: 12, display: 'flex', gap: 8, zIndex: 10 }}>
          <div style={{ flex: 1, background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(10px)',
                        borderRadius: 14, padding: '9px 14px', boxShadow: '0 2px 14px rgba(0,0,0,.14)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: T.text, letterSpacing: -.3 }}>
                  {trip?.name || 'No active trip'}
                </div>
                <div style={{ fontSize: 11, color: T.textSub, marginTop: 1 }}>
                  {trip ? `${track.length} pts recorded` : 'Start a trip to begin tracking'}
                </div>
              </div>
              {tracking && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5,
                               background: T.accent, borderRadius: 10, padding: '4px 9px' }}>
                  <div style={{ width: 6, height: 6, borderRadius: 3, background: '#5DBE7E',
                                 animation: 'pulse 2s infinite' }} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'white', letterSpacing: .8 }}>LIVE</span>
                </div>
              )}
            </div>
          </div>

          {/* Style toggle */}
          <div onClick={() => setMapStyle(s => s === 'outdoors-v12' ? 'satellite-streets-v12' : 'outdoors-v12')}
               style={{ width: 44, height: 44, borderRadius: 22, background: 'rgba(255,255,255,0.95)',
                         backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center',
                         justifyContent: 'center', boxShadow: '0 2px 10px rgba(0,0,0,.12)', cursor: 'pointer' }}>
            <Ic d={ICONS.map} size={20} color={T.accent} sw={1.8} />
          </div>
        </div>

        {/* GPS error */}
        {error && (
          <div style={{ position: 'absolute', top: 70, left: 12, right: 12, zIndex: 10,
                        background: '#FBF0E4', borderRadius: 10, padding: '8px 12px',
                        fontSize: 11, color: T.amber, fontWeight: 600 }}>
            GPS: {error}
          </div>
        )}

        {/* Stats bar */}
        <div style={{ position: 'absolute', bottom: 14, left: 12, right: 12, zIndex: 10 }}>
          <div style={{ background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(10px)',
                        borderRadius: 16, padding: '12px 6px', boxShadow: '0 4px 22px rgba(0,0,0,.16)',
                        display: 'flex' }}>
            {[
              { val: stats.miles,  unit: 'mi',  label: 'Distance' },
              { val: stats.elev,   unit: 'ft',  label: 'Elevation' },
              { val: stats.pts,    unit: 'pts', label: 'Points' },
              { val: position ? `${position.accuracy?.toFixed(0)}` : '—', unit: 'm', label: 'Accuracy' },
            ].map((s, i, arr) => (
              <div key={i} style={{ flex: 1, textAlign: 'center',
                                     borderRight: i < arr.length - 1 ? `1px solid ${T.border}` : 'none' }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: T.text, letterSpacing: -.5, lineHeight: 1 }}>
                  {s.val}<span style={{ fontSize: 10, fontWeight: 500, color: T.textSub }}>{s.unit}</span>
                </div>
                <div style={{ fontSize: 9.5, color: T.textFaint, marginTop: 3, fontWeight: 500 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <BottomNav active="map" onNav={onNav} onFab={onFab} trip={trip} />
    </div>
  );
}

function entryColor(type) {
  const map = { campsite: '#B8702E', water: '#3A72A8', wildlife: '#4A7A34', rapid: '#3A72A8', note: '#6B6763' };
  return map[type] || '#2C5F3E';
}

function locationSymbol(type) {
  const map = {
    'put-in': '🟢',
    'take-out': '🔴',
    camp: '⛺',
    hazard: '⚠',
    'point-of-interest': '📍',
  };
  return map[type] || '📍';
}

function computeStats(track) {
  if (!track.length) return { miles: '0.0', elev: '0', pts: '0' };
  let dist = 0;
  for (let i = 1; i < track.length; i++) {
    dist += haversine(track[i - 1], track[i]);
  }
  const alts = track.filter(p => p.alt != null).map(p => p.alt);
  const elevGain = alts.length > 1
    ? alts.reduce((acc, a, i) => i > 0 && a > alts[i - 1] ? acc + (a - alts[i - 1]) : acc, 0)
    : 0;
  return {
    miles: (dist * 0.000621371).toFixed(1),
    elev: Math.round(elevGain * 3.28084).toLocaleString(),
    pts: track.length.toString(),
  };
}

function haversine(a, b) {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
