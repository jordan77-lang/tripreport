import { getCurrentUserId, isTripMember } from '../lib/storage';
import { getMyResponsibilities, getTripStage } from '../lib/tripDashboard';
import { CrewActivityPulse } from './CrewActivityPulse';
import { buildTripParticipants } from '../lib/tripParticipants';
import { formatTripDateRange } from '../lib/tripEdit';
import { SyncChip } from './SyncChip';
import { MediaThumb } from './MediaThumb';
import { OwnerDeletedTripBanner } from './OwnerDeletedTripBanner';
import { Ic } from './Ic';
import { ICONS } from '../tokens';
import crewIcon from '../assets/crew.png';
import backpackIcon from '../assets/gear.png';


export function TripDashboard({ trip, onOpen, onRecap, onTripUpdate, onTripDeleted, now }) {
  const stage = getTripStage(trip, now);
  const userId = getCurrentUserId();
  const tasks = getMyResponsibilities(trip, userId);
  const crewCount = buildTripParticipants(trip, userId).length;
  const canCapture = stage.id !== 'completed' && isTripMember(trip, userId);
  const hasLocations = (trip.locations || []).length > 0;
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
      <OwnerDeletedTripBanner trip={trip} onTripUpdate={onTripUpdate} onTripDeleted={onTripDeleted} />
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
          <button type="button" onClick={() => onOpen('plan', { tab: 'mine' })}><img src={backpackIcon} alt="" aria-hidden="true" width={26} height={26} style={{ flexShrink: 0, objectFit: 'contain' }} /><span>{tasks.gearToBring.length} gear to bring · {tasks.meals.length} meal{tasks.meals.length === 1 ? '' : 's'} assigned</span><span aria-hidden="true">→</span></button>
          {stage.id === 'planning' && <button type="button" onClick={() => onOpen('plan', { tab: 'participants' })}><img src={crewIcon} alt="" aria-hidden="true" width={26} height={26} style={{ flexShrink: 0, objectFit: 'contain' }} /><span>View crew</span><span aria-hidden="true">→</span></button>}
          <button type="button" onClick={() => onOpen('plan', { tab: 'maps' })}><Ic d={ICONS.map} size={19} color="currentColor" /><span>Check offline maps before you go</span><span aria-hidden="true">→</span></button>
          {stage.id === 'active' && <button type="button" onClick={() => onOpen('map')}><Ic d={ICONS.compass} size={19} color="currentColor" /><span>Open map &amp; recording controls</span><span aria-hidden="true">→</span></button>}
        </>}
      </div>
      <CrewActivityPulse trip={trip} onOpen={onOpen} />
    </div>
  </section>;
}
