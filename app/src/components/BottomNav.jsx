import { Ic } from './Ic';
import { T, F, ICONS } from '../tokens';
import { ts } from '../lib/textScale';

const TABS = [
  { id: 'home', label: 'Home', d: ICONS.home, d2: ICONS.home2 },
  { id: 'trip', label: 'Trip', d: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z', d2: 'M4 22v-7' },
  { id: 'log', label: 'Add', d: ICONS.journal, d2: ICONS.journal2 },
];

export function BottomNav({ active = 'home', onNav, trip }) {
  const hasOpenTrip = trip && trip.status !== 'completed';
  const tabs = hasOpenTrip ? TABS : [TABS[0]];
  return (
    <nav aria-label="Trip navigation" style={{ background: T.card, borderTop: '1px solid ' + T.border,
      flexShrink: 0, fontFamily: F, paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <div style={{ display: 'flex', alignItems: 'stretch', minHeight: 68 }}>
        {tabs.map(tab => {
          const selected = active === tab.id;
          return (
            <button key={tab.id} type="button" onClick={() => onNav?.(tab.id)}
              aria-label={tab.label}
              aria-current={selected ? 'page' : undefined}
              style={{ flex: 1, minWidth: 0, minHeight: 60, border: 'none', borderRadius: 10,
                background: 'transparent', color: selected ? T.accent : T.textSub, cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
                fontFamily: F, fontSize: ts(12), fontWeight: selected ? 800 : 600 }}>
              <Ic d={tab.d} d2={tab.d2} size={22} color={selected ? T.accent : T.textSub} sw={selected ? 2.2 : 1.6} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
