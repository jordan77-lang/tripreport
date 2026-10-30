import { Ic } from './Ic';
import { T, ICONS } from '../tokens';
import { ts } from '../lib/textScale';
import { eventTypesForTrip } from '../lib/eventTypes';
import { VIDEO_ENABLED } from '../lib/featureFlags';

export function CaptureActions({ trip, onCapture }) {
  const types = eventTypesForTrip(trip).filter(item => item.type !== 'campsite');
  if (VIDEO_ENABLED) types.push({ type: 'video', label: 'Video', icon: ICONS.video, col: '#C05050' });
  return (
    <section aria-label="Places and observations">
      <p style={{ color: T.textSub, fontSize: ts(14), margin: '12px 0 10px', fontWeight: 700 }}>Places &amp; observations</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
        {types.map((item) => (
          <button type="button" key={item.type} onClick={() => onCapture(item.type)}
            style={{ minHeight: 64, border: '1px solid ' + T.border, borderRadius: 14, background: T.card,
              color: T.text, display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 10,
              padding: '10px 12px', fontSize: ts(15), fontWeight: 800, cursor: 'pointer', textAlign: 'left' }}>
            {item.img
              ? <img src={item.img} alt="" aria-hidden="true" width={34} height={34} style={{ objectFit: 'contain', flexShrink: 0 }} />
              : <Ic d={item.icon} size={22} color={item.col} />}<span>{item.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
