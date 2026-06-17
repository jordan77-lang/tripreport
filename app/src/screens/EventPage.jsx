import { useEffect, useMemo, useRef, useState } from 'react';
import { BottomNav } from '../components/BottomNav';
import { SyncChip } from '../components/SyncChip';
import { Ic } from '../components/Ic';
import { EntryForm } from './EntryForm';
import { TripExpenses } from '../components/TripExpenses';
import { T, F, ICONS } from '../tokens';
import { addEntry, getCurrentUserId, removeEvent, updateEntry, updateEvent } from '../lib/storage';
import { savePlanningToCloud } from '../lib/planningSave';
import { createPhotoMediaFromFile } from '../lib/media';
import { MediaThumb } from '../components/MediaThumb';
import { createMediaObjectUrl, isLegacyMediaRef } from '../lib/mediaStore';
import { buildTripParticipants, labelFor } from '../lib/expenses';

const ENTRY_COLORS = {
  campsite: '#B8702E', water: '#4A8BC4', wildlife: '#4A7A34',
  weather: '#517EA3', rapid: '#3A72A8', 'river-feature': '#3A72A8',
  note: '#6B6763', food: '#B06030', voice: '#5B8DD9', video: '#C05050',
  gauge: '#2A5C8E', 'custom-event': '#2C5F3E',
};

// SVG path for each entry type (maps to ICONS)
const ENTRY_ICON = {
  campsite: ICONS.tent, water: ICONS.drop, wildlife: ICONS.leaf,
  weather: ICONS.compass, rapid: ICONS.drop, 'river-feature': ICONS.drop,
  note: ICONS.note, food: ICONS.fork, voice: ICONS.mic,
  video: ICONS.video, gauge: ICONS.gauge, 'custom-event': ICONS.plus,
};

// Core contributions always available for any event
const CORE_CONTRIBUTE = [
  { icon: ICONS.note,    label: 'Add Note',        col: '#6B6763', type: 'note' },
  { icon: ICONS.camera,  label: mediaCaptureLabel('Photo / Video'),   col: '#C05050', type: 'video' },
  { icon: ICONS.mic,     label: 'Voice Memo',      col: '#5B8DD9', type: 'voice' },
  { icon: ICONS.compass, label: 'Weather',         col: '#517EA3', type: 'weather' },
  { icon: ICONS.gauge,   label: 'Gauge Reading',   col: '#2A5C8E', type: 'gauge' },
];

// Additional items specific to certain event types
const CONTEXTUAL_CONTRIBUTE = {
  food:     [{ icon: ICONS.fork,  label: 'Meal Detail', col: '#B06030', type: 'food' }],
  wildlife: [{ icon: ICONS.leaf,  label: 'Sighting',    col: '#4A7A34', type: 'wildlife' }],
  gauge:    [{ icon: ICONS.drop,  label: 'River Feature', col: '#3A72A8', type: 'river-feature' }],
  campsite: [{ icon: ICONS.tent,  label: 'Camp Note',   col: '#B8702E', type: 'campsite' }],
};

function getContributeItems(eventType) {
  const contextual = CONTEXTUAL_CONTRIBUTE[eventType] || [];
  // Deduplicate: don't show a contextual item if it's already in core
  const coreTypes = new Set(CORE_CONTRIBUTE.map(c => c.type));
  return [...CORE_CONTRIBUTE, ...contextual.filter(c => !coreTypes.has(c.type))];
}

