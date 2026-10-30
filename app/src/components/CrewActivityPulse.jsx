import { getCurrentUserId } from '../lib/storage';
import { buildCrewActivityFeed } from '../lib/tripDashboard';
import gearIcon from '../assets/gear.png';
import skilletIcon from '../assets/skillet.png';
import placeIcon from '../assets/place.png';

// Custom artwork that replaces an activity emoji.
const ACTIVITY_ICONS = { '🎒': gearIcon, '🍳': skilletIcon, '📍': placeIcon };

export function CrewActivityPulse({ trip, onOpen, limit = 4, style }) {
  const items = buildCrewActivityFeed(trip, getCurrentUserId(), limit);
  if (items.length === 0) return null;
  return (
    <div className="dashboard-crew-activity" style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(42,92,142,0.12)', ...style }}>
      <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, opacity: 0.72, marginBottom: 6 }}>
        Crew activity pulse
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onOpen(item.screen || 'trip', item.params || {})}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
              padding: '6px 8px', borderRadius: 8, border: 'none', background: 'rgba(255,255,255,0.55)',
              cursor: 'pointer', fontSize: 12, color: 'inherit', fontFamily: 'inherit',
            }}
          >
            {ACTIVITY_ICONS[item.icon]
              ? <img src={ACTIVITY_ICONS[item.icon]} alt="" aria-hidden="true" width={22} height={22} style={{ flexShrink: 0, objectFit: 'contain' }} />
              : <span aria-hidden="true" style={{ fontSize: 13 }}>{item.icon}</span>}
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.text}</span>
            <span aria-hidden="true" style={{ opacity: 0.6 }}>→</span>
          </button>
        ))}
      </div>
    </div>
  );
}
