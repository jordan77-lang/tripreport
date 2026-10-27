import { useState } from 'react';
import { getTrip, saveTrip } from '../lib/storage';
import {
  applyImportPlacement,
  combineLocations,
  dismissDuplicateLocationPair,
  distanceMeters,
  duplicateLocations,
  nearbyEventsForLocations,
} from '../lib/tripTimeline';
import { T, F } from '../tokens';
import { ts } from '../lib/textScale';

export function DuplicatePlacesBanner({ trip, onCombined }) {
  const [, setDismissTick] = useState(0);
  const pairs = duplicateLocations(trip);
  const nearbyEvents = nearbyEventsForLocations(trip);
  if (!pairs.length && !nearbyEvents.length) return null;

  function combine(keep, other) {
    const latest = getTrip(trip.id);
    if (!latest) return;
    saveTrip(combineLocations(latest, keep.id, other.id));
    onCombined?.();
  }

  function keepPlacesSeparate(a, b) {
    dismissDuplicateLocationPair(trip?.id, a.id, b.id);
    setDismissTick((n) => n + 1);
  }

  function attachItemToLocation(suggestion) {
    const latest = getTrip(trip.id);
    if (!latest) return;
    saveTrip(applyImportPlacement(latest, {
      places: [],
      items: [{ ...suggestion, action: 'add' }],
    }));
    onCombined?.();
  }

  function keepItemSeparate(suggestion) {
    const prefix = suggestion.kind === 'events' ? 'evt:' : 'ent:';
    dismissDuplicateLocationPair(trip?.id, prefix + suggestion.id, suggestion.targetId);
    setDismissTick((n) => n + 1);
  }

  return (
    <section aria-label="Duplicate places" style={{ background: '#FBF0E4', border: '1px solid #E8C9A0', borderRadius: 12, padding: '12px 14px', marginBottom: 12, fontFamily: F }}>
      {pairs.length > 0 && (
        <>
          <div style={{ fontSize: ts(14), fontWeight: 800, color: '#7A4A14', marginBottom: 4 }}>Same place, two pins</div>
          <p style={{ margin: '0 0 10px', fontSize: ts(13), color: '#7A4A14', lineHeight: 1.45 }}>
            These saved locations are within 200 m of each other or share a name. Combine them so everyone’s events and notes stay anchored to one stop.
          </p>
          {pairs.map(([a, b]) => {
            const dist = Number.isFinite(Number(a.lat)) && Number.isFinite(Number(b.lat))
              ? Math.round(distanceMeters(a.lat, a.lng, b.lat, b.lng))
              : null;
            const sameLabel = (a.name || '').trim().toLowerCase() === (b.name || '').trim().toLowerCase();
            const title = sameLabel ? a.name : `${a.name} & ${b.name}`;
            return (
              <div key={a.id + b.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: ts(13), color: T.text, fontWeight: 700 }}>
                  {title}{dist != null ? ` · ${dist} m apart` : ''}
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" onClick={() => combine(a, b)}
                    style={{ flexShrink: 0, minHeight: 38, border: 'none', borderRadius: 10, background: '#7A4A14', color: 'white', fontWeight: 800, fontSize: ts(12), padding: '6px 12px', cursor: 'pointer', fontFamily: F }}>
                    Combine
                  </button>
                  <button type="button" onClick={() => keepPlacesSeparate(a, b)}
                    style={{ flexShrink: 0, minHeight: 38, border: '1px solid #D6B48A', borderRadius: 10, background: 'white', color: '#7A4A14', fontWeight: 700, fontSize: ts(12), padding: '6px 10px', cursor: 'pointer', fontFamily: F }}>
                    Keep separate
                  </button>
                </div>
              </div>
            );
          })}
        </>
      )}

      {nearbyEvents.length > 0 && (
        <div style={{ marginTop: pairs.length > 0 ? 12 : 0, paddingTop: pairs.length > 0 ? 10 : 0, borderTop: pairs.length > 0 ? '1px solid #E8C9A0' : 'none' }}>
          <div style={{ fontSize: ts(14), fontWeight: 800, color: '#7A4A14', marginBottom: 4 }}>Events near a saved location</div>
          <p style={{ margin: '0 0 8px', fontSize: ts(13), color: '#7A4A14', lineHeight: 1.45 }}>
            These events happened within 200 m of a saved location. Add them to that location so your crew’s experiences stay together.
          </p>
          {nearbyEvents.map((s) => (
            <div key={s.kind + ':' + s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: ts(13), color: T.text }}>
                <strong>{s.name}</strong> · {s.distanceMeters} m from <strong>{s.targetName}</strong>
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" onClick={() => attachItemToLocation(s)}
                  style={{ flexShrink: 0, minHeight: 38, border: 'none', borderRadius: 10, background: '#7A4A14', color: 'white', fontWeight: 800, fontSize: ts(12), padding: '6px 12px', cursor: 'pointer', fontFamily: F }}>
                  Add to {s.targetName}
                </button>
                <button type="button" onClick={() => keepItemSeparate(s)}
                  style={{ flexShrink: 0, minHeight: 38, border: '1px solid #D6B48A', borderRadius: 10, background: 'white', color: '#7A4A14', fontWeight: 700, fontSize: ts(12), padding: '6px 10px', cursor: 'pointer', fontFamily: F }}>
                  Keep separate
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
