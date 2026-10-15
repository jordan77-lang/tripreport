import { getTrip, saveTrip } from '../lib/storage';
import { combineLocations, duplicateLocations } from '../lib/tripTimeline';
import { T, F } from '../tokens';
import { ts } from '../lib/textScale';

export function DuplicatePlacesBanner({ trip, onCombined }) {
  const pairs = duplicateLocations(trip);
  if (!pairs.length) return null;

  function combine(keep, other) {
    const latest = getTrip(trip.id);
    if (!latest) return;
    saveTrip(combineLocations(latest, keep.id, other.id));
    onCombined?.();
  }

  return (
    <section aria-label="Duplicate places" style={{ background: '#FBF0E4', border: '1px solid #E8C9A0', borderRadius: 12, padding: '12px 14px', marginBottom: 12, fontFamily: F }}>
      <div style={{ fontSize: ts(14), fontWeight: 800, color: '#7A4A14', marginBottom: 4 }}>Same place, two pins</div>
      <p style={{ margin: '0 0 10px', fontSize: ts(13), color: '#7A4A14', lineHeight: 1.45 }}>
        These places share a name and are within about 110 metres. Combine them so everyone’s notes stay on one stop. Separate visits stay separate.
      </p>
      {pairs.map(([a, b]) => (
        <div key={a.id + b.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 8 }}>
          <span style={{ fontSize: ts(13), color: T.text, fontWeight: 700 }}>{a.name}</span>
          <button type="button" onClick={() => combine(a, b)}
            style={{ flexShrink: 0, minHeight: 40, border: 'none', borderRadius: 10, background: '#7A4A14', color: 'white', fontWeight: 800, fontSize: ts(13), padding: '8px 12px', cursor: 'pointer', fontFamily: F }}>
            Combine
          </button>
        </div>
      ))}
    </section>
  );
}
