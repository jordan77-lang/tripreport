import { useState } from 'react';
import { Ic } from './Ic';
import { T, F, ICONS } from '../tokens';
import { fetchWeatherAtTime } from '../lib/weather';
import {
  celsiusToF,
  resolveObservedAtIso,
  weatherFieldsFromSnapshot,
} from '../lib/eventWeather';

/**
 * Event time picker, shown for every event type.
 *
 * The event's time is the source of truth for its entries: weather and gauge
 * lookups inside an event key off it, so it can never be left implicit.
 */
export function EventTimeEditSection({ draft, setDraft }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: T.textSub, marginBottom: 6 }}>When did this happen</div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        {[{ id: 'now', label: 'Now' }, { id: 'custom', label: 'Pick date & time' }].map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => setDraft((d) => ({ ...d, observedTimeMode: opt.id }))}
            style={{
              padding: '6px 11px',
              borderRadius: 14,
              cursor: 'pointer',
              fontSize: 10.5,
              fontWeight: 700,
              fontFamily: F,
              background: draft.observedTimeMode === opt.id ? '#2A5C8E' : T.card,
              color: draft.observedTimeMode === opt.id ? 'white' : T.textSub,
              border: draft.observedTimeMode === opt.id ? 'none' : `1px solid ${T.border}`,
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {draft.observedTimeMode === 'custom' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="date"
            value={draft.observedDate}
            onChange={(e) => setDraft((d) => ({ ...d, observedDate: e.target.value }))}
            style={fieldStyle}
          />
          <input
            type="time"
            value={draft.observedTime}
            onChange={(e) => setDraft((d) => ({ ...d, observedTime: e.target.value }))}
            style={fieldStyle}
          />
        </div>
      )}
      <div style={{ fontSize: 10, color: T.textFaint, marginTop: 6, lineHeight: 1.4 }}>
        Weather and river flow logged here use this time.
      </div>
    </div>
  );
}

