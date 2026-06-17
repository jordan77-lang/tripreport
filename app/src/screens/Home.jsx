import { useMemo, useState } from 'react';
import { Ic } from '../components/Ic';
import { BottomNav } from '../components/BottomNav';
import { SyncChip } from '../components/SyncChip';
import { MediaThumb } from '../components/MediaThumb';
import { T, F, ICONS } from '../tokens';
import { ts } from '../lib/textScale';
import { formatTripDate } from '../lib/tripEdit';
export function Home({ trip, allTrips = [], onNav, onFab, onOpenTrip, onSelectTrip, onOpenPlan, onJoinTrip, onOpenSettings, onOpenRecap, auth }) {
  const currentTrip = trip && trip.status !== 'completed' ? trip : null;
  const [tripSearch, setTripSearch] = useState('');
  const [pastTripsExpanded, setPastTripsExpanded] = useState(false);
  const entries = useMemo(() => currentTrip?.entries ?? [], [currentTrip?.entries]);
  const tripSyncState = currentTrip?.syncState || (entries.some(e => e.syncState === 'pending') ? 'pending' : 'synced');
  const openTrips = useMemo(() => {
    return (allTrips || [])
      .filter((t) => t.status !== 'completed')
      .sort((a, b) => {
        const aTs = a.startDate ? new Date(`${a.startDate}T00:00:00`).getTime() : (a.createdAt || 0);
        const bTs = b.startDate ? new Date(`${b.startDate}T00:00:00`).getTime() : (b.createdAt || 0);
        return aTs - bTs;
      });
  }, [allTrips]);
  const otherTrips = useMemo(() => {
    if (!currentTrip) return openTrips;
    return openTrips.filter((t) => t.id !== currentTrip.id);
  }, [openTrips, currentTrip]);

  const finalizedTrips = useMemo(() => {
    const query = tripSearch.trim().toLowerCase();
    return (allTrips || [])
      .filter((t) => t.status === 'completed')
      .filter((t) => {
        if (!query) return true;
        const participants = `${t.ownerId || ''} ${(t.collaborators || []).map((c) => c.handle || c.name || '').join(' ')}`;
        const hay = `${t.name || ''} ${t.location || ''} ${(t.types || []).join(' ')} ${participants}`.toLowerCase();
        return hay.includes(query);
      })
      .sort((a, b) => (b.endedAt || b.updatedAt || b.createdAt || 0) - (a.endedAt || a.updatedAt || a.createdAt || 0));
  }, [allTrips, tripSearch]);

  const visiblePastTrips = pastTripsExpanded ? finalizedTrips : finalizedTrips.slice(0, 4);

  const profileInitial = (auth?.profile?.display_name || auth?.user?.email || '?').charAt(0).toUpperCase();

  return (
    <div style={{ height: '100%', background: T.bg, display: 'flex', flexDirection: 'column', fontFamily: F, overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ background: T.card, padding: '12px 16px 14px', borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: ts(22), fontWeight: 800, color: T.text, letterSpacing: -.6 }}>TripReport</div>
            <div style={{ fontSize: ts(13), color: T.textSub, marginTop: 2 }}>
              {currentTrip ? currentTrip.name : 'Ready to explore'}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            {auth?.configured && onJoinTrip && (
              <div onClick={onJoinTrip}
                   style={{ background: T.accentLight, border: `1px solid ${T.accent}40`, borderRadius: 9, padding: '7px 10px', fontSize: ts(12), fontWeight: 700, color: T.accent, cursor: 'pointer' }}>
                Join
              </div>
            )}
            {onOpenSettings && (
              <button type="button" onClick={onOpenSettings} aria-label="Settings"
                style={{ width: 36, height: 36, borderRadius: 10, border: `1px solid ${T.border}`, background: T.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                <Ic d="M4 6h16 M4 12h16 M4 18h16" size={17} color={T.textSub} sw={2} />
              </button>
            )}
            <div style={{ width: 36, height: 36, borderRadius: 18, background: T.accent,
                           display: 'flex', alignItems: 'center', justifyContent: 'center',
                           fontSize: ts(14), fontWeight: 800, color: 'white' }} title={auth?.profile?.display_name || ''}>
              {profileInitial}
            </div>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>

        {/* Current trip */}
        {currentTrip ? (
          <div style={{ margin: '14px 16px 0', background: '#2A5C8E', borderRadius: 16,
                        boxShadow: '0 4px 20px rgba(42,92,142,.35)', padding: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
              <Ic d={ICONS.compass} size={14} color="rgba(255,255,255,.85)" sw={2} />
              <span style={{ fontSize: 10.5, fontWeight: 700, color: 'rgba(255,255,255,.7)', letterSpacing: .8 }}>YOUR TRIP</span>
            </div>
            {!!currentTrip.coverPhoto && (
              <MediaThumb media={currentTrip.coverPhoto} alt="Trip cover" style={{ width: '100%', maxHeight: 200, objectFit: 'contain', borderRadius: 12, marginBottom: 10, display: 'block', background: 'rgba(0,0,0,.18)' }} />
            )}
            <div style={{ fontSize: 19, fontWeight: 800, color: 'white', letterSpacing: -.4, marginBottom: 2 }}>{currentTrip.name}</div>
            <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.7)', marginBottom: 10 }}>
              {(currentTrip.types || []).join(' · ') || 'Trip'}
              {currentTrip.startDate ? ` · Starts ${formatTripDate(currentTrip.startDate)}` : ''}
              {entries.length > 0 ? ` · ${entries.length} entries` : ''}
            </div>
            <div style={{ marginBottom: 10 }}>
              <SyncChip state={tripSyncState} compact />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div onClick={() => { onSelectTrip?.(currentTrip.id); onOpenPlan?.(); }}
                   style={{ background: 'rgba(255,255,255,.15)', borderRadius: 10, padding: '11px 10px', textAlign: 'center', cursor: 'pointer' }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: 'white' }}>Plan</span>
              </div>
              <div onClick={() => { onSelectTrip?.(currentTrip.id); onOpenTrip?.(); }}
                   style={{ background: 'rgba(255,255,255,.92)', borderRadius: 10, padding: '11px 10px', textAlign: 'center', cursor: 'pointer' }}>
                <span style={{ fontSize: 12.5, fontWeight: 800, color: '#2A5C8E' }}>Trip</span>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ margin: '14px 16px 0', background: T.accentLight, borderRadius: 16, padding: '20px',
                        textAlign: 'center', border: `1.5px dashed ${T.accent}60` }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.accent, marginBottom: 6 }}>No trip selected</div>
            <div style={{ fontSize: 12, color: T.accentMid, marginBottom: 14 }}>Create a trip to plan gear, shopping, and crew</div>
            <div onClick={onFab} style={{ background: T.accent, borderRadius: 12, padding: '10px 20px',
                                           display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <Ic d={ICONS.plus} size={16} color="white" sw={2.5} />
              <span style={{ fontSize: 13, fontWeight: 700, color: 'white' }}>New Trip</span>
            </div>
          </div>
        )}

        {/* More trips */}
        {otherTrips.length > 0 && (
          <div style={{ padding: '14px 16px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>More Trips</span>
              <span style={{ fontSize: 12, color: T.textSub }}>{otherTrips.length}</span>
            </div>
            {otherTrips.map((t) => {
              const isSelected = trip?.id === t.id;
              const gearCount = (t.gearItems || []).length;
              const mealCount = (t.meals || []).length;
              return (
                <div key={t.id} style={{ background: T.card, borderRadius: 12, padding: '11px 12px', marginBottom: 8, border: `1.5px solid ${isSelected ? '#2A5C8E' : T.border}`, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  {t.coverPhoto ? (
                    <MediaThumb media={t.coverPhoto} alt={`${t.name} cover`} style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: 44, height: 44, borderRadius: 10, background: '#E4EFF8', border: `1px solid #C7DDEF`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Ic d={ICONS.compass} size={18} color="#2A5C8E" sw={1.8} />
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: T.text }}>{t.name || 'Trip'}</div>
                    <div style={{ fontSize: 11, color: T.textFaint }}>{(t.types || []).join(' · ') || 'No type'}</div>
                    <div style={{ fontSize: 10.5, color: T.textSub, marginTop: 2 }}>Starts {formatTripDate(t.startDate)}</div>
                    <div style={{ fontSize: 10, color: T.textFaint, marginTop: 2 }}>{gearCount} gear · {mealCount} meals</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
                    <div onClick={() => { onSelectTrip?.(t.id); onOpenPlan?.(); }}
                         style={{ fontSize: 10.5, color: '#2A5C8E', fontWeight: 700, cursor: 'pointer', textAlign: 'right' }}>
                      Plan
                    </div>
                    <div onClick={() => onSelectTrip?.(t.id)}
                         style={{ fontSize: 10.5, color: T.accent, fontWeight: 800, cursor: 'pointer', textAlign: 'right' }}>
                      Trip
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Past trips */}
        {finalizedTrips.length > 0 && (
          <div style={{ padding: '16px 16px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Past Trips</span>
              <span style={{ fontSize: 11, color: T.textFaint }}>{finalizedTrips.length}</span>
            </div>

            <input
              value={tripSearch}
              onChange={(e) => { setTripSearch(e.target.value); setPastTripsExpanded(false); }}
              placeholder="Search past trips…"
              style={{ width: '100%', border: `1.5px solid ${T.border}`, borderRadius: 9, padding: '8px 10px', fontSize: 12, fontFamily: F, marginBottom: 8, boxSizing: 'border-box', outline: 'none', background: T.card }}
            />

            {visiblePastTrips.map((t) => (
              <div key={t.id} style={{ background: T.card, borderRadius: 12, padding: '10px 11px', marginBottom: 6, border: `1px solid ${T.border}`, display: 'flex', gap: 10, alignItems: 'center' }}>
                <div onClick={() => onSelectTrip?.(t.id)} style={{ display: 'flex', gap: 10, flex: 1, minWidth: 0, cursor: 'pointer', alignItems: 'center' }}>
                  {t.coverPhoto ? (
                    <MediaThumb media={t.coverPhoto} alt={`${t.name} cover`} style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: 36, height: 36, borderRadius: 8, background: T.bg, border: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Ic d={ICONS.journal} size={16} color={T.textFaint} sw={1.8} />
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name || 'Trip'}</div>
                    <div style={{ fontSize: 10.5, color: T.textFaint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {t.location || (t.types || []).join(' · ') || 'Trip'}
                      {' · '}
                      {new Date(t.endedAt || t.updatedAt || t.createdAt || 0).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}
                    </div>
                  </div>
                </div>
                <div onClick={() => onOpenRecap?.(t.id)} style={{ fontSize: 10.5, color: '#2E6D3A', fontWeight: 800, cursor: 'pointer', flexShrink: 0 }}>Recap</div>
              </div>
            ))}

            {finalizedTrips.length > 4 && !pastTripsExpanded && (
              <button
                type="button"
                onClick={() => setPastTripsExpanded(true)}
                style={{ width: '100%', marginTop: 2, border: `1px solid ${T.border}`, borderRadius: 9, padding: '8px 10px', background: T.bg, color: T.textSub, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: F }}
              >
                Show all {finalizedTrips.length} trips
              </button>
            )}

            {tripSearch.trim() && visiblePastTrips.length === 0 && (
              <div style={{ textAlign: 'center', padding: '8px 0', color: T.textFaint, fontSize: 11.5 }}>
                No past trips match your search.
              </div>
            )}
          </div>
        )}

        <div style={{ height: 16 }} />
      </div>

      <BottomNav active="home" onNav={onNav} onFab={onFab} trip={currentTrip} />
    </div>
  );
}

