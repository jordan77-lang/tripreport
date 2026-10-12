import { Ic } from './Ic';
import { T, F, ICONS } from '../tokens';
import { ts } from '../lib/textScale';

const TABS = [
  { id: 'home', label: 'Trips', d: ICONS.home, d2: ICONS.home2 },
  { id: 'map', label: 'Map', d: ICONS.map, d2: ICONS.map2 },
  { id: 'capture', label: 'Log', d: ICONS.plus },
  { id: 'log', label: 'Journal', d: ICONS.journal, d2: ICONS.journal2 },
  { id: 'plan', label: 'Plan', d: ICONS.tent },
];

export function BottomNav({ active = 'home', onNav, trip }) {
  const hasOpenTrip = trip && trip.status !== 'completed';
  const tabs = hasOpenTrip ? TABS : [TABS[0]];
  return (
    <nav aria-label="Trip navigation" style={{ background: T.card, borderTop: '1px solid ' + T.border,
      flexShrink: 0, fontFamily: F, paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      {hasOpenTrip && active !== 'trip' && (
        <button type="button" onClick={() => onNav?.('trip')} aria-current={active === 'trip' ? 'page' : undefined}
          style={{ width: '100%', minHeight: 44, border: 'none', borderBottom: '1px solid ' + T.border,
            background: T.accentLight, color: T.accent, padding: '8px 16px', fontSize: ts(12), fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, cursor: 'pointer' }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{trip.name}</span>
          <span style={{ flexShrink: 0 }}>Trip details →</span>
        </button>
      )}
      <div style={{ display: 'flex', alignItems: 'stretch', minHeight: 68 }}>
        {tabs.map(tab => {
          const selected = active === tab.id;
          const capture = tab.id === 'capture';
          return (
            <button key={tab.id} type="button" onClick={() => onNav?.(tab.id)}
              aria-label={capture ? 'Log a moment' : tab.label}
              aria-current={selected ? 'page' : undefined}
              style={{ flex: 1, minWidth: 0, minHeight: 60, border: 'none', borderRadius: 10,
                margin: capture ? '6px 2px' : 0, background: capture ? T.accent : 'transparent',
                color: capture ? 'white' : selected ? T.accent : T.textSub, cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
                fontFamily: F, fontSize: ts(12), fontWeight: selected || capture ? 800 : 600 }}>
              <Ic d={tab.d} d2={tab.d2} size={22} color={capture ? 'white' : selected ? T.accent : T.textSub} sw={selected || capture ? 2.2 : 1.6} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