export function EventPage({
  trip, location, event, onBack, onNav, onFab, onTripUpdate,
  canEditEvent = true, canAddToEvent = true,
  initialEdit = false, initialAddType = null,
  onPrev = null, onNext = null, eventIndex = null, eventCount = null,
}) {
  const currentUserId = getCurrentUserId();
  const participants = useMemo(() => buildTripParticipants(trip, currentUserId), [trip, currentUserId]);
  const coverRef = useRef(null);

  const [activeFormType, setActiveFormType] = useState(initialAddType);
  const [editingEntry, setEditingEntry] = useState(null);
  const [editingEvent, setEditingEvent] = useState(initialEdit);
  const [editEventError, setEditEventError] = useState(null);
  const [contributeOpen, setContributeOpen] = useState(false);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [eventDraft, setEventDraft] = useState({
    name: event?.name || '',
    notes: event?.notes || '',
    type: event?.type || 'note',
    coverPhoto: event?.coverPhoto,
    memberIds: event?.memberIds || [],
  });

  useEffect(() => {
    setEventDraft({
      name: event?.name || '',
      notes: event?.notes || '',
      type: event?.type || 'note',
      coverPhoto: event?.coverPhoto,
      memberIds: event?.memberIds || [],
    });
  }, [event?.id, event?.name, event?.notes, event?.type, event?.coverPhoto, event?.memberIds]);

  const entries = useMemo(() => {
    const list = (trip?.entries || []).filter((e) => e.eventId === event?.id);
    return list.sort((a, b) => {
      const ta = a.observedAt ? new Date(a.observedAt).getTime() : (a.createdAt || 0);
      const tb = b.observedAt ? new Date(b.observedAt).getTime() : (b.createdAt || 0);
      return ta - tb;
    });
  }, [trip?.entries, event?.id]);

  const photos = useMemo(() => {
    const out = [];
    const cover = event?.coverPhoto;
    if (cover && (cover.id || cover.thumbDataUrl || cover.dataUrl)) {
      out.push({ media: cover, caption: event.name, isCover: true });
    }
    for (const e of entries) {
      for (const f of e.photoFiles || []) {
        if (f.id || f.thumbDataUrl || f.dataUrl) {
          out.push({ media: f, caption: e.title || e.type, entryId: e.id });
        }
      }
    }
    return out;
  }, [entries, event?.coverPhoto, event?.name]);

  function openNewEntry(type) {
    setEditingEntry(null);
    setActiveFormType(type);
    setContributeOpen(false);
  }

  function handleSaveEntry(payload) {
    if (!trip || !event) return;
    const next = {
      ...payload,
      eventId: event.id,
      eventName: event.name,
      eventType: event.type,
      locationId: event.locationId,
      locationName: event.locationName,
      locationType: location?.type,
    };
    if (editingEntry?.id) updateEntry(trip.id, editingEntry.id, next);
    else addEntry(trip.id, next);
    setActiveFormType(null);
    setEditingEntry(null);
    onTripUpdate?.();
  }

  function saveEventDetails() {
    if (!trip || !event) return;
    if (!eventDraft.name.trim()) {
      setEditEventError('Event name is required.');
      return;
    }
    setEditEventError(null);
    void savePlanningToCloud(trip.id, () => {
      updateEvent(trip.id, event.id, {
        name: eventDraft.name.trim(),
        notes: eventDraft.notes,
        type: eventDraft.type,
        coverPhoto: eventDraft.coverPhoto,
        memberIds: eventDraft.memberIds,
      });
    }).then(() => {
      setEditingEvent(false);
      onTripUpdate?.();
    }).catch((e) => {
      setEditEventError(e?.message || 'Could not save event.');
    });
  }

  async function handleDeleteEvent() {
    if (!canEditEvent || !trip || !event) return;
    if (!window.confirm(`Delete "${event.name}" and all its entries?`)) return;
    await savePlanningToCloud(trip.id, () => {
      removeEvent(trip.id, event.id);
    });
    onTripUpdate?.();
    onBack();
  }

  async function onCoverSelected(files) {
    const f = Array.from(files || [])[0];
    if (!f) return;
    const coverPhoto = trip?.id ? await createPhotoMediaFromFile(f, trip.id, { maxThumbSide: 320, maxFullSide: 1200 }) : null;
    setEventDraft((d) => ({ ...d, coverPhoto }));
  }

  if (!event) {
    return (
      <div style={{ height: '100%', background: T.bg, display: 'flex', flexDirection: 'column', fontFamily: F }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.textFaint }}>
          Event not found
        </div>
        <BottomNav active="trip" onNav={onNav} onFab={onFab} trip={trip} />
      </div>
    );
  }

  if (activeFormType) {
    return (
      <EntryForm
        type={editingEntry?.type || activeFormType}
        trip={trip}
        locations={location ? [location] : []}
        defaultLocationId={location?.id || event.locationId}
        initialEntry={editingEntry}
        onSave={handleSaveEntry}
        onCancel={() => { setActiveFormType(null); setEditingEntry(null); }}
      />
    );
  }

  const accentCol = ENTRY_COLORS[event.type] || T.accent;
  const eventIcon = ENTRY_ICON[event.type] || ICONS.note;

  return (
    <div style={{ height: '100%', background: T.bg, display: 'flex', flexDirection: 'column', fontFamily: F, overflow: 'hidden' }}>

      {/* ── Header ── */}
      <div style={{ background: T.card, padding: '10px 16px 12px', borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div onClick={onBack}
               style={{ width: 36, height: 36, borderRadius: 18, background: T.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
            <Ic d="M19 12H5 M12 5l-7 7 7 7" size={18} color={T.text} sw={2} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: T.text, letterSpacing: -0.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {event.name}
            </div>
            <div style={{ fontSize: 11, color: T.textSub, marginTop: 1 }}>
              {location?.name || event.locationName || 'Unknown location'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
            {canEditEvent && (
              <div onClick={() => { setEditingEvent((v) => !v); setEditEventError(null); }}
                   style={{ fontSize: 10.5, color: editingEvent ? T.textFaint : accentCol, fontWeight: 700, cursor: 'pointer' }}>
                {editingEvent ? 'Cancel' : 'Edit'}
              </div>
            )}
            {canAddToEvent && (
              <div onClick={() => setContributeOpen((v) => !v)}
                   style={{ background: accentCol, color: 'white', borderRadius: 9, padding: '6px 12px', fontSize: 10.5, fontWeight: 700, cursor: 'pointer' }}>
                + Add
              </div>
            )}
          </div>
        </div>

        {/* ── Prev / Next navigation ── */}
        {(onPrev || onNext) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${T.border}` }}>
            <div onClick={onPrev || undefined}
                 style={{ flex: 1, height: 32, borderRadius: 9, border: `1px solid ${T.border}`, background: T.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, cursor: onPrev ? 'pointer' : 'default', opacity: onPrev ? 1 : 0.3 }}>
              <Ic d="M15 18l-6-6 6-6" size={14} color={T.textSub} sw={2} />
              <span style={{ fontSize: 11, fontWeight: 700, color: T.textSub }}>Previous</span>
            </div>
            {eventIndex != null && eventCount != null && (
              <div style={{ fontSize: 10.5, fontWeight: 700, color: T.textFaint, whiteSpace: 'nowrap', padding: '0 4px' }}>
                {eventIndex + 1} / {eventCount}
              </div>
            )}
            <div onClick={onNext || undefined}
                 style={{ flex: 1, height: 32, borderRadius: 9, border: `1px solid ${T.border}`, background: T.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, cursor: onNext ? 'pointer' : 'default', opacity: onNext ? 1 : 0.3 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: T.textSub }}>Next</span>
              <Ic d="M9 18l6-6-6-6" size={14} color={T.textSub} sw={2} />
            </div>
          </div>
        )}
      </div>

      {/* ── Scrollable body ── */}
      <div style={{ flex: 1, overflowY: 'auto' }}>

        {/* ── Photo carousel ── */}
        {photos.length > 0 && (
          <div style={{ position: 'relative', background: '#111', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 180, maxHeight: 340 }}>
            <MediaThumb
              media={photos[photoIdx]?.media}
              preferThumb={false}
              alt={photos[photoIdx]?.caption || 'Event photo'}
              style={{ width: '100%', maxHeight: 340, objectFit: 'contain', display: 'block' }}
            />
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(transparent, rgba(0,0,0,.55))', padding: '24px 14px 10px' }}>
              {photos.length > 1 && (
                <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                  {photos.map((_, i) => (
                    <div key={i} onClick={() => setPhotoIdx(i)}
                         style={{ width: i === photoIdx ? 16 : 5, height: 5, borderRadius: 3, background: i === photoIdx ? 'white' : 'rgba(255,255,255,.4)', cursor: 'pointer', transition: 'width .2s' }} />
                  ))}
                </div>
              )}
              <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.85)' }}>{photos[photoIdx]?.caption}</div>
            </div>
            {photos.length > 1 && (
              <>
                <div onClick={() => setPhotoIdx((i) => (i - 1 + photos.length) % photos.length)}
                     style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', width: 30, height: 30, borderRadius: 15, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                  <Ic d="M15 18l-6-6 6-6" size={15} color="white" sw={2} />
                </div>
                <div onClick={() => setPhotoIdx((i) => (i + 1) % photos.length)}
                     style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', width: 30, height: 30, borderRadius: 15, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                  <Ic d="M9 18l6-6-6-6" size={15} color="white" sw={2} />
                </div>
                <div style={{ position: 'absolute', top: 8, right: 10, background: 'rgba(0,0,0,.45)', borderRadius: 8, padding: '2px 7px', fontSize: 10, fontWeight: 700, color: 'white' }}>
                  {photoIdx + 1} / {photos.length}
                </div>
              </>
            )}
          </div>
        )}

        <div style={{ padding: '14px 16px' }}>

          {/* ── Edit event form ── */}
          {editingEvent && canEditEvent && (
            <div style={{ background: T.card, borderRadius: 14, border: `1px solid ${T.border}`, padding: '13px 14px', marginBottom: 14 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: T.text, marginBottom: 10 }}>Edit Event</div>
              <input
                value={eventDraft.name}
                onChange={(e) => { setEventDraft((d) => ({ ...d, name: e.target.value })); if (e.target.value.trim()) setEditEventError(null); }}
                placeholder="Event name (required)"
                style={{ width: '100%', border: `1.5px solid ${editEventError && !eventDraft.name.trim() ? '#C0392B' : T.border}`, borderRadius: 10, padding: '8px 10px', fontSize: 12, fontFamily: F, marginBottom: editEventError && !eventDraft.name.trim() ? 4 : 8, boxSizing: 'border-box', outline: 'none', background: T.bg }}
              />
              {editEventError && !eventDraft.name.trim() && (
                <div style={{ fontSize: 11, color: '#C0392B', fontWeight: 600, marginBottom: 8, padding: '5px 9px', background: '#FFF0EE', borderRadius: 7, border: '1px solid #F5C6C0' }}>
                  {editEventError}
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 8 }}>
                {['food', 'wildlife', 'gauge', 'weather', 'note', 'custom-event'].map((tp) => (
                  <div key={tp} onClick={() => setEventDraft((d) => ({ ...d, type: tp }))}
                       style={{ flexShrink: 0, padding: '5px 10px', borderRadius: 14, cursor: 'pointer', fontSize: 10.5, fontWeight: 700,
                                background: eventDraft.type === tp ? accentCol : T.bg,
                                color: eventDraft.type === tp ? 'white' : T.textSub,
                                border: eventDraft.type === tp ? 'none' : `1px solid ${T.border}` }}>
                    {tp}
                  </div>
                ))}
              </div>
              <textarea
                value={eventDraft.notes}
                onChange={(e) => setEventDraft((d) => ({ ...d, notes: e.target.value }))}
                placeholder="Event description"
                rows={2}
                style={{ width: '100%', border: `1.5px solid ${T.border}`, borderRadius: 10, padding: '8px 10px', fontSize: 12, fontFamily: F, marginBottom: 8, boxSizing: 'border-box', outline: 'none', background: T.bg, resize: 'vertical' }}
              />
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: T.textSub, marginBottom: 6 }}>Expense crew (who shares costs for this event)</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {participants.map((p) => {
                    const on = eventDraft.memberIds.includes(p.id);
                    return (
                      <div
                        key={p.id}
                        onClick={() => setEventDraft((d) => ({
                          ...d,
                          memberIds: on ? d.memberIds.filter((id) => id !== p.id) : [...d.memberIds, p.id],
                        }))}
                        style={{
                          padding: '5px 10px',
                          borderRadius: 14,
                          cursor: 'pointer',
                          fontSize: 10.5,
                          fontWeight: 700,
                          background: on ? accentCol : T.bg,
                          color: on ? 'white' : T.textSub,
                          border: on ? 'none' : `1px solid ${T.border}`,
                        }}
                      >
                        {p.label}
                      </div>
                    );
                  })}
                </div>
                <div style={{ fontSize: 10, color: T.textFaint, marginTop: 6 }}>
                  e.g. everyone in your car for gas — expenses here default to this crew.
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <div onClick={() => coverRef.current?.click()}
                     style={{ background: '#E4EFF8', border: '1px solid #3A72A840', borderRadius: 10, padding: '7px 10px', fontSize: 10.5, fontWeight: 700, color: '#2A5C8E', cursor: 'pointer' }}>
                  Set Cover Photo
                </div>
                <input ref={coverRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => onCoverSelected(e.target.files)} />
                {!!eventDraft.coverPhoto && (
                  <div onClick={() => setEventDraft((d) => ({ ...d, coverPhoto: null }))}
                       style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: '7px 10px', fontSize: 10.5, fontWeight: 700, color: T.textSub, cursor: 'pointer' }}>
                    Remove Cover
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, flexDirection: 'column' }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div onClick={() => { setEditingEvent(false); setEditEventError(null); }}
                       style={{ flex: 1, height: 36, borderRadius: 10, border: `1px solid ${T.border}`, background: T.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 11, fontWeight: 700, color: T.textSub }}>
                    Cancel
                  </div>
                  <div onClick={() => void saveEventDetails()}
                       style={{ flex: 1, height: 36, borderRadius: 10, background: accentCol, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 11, fontWeight: 700, color: 'white' }}>
                    Save
                  </div>
                </div>
                <button type="button" onClick={() => void handleDeleteEvent()} style={{ border: 'none', background: 'transparent', color: '#8A1414', fontSize: 11, fontWeight: 700, cursor: 'pointer', padding: '2px 0', fontFamily: F }}>
                  Delete event and its entries
                </button>
              </div>
            </div>
          )}

          {/* ── Event summary ── */}
          {!editingEvent && (
            <div style={{ background: T.card, borderRadius: 14, border: `1px solid ${T.border}`, padding: '14px 15px', marginBottom: 14 }}>
              {/* Type + location row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: event.notes || event.taggedParticipantLabel ? 10 : 0 }}>
                <div style={{ width: 32, height: 32, borderRadius: 9, background: accentCol + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Ic d={eventIcon} size={15} color={accentCol} sw={1.8} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ background: accentCol + '18', color: accentCol, borderRadius: 6, padding: '2px 8px', fontSize: 10.5, fontWeight: 700, textTransform: 'capitalize' }}>{event.type}</span>
                    <span style={{ fontSize: 10.5, color: T.textFaint }}>{location?.name || event.locationName}</span>
                    <SyncChip state={event.syncState || 'pending'} compact />
                  </div>
                </div>
              </div>
              {!!event.notes && (
                <p style={{ margin: '0 0 8px', fontSize: 13, color: T.textSub, lineHeight: 1.6 }}>{event.notes}</p>
              )}
              {(event.memberIds?.length > 0) && (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 11, color: T.textFaint, marginBottom: event.taggedParticipantLabel ? 6 : 0 }}>
                  <Ic d={ICONS.users} size={12} color={T.textFaint} sw={1.8} style={{ marginTop: 2, flexShrink: 0 }} />
                  <span>
                    Crew: {event.memberIds.map((id) => labelFor(participants, id)).join(', ')}
                  </span>
                </div>
              )}
              {!!event.taggedParticipantLabel && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: T.textFaint }}>
                  <Ic d={ICONS.users} size={12} color={T.textFaint} sw={1.8} />
                  <span>{event.taggedParticipantLabel}</span>
                </div>
              )}
              {entries.length > 0 && (
                <div style={{ display: 'flex', gap: 8, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${T.border}`, flexWrap: 'wrap' }}>
                  {buildEntryTypeSummary(entries).map(({ type, count, icon }) => (
                    <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 5, background: T.bg, border: `1px solid ${T.border}`, borderRadius: 8, padding: '4px 9px' }}>
                      <Ic d={icon} size={12} color={ENTRY_COLORS[type] || T.textSub} sw={1.8} />
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: T.text }}>{count}</span>
                      <span style={{ fontSize: 10, color: T.textFaint, textTransform: 'capitalize' }}>{type}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div style={{ marginBottom: 14 }}>
            <TripExpenses
              trip={trip}
              onTripUpdate={onTripUpdate}
              showTitle
              scope="event"
              event={event}
              location={location}
            />
          </div>

          {/* ── Contribute panel ── */}
          {contributeOpen && canAddToEvent && (
            <div style={{ background: T.card, borderRadius: 14, border: `1px solid ${T.border}`, padding: '12px 14px', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.textSub, letterSpacing: 0.5, textTransform: 'uppercase' }}>Add entry</div>
                <div onClick={() => setContributeOpen(false)} style={{ fontSize: 10.5, color: T.textFaint, cursor: 'pointer' }}>Close</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {getContributeItems(event.type).map((item) => (
                  <div key={item.type} onClick={() => openNewEntry(item.type)}
                       style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 10, padding: '10px 13px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 11 }}>
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: item.col + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Ic d={item.icon} size={14} color={item.col} sw={1.8} />
                    </div>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: T.text }}>{item.label}</span>
                    <Ic d="M9 18l6-6-6-6" size={14} color={T.textFaint} sw={1.8} style={{ marginLeft: 'auto' }} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Timeline ── */}
          {entries.length === 0 ? (
            <div style={{ background: T.card, borderRadius: 14, border: `1px dashed ${T.border}`, padding: '28px 16px', textAlign: 'center', marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: accentCol + '14', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Ic d={eventIcon} size={20} color={accentCol} sw={1.6} />
                </div>
              </div>
              <div style={{ fontSize: 13, color: T.textSub, fontWeight: 700, marginBottom: 4 }}>No entries yet</div>
              {canAddToEvent && (
                <div style={{ fontSize: 11.5, color: T.textFaint }}>
                  Tap <span style={{ color: accentCol, fontWeight: 700 }}>+ Add</span> to capture photos, gauge readings, weather, and more
                </div>
              )}
            </div>
          ) : (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.textFaint, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 10 }}>
                {entries.length} {entries.length === 1 ? 'Entry' : 'Entries'}
              </div>
              {entries.map((e, i) => (
                <EntryCard
                  key={e.id || i}
                  entry={e}
                  canEdit={canEditEvent || e.authorId === currentUserId}
                  onEdit={() => { setEditingEntry(e); setActiveFormType(e.type || event.type || 'note'); }}
                />
              ))}
            </>
          )}

          <div style={{ height: 16 }} />
        </div>
      </div>

      <BottomNav active="trip" onNav={onNav} onFab={onFab} trip={trip} />
    </div>
  );
}

// ── EntryCard ────────────────────────────────────────────────────────────────

function EntryCard({ entry: e, canEdit, onEdit }) {
  const col = ENTRY_COLORS[e.type] || T.accent;
  const icon = ENTRY_ICON[e.type] || ICONS.note;

  return (
    <div style={{ background: T.card, borderRadius: 14, border: `1px solid ${T.border}`, marginBottom: 10, overflow: 'hidden', display: 'flex' }}>
      {/* Left accent bar */}
      <div style={{ width: 4, background: col, flexShrink: 0 }} />

      <div style={{ flex: 1, padding: '12px 13px 13px', minWidth: 0 }}>
        {/* Row: icon + title + time */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, marginBottom: 8 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: col + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
            <Ic d={icon} size={14} color={col} sw={1.8} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.text, lineHeight: 1.3 }}>
              {e.title || entryTypeLabel(e)}
            </div>
            <div style={{ fontSize: 10.5, color: col, fontWeight: 600, textTransform: 'capitalize', marginTop: 1 }}>
              {entryTypeLabel(e)}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
            {e.observedAt && (
              <span style={{ fontSize: 9.5, color: T.textFaint }}>{fmtTime(e.observedAt)}</span>
            )}
            <SyncChip state={e.syncState || 'pending'} compact />
          </div>
        </div>

        {/* Notes */}
        {e.notes && (
          <p style={{ margin: '0 0 8px', fontSize: 12.5, color: T.textSub, lineHeight: 1.6 }}>{e.notes}</p>
        )}

        {/* Specialised data */}
        <SpecialisedData entry={e} col={col} />

        {/* GPS */}
        {e.lat != null && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6 }}>
            <Ic d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z M12 10a2 2 0 100-4 2 2 0 000 4z" size={12} color={T.textFaint} sw={1.6} />
            <span style={{ fontSize: 10.5, color: T.textFaint }}>{e.lat.toFixed(5)}, {e.lng.toFixed(5)}</span>
          </div>
        )}

        {/* Media */}
        {(e.photoFiles?.length > 0 || e.videoFiles?.length > 0 || e.voiceFiles?.length > 0) && (
          <MediaRow entry={e} />
        )}

        {/* Edit link */}
        {canEdit && (
          <div onClick={onEdit}
               style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: '#2A5C8E', fontWeight: 700, cursor: 'pointer' }}>
            <Ic d={ICONS.note} size={11} color="#2A5C8E" sw={2} />
            Edit entry
          </div>
        )}
      </div>
    </div>
  );
}

