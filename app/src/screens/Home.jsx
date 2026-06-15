import { useMemo, useState } from 'react';
import { Ic } from '../components/Ic';
import { BottomNav } from '../components/BottomNav';
import { SyncChip } from '../components/SyncChip';
import { T, F, ICONS } from '../tokens';
import { fetchGauge, fetchNearbyGaugesByGps } from '../lib/usgs';
import { fetchCurrentWeather } from '../lib/weather';
import { MAIN_SALMON_RIVER } from '../lib/mapRegions';
import { supabaseConfigured } from '../lib/supabase';

export function Home({ trip, allTrips = [], onNav, onFab, onRiverIntel, onOpenTrip, onSelectTrip, onStartTrip, onOpenPlan, onJoinTrip, auth }) {
  const fieldTrip = trip?.status === 'active' ? trip : null;
  const selectedPlanningTrip = trip?.status === 'planning' ? trip : null;
  const [nowMs] = useState(() => Date.now());
  const [planLocation, setPlanLocation] = useState('');
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState(null);
  const [planResult, setPlanResult] = useState(null);
  const [locationFilter, setLocationFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [participantFilter, setParticipantFilter] = useState('');
  const entries = useMemo(() => fieldTrip?.entries ?? [], [fieldTrip?.entries]);
  const track   = useMemo(() => fieldTrip?.track ?? [], [fieldTrip?.track]);
  const tripSyncState = fieldTrip?.syncState || (entries.some(e => e.syncState === 'pending') ? 'pending' : 'synced');
  const upcomingTrips = useMemo(() => {
    return (allTrips || [])
      .filter((t) => t.status === 'planning')
      .sort((a, b) => {
        const aTs = a.startDate ? new Date(`${a.startDate}T00:00:00`).getTime() : (a.createdAt || 0);
        const bTs = b.startDate ? new Date(`${b.startDate}T00:00:00`).getTime() : (b.createdAt || 0);
        return aTs - bTs;
      });
  }, [allTrips]);
  const upcomingList = useMemo(() => {
    if (!selectedPlanningTrip || fieldTrip) return upcomingTrips;
    return upcomingTrips.filter((t) => t.id !== selectedPlanningTrip.id);
  }, [upcomingTrips, selectedPlanningTrip, fieldTrip]);
  const availableTypes = useMemo(() => {
    const set = new Set();
    for (const t of allTrips) {
      for (const tp of t.types || []) set.add(tp);
    }
    return ['all', ...Array.from(set)];
  }, [allTrips]);

  const finalizedTrips = useMemo(() => {
    const base = (allTrips || []).filter((t) => t.status === 'completed');
    return base
      .filter((t) => {
        if (locationFilter.trim()) {
          const hay = `${t.location || ''} ${t.name || ''}`.toLowerCase();
          if (!hay.includes(locationFilter.trim().toLowerCase())) return false;
        }
        if (typeFilter !== 'all' && !(t.types || []).includes(typeFilter)) return false;
        if (participantFilter.trim()) {
          const participantHay = `${t.ownerId || ''} ${(t.collaborators || []).map((c) => c.handle || c.id || '').join(' ')}`.toLowerCase();
          if (!participantHay.includes(participantFilter.trim().toLowerCase())) return false;
        }

        const ts = t.endedAt || (t.endDate ? new Date(t.endDate).getTime() : (t.updatedAt || t.createdAt || 0));
          if (dateFilter === '30d' && ts < nowMs - 30 * 864e5) return false;
          if (dateFilter === '90d' && ts < nowMs - 90 * 864e5) return false;
          if (dateFilter === 'year' && ts < nowMs - 365 * 864e5) return false;
        return true;
      })
      .sort((a, b) => (b.endedAt || b.updatedAt || b.createdAt || 0) - (a.endedAt || a.updatedAt || a.createdAt || 0));
        }, [allTrips, locationFilter, dateFilter, typeFilter, participantFilter, nowMs]);

  async function lookupPlanningByLocation() {
    const query = planLocation.trim();
    if (!query) return;
    setPlanLoading(true);
    setPlanError(null);
    try {
      const geo = await geocodePlace(query);
      if (!geo) {
        setPlanError('Could not find that place. Try a nearby town or river name.');
        setPlanResult(null);
        return;
      }

      const nearby = await fetchNearbyGaugesByGps(geo.lat, geo.lng, { radiusMiles: 120, limit: 6 });
      const nearest = nearby[0] || null;
      let gauge = nearest;
      if (nearest?.id) {
        try {
          const live = await fetchGauge(nearest.id);
          gauge = {
            ...nearest,
            cfs: live.cfs ?? nearest.cfs,
            gaugeHt: live.gaugeHt ?? nearest.gaugeHt,
            name: live.siteName || nearest.name,
            updatedAt: live.updatedAt || nearest.updatedAt,
          };
        } catch {
          // Keep nearby station values if live refresh fails.
        }
      }

      const weather = await fetchCurrentWeather(geo.lat, geo.lng);
      setPlanResult({
        place: geo.name,
        lat: geo.lat,
        lng: geo.lng,
        gauge,
        weather,
      });
    } catch (e) {
      setPlanError(e?.message || 'Could not load planning conditions.');
      setPlanResult(null);
    } finally {
      setPlanLoading(false);
    }
  }

  const profileInitial = (auth?.profile?.display_name || auth?.user?.email || '?').charAt(0).toUpperCase();

  return (
    <div style={{ height: '100%', background: T.bg, display: 'flex', flexDirection: 'column', fontFamily: F, overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ background: T.card, padding: '12px 16px 14px', borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: T.text, letterSpacing: -.6 }}>TripReport</div>
            <div style={{ fontSize: 12, color: T.textSub, marginTop: 1 }}>
              {fieldTrip
                ? `Active: ${fieldTrip.name}`
                : selectedPlanningTrip
                  ? `Planning: ${selectedPlanningTrip.name}`
                  : 'Ready to explore'}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {auth?.configured && onJoinTrip && (
              <div onClick={onJoinTrip}
                   style={{ background: T.accentLight, border: `1px solid ${T.accent}40`, borderRadius: 9, padding: '6px 10px', fontSize: 10.5, fontWeight: 700, color: T.accent, cursor: 'pointer' }}>
                Join trip
              </div>
            )}
            {auth?.configured && (
              <div onClick={() => auth.signOut()}
                   style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 9, padding: '6px 10px', fontSize: 10.5, fontWeight: 700, color: T.textSub, cursor: 'pointer' }}>
                Sign out
              </div>
            )}
            <div style={{ width: 38, height: 38, borderRadius: 19, background: T.accent,
                           display: 'flex', alignItems: 'center', justifyContent: 'center',
                           fontSize: 14, fontWeight: 800, color: 'white' }} title={auth?.profile?.display_name || ''}>
              {profileInitial}
            </div>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>

        {auth?.configured && auth?.profile?.display_name && (
          <div style={{ margin: '12px 16px 0', background: '#E4EFF8', border: '1px solid #C7DDEF', borderRadius: 12, padding: '12px 14px' }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#2A5C8E', marginBottom: 4 }}>Main Salmon · July 20 launch</div>
            <div style={{ fontSize: 11, color: T.textSub, lineHeight: 1.45, marginBottom: 10 }}>
              Plan your trip from Corn Creek through the wilderness corridor. Offline map preload for this section is coming next — bounds are already configured.
            </div>
            <div style={{ fontSize: 10.5, color: '#2A5C8E', fontWeight: 700 }}>
              Region: {MAIN_SALMON_RIVER.name} · zoom {MAIN_SALMON_RIVER.default_zoom}
            </div>
          </div>
        )}

        {/* Active trip banner */}
        {fieldTrip ? (
          <div style={{ margin: '14px 16px 0', background: T.accent, borderRadius: 16,
                        boxShadow: `0 4px 20px ${T.accent}40`, padding: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: 4, background: '#5DBE7E', animation: 'pulse 2s infinite' }} />
              <span style={{ fontSize: 10.5, fontWeight: 700, color: 'rgba(255,255,255,.7)', letterSpacing: .8 }}>ACTIVE TRIP</span>
            </div>
            {!!fieldTrip.coverPhoto?.thumbDataUrl && (
              <img src={fieldTrip.coverPhoto.thumbDataUrl} alt="Trip cover" style={{ width: '100%', maxHeight: 200, objectFit: 'contain', borderRadius: 12, marginBottom: 10, display: 'block', background: 'rgba(0,0,0,.18)' }} />
            )}
            <div style={{ fontSize: 19, fontWeight: 800, color: 'white', letterSpacing: -.4, marginBottom: 2 }}>{fieldTrip.name}</div>
            <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.7)', marginBottom: 12 }}>
              {(fieldTrip.types || []).join(' · ')} · {entries.length} entries · {track.length} GPS pts
            </div>
            <div style={{ marginBottom: 10 }}>
              <SyncChip state={tripSyncState} compact />
            </div>
            <div onClick={onOpenTrip}
                 style={{ background: 'rgba(255,255,255,.15)', borderRadius: 10, padding: '11px 14px',
                           display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'white' }}>Open Trip Page</span>
              <Ic d={ICONS.chevR} size={16} color="white" sw={2.2} />
            </div>
          </div>
        ) : selectedPlanningTrip ? (
          <div style={{ margin: '14px 16px 0', background: '#2A5C8E', borderRadius: 16,
                        boxShadow: '0 4px 20px rgba(42,92,142,.35)', padding: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
              <Ic d={ICONS.compass} size={14} color="rgba(255,255,255,.85)" sw={2} />
              <span style={{ fontSize: 10.5, fontWeight: 700, color: 'rgba(255,255,255,.7)', letterSpacing: .8 }}>UPCOMING TRIP</span>
            </div>
            {!!selectedPlanningTrip.coverPhoto?.thumbDataUrl && (
              <img src={selectedPlanningTrip.coverPhoto.thumbDataUrl} alt="Trip cover" style={{ width: '100%', maxHeight: 200, objectFit: 'contain', borderRadius: 12, marginBottom: 10, display: 'block', background: 'rgba(0,0,0,.18)' }} />
            )}
            <div style={{ fontSize: 19, fontWeight: 800, color: 'white', letterSpacing: -.4, marginBottom: 2 }}>{selectedPlanningTrip.name}</div>
            <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.7)', marginBottom: 12 }}>
              {(selectedPlanningTrip.types || []).join(' · ') || 'Trip'} · Starts {formatTripDate(selectedPlanningTrip.startDate)}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div onClick={() => { onSelectTrip?.(selectedPlanningTrip.id); onOpenPlan?.(); }}
                   style={{ background: 'rgba(255,255,255,.15)', borderRadius: 10, padding: '11px 10px', textAlign: 'center', cursor: 'pointer' }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: 'white' }}>Open Plan</span>
              </div>
              <div onClick={() => onStartTrip?.(selectedPlanningTrip.id)}
                   style={{ background: 'rgba(255,255,255,.92)', borderRadius: 10, padding: '11px 10px', textAlign: 'center', cursor: 'pointer' }}>
                <span style={{ fontSize: 12.5, fontWeight: 800, color: '#2A5C8E' }}>Start Trip</span>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ margin: '14px 16px 0', background: T.accentLight, borderRadius: 16, padding: '20px',
                        textAlign: 'center', border: `1.5px dashed ${T.accent}60` }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.accent, marginBottom: 6 }}>No active trip</div>
            <div style={{ fontSize: 12, color: T.accentMid, marginBottom: 14 }}>Start a new trip to begin logging</div>
            <div onClick={onFab} style={{ background: T.accent, borderRadius: 12, padding: '10px 20px',
                                           display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <Ic d={ICONS.plus} size={16} color="white" sw={2.5} />
              <span style={{ fontSize: 13, fontWeight: 700, color: 'white' }}>Start New Trip</span>
            </div>
          </div>
        )}

        {/* Quick actions */}
        <div style={{ padding: '14px 16px 0' }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: T.textSub, letterSpacing: .7,
                         textTransform: 'uppercase', marginBottom: 10 }}>Quick Actions</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[
              { label: 'Start New Trip',    sub: 'Plan & invite people', icon: ICONS.plus,    col: T.accent,   bg: T.accentLight, onClick: onFab, primary: true },
              { label: 'River Conditions',  sub: 'Live USGS gauge data', icon: ICONS.drop,    col: '#3A72A8',  bg: '#E4EFF8',     onClick: onRiverIntel },
            ].map((a, i) => (
              <div key={i} onClick={a.onClick}
                   style={{ background: a.primary ? T.accent : T.card, borderRadius: 13, padding: '13px 12px',
                             border: `1.5px solid ${a.primary ? 'transparent' : T.border}`,
                             boxShadow: a.primary ? `0 4px 16px ${T.accent}40` : 'none',
                             display: 'flex', flexDirection: 'column', gap: 8, cursor: 'pointer' }}>
                <div style={{ width: 36, height: 36, borderRadius: 10,
                               background: a.primary ? 'rgba(255,255,255,.2)' : a.bg,
                               display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Ic d={a.icon} size={18} color={a.primary ? 'white' : a.col} sw={a.primary ? 2.2 : 1.9} />
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: a.primary ? 'white' : T.text, letterSpacing: -.2 }}>{a.label}</div>
                  <div style={{ fontSize: 10.5, color: a.primary ? 'rgba(255,255,255,.65)' : T.textFaint, marginTop: 2 }}>{a.sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ padding: '14px 16px 0' }}>
          <div style={{ background: T.card, borderRadius: 12, border: `1px solid ${T.border}`, padding: '10px 11px' }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: T.textSub, letterSpacing: .7, textTransform: 'uppercase', marginBottom: 8 }}>Plan By Location</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input
                value={planLocation}
                onChange={(e) => setPlanLocation(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void lookupPlanningByLocation(); }}
                placeholder="Search location for river + weather"
                style={{ flex: 1, border: `1.5px solid ${T.border}`, borderRadius: 9, padding: '8px 10px', fontSize: 11.5, fontFamily: F, boxSizing: 'border-box', outline: 'none', background: T.bg }}
              />
              <div onClick={() => void lookupPlanningByLocation()} style={{ background: '#E4EFF8', border: '1px solid #3A72A840', borderRadius: 9, padding: '8px 10px', fontSize: 11, fontWeight: 700, color: '#2A5C8E', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                {planLoading ? 'Loading...' : 'Lookup'}
              </div>
            </div>

            {planError && <div style={{ fontSize: 10.5, color: T.amber, marginBottom: 6 }}>{planError}</div>}

            {!!planResult && (
              <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, background: T.bg, padding: '8px 9px' }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: T.text, marginBottom: 4 }}>{planResult.place}</div>
                <div style={{ fontSize: 10, color: T.textFaint, marginBottom: 6 }}>{planResult.lat.toFixed(4)}, {planResult.lng.toFixed(4)}</div>
                <div style={{ fontSize: 10.5, color: '#2A5C8E', fontWeight: 700 }}>River Conditions</div>
                {planResult.gauge ? (
                  <div style={{ fontSize: 10.5, color: T.textSub, marginBottom: 6 }}>
                    {planResult.gauge.name || 'Nearest gauge'} · {planResult.gauge.cfs != null ? `${Math.round(planResult.gauge.cfs)} cfs` : 'flow n/a'}{planResult.gauge.gaugeHt != null ? ` · ${planResult.gauge.gaugeHt.toFixed(2)} ft` : ''}
                  </div>
                ) : (
                  <div style={{ fontSize: 10.5, color: T.textFaint, marginBottom: 6 }}>No nearby USGS gauge found.</div>
                )}
                <div style={{ fontSize: 10.5, color: '#2A5C8E', fontWeight: 700 }}>Weather</div>
                <div style={{ fontSize: 10.5, color: T.textSub }}>
                  {planResult.weather.summary || 'Unknown'} · {planResult.weather.temperatureC != null ? `${Math.round(planResult.weather.temperatureC)}°C` : 'temp n/a'}{planResult.weather.windKph != null ? ` · wind ${Math.round(planResult.weather.windKph)} kph` : ''}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Upcoming trips */}
        {upcomingList.length > 0 && (
          <div style={{ padding: '14px 16px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Upcoming Trips</span>
              <span style={{ fontSize: 12, color: T.textSub }}>{upcomingList.length}</span>
            </div>
            {upcomingList.map((t) => {
              const isSelected = trip?.id === t.id;
              const gearCount = (t.gearItems || []).length;
              const mealCount = (t.meals || []).length;
              return (
                <div key={t.id} style={{ background: T.card, borderRadius: 12, padding: '11px 12px', marginBottom: 8, border: `1.5px solid ${isSelected ? '#2A5C8E' : T.border}`, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  {t.coverPhoto?.thumbDataUrl ? (
                    <img src={t.coverPhoto.thumbDataUrl} alt={`${t.name} cover`} style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }} />
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
                    <div onClick={() => onStartTrip?.(t.id)}
                         style={{ fontSize: 10.5, color: T.accent, fontWeight: 800, cursor: 'pointer', textAlign: 'right' }}>
                      Start
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Finalized trip list */}
        <div style={{ padding: '16px 16px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Finalized Trips</span>
            <span style={{ fontSize: 12, color: T.textSub }}>{finalizedTrips.length} shown</span>
          </div>

          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: '10px 11px', marginBottom: 10 }}>
            <input
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              placeholder="Filter by location"
              style={{ width: '100%', border: `1.5px solid ${T.border}`, borderRadius: 9, padding: '8px 10px', fontSize: 11.5, fontFamily: F, marginBottom: 8, boxSizing: 'border-box', outline: 'none', background: T.bg }}
            />
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} style={{ flex: 1, border: `1.5px solid ${T.border}`, borderRadius: 9, padding: '8px 10px', fontSize: 11.5, fontFamily: F, background: T.bg }}>
                <option value="all">Any date</option>
                <option value="30d">Last 30d</option>
                <option value="90d">Last 90d</option>
                <option value="year">Last year</option>
              </select>
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ flex: 1, border: `1.5px solid ${T.border}`, borderRadius: 9, padding: '8px 10px', fontSize: 11.5, fontFamily: F, background: T.bg }}>
                {availableTypes.map((tp) => (
                  <option key={tp} value={tp}>{tp === 'all' ? 'Any type' : tp}</option>
                ))}
              </select>
            </div>
            <input
              value={participantFilter}
              onChange={(e) => setParticipantFilter(e.target.value)}
              placeholder="Filter by participant"
              style={{ width: '100%', border: `1.5px solid ${T.border}`, borderRadius: 9, padding: '8px 10px', fontSize: 11.5, fontFamily: F, boxSizing: 'border-box', outline: 'none', background: T.bg }}
            />
          </div>

          {finalizedTrips.length === 0 && (
            <div style={{ textAlign: 'center', padding: '10px 0', color: T.textFaint, fontSize: 11.5 }}>
              No finalized trips match these filters.
            </div>
          )}

          {finalizedTrips.map((t) => (
            <div key={t.id} onClick={() => onSelectTrip?.(t.id)} style={{ background: T.card, borderRadius: 12, padding: '11px 12px', marginBottom: 8, border: `1px solid ${T.border}`, display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
              {t.coverPhoto?.thumbDataUrl ? (
                <img src={t.coverPhoto.thumbDataUrl} alt={`${t.name} cover`} style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }} />
              ) : (
                <div style={{ width: 44, height: 44, borderRadius: 10, background: T.bg, border: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Ic d={ICONS.journal} size={18} color={T.textFaint} sw={1.8} />
                </div>
              )}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: T.text }}>{t.name || 'Trip'}</div>
                <div style={{ fontSize: 11, color: T.textFaint }}>{t.location || 'Unknown location'}</div>
                <div style={{ fontSize: 10.5, color: T.textFaint }}>{(t.types || []).join(' · ') || 'No type'}</div>
                <div style={{ fontSize: 10.5, color: T.textFaint }}>Ended: {new Date(t.endedAt || t.updatedAt || t.createdAt || 0).toLocaleDateString()}</div>
              </div>
              <div style={{ fontSize: 10.5, color: T.accent, fontWeight: 700 }}>Open</div>
            </div>
          ))}
        </div>

        <div style={{ height: 16 }} />
      </div>

      <BottomNav active="home" onNav={onNav} onFab={onFab} trip={fieldTrip || selectedPlanningTrip} />
    </div>
  );
}

function formatTripDate(value) {
  if (!value) return 'TBD';
  const d = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return 'TBD';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

async function geocodePlace(query) {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', query);
  url.searchParams.set('count', '1');
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error('Geocoding lookup failed');
  const data = await res.json();
  const top = data?.results?.[0];
  if (!top) return null;
  return {
    name: [top.name, top.admin1, top.country].filter(Boolean).join(', '),
    lat: Number(top.latitude),
    lng: Number(top.longitude),
  };
}

