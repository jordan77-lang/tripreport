import { useState } from 'react';
import { BottomNav } from '../components/BottomNav';
import { Ic } from '../components/Ic';
import { SyncChip } from '../components/SyncChip';
import { T, F, ICONS, CAPTURE_MODES } from '../tokens';
import { addEntry, updateEntry } from '../lib/storage';
import { mediaCaptureLabel } from '../lib/featureFlags';
import { ts } from '../lib/textScale';
import { EntryForm } from './EntryForm';

const ENTRY_COLORS = {
  campsite: '#B8702E', water: '#4A8BC4', wildlife: '#4A7A34',
  weather: '#517EA3', rapid: '#3A72A8', 'river-feature': '#3A72A8', note: '#6B6763', food: '#B06030',
  voice: '#5B8DD9', video: '#C05050', gauge: '#2A5C8E', 'custom-event': '#2C5F3E',
};

export function FieldJournal({ trip, onNav, onFab, onTripUpdate }) {
  const hasRiver = trip?.types?.some(t => ['Rafting', 'River Camping', 'Paddling'].includes(t));
  const [captureMode, setCaptureMode] = useState(hasRiver ? 'river' : 'camping');
  const [activeForm, setActiveForm] = useState(null); // entry type string or null
  const [editingEntry, setEditingEntry] = useState(null);
  const [showCaptureMenu, setShowCaptureMenu] = useState(false);
  const [search, setSearch] = useState('');
  const captureItems = CAPTURE_MODES[captureMode];
  const entries = trip?.entries ?? [];
  const locations = trip?.locations ?? [];

  const filteredEntries = search.trim()
    ? entries.filter((e) => {
        const q = search.toLowerCase();
        const locName = locations.find((l) => l.id === e.locationId)?.name || e.locationName || '';
        const hay = `${e.title || ''} ${e.type || ''} ${e.notes || ''} ${e.featureType || ''} ${locName}`.toLowerCase();
        return hay.includes(q);
      })
    : entries;
  const tripSyncState = trip?.syncState || (entries.some(e => e.syncState === 'pending') ? 'pending' : 'synced');

  function handleSave(entry) {
    if (!trip) return;
    if (editingEntry?.id) updateEntry(trip.id, editingEntry.id, entry);
    else addEntry(trip.id, entry);
    onTripUpdate?.();
    setActiveForm(null);
    setEditingEntry(null);
  }

  if (activeForm) {
    return <EntryForm
      type={activeForm}
      trip={trip}
      locations={locations}
      defaultLocationId={editingEntry?.locationId || locations[0]?.id || null}
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
              {trip?.name || 'No active trip'}
            </div>
            <div style={{ fontSize: ts(13), color: T.textSub, marginTop: 2 }}>
              {entries.length} entries logged
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

        {/* Quick Capture */}
        <div style={{ background: T.card, borderRadius: 14, padding: '12px 14px',
                      border: `1px solid ${T.border}`, marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontSize: ts(12), fontWeight: 700, color: T.textSub,
                           textTransform: 'uppercase', letterSpacing: .8 }}>Quick Capture</div>
            {hasRiver && (
              <div style={{ display: 'flex', background: T.bg, borderRadius: 8, padding: 2, gap: 1,
                             border: `1px solid ${T.border}` }}>
                {['camping', 'river'].map(mode => (
                  <div key={mode} onClick={() => setCaptureMode(mode)}
                       style={{ padding: '5px 10px', borderRadius: 6, fontSize: ts(12), fontWeight: 700,
                                 cursor: 'pointer', transition: 'all .15s',
                                 background: captureMode === mode ? (mode === 'river' ? '#3A72A8' : T.accent) : 'transparent',
                                 color: captureMode === mode ? 'white' : T.textFaint }}>
                    {mode === 'camping' ? '⛺' : '🌊'}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ position: 'relative' }}>
            <div onClick={() => setShowCaptureMenu(v => !v)}
                 style={{ minHeight: 46, borderRadius: 11, border: `1.5px solid ${T.border}`, background: T.bg,
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px', cursor: 'pointer' }}>
              <span style={{ fontSize: ts(14), fontWeight: 700, color: T.text }}>Choose entry type for a location</span>
              <span style={{ fontSize: ts(13), color: T.textFaint }}>{showCaptureMenu ? '▲' : '▼'}</span>
            </div>

            {showCaptureMenu && (
              <div style={{ position: 'absolute', top: 46, left: 0, right: 0, background: T.card, border: `1px solid ${T.border}`,
                            borderRadius: 11, boxShadow: '0 8px 20px rgba(0,0,0,.12)', zIndex: 5, maxHeight: 260, overflowY: 'auto' }}>
                {!locations.length && (
                  <div style={{ padding: '12px 11px', fontSize: ts(13), color: T.textFaint }}>
                    Create a trip location from the Trip page first.
                  </div>
                )}
                {!!locations.length && captureItems.map((item, i) => (
                  <div key={i} onClick={() => { setEditingEntry(null); setActiveForm(item.type); setShowCaptureMenu(false); }}
                       style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 11px', cursor: 'pointer', borderBottom: i < captureItems.length - 1 ? `1px solid ${T.border}` : 'none' }}>
                    <div style={{ width: 34, height: 34, borderRadius: 8, background: item.col + '1A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Ic d={item.icon} size={16} color={item.col} sw={1.9} />
                    </div>
                    <span style={{ fontSize: ts(14), fontWeight: 700, color: T.text }}>{mediaCaptureLabel(item.label)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Entries */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: ts(15), fontWeight: 700, color: T.text }}>Entries</span>
          <span style={{ fontSize: ts(13), color: T.textSub }}>{filteredEntries.length}{search.trim() ? `/${entries.length}` : ''} total</span>
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title, notes, type, location…"
          style={{ width: '100%', border: `1.5px solid ${T.border}`, borderRadius: 10, padding: '11px 12px', fontSize: ts(14), fontFamily: F, marginBottom: 10, boxSizing: 'border-box', outline: 'none', background: T.card }}
        />

        {entries.length === 0 && (
          <div style={{ textAlign: 'center', padding: '32px 0', color: T.textFaint, fontSize: ts(14) }}>
            No entries yet — tap a capture button above
          </div>
        )}

        {entries.length > 0 && filteredEntries.length === 0 && (
          <div style={{ textAlign: 'center', padding: '24px 0', color: T.textFaint, fontSize: ts(13) }}>
            No entries match &ldquo;{search}&rdquo;
          </div>
        )}

        {filteredEntries.map((e, i) => {
          const col = ENTRY_COLORS[e.type] || T.accent;
          return (
            <div key={e.id || i} style={{ background: T.card, borderRadius: 12, padding: '12px 13px',
                                           marginBottom: 8, border: `1px solid ${T.border}`,
                                           display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <div style={{ width: 36, height: 36, borderRadius: 9, background: col + '1C',
                             display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Ic d={typeIcon(e.type)} size={16} color={col} sw={1.8} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                  <span style={{ fontSize: ts(14), fontWeight: 700, color: T.text }}>{e.title || e.type}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: ts(12), color: T.textFaint }}>{timeAgo(e.createdAt)}</span>
                    <SyncChip state={e.syncState || 'pending'} compact />
                  </div>
                </div>
                <div style={{ fontSize: ts(12), color: col, fontWeight: 700, marginBottom: e.notes ? 4 : 0,
                               textTransform: 'capitalize' }}>{entryTypeLabel(e)}</div>
                <div style={{ fontSize: ts(12), color: '#2A5C8E', marginBottom: 4 }}>
                  {entryLocationLabel(e, locations)}
                </div>
                {e.observedAt && <div style={{ fontSize: ts(12), color: T.textFaint, marginBottom: 4 }}>Observed: {new Date(e.observedAt).toLocaleString()}</div>}
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
                {e.type === 'weather' && (e.weatherSummary || e.weatherTempC != null) && (
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
                <div style={{ marginTop: 7 }}>
                  <span
                    onClick={() => { setEditingEntry(e); setActiveForm(e.type || 'note'); }}
                    style={{ fontSize: ts(13), color: '#2A5C8E', fontWeight: 700, cursor: 'pointer' }}
                  >
                    Edit entry
                  </span>
                </div>
              </div>
            </div>
          );
        })}
        <div style={{ height: 4 }} />
      </div>

      <BottomNav active="log" onNav={onNav} onFab={onFab} trip={trip} />
    </div>
  );
}

function typeIcon(type) {
  const map = {
    campsite: ICONS.tent, water: ICONS.drop, wildlife: ICONS.leaf,
    weather: ICONS.compass, rapid: ICONS.drop, 'river-feature': ICONS.drop, note: ICONS.note, food: ICONS.fork,
    voice: ICONS.mic, video: ICONS.video, gauge: ICONS.gauge,
    'custom-event': ICONS.plus,
  };
  return map[type] || ICONS.note;
}

function entryTypeLabel(entry) {
  if (entry.type === 'river-feature') {
    const ft = entry.featureType || 'river feature';
    return `River Feature · ${ft}`;
  }
  return entry.type;
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
