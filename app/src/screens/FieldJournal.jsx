import { buildTripTimeline, formatTripDay, groupJournalDays, tripTimeZone } from '../lib/tripTimeline';
import { Fragment, useState } from 'react';
import { BottomNav } from '../components/BottomNav';
import { Ic } from '../components/Ic';
import { SyncChip } from '../components/SyncChip';
import { T, F, ICONS } from '../tokens';
import { addEntry, updateEntry, getCurrentUserId, isTripMember, isTripOpen } from '../lib/storage';
import { AudioAttachment } from '../components/AudioAttachment';
import { MediaThumb } from '../components/MediaThumb';
import { resolveUserDisplayName } from '../lib/tripParticipants';
import { locationTypeLabel } from '../lib/locationTypes';
import { ts } from '../lib/textScale';
import { EntryForm } from './EntryForm';

const ENTRY_COLORS = {
  photo: '#2C5F3E', campsite: '#B8702E', water: '#4A8BC4', wildlife: '#4A7A34', conditions: '#2A5C8E',
  weather: '#517EA3', rapid: '#3A72A8', 'river-feature': '#3A72A8', note: '#6B6763', food: '#B06030',
  voice: '#5B8DD9', video: '#C05050', gauge: '#2A5C8E', expense: '#2A5C8E', 'custom-event': '#2C5F3E',
};