export function EventWeatherEditSection({ draft, setDraft, location }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const hasCoords = location?.lat != null && location?.lng != null;
  const hasWeather = draft.weatherSummary || draft.weatherTempC != null;

  async function pullWeather() {
    setError(null);
    if (!hasCoords) {
      setError('This location needs GPS coordinates before weather can be pulled.');
      return;
    }
    const when = resolveObservedAtIso(draft);
    setDraft((d) => ({ ...d, observedTimeMode: d.observedTimeMode, observedAt: when }));

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setDraft((d) => ({
        ...d,
        weatherSyncPending: true,
        observedAt: when,
      }));
      setError('Offline — weather will sync when you are back online.');
      return;
    }

    setLoading(true);
    try {
      const weather = await fetchWeatherAtTime(location.lat, location.lng, when);
      setDraft((d) => ({
        ...d,
        observedAt: when,
        ...weatherFieldsFromSnapshot(weather),
        weatherSyncPending: false,
      }));
    } catch (err) {
      setError(err?.message || 'Could not fetch weather for that time.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ marginBottom: 10, padding: '10px 12px', borderRadius: 12, background: '#F7FAFC', border: '1px solid #D8E6F2' }}>
      <div style={{ fontSize: 10.5, fontWeight: 800, color: '#2A5C8E', marginBottom: 8, letterSpacing: 0.3 }}>
        WEATHER
      </div>

      <div style={{ fontSize: 10, color: T.textFaint, marginBottom: 8 }}>
        {hasCoords
          ? `Uses weather at ${location?.name || 'this location'} (${Number(location.lat).toFixed(4)}, ${Number(location.lng).toFixed(4)}).`
          : 'Add GPS to this location to enable weather lookup.'}
      </div>

      <button
        type="button"
        onClick={() => void pullWeather()}
        disabled={loading || !hasCoords}
        style={{
          width: '100%',
          height: 38,
          borderRadius: 10,
          border: '1px solid #3A72A840',
          background: loading || !hasCoords ? T.bg : '#E4EFF8',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          cursor: loading || !hasCoords ? 'not-allowed' : 'pointer',
          fontFamily: F,
          fontSize: 11.5,
          fontWeight: 700,
          color: loading || !hasCoords ? T.textFaint : '#2A5C8E',
          marginBottom: 8,
        }}
      >
        <Ic d={ICONS.compass} size={15} color={loading || !hasCoords ? T.textFaint : '#2A5C8E'} sw={1.8} />
        {loading ? 'Fetching weather…' : 'Pull weather for this time'}
      </button>

      {error && (
        <div style={{ fontSize: 10.5, color: T.amber, marginBottom: 8 }}>{error}</div>
      )}

      {draft.weatherSyncPending && !hasWeather && (
        <div style={{ fontSize: 10.5, color: T.textSub, marginBottom: 8 }}>
          Weather will sync when you are back online.
        </div>
      )}

      {hasWeather && (
        <div style={{ background: T.card, borderRadius: 10, border: `1px solid ${T.border}`, padding: '9px 10px', marginBottom: 8 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: T.text }}>{draft.weatherSummary || 'Conditions'}</div>
          <div style={{ fontSize: 10.5, color: T.textSub, marginTop: 3 }}>
            {draft.weatherFetchedAt ? new Date(draft.weatherFetchedAt).toLocaleString() : 'For selected time'}
          </div>
          <div style={{ fontSize: 11, color: T.text, marginTop: 4 }}>
            {draft.weatherTempC != null ? `${Math.round(celsiusToF(draft.weatherTempC))}°F` : 'Temp n/a'}
            {draft.weatherWindKph != null ? ` · Wind ${Math.round(draft.weatherWindKph)} km/h` : ''}
          </div>
        </div>
      )}

      <textarea
        value={draft.weatherObservation || ''}
        onChange={(e) => setDraft((d) => ({ ...d, weatherObservation: e.target.value }))}
        placeholder="Your weather notes (wind gusts, visibility, how it felt…)"
        rows={2}
        style={{
          width: '100%',
          border: `1.5px solid ${T.border}`,
          borderRadius: 10,
          padding: '8px 10px',
          fontSize: 11.5,
          fontFamily: F,
          boxSizing: 'border-box',
          outline: 'none',
          background: T.card,
          resize: 'vertical',
        }}
      />
    </div>
  );
}

export function EventWeatherSummary({ event }) {
  if (!event?.observedAt && !event?.weatherSummary && event?.weatherTempC == null && !event?.weatherSyncPending) {
    return null;
  }

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${T.border}` }}>
      {event.observedAt && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: T.textSub, marginBottom: 8 }}>
          <Ic d={ICONS.compass} size={12} color={T.textFaint} sw={1.8} />
          <span>{new Date(event.observedAt).toLocaleString()}</span>
        </div>
      )}
      {event.weatherSyncPending && (
        <div style={{ fontSize: 10.5, color: T.amber, marginBottom: 8 }}>Weather sync pending…</div>
      )}
      {(event.weatherSummary || event.weatherTempC != null) && (
        <div style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', background: '#EBF3FA', borderRadius: 10, padding: '7px 10px' }}>
          <Ic d={ICONS.compass} size={14} color="#517EA3" sw={1.8} />
          {event.weatherSummary && <span style={{ fontSize: 11.5, fontWeight: 700, color: '#2A5C8E' }}>{event.weatherSummary}</span>}
          {event.weatherTempC != null && (
            <span style={{ fontSize: 11, color: T.text }}>{Math.round(celsiusToF(event.weatherTempC))}°F</span>
          )}
          {event.weatherWindKph != null && (
            <span style={{ fontSize: 10.5, color: T.textSub }}>Wind {Math.round(event.weatherWindKph)} km/h</span>
          )}
        </div>
      )}
      {event.weatherObservation && (
        <p style={{ margin: '8px 0 0', fontSize: 11.5, color: T.textSub, lineHeight: 1.5 }}>
          {event.weatherObservation}
        </p>
      )}
    </div>
  );
}

const fieldStyle = {
  flex: 1,
  minWidth: 0,
  border: `1.5px solid ${T.border}`,
  borderRadius: 10,
  padding: '8px 10px',
  fontSize: 11.5,
  fontFamily: F,
  color: T.text,
  background: T.card,
  outline: 'none',
  boxSizing: 'border-box',
};
