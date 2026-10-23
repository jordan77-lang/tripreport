import { routeStats } from '../lib/gpsRecorder';
import { useState, useEffect } from 'react';
import { TripMap } from '../components/TripMap';
import { BottomNav } from '../components/BottomNav';
import { DuplicatePlacesBanner } from '../components/DuplicatePlacesBanner';
import { duplicateLocations } from '../lib/tripTimeline';
import { Ic } from '../components/Ic';
import { T, F, ICONS } from '../tokens';
import { getTripOfflineMapReadiness } from '../lib/offlineMaps';

export function Navigator({ trip, onNav, onFab, gps, onTripUpdate }) {
  const [mapStyle, setMapStyle] = useState('outdoors-v12');
  const [offlineReadiness, setOfflineReadiness] = useState(null);
  const { position:recordingPosition, tracking, error } = gps || {};
  const [locatedPosition,setLocatedPosition]=useState(null);
  const [locating,setLocating]=useState(false),[locateError,setLocateError]=useState(null);
  const position=tracking?recordingPosition:(locatedPosition||recordingPosition);
  function locateMe(){
    if(!navigator.geolocation){setLocateError('Location is unavailable.');return;}
    setLocating(true);setLocateError(null);
    navigator.geolocation.getCurrentPosition(p=>{
      setLocatedPosition({lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy});setLocating(false);
    },e=>{setLocateError(e.message);setLocating(false);},{enableHighAccuracy:true,timeout:15000,maximumAge:0});
  }

  const track = trip?.track ?? [];
  const locations = (trip?.locations ?? [])
    .filter(l => l.lng && l.lat)
    .map(l => ({ ...l, title: l.name, col: '#3A72A8', symbol: l.icon || locationSymbol(l.type) }));
  const legacyEntries = locations.length
    ? []
    : (trip?.entries ?? [])
      .filter(e => e.lng && e.lat)
      .map(e => ({ ...e, col: entryColor(e.type) }));

  const stats = routeStats(track);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void getTripOfflineMapReadiness(trip).then((result) => {
        if (!cancelled) setOfflineReadiness(result);
      });
    };
    load();
    const onVis = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [trip?.id, trip?.offlineRegions]);

  return (
    <div style={{ height: '100%', background: '#000', display: 'flex', flexDirection: 'column', fontFamily: F }}>

      {/* Full-bleed map */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <TripMap
          style={mapStyle}
          position={position}
          center={locatedPosition}
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

        {/* Offline map status */}
        {offlineReadiness?.configured && (
          <div style={{
            position: 'absolute',
            top: 62,
            left: 12,
            right: 12,
            zIndex: 10,
            background: offlineReadiness.ready ? 'rgba(235,245,235,0.96)' : 'rgba(251,240,228,0.96)',
            borderRadius: 10,
            padding: '7px 11px',
            fontSize: 10.5,
            fontWeight: 700,
            color: offlineReadiness.ready ? '#2A6A14' : '#8A5526',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            boxShadow: '0 2px 10px rgba(0,0,0,.08)',
          }}>
            <Ic d={offlineReadiness.ready ? 'M20 6L9 17l-5-5' : ICONS.compass} size={13} color={offlineReadiness.ready ? '#2A6A14' : '#8A5526'} sw={offlineReadiness.ready ? 3 : 1.8} />
            <span>
              {offlineReadiness.ready
                ? 'Offline map on this device'
                : 'Offline map not downloaded — open Trip Plan → Maps'}
            </span>
          </div>
        )}

        {/* GPS error */}
        {(error || locateError) && (
          <div style={{ position: 'absolute', top: offlineReadiness?.configured ? 98 : 70, left: 12, right: 12, zIndex: 10,
                        background: '#FBF0E4', borderRadius: 10, padding: '8px 12px',
                        fontSize: 11, color: T.amber, fontWeight: 600 }}>
            GPS: {error || locateError}
          </div>
        )}

        <button type="button" disabled={locating} onClick={locateMe}
          style={{position:'absolute',bottom:94,right:12,zIndex:10,minHeight:44,padding:'10px 14px',border:'1px solid '+T.border,borderRadius:12,background:T.card,color:T.accent,fontWeight:700}}>
          {locating?'Finding location…':'Locate me'}
        </button>
        {/* Stats bar */}
        <div style={{ position: 'absolute', bottom: 14, left: 12, right: 12, zIndex: 10 }}>
          <div style={{ background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(10px)',
                        borderRadius: 16, padding: '12px 6px', boxShadow: '0 4px 22px rgba(0,0,0,.16)',
                        display: 'flex' }}>
            {[
              { val: stats.miles,  unit: 'mi',  label: 'Recorded distance' },
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

      {duplicateLocations(trip || {}).length > 0 && (
        <div style={{ background: T.bg, padding: '8px 12px 0' }}>
          <DuplicatePlacesBanner trip={trip} onCombined={onTripUpdate} />
        </div>
      )}
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
    scout: '👀',
    'rapid-scout': '👀',
    hike: '🥾',
    'hiking-location': '🥾',
    camp: '⛺',
    campsite: '⛺',
    interest: '🏛',
    'point-of-interest': '📍',
    shopping: '🛒',
    hotel: '🏨',
    meeting: '🗒',
    hazard: '⚠',
  };
  return map[type] || '📍';
}