function SpecialisedData({ entry: e, col }) {
  const chips = [];

  if (e.cfs != null || e.gaugeHt != null || e.gaugeSiteName) {
    chips.push(
      <DataChip key="gauge" iconD={ICONS.gauge} color="#2A5C8E" bg="#EAF3FB">
        {e.gaugeSiteName && <span style={{ fontWeight: 700 }}>{e.gaugeSiteName}</span>}
        {e.cfs != null && <span>{Math.round(e.cfs).toLocaleString()} cfs</span>}
        {e.gaugeHt != null && <span>{e.gaugeHt.toFixed(2)} ft</span>}
        {e.rapidClass && <span>Class {e.rapidClass}</span>}
      </DataChip>
    );
  }

  if (e.weatherTempC != null || e.weatherSummary) {
    chips.push(
      <DataChip key="weather" iconD={ICONS.compass} color="#517EA3" bg="#EBF3FA">
        {e.weatherSummary && <span style={{ fontWeight: 700 }}>{e.weatherSummary}</span>}
        {e.weatherTempC != null && <span>{Math.round(cToF(e.weatherTempC))}°F</span>}
        {e.weatherFeelsLikeC != null && <span>Feels {Math.round(cToF(e.weatherFeelsLikeC))}°F</span>}
        {e.weatherWindKph != null && <span>Wind {Math.round(e.weatherWindKph)} kph</span>}
      </DataChip>
    );
  }

  if (e.weatherObservation || e.weatherObservationSky) {
    const obs = [e.weatherObservationSky, e.weatherObservationWind, e.weatherObservationWater].filter(Boolean).join(' · ') || e.weatherObservation;
    chips.push(
      <DataChip key="obs" iconD={ICONS.note} color="#6B6763" bg={T.bg}>
        <span>{obs}</span>
      </DataChip>
    );
  }

  if (e.featureType) {
    chips.push(
      <DataChip key="feature" iconD={ICONS.drop} color="#3A72A8" bg="#EAF3FB">
        <span style={{ fontWeight: 700, textTransform: 'capitalize' }}>{e.featureType}</span>
        {e.rapidClass && <span>Class {e.rapidClass}</span>}
      </DataChip>
    );
  }

  if (e.rating) {
    chips.push(
      <DataChip key="rating" iconD={ICONS.fork} color="#B8702E" bg="#FBF0E4">
        <span>{'★'.repeat(e.rating)}{'☆'.repeat(5 - e.rating)}</span>
      </DataChip>
    );
  }

  if (!chips.length) return null;
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 4 }}>{chips}</div>;
}