export function FieldJournal({ trip, onNav, onFab, onTripUpdate, onOpenLocation, onOpenEvent, notice, locationId = null }) {
  const [activeForm, setActiveForm] = useState(null); // entry type string or null
  const [editingEntry, setEditingEntry] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [savedNotice, setSavedNotice] = useState(null);
  const [filter, setFilter] = useState('everyone');
  const currentUserId = getCurrentUserId();
  const [search, setSearch] = useState('');
  const entries = buildTripTimeline(trip || {}).map(point => ({...point.item,
    _kind: point.kind, _key: point.id, _day: point.day, authorId: point.authorId,
    title: point.item.title || point.item.name,
    photoFiles: point.item.photoFiles || point.item.photos || [],
    observedAt: point.time,
  }));
  const locations = trip?.locations ?? [];
  const unassignedCount = (trip?.entries || []).filter(entry => !entry.locationId).length;

  const filteredEntries = entries.filter(e => {
    if (filter === 'mine' && e.authorId !== currentUserId) return false;
    if (filter === 'photos' && !e.photoFiles?.length) return false;
    if (filter === 'unassigned' && (e._kind !== 'entry' || e.locationId)) return false;
    const q = search.trim().toLowerCase();
    const locName = locations.find(l => l.id === e.locationId)?.name || e.locationName || '';
    return !q || [e.title, e.type, e.notes, e.featureType, locName].join(' ').toLowerCase().includes(q);
  }).sort((a, b) => new Date(b.observedAt || b.createdAt) - new Date(a.observedAt || a.createdAt));
  const journalDays = groupJournalDays(filteredEntries, locations);
  function editEntry(entry) {
    setSaveError(null);
    setEditingEntry(trip.entries.find(item => item.id === entry.id));
    setActiveForm(entry.type || 'note');
  }
  const tripSyncState = trip?.syncState || (entries.some(e => e.syncState === 'pending') ? 'pending' : 'synced');

  function handleSave(entry) {
    if (!trip) return;
    setSaveError(null);
    try {
      const saved = editingEntry?.id ? updateEntry(trip.id, editingEntry.id, entry) : addEntry(trip.id, entry);
      if (!saved) throw new Error('Entry could not be saved. Please try again.');
      onTripUpdate?.();
      setActiveForm(null);
      setEditingEntry(null);
      setSavedNotice('Entry saved on this phone.');
    } catch (e) { setSaveError(e.message); }
  }

  if (activeForm) {
    return <EntryForm
      type={activeForm}
      trip={trip}
      locations={locations}
      defaultLocationId={editingEntry?.locationId || null}
      allowUnlinked={!editingEntry?.locationId}
      saveError={saveError}
      initialEntry={editingEntry}
      onSave={handleSave}
      onCancel={() => { setActiveForm(null); setEditingEntry(null); }}
    />;
  }

  return (
    <div style={{ height: '100%', background: T.bg, display: 'flex', flexDirection: 'column', fontFamily: F, overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ background: T.card, padding: '10px 16px 14px', borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: ts(20), fontWeight: 800, color: T.text, letterSpacing: -.5 }}>
              Journal
            </div>
            <div style={{ fontSize: ts(13), color: T.textSub, marginTop: 2 }}>
              {trip?.name || 'No active trip'} · {entries.length} moments
            </div>
            <div style={{ marginTop: 6 }}>
              <SyncChip state={tripSyncState} compact />
            </div>
          </div>
          {trip?.types && (
            <div style={{ display: 'flex', gap: 4 }}>
              {trip.types.slice(0, 2).map(type => (
                <div key={type} style={{ background: T.accentLight, borderRadius: 6, padding: '4px 9px',
                                          fontSize: ts(11), fontWeight: 700, color: T.accent }}>{type}</div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>

        {(savedNotice || notice) && <p role="status" style={{ padding: 12, marginBottom: 12, background: T.accentLight, color: T.accent, borderRadius: 10, fontSize: ts(14) }}>{savedNotice || notice}</p>}
        <div style={{ marginBottom: 20 }}>
          {isTripOpen(trip) && isTripMember(trip, currentUserId) && <button className="dashboard-button primary" type="button" onClick={() => onNav?.('capture')}>
            <Ic d={ICONS.plus} size={18} color="currentColor" /> {locationId ? 'Add entry at this location' : 'Choose a location to add entries'}
          </button>}
          {locationId && (
            <p style={{ fontSize: ts(14), color: T.accent, fontWeight: 700, margin: '12px 0 0' }}>
              Adding to {locations.find((item) => item.id === locationId)?.name || 'this place'}
            </p>
          )}
        </div>

        {unassignedCount > 0 && <div style={{ padding: 14, borderRadius: 12, background: T.accentLight, marginBottom: 16 }}>
          <p style={{ fontSize: ts(14), color: T.accent, lineHeight: 1.5 }}>{unassignedCount} earlier {unassignedCount === 1 ? 'entry has' : 'entries have'} no saved location. Use Edit entry to assign a place.</p>
          <button className="dashboard-text-button" type="button" onClick={() => { setFilter('unassigned'); setSearch(''); }}>Show entries without a location</button>
        </div>}

        {/* Entries */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: ts(15), fontWeight: 700, color: T.text }}>Trip timeline</span>
          <span style={{ fontSize: ts(13), color: T.textSub }}>{filteredEntries.length}{search.trim() ? `/${entries.length}` : ''} total</span>
        </div>

        <div aria-label="Journal filters" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {[['everyone', 'Everyone'], ['mine', 'Mine'], ['photos', 'Photos'], ...(unassignedCount ? [['unassigned', 'Needs a location']] : [])].map(([value, label]) =>
            <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}
              style={{ minHeight: 44, padding: '8px 14px', borderRadius: 12, border: '1px solid ' + T.border,
                background: filter === value ? T.accent : T.card, color: filter === value ? 'white' : T.text,
                fontSize: ts(14), cursor: 'pointer' }}>{label}</button>)}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search journal"
          placeholder="Search title, notes, type, location…"
          style={{ width: '100%', border: `1.5px solid ${T.border}`, borderRadius: 10, padding: '11px 12px', fontSize: ts(14), fontFamily: F, marginBottom: 10, boxSizing: 'border-box', outline: 'none', background: T.card }}
        />

        {entries.length === 0 && (
          <div style={{ textAlign: 'center', padding: '32px 0', color: T.textFaint, fontSize: ts(14) }}>
            Your shared story starts with a location. Add a place, then collect its photos, notes, meals, and sightings.
          </div>
        )}

        {entries.length > 0 && filteredEntries.length === 0 && (
          <div style={{ textAlign: 'center', padding: '24px 0', color: T.textFaint, fontSize: ts(13) }}>
            No entries match these filters.
          </div>
        )}

        {journalDays.map((day) => (
          <Fragment key={day.day}>
            <h2 style={{ fontSize: ts(15), color: T.textSub, margin: '16px 0 10px' }}>{formatTripDay(day.day, trip?.startDate)}</h2>
            {day.places.map((place) => (
              <div key={place.id} style={{ background: T.card, borderRadius: 12, border: `1px solid ${T.border}`, marginBottom: 10, overflow: 'hidden' }}>
                <button type="button" onClick={() => onOpenLocation?.(place.location.id)}
                  style={{ width: '100%', border: 'none', background: 'transparent', padding: '12px 13px', textAlign: 'left', cursor: onOpenLocation ? 'pointer' : 'default', fontFamily: F }}>
                  <div style={{ fontSize: ts(15), fontWeight: 800, color: T.text }}>{place.location.icon || '📍'} {place.location.name}</div>
                  <div style={{ fontSize: ts(12), color: T.textSub, marginTop: 2 }}>{locationTypeLabel(place.location.type)}</div>
                </button>
                {(place.events.length > 0 || place.loose.length > 0) && (
                  <div style={{ borderTop: `1px solid ${T.border}`, padding: '4px 10px 8px 14px' }}>
                    {place.events.map((group) => (
                      <div key={group.id} style={{ marginTop: 8, paddingLeft: 10, borderLeft: `2px solid ${T.border}` }}>
                        <button type="button" onClick={() => onOpenEvent?.(place.location.id, group.event.id)}
                          style={{ width: '100%', border: 'none', background: 'transparent', padding: '4px 0', textAlign: 'left', cursor: onOpenEvent ? 'pointer' : 'default', fontFamily: F }}>
                          <div style={{ fontSize: ts(14), fontWeight: 800, color: T.text }}>{group.event.title || group.event.name || group.event.type}</div>
                          <div style={{ fontSize: ts(12), color: ENTRY_COLORS[group.event.type] || T.accent, fontWeight: 700 }}>{entryTypeLabel(group.event)}</div>
                        </button>
                        {group.entries.map((entry) => (
                          <JournalCard key={entry._key || entry.id} entry={entry} trip={trip} currentUserId={currentUserId} locations={locations} hideLocation onEdit={editEntry} />
                        ))}
                      </div>
                    ))}
                    {place.loose.map((entry) => (
                      <div key={entry._key || entry.id} style={{ marginTop: 8, paddingLeft: 10, borderLeft: `2px solid ${T.border}` }}>
                        <JournalCard entry={entry} trip={trip} currentUserId={currentUserId} locations={locations} hideLocation onEdit={editEntry} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {day.loose.map((entry) => (
              <JournalCard key={entry._key || entry.id} entry={entry} trip={trip} currentUserId={currentUserId} locations={locations} onEdit={editEntry} />
            ))}
          </Fragment>
        ))}
        <div style={{ height: 4 }} />
      </div>

      <BottomNav active="log" onNav={onNav} onFab={onFab} trip={trip} />
    </div>
  );
}

function JournalCard({ entry: e, trip, currentUserId, locations, hideLocation = false, onEdit }) {
  const col = ENTRY_COLORS[e.type] || T.accent;
  return (
    <div style={{ background: hideLocation ? 'transparent' : T.card, borderRadius: hideLocation ? 0 : 12, padding: hideLocation ? '8px 0' : '12px 13px',
                  marginBottom: hideLocation ? 0 : 8, border: hideLocation ? 'none' : `1px solid ${T.border}`,
                  display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <div style={{ width: 36, height: 36, borderRadius: 9, background: col + '1C',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Ic d={typeIcon(e.type)} size={16} color={col} sw={1.8} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
          <span style={{ fontSize: ts(14), fontWeight: 700, color: T.text }}>{e.title || e.type}</span>
          <span style={{ fontSize: ts(12), color: T.textFaint }}>{timeAgo(e.createdAt)}</span>
        </div>
        <div style={{ fontSize: ts(12), color: col, fontWeight: 700, marginBottom: e.notes ? 4 : 0, textTransform: 'capitalize' }}>{journalKindLabel(e)}</div>
        <div style={{ fontSize: ts(12), color: '#2A5C8E', marginBottom: 4 }}>
          {resolveUserDisplayName(trip, e.authorId, currentUserId) || 'Crew member'}
          {!hideLocation && ` · ${entryLocationLabel(e, locations)}`}
        </div>
        {e.observedAt && <div style={{ fontSize: ts(12), color: T.textFaint, marginBottom: 4 }}>Observed: {new Date(e.observedAt).toLocaleString(undefined, { timeZone: tripTimeZone(trip) })}</div>}
        {e.notes && <div style={{ fontSize: ts(13), color: T.textSub, lineHeight: 1.4 }}>{e.notes}</div>}
        {e.mapTagSymbol && <div style={{ fontSize: ts(12), color: T.textFaint, marginTop: 2 }}>Tag: {e.mapTagSymbol}</div>}
        {e.cfs && (
          <div style={{ fontSize: ts(13), color: '#3A72A8', fontWeight: 600 }}>
            {e.cfs} CFS{e.rapidClass ? ` · Class ${e.rapidClass}` : ''}
          </div>
        )}
        {e.gaugeSyncPending && (
          <div style={{ fontSize: ts(12), color: T.textFaint, marginTop: 2 }}>
            Gauge flow pending sync when back online
          </div>
        )}
        {(e.type === 'weather' || e.type === 'conditions') && (e.weatherSummary || e.weatherTempC != null) && (
          <div style={{ fontSize: ts(13), color: '#2A5C8E', fontWeight: 600 }}>
            {e.weatherSummary || 'Weather'}
            {e.weatherTempC != null ? ` · ${Math.round(cToF(e.weatherTempC))}°F` : ''}
            {e.weatherWindKph != null ? ` · Wind ${Math.round(e.weatherWindKph)} km/h` : ''}
          </div>
        )}
        {e.weatherSyncPending && (
          <div style={{ fontSize: ts(12), color: T.textFaint, marginTop: 2 }}>
            Weather conditions pending sync when back online
          </div>
        )}
        {e.weatherObservation && (
          <div style={{ fontSize: ts(12), color: T.textSub, marginTop: 3 }}>
            Obs: {e.weatherObservation}
          </div>
        )}
        {e.rating && <div style={{ fontSize: ts(14), color: T.amber }}>{'★'.repeat(e.rating)}{'☆'.repeat(5 - e.rating)}</div>}
        {e.lat && <div style={{ fontSize: ts(12), color: T.textFaint, marginTop: 3 }}>📍 GPS tagged</div>}
        {(e.photoNotes || e.videoNotes || e.voiceNotes) && (
          <div style={{ fontSize: ts(12), color: T.textFaint, marginTop: 3 }}>
            {(e.photoNotes ? '📷 ' : '') + (e.videoNotes ? '🎥 ' : '') + (e.voiceNotes ? '🎙 ' : '')}Media notes added
          </div>
        )}
        {(e.photoFiles?.length || e.videoFiles?.length || e.voiceFiles?.length) && (
          <div style={{ fontSize: ts(12), color: T.textFaint, marginTop: 3 }}>
            {(e.photoFiles?.length || 0)} photos · {(e.videoFiles?.length || 0)} videos · {(e.voiceFiles?.length || 0)} audio
          </div>
        )}
        {!!e.photoFiles?.length && <div style={{ display: 'flex', gap: 8, overflowX: 'auto', marginTop: 8 }}>{e.photoFiles.map((photo, index) => <MediaThumb key={photo.id || index} media={photo} alt={photo.caption || 'Journal photo'} style={{ width: 96, height: 96, borderRadius: 10, objectFit: 'cover' }} />)}</div>}
        {e.voiceFiles?.map((audio, index) => <AudioAttachment key={audio.id || index} media={audio} />)}
        {e._kind === 'entry' && <div style={{ marginTop: 7 }}>
          <button type="button" onClick={() => onEdit?.(e)}
            style={{ minHeight: 44, padding: '8px 0', border: 'none', background: 'transparent', fontSize: ts(14), color: '#2A5C8E', fontWeight: 700, cursor: 'pointer' }}>
            Edit entry
          </button>
        </div>}
      </div>
    </div>
  );
}

function typeIcon(type) {
  const map = {
    photo: ICONS.camera, campsite: ICONS.tent, water: ICONS.drop, wildlife: ICONS.leaf,
    weather: ICONS.compass, conditions: ICONS.compass, rapid: ICONS.drop, 'river-feature': ICONS.drop, note: ICONS.note, food: ICONS.fork,
    voice: ICONS.mic, video: ICONS.video, gauge: ICONS.gauge, expense: ICONS.expense,
    'custom-event': ICONS.plus,
  };
  return map[type] || ICONS.note;
}

function entryTypeLabel(entry) {
  if (entry.type === 'conditions') return 'Weather & flow';
  if (entry.type === 'gauge') return 'River Flow';
  if (entry.type === 'weather') return 'Weather';
  if (entry.type === 'campsite') return 'Campsite';
  if (entry.type === 'expense') return 'Expense';
  if (entry.type === 'custom-event') return 'Custom';
  if (entry.type === 'video') return 'Photo/video';
  if (entry.type === 'river-feature') {
    const ft = entry.featureType || 'river feature';
    return `River Feature · ${ft}`;
  }
  return entry.type;
}

function journalKindLabel(entry) {
  const label = entryTypeLabel(entry);
  if (['gauge', 'weather', 'conditions'].includes(entry.type) && entry._kind === 'entry') return label;
  return `${label} · ${entry._kind}`;
}

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

function entryLocationLabel(entry, locations) {
  if (!entry?.locationId) return 'No linked location';
  const found = locations.find((l) => l.id === entry.locationId);
  const name = found?.name || entry.locationName || 'Unknown location';
  return `Location: ${name}`;
}

function cToF(c) {
  return (c * 9) / 5 + 32;
}
