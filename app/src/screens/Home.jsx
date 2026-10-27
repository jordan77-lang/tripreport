import { useMemo, useState } from 'react';
import { Ic } from '../components/Ic';
import { BottomNav } from '../components/BottomNav';
import { MediaThumb } from '../components/MediaThumb';
import { TripDashboard } from '../components/TripDashboard';
import { T, ICONS } from '../tokens';
import { formatTripDate } from '../lib/tripEdit';
import { forkTripAsTemplate } from '../lib/storage';

export function Home({ trip, allTrips = [], onNav, onFab, onSelectTrip, onJoinTrip, onOpenSettings, onOpenRecap, auth }) {
  const [tripSearch, setTripSearch] = useState('');
  const [selectedActivity, setSelectedActivity] = useState('All');
  const [pastTripsExpanded, setPastTripsExpanded] = useState(false);
  const otherTrips = useMemo(() => allTrips
    .filter(item => item.status !== 'completed' && item.id !== trip?.id)
    .sort((a, b) => (a.startDate || '9999').localeCompare(b.startDate || '9999')), [allTrips, trip?.id]);
  const completedTripTypes = useMemo(() => {
    const types = new Set();
    for (const item of allTrips) {
      if (item.status !== 'completed') continue;
      for (const tp of item.types || []) if (tp) types.add(tp);
    }
    return ['All', ...types];
  }, [allTrips]);
  const pastTrips = useMemo(() => {
    const query = tripSearch.trim().toLowerCase();
    return allTrips.filter(item => item.status === 'completed')
      .filter(item => selectedActivity === 'All' || (item.types || []).includes(selectedActivity))
      .filter(item => !query || [item.name, item.location, ...(item.types || []), ...Object.values(item.memberProfiles || {}),
        ...(item.collaborators || []).map(person => person.handle || person.name || '')].join(' ').toLowerCase().includes(query))
      .sort((a, b) => (b.endedAt || b.updatedAt || b.createdAt || 0) - (a.endedAt || a.updatedAt || a.createdAt || 0));
  }, [allTrips, tripSearch, selectedActivity]);
  const visiblePastTrips = pastTripsExpanded ? pastTrips : pastTrips.slice(0, 4);
  const profileName = auth?.profile?.display_name || auth?.user?.email || '';
  const open = (item, screen = 'trip', params = {}) => onSelectTrip?.(item.id, { screen, params });

  return <div className="trips-home">
    <header className="trips-header">
      <div className="trips-header-inner">
        <div className="trips-brand"><span className="trips-brand-icon"><Ic d={ICONS.compass} size={23} color="white" /></span><div><h1>TripReport</h1><p>Every adventure. Everyone’s story.</p></div></div>
        <div className="trips-header-actions">
          {auth?.configured && onJoinTrip && <button className="dashboard-button secondary" type="button" aria-label="Join a trip" onClick={onJoinTrip}><span className="trips-join-full">Join a trip</span><span className="trips-join-short">Join</span></button>}
          {onOpenSettings && <button className="trips-settings" type="button" onClick={onOpenSettings} aria-label="Settings"><Ic d="M4 6h16 M4 12h16 M4 18h16" size={20} color={T.textSub} /></button>}
          {profileName && <span className="trips-avatar" title={profileName} aria-label={profileName}>{profileName.charAt(0).toUpperCase()}</span>}
        </div>
      </div>
    </header>
    <main className="trips-scroll">
      <div className="trips-content">
        <div className="dashboard-section-heading trips-heading"><div><p className="dashboard-eyebrow">Plan together. Capture the adventure.</p><h2>Your trips</h2></div>
          {onFab && <button className="dashboard-button primary" type="button" onClick={onFab}><Ic d={ICONS.plus} size={18} color="currentColor" /> New trip</button>}
        </div>
        {trip ? <TripDashboard trip={trip} onOpen={(screen, params) => open(trip, screen, params)} onRecap={() => onOpenRecap?.(trip.id)} /> : <section className="trips-welcome">
          <span className="trips-welcome-icon"><Ic d={ICONS.tent} size={36} color={T.accent} /></span>
          <h2>{allTrips.length ? 'Pick your next adventure.' : 'Good adventures start with good company.'}</h2>
          <p>{allTrips.length ? 'Open a trip below to see your plan, crew, and memories.' : 'Plan the details with your crew, save moments along the way, and bring the whole story home.'}</p>
          <div className="dashboard-actions">
            {auth?.configured && onJoinTrip && <button className="dashboard-button primary" type="button" onClick={onJoinTrip}>Join your crew</button>}
            {onFab && <button className="dashboard-button secondary" type="button" onClick={onFab}>Plan a new trip</button>}
          </div>
        </section>}
        {otherTrips.length > 0 && <section className="trips-list-section" aria-labelledby="upcoming-trips-title">
          <div className="dashboard-section-heading"><h2 id="upcoming-trips-title">{trip ? 'More adventures' : 'Upcoming & active'}</h2><span className="dashboard-caption">{otherTrips.length} trip{otherTrips.length === 1 ? '' : 's'}</span></div>
          <div className="trips-card-grid">{otherTrips.map(item => <article className="trip-list-card" key={item.id}>
            <button className="trip-list-open" type="button" onClick={() => open(item)}>
              <TripThumbnail trip={item} /><div><span className="dashboard-eyebrow">{item.status === 'planning' ? 'Planning' : 'On the trip'}</span><h3>{item.name || 'Trip'}</h3><p>{formatTripDate(item.startDate)}{item.location ? ` · ${item.location}` : ''}</p></div>
            </button>
            <div className="trip-list-actions"><button className="dashboard-text-button" type="button" onClick={() => open(item, 'plan', { tab: 'mine' })}>My responsibilities</button><button className="dashboard-text-button" type="button" onClick={() => open(item)}>Open trip <span aria-hidden="true">→</span></button></div>
          </article>)}</div>
        </section>}
        {allTrips.some(item => item.status === 'completed') && <section className="trips-list-section" aria-labelledby="past-trips-title">
          <div className="dashboard-section-heading"><div><p className="dashboard-eyebrow">Stories worth keeping</p><h2 id="past-trips-title">Past adventures</h2></div><span className="dashboard-caption">{pastTrips.length} trip{pastTrips.length === 1 ? '' : 's'}</span></div>
          {completedTripTypes.length > 2 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              {completedTripTypes.map(tp => (
                <button
                  key={tp}
                  type="button"
                  onClick={() => { setSelectedActivity(tp); setPastTripsExpanded(false); }}
                  style={{
                    border: `1px solid ${selectedActivity === tp ? T.accent : T.border}`,
                    borderRadius: 16, padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    background: selectedActivity === tp ? T.accentLight : T.card,
                    color: selectedActivity === tp ? T.accent : T.textSub,
                  }}
                >
                  {tp}
                </button>
              ))}
            </div>
          )}
          <input className="trips-search" aria-label="Search past trips" placeholder="Search trips, places, or crew…" value={tripSearch} onChange={event => { setTripSearch(event.target.value); setPastTripsExpanded(false); }} />
          <div className="trips-card-grid">{visiblePastTrips.map(item => <article className="trip-list-card" key={item.id}>
            <button className="trip-list-open" type="button" onClick={() => open(item)}><TripThumbnail trip={item} /><div><h3>{item.name || 'Trip'}</h3><p>{item.location || (item.types || []).join(' · ') || 'Adventure'} · {formatTripDate(item.startDate)}</p></div></button>
            <div className="trip-list-actions">
              <button className="dashboard-text-button" type="button" onClick={() => open(item, 'home')}>Trip dashboard</button>
              <button className="dashboard-text-button" type="button" onClick={() => { const forked = forkTripAsTemplate(item.id); if (forked) onSelectTrip?.(forked.id); }}>Fork route &amp; meals</button>
              <button className="dashboard-text-button" type="button" onClick={() => onOpenRecap?.(item.id, { tab: 'story' })}>Recap &amp; share <span aria-hidden="true">→</span></button>
            </div>
          </article>)}</div>
          {pastTrips.length > 4 && !pastTripsExpanded && <button className="dashboard-button secondary trips-show-all" type="button" onClick={() => setPastTripsExpanded(true)}>Show all {pastTrips.length} trips</button>}
          {!pastTrips.length && <p className="dashboard-description">No past trips match your search.</p>}
        </section>}
      </div>
    </main>
    <BottomNav active="home" onNav={onNav} trip={trip} />
  </div>;
}

function TripThumbnail({ trip }) {
  return <span className="trip-list-thumbnail">{trip.coverPhoto ? <MediaThumb media={trip.coverPhoto} alt="" /> : <Ic d={ICONS.compass} size={25} color={T.accent} />}</span>;
}
