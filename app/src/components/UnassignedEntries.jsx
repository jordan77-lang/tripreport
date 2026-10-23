import { useState } from 'react';
import { getCurrentUserId, isTripMember, isTripOpen, updateEntry } from '../lib/storage';
import { AudioAttachment } from './AudioAttachment';
import { MediaThumb } from './MediaThumb';
import { T } from '../tokens';

// Preserve earlier captures without keeping a second journal interface.
export function UnassignedEntries({ trip, onTripUpdate, onAddLocation }) {
  const entries = (trip?.entries || []).filter(entry => !entry.locationId);
  if (!entries.length) return null;
  const canEdit = isTripOpen(trip) && isTripMember(trip, getCurrentUserId());
  return <details style={{ margin: '18px 0', padding: 16, border: `1px solid ${T.border}`, borderRadius: 14, background: T.card }}>
    <summary style={{ minHeight: 44, cursor: 'pointer', fontSize: 15, fontWeight: 800, color: T.text }}>Earlier entries without a location ({entries.length})</summary>
    <p className="dashboard-description">Your earlier captures are still here. Assign a location to put each one with its place.</p>
    {canEdit && !(trip.locations || []).length && <button className="dashboard-text-button" type="button" onClick={onAddLocation}>Add a location first</button>}
    {entries.map(entry => <UnassignedEntry key={entry.id} entry={entry} trip={trip} canEdit={canEdit} onTripUpdate={onTripUpdate} />)}
  </details>;
}

function UnassignedEntry({ entry, trip, canEdit, onTripUpdate }) {
  const [locationId, setLocationId] = useState('');
  const [error, setError] = useState(null);
  const id = `assign-${entry.id}`;
  function assign() {
    try {
      if (!locationId || !canEdit) return;
      const saved = updateEntry(trip.id, entry.id, { locationId });
      if (!saved) throw new Error('This entry is no longer available.');
      onTripUpdate?.();
    } catch (error) { setError(error.message); }
  }
  return <div style={{ borderTop: `1px solid ${T.border}`, padding: '14px 0', marginTop: 12 }}>
    <p style={{ fontSize: 15, fontWeight: 700, color: T.text }}>{entry.title || entry.type || 'Earlier entry'}</p>
    {entry.notes && <p className="dashboard-description">{entry.notes}</p>}
    {(entry.photoFiles || []).map(photo => <MediaThumb key={photo.id} media={photo} alt={photo.caption || 'Earlier photo'} style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 10, margin: '8px 8px 0 0' }} />)}
    {(entry.voiceFiles || []).map(audio => <AudioAttachment key={audio.id} media={audio} />)}
    {canEdit && (trip.locations || []).length > 0 && <div style={{ marginTop: 12 }}>
      <label htmlFor={id} style={{ display: 'block', color: T.textSub, fontSize: 14, marginBottom: 6 }}>Assign to location</label>
      <select id={id} value={locationId} onChange={event => setLocationId(event.target.value)} style={{ width: '100%', minHeight: 48, border: `1px solid ${T.border}`, background: T.card, borderRadius: 10, padding: 10, color: T.text }}>
        <option value="">Choose a saved location</option>
        {trip.locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}
      </select>
      <button className="dashboard-text-button" type="button" disabled={!locationId} onClick={assign}>Save at this location</button>
    </div>}
    {error && <p role="alert" style={{ color: '#8A1414', fontSize: 14 }}>{error}</p>}
  </div>;
}
