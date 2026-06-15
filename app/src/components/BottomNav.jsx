import { Ic } from './Ic';
import { T, F, ICONS } from '../tokens';

const HOME_TAB = { id: 'home', label: 'Home', d: ICONS.home, d2: ICONS.home2 };
const TRIP_TABS = [
  { id: 'trip', label: 'Trip', d: ICONS.tent, d2: 'M12 3v14' },
  { id: 'map', label: 'Map', d: ICONS.map, d2: ICONS.map2 },
  { id: 'log', label: 'Journal', d: ICONS.journal, d2: ICONS.journal2 },
];

export function BottomNav({ active = 'home', onNav, trip }) {
  const showFieldTabs = trip?.status === 'active';
  const tabs = trip
    ? [HOME_TAB, TRIP_TABS[0], ...(showFieldTabs ? TRIP_TABS.slice(1) : [])]
    : [HOME_TAB];

  return (
    <div style={{ height: 64, background: T.card, borderTop: `1px solid ${T.border}`,
                  display: 'flex', alignItems: 'center', paddingBottom: 2, flexShrink: 0 }}>
      {tabs.map(t => (
        <div key={t.id}
          onClick={() => onNav?.(t.id)}
          style={{ flex: 1, display: 'flex', flexDirection: 'column', cursor: 'pointer',
                   alignItems: 'center', justifyContent: 'center', gap: 2, position: 'relative',
                   minWidth: 0, padding: '0 2px' }}>
          {active === t.id && (
            <div style={{ position: 'absolute', top: -1, width: 26, height: 3,
                           background: T.accent, borderRadius: 2 }} />
          )}
          <Ic d={t.d} d2={t.d2} size={trip ? 20 : 21}
              color={active === t.id ? T.accent : T.textFaint}
              sw={active === t.id ? 2.2 : 1.6} />
          <span style={{ fontSize: trip ? 9 : 9.5, color: active === t.id ? T.accent : T.textFaint,
                          fontWeight: active === t.id ? 700 : 400, fontFamily: F,
                          letterSpacing: 0.1, maxWidth: '100%', overflow: 'hidden',
                          textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.label}</span>
        </div>
      ))}
    </div>
  );
}
