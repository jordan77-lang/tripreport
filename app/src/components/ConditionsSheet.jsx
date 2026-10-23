import { useState } from 'react';
import { addEntry } from '../lib/storage';
import { fetchWeatherAtTime } from '../lib/weather';
import { fetchGauge, fetchNearbyGaugesByGps, findNearbyKnownGauges } from '../lib/usgs';
import { T, F } from '../tokens';
import { ts } from '../lib/textScale';

function toDatetimeLocal(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function readGps() {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Location is unavailable on this phone.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(new Error(err?.message || 'Could not read GPS.')),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 15000 },
    );
  });
}

export function ConditionsSheet({ trip, defaultLocationId = null, lockLocation = false, onCancel, onSaved }) {
  const places = (trip?.locations || []).filter((loc) => loc?.lat != null && loc?.lng != null);
  const [useHere, setUseHere] = useState(!defaultLocationId);
  const [placeId, setPlaceId] = useState(defaultLocationId || places[0]?.id || '');
  const [whenMode, setWhenMode] = useState('now');
  const [whenLocal, setWhenLocal] = useState(() => toDatetimeLocal(new Date()));
  const [includeWeather, setIncludeWeather] = useState(true);
  const [includeFlow, setIncludeFlow] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const selected = places.find((loc) => loc.id === placeId) || null;

  async function save() {
    if (!includeWeather && !includeFlow) {
      setError('Choose weather, streamflow, or both.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (lockLocation && !selected) throw new Error('Choose a saved location for these conditions.');
      let coords = null;
      let location = null;
      if (!useHere && selected) {
        location = selected;
        coords = { lat: Number(selected.lat), lng: Number(selected.lng) };
      } else {
        coords = await readGps();
      }
      const observedAt = whenMode === 'now' ? new Date().toISOString() : new Date(whenLocal).toISOString();
      if (!Number.isFinite(new Date(observedAt).getTime())) throw new Error('Pick a valid date and time.');

      const entry = {
        type: 'conditions',
        title: 'Weather & flow',
        locationId: location?.id,
        lat: coords.lat,
        lng: coords.lng,
        observedAt,
        weatherRequestedAt: observedAt,
        gaugeRequestedAt: observedAt,
      };

      if (includeWeather) {
        try {
          const weather = await fetchWeatherAtTime(coords.lat, coords.lng, observedAt);
          entry.weatherTempC = weather.temperatureC;
          entry.weatherFeelsLikeC = weather.feelsLikeC;
          entry.weatherWindKph = weather.windKph;
          entry.weatherWindDirectionDeg = weather.windDirectionDeg;
          entry.weatherCode = weather.weatherCode;
          entry.weatherSummary = weather.summary;
          entry.weatherFetchedAt = weather.fetchedAt;
          entry.weatherSource = weather.source;
          entry.weatherSyncPending = false;
        } catch {
          entry.weatherSyncPending = true;
        }
      }

      if (includeFlow) {
        try {
          let site = (await fetchNearbyGaugesByGps(coords.lat, coords.lng, { radiusMiles: 120, limit: 1 }))[0];
          if (!site) site = findNearbyKnownGauges(coords.lat, coords.lng, { limit: 1, maxMiles: 500 })[0];
          if (!site?.id) throw new Error('No gauge nearby');
          const live = await fetchGauge(site.id, { at: observedAt });
          entry.gaugeSiteId = site.id;
          entry.gaugeSiteName = live.siteName || site.name || site.siteName || '';
          entry.cfs = live.cfs ?? null;
          entry.gaugeHt = live.gaugeHt ?? null;
          entry.gaugeFetchedAt = live.updatedAt || observedAt;
          entry.gaugeSyncPending = live.cfs == null;
        } catch {
          entry.gaugeSyncPending = true;
        }
      }

      const saved = addEntry(trip.id, entry);
      if (!saved) throw new Error('Could not save conditions on this trip.');
      const waiting = saved.weatherSyncPending || saved.gaugeSyncPending;
      const placeName = location?.name || 'this spot';
      onSaved?.(waiting
        ? `Saved for ${placeName}. Weather and flow will fill in when you have service.`
        : `Weather and flow added to ${placeName}.`);
    } catch (err) {
      setError(err?.message || 'Could not save conditions.');
    } finally {
      setBusy(false);
    }
  }

  const choice = (active) => ({
    minHeight: 40,
    padding: '8px 12px',
    borderRadius: 10,
    border: active ? 'none' : `1px solid ${T.border}`,
    background: active ? T.accent : T.card,
    color: active ? 'white' : T.text,
    fontWeight: 800,
    fontSize: ts(14),
    fontFamily: F,
    cursor: 'pointer',
  });

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: T.bg, fontFamily: F, padding: 20 }}>
      <button type="button" onClick={onCancel} style={{ minHeight: 44, padding: '8px 12px', border: `1px solid ${T.border}`, borderRadius: 10, background: T.card, color: T.text, fontSize: ts(14), cursor: 'pointer', fontFamily: F }}>← Back</button>
      <h1 style={{ fontSize: ts(24), marginTop: 20, color: T.text }}>Weather & flow</h1>
      <p style={{ fontSize: ts(16), color: T.textSub, lineHeight: 1.5, margin: '8px 0 18px' }}>
        Save conditions for this place and time. Without service, the reading fills in on the next sync.
      </p>

      <div style={{ fontSize: ts(14), fontWeight: 800, color: T.text, marginBottom: 8 }}>Place</div>
      {lockLocation ? <p style={{ fontSize: ts(15), marginBottom: 16, fontWeight: 700, color: T.accent }}>{selected?.name}</p> : <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <button type="button" onClick={() => setUseHere(true)} style={choice(useHere)}>Here</button>
        <button type="button" onClick={() => setUseHere(false)} style={choice(!useHere)} disabled={!places.length}>A saved place</button>
      </div>}
      {!lockLocation && !useHere && (
        <select aria-label="Saved place" value={placeId} onChange={(e) => setPlaceId(e.target.value)}
          style={{ width: '100%', minHeight: 44, marginBottom: 16, borderRadius: 10, border: `1px solid ${T.border}`, padding: '10px 12px', fontFamily: F, fontSize: ts(15), background: T.card }}>
          {places.map((loc) => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
        </select>
      )}

      <div style={{ fontSize: ts(14), fontWeight: 800, color: T.text, margin: '8px 0' }}>Time</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <button type="button" onClick={() => setWhenMode('now')} style={choice(whenMode === 'now')}>Now</button>
        <button type="button" onClick={() => setWhenMode('earlier')} style={choice(whenMode === 'earlier')}>Another time</button>
      </div>
      {whenMode === 'earlier' && (
        <input type="datetime-local" aria-label="Conditions time" value={whenLocal} onChange={(e) => setWhenLocal(e.target.value)}
          style={{ width: '100%', minHeight: 44, marginBottom: 16, borderRadius: 10, border: `1px solid ${T.border}`, padding: '10px 12px', fontFamily: F, fontSize: ts(15), background: T.card, boxSizing: 'border-box' }} />
      )}

      <div style={{ fontSize: ts(14), fontWeight: 800, color: T.text, margin: '8px 0' }}>Reading</div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, fontSize: ts(15), color: T.text }}>
        <input type="checkbox" checked={includeWeather} onChange={(e) => setIncludeWeather(e.target.checked)} /> Weather
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, fontSize: ts(15), color: T.text, marginBottom: 16 }}>
        <input type="checkbox" checked={includeFlow} onChange={(e) => setIncludeFlow(e.target.checked)} /> Streamflow
      </label>

      {error && <p role="alert" style={{ color: '#8A1414', fontSize: ts(14) }}>{error}</p>}
      <button type="button" disabled={busy} onClick={() => void save()}
        style={{ minHeight: 48, padding: '12px 18px', border: 'none', borderRadius: 12, background: T.accent, color: 'white', fontWeight: 800, fontSize: ts(16), cursor: 'pointer', fontFamily: F }}>
        {busy ? 'Saving…' : 'Save conditions'}
      </button>
    </div>
  );
}
