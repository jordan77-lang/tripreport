import { Ic } from './Ic';
import { T, F } from '../tokens';
import { ts } from '../lib/textScale';
import { EVENT_CAPTURE_TYPES } from '../lib/eventTypes';

export function EventTypePicker({ onSelect, title = 'Log an event', hint = 'Creates an event at this location — add photos, gauge readings, and notes on the next screen.', compact = false }) {
  return (
    <div style={{ marginBottom: compact ? 0 : 12 }}>
      <div style={{ fontSize: ts(13), fontWeight: 800, color: T.text, marginBottom: 4 }}>{title}</div>
      {hint && (
        <div style={{ fontSize: ts(11), color: T.textSub, lineHeight: 1.45, marginBottom: 10 }}>{hint}</div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {EVENT_CAPTURE_TYPES.map((item) => (
          <button
            key={item.type}
            type="button"
            onClick={() => onSelect(item.type)}
            style={{
              border: `1px solid ${T.border}`,
              borderRadius: 12,
              padding: '11px 10px',
              background: T.card,
              cursor: 'pointer',
              fontFamily: F,
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              textAlign: 'left',
            }}
          >
            <div style={{
              width: 32,
              height: 32,
              borderRadius: 9,
              background: `${item.col}18`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}>
              <Ic d={item.icon} size={15} color={item.col} sw={1.8} />
            </div>
            <span style={{ fontSize: ts(12), fontWeight: 700, color: T.text, lineHeight: 1.25 }}>{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