function DataChip({ iconD, color, bg, children }) {
  const parts = Array.isArray(children) ? children : [children];
  const valid = parts.filter(Boolean);
  if (!valid.length) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: bg, border: `1px solid ${color}28`, borderRadius: 9, padding: '7px 10px' }}>
      <div style={{ flexShrink: 0, marginTop: 1 }}>
        <Ic d={iconD} size={13} color={color} sw={1.8} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 8px', fontSize: 11.5, color, alignItems: 'center', lineHeight: 1.5 }}>
        {valid}
      </div>
    </div>
  );
}

function MediaRow({ entry: e }) {
  const [lightboxIdx, setLightboxIdx] = useState(null);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const videoCount = e.videoFiles?.length || 0;
  const voiceCount = e.voiceFiles?.length || 0;

  const photosWithData = (e.photoFiles || []).filter((f) => f.id || f.thumbDataUrl || f.dataUrl);
  const photosNoData   = (e.photoFiles || []).filter((f) => !f.id && !f.thumbDataUrl && !f.dataUrl);
  const caption = e.photoNotes || '';

  useEffect(() => {
    let cancelled = false;
    let objectUrl = null;

    async function load() {
      if (lightboxIdx === null) {
        setLightboxSrc(null);
        return;
      }
      const media = photosWithData[lightboxIdx];
      if (!media) {
        setLightboxSrc(null);
        return;
      }
      if (isLegacyMediaRef(media)) {
        setLightboxSrc(media.dataUrl || media.thumbDataUrl);
        return;
      }
      try {
        objectUrl = await createMediaObjectUrl(media.id, { preferThumb: false });
        if (!cancelled) setLightboxSrc(objectUrl);
      } catch {
        if (!cancelled) setLightboxSrc(null);
      }
    }

    load();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [lightboxIdx, e.photoFiles]);

  return (
    <div style={{ marginTop: 8 }}>
      {photosWithData.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, marginBottom: photosNoData.length || videoCount || voiceCount ? 6 : 0 }}>
          {photosWithData.map((f, i) => (
            <div key={f.id || i} onClick={() => setLightboxIdx(i)}
                 style={{ position: 'relative', borderRadius: 9, overflow: 'hidden', background: '#F0EDE8', cursor: 'pointer', aspectRatio: '1' }}>
              <MediaThumb media={f} alt={`Photo ${i + 1}`}
                   style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
            </div>
          ))}
        </div>
      )}
      {caption && photosWithData.length > 0 && (
        <div style={{ fontSize: 11, color: T.textFaint, fontStyle: 'italic', marginBottom: 4 }}>{caption}</div>
      )}
      {(photosNoData.length > 0 || videoCount > 0 || voiceCount > 0) && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {photosNoData.length > 0 && <MediaBadge iconD={ICONS.camera} count={photosNoData.length} label="photos" />}
          {videoCount > 0 && <MediaBadge iconD={ICONS.video} count={videoCount} label={videoCount === 1 ? 'video' : 'videos'} />}
          {voiceCount > 0 && <MediaBadge iconD={ICONS.mic} count={voiceCount} label="audio" />}
        </div>
      )}
      {lightboxIdx !== null && lightboxSrc && (
        <div onClick={() => setLightboxIdx(null)}
             style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.92)', zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <img src={lightboxSrc}
               alt={`Photo ${lightboxIdx + 1}`}
               style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain', borderRadius: 8 }}
               onClick={(ev) => ev.stopPropagation()} />
          {caption && (
            <div style={{ color: 'rgba(255,255,255,.7)', fontSize: 12, marginTop: 10, maxWidth: '80%', textAlign: 'center' }}>{caption}</div>
          )}
          <div style={{ display: 'flex', gap: 16, marginTop: 16, alignItems: 'center' }}>
            {lightboxIdx > 0 && (
              <div onClick={(ev) => { ev.stopPropagation(); setLightboxIdx((i) => i - 1); }}
                   style={{ background: 'rgba(255,255,255,.15)', borderRadius: 20, padding: '8px 16px', cursor: 'pointer', color: 'white', fontSize: 12, fontWeight: 700 }}>
                ← Prev
              </div>
            )}
            <span style={{ color: 'rgba(255,255,255,.5)', fontSize: 11 }}>{lightboxIdx + 1} / {photosWithData.length}</span>
            {lightboxIdx < photosWithData.length - 1 && (
              <div onClick={(ev) => { ev.stopPropagation(); setLightboxIdx((i) => i + 1); }}
                   style={{ background: 'rgba(255,255,255,.15)', borderRadius: 20, padding: '8px 16px', cursor: 'pointer', color: 'white', fontSize: 12, fontWeight: 700 }}>
                Next →
              </div>
            )}
          </div>
          <div style={{ marginTop: 10, color: 'rgba(255,255,255,.4)', fontSize: 11 }}>Tap anywhere to close</div>
        </div>
      )}
    </div>
  );
}

function MediaBadge({ iconD, count, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: T.bg, border: `1px solid ${T.border}`, borderRadius: 7, padding: '4px 8px', fontSize: 10.5 }}>
      <Ic d={iconD} size={12} color={T.textSub} sw={1.8} />
      <span style={{ fontWeight: 700, color: T.text }}>{count}</span>
      {label && <span style={{ color: T.textFaint }}>{label}</span>}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildEntryTypeSummary(entries) {
  const counts = {};
  for (const e of entries) counts[e.type] = (counts[e.type] || 0) + 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([type, count]) => ({ type, count, icon: ENTRY_ICON[type] || ICONS.note }));
}

function entryTypeLabel(entry) {
  if (entry.type === 'river-feature') return `River Feature · ${entry.featureType || 'feature'}`;
  return entry.type;
}

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function cToF(c) {
  return (c * 9) / 5 + 32;
}
