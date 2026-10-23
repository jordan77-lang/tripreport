import { Ic } from './Ic';
import { T, F, ICONS } from '../tokens';
import { ts } from '../lib/textScale';
import { getCurrentUserId, isTripMember, isTripOpen } from '../lib/storage';

const TABS = [
  { id: 'home', label: 'Trips', d: ICONS.home, d2: ICONS.home2 },
  { id: 'trip', label: 'Current trip', d: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z', d2: 'M4 22v-7' },
  { id: 'capture', label: 'Add', d: ICONS.plus },
  { id: 'plan', label: 'Plan', d: ICONS.tent },
];

export function BottomNav({ active = 'home', onNav, trip }) {
  const hasOpenTrip = trip && trip.status !== 'completed';
  const tabs = hasOpenTrip ? TABS : trip ? [TABS[0], TABS[1]] : [TABS[0]];
  const canAdd = isTripOpen(trip) && isTripMember(trip, getCurrentUserId());
  return (
    <nav aria-label="Trip navigation" style={{ background: T.card, borderTop: '1px solid ' + T.border,
      flexShrink: 0, fontFamily: F, paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <div style={{ display: 'flex', alignItems: 'stretch', minHeight: 68 }}>
        {tabs.map(tab => {
          const selected = active === tab.id || (active === 'map' && tab.id === 'trip');
          const add = tab.id === 'capture';
          return (
            <button key={tab.id} type="button" onClick={() => onNav?.(tab.id)}
              aria-label={tab.label}
              disabled={add && !canAdd}
              aria-current={selected ? 'page' : undefined}
              style={{ flex: hasOpenTrip && tab.id === 'plan' ? 2 : 1, minWidth: 0, minHeight: 60, border: 'none', borderRadius: 10,
                opacity: add && !canAdd ? 0.45 : 1,
                background: 'transparent', color: selected ? T.accent : T.textSub, cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
                fontFamily: F, fontSize: ts(12), fontWeight: selected ? 800 : 600 }}>
              <span style={add ? { display: 'flex', alignItems: 'center', justifyContent: 'center', width: 46, height: 38, borderRadius: 14, background: T.accent, boxShadow: '0 3px 10px #2C5F3E30' } : { display: 'flex', height: 38, alignItems: 'center' }}>
                <Ic d={tab.d} d2={tab.d2} size={add ? 26 : 22} color={add ? 'white' : selected ? T.accent : T.textSub} sw={add || selected ? 2.2 : 1.6} />
              </span>
              <span style={{ lineHeight: 1.2 }}>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
