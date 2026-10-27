import { getCurrentUserId, isTripMember } from '../lib/storage';
import { buildCrewActivityFeed, getMyResponsibilities, getTripStage } from '../lib/tripDashboard';
import { buildTripParticipants } from '../lib/tripParticipants';
import { formatTripDateRange } from '../lib/tripEdit';
import { SyncChip } from './SyncChip';
import { MediaThumb } from './MediaThumb';
import { Ic } from './Ic';
import { ICONS } from '../tokens';

export function TripDashboard({ trip, onOpen, onRecap, now }) {
  const stage = getTripStage(trip, now);
  const userId = getCurrentUserId();
  const tasks = getMyResponsibilities(trip, userId);
  const crewCount = buildTripParticipants(trip, userId).length;
  const canCapture = stage.id !== 'completed' && isTripMember(trip, userId);
  const hasLocations = (trip.locations || []).length > 0;
  const activityFeed = buildCrewActivityFeed(trip, userId, 4);
  return <section className={`trip-dashboard stage-${stage.id}`} aria-labelledby="selected-trip-title">
    <div className="trip-dashboard-hero">
      {trip.coverPhoto && <MediaThumb media={trip.coverPhoto} alt="" className="trip-dashboard-cover" />}
      <div className="trip-dashboard-hero-content">
        <div className="trip-dashboard-topline"><span className="dashboard-stage"><Ic d={stage.id === 'completed' ? ICONS.journal : ICONS.compass} size={15} color="currentColor" />{stage.label}</span><SyncChip state={trip.syncState || 'pending'} compact /></div>
        <button className="trip-dashboard-title" type="button" onClick={() => onOpen('trip')}><h2 id="selected-trip-title">{trip.name}</h2><span aria-hidden="true">↗</span></button>
        <p className="trip-dashboard-meta">{[trip.location, formatTripDateRange(trip.startDate, trip.endDate)].filter(Boolean).join(' · ')}</p>
        <p className="trip-dashboard-crew">{crewCount} crew member{crewCount === 1 ? '' : 's'} · {(trip.locations || []).length} locations{tasks.plannedLocations > 0 ? ` (${tasks.plannedLocations} planned)` : ''} · {(trip.entries || []).length} entries</p>
      </div>
    </div>
    <div className="trip-dashboard-body">
      <h3>{stage.headline}</h3>
      <p className="dashboard-description">{stage.description}</p>
      <div className="dashboard-actions">
        {stage.id === 'planning' ? <>
          <button className="dashboard-button primary" type="button" onClick={() => onOpen(!hasLocations && canCapture ? 'capture' : 'trip', !hasLocations && canCapture ? { type: 'location' } : {})}>{hasLocations ? 'View locations' : canCapture ? 'Add your first location' : 'View locations'} <span aria-hidden="true">→</span></button>
          <button className="dashboard-button secondary" type="button" onClick={() => onOpen('plan', { tab: 'mine' })}>My responsibilities</button>
        </> : stage.id === 'completed' ? <>
          <button className="dashboard-button primary" type="button" onClick={onRecap}>Create or edit recap <span aria-hidden="true">→</span></button>
          <button className="dashboard-button secondary" type="button" onClick={() => onOpen('trip')}>Review the trip</button>
        </> : <>
          <button className="dashboard-button primary" type="button" onClick={() => onOpen(!hasLocations && canCapture ? 'capture' : 'trip', !hasLocations && canCapture ? { type: 'location' } : {})}>{hasLocations ? 'Open your locations' : canCapture ? 'Add your first location' : 'View locations'} <span aria-hidden="true">→</span></button>
          {canCapture && <button className="dashboard-button secondary" type="button" onClick={() => onOpen('capture')}>Add location or event</button>}
        </>}
      </div>
      <div className="dashboard-shortcuts">
        {stage.id === 'completed' ? <button type="button" onClick={() => onOpen('plan', { tab: 'expenses' })}><Ic d={ICONS.expense} size={19} color="currentColor" /><span>Review expenses</span><span aria-hidden="true">→</span></button> : <>
          <button type="button" onClick={() => onOpen('plan', { tab: 'mine' })}><Ic d={ICONS.leaf} size={19} color="currentColor" /><span>{tasks.gearToBring.length} gear to bring · {tasks.meals.length} meal{tasks.meals.length === 1 ? '' : 's'} assigned</span><span aria-hidden="true">→</span></button>
          {stage.id === 'planning' && <button type="button" onClick={() => onOpen('plan', { tab: 'participants' })}><Ic d={ICONS.home} size={19} color="currentColor" /><span>View crew</span><span aria-hidden="true">→</span></button>}
          <button type="button" onClick={() => onOpen('plan', { tab: 'maps' })}><Ic d={ICONS.map} size={19} color="currentColor" /><span>Check offline maps before you go</span><span aria-hidden="true">→</span></button>
          {stage.id === 'active' && <button type="button" onClick={() => onOpen('map')}><Ic d={ICONS.compass} size={19} color="currentColor" /><span>Open map &amp; recording controls</span><span aria-hidden="true">→</span></button>}
        </>}
      </div>
      {activityFeed.length > 0 && (
        <div className="dashboard-crew-activity" style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(42,92,142,0.12)' }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, opacity: 0.72, marginBottom: 6 }}>
            Crew activity pulse
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {activityFeed.map((item) => (
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
                <span aria-hidden="true" style={{ fontSize: 13 }}>{item.icon}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.text}</span>
                <span aria-hidden="true" style={{ opacity: 0.6 }}>→</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  </section>;
}
