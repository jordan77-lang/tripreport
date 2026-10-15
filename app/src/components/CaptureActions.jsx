import { Ic } from './Ic';
import { T } from '../tokens';
import { ts } from '../lib/textScale';
import { eventTypesForTrip } from '../lib/eventTypes';

export function CaptureActions({ trip, onCapture, hideLocation = false }) {
  const types = eventTypesForTrip(trip).filter((item) => !(hideLocation && item.type === 'campsite'));
  return (
    <section aria-label="Quick capture">
      {!hideLocation && (
        <button type="button" onClick={() => onCapture('location')}
          style={{ width: '100%', minHeight: 48, marginBottom: 10, border: '1px solid ' + T.border,
            borderRadius: 12, background: T.card, color: T.text, fontSize: ts(14), fontWeight: 800, cursor: 'pointer' }}>
          Location
        </button>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
        {types.map((item) => (
          <button type="button" key={item.type} onClick={() => onCapture(item.type)}
            style={{ minHeight: 64, border: '1px solid ' + T.border, borderRadius: 14, background: T.card,
              color: T.text, display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 10,
              padding: '10px 12px', fontSize: ts(15), fontWeight: 800, cursor: 'pointer', textAlign: 'left' }}>
            <Ic d={item.icon} size={22} color={item.col} /><span>{item.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
