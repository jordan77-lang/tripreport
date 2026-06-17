import { useState } from 'react';
import { T, F } from '../tokens';
import { ts } from '../lib/textScale';
import { createPhotoMediaFromFile } from '../lib/media';
import { MediaThumb } from './MediaThumb';
import { TRIP_TYPES, saveTripDetailsFromDraft } from '../lib/tripEdit';
import { savePlanningToCloud } from '../lib/planningSave';

export function TripEditPanel({ trip, draft, onCancel, onSaved, onDraftChange }) {
  const [coverBusy, setCoverBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [error, setError] = useState(null);

  function updateDraft(next) {
    onDraftChange?.(next);
  }

  function toggleType(type) {
    updateDraft({
      ...draft,
      types: draft.types.includes(type)
        ? draft.types.filter((t) => t !== type)
        : [...draft.types, type],
    });
  }

  async function onCoverSelected(files) {
    const file = Array.from(files || [])[0];
    if (!file || !trip?.id) return;
    setCoverBusy(true);
    try {
      const nextCover = await createPhotoMediaFromFile(file, trip.id, { maxThumbSide: 320, maxFullSide: 1200 });
      updateDraft({ ...draft, coverPhoto: nextCover });
    } finally {
      setCoverBusy(false);
    }
  }

  async function handleSave() {
    if (!trip?.id || saveBusy) return;
    setError(null);
    setSaveBusy(true);
    try {
      await savePlanningToCloud(trip.id, () => {
        saveTripDetailsFromDraft(trip, draft);
      });
      onSaved?.();
    } catch (e) {
      setError(e?.message || 'Could not save trip.');
    } finally {
      setSaveBusy(false);
    }
  }

  return (
    <div style={{ background: T.card, borderRadius: 12, border: `1px solid ${T.border}`, padding: '12px 14px', marginBottom: 12 }}>
      <div style={{ fontSize: ts(15), fontWeight: 800, color: T.text, marginBottom: 10 }}>Edit trip</div>

      {!!error && (
        <div style={{ background: '#FBE4E4', border: '1px solid #E7B5B5', borderRadius: 10, padding: '8px 10px', marginBottom: 10, fontSize: ts(13), fontWeight: 700, color: '#8A1414' }}>
          {error}
        </div>
      )}

      <label style={{ display: 'block', fontSize: ts(12), fontWeight: 700, color: T.textSub, marginBottom: 4 }}>Trip name</label>
      <input
        value={draft.name}
        onChange={(e) => updateDraft({ ...draft, name: e.target.value })}
        placeholder="Trip name"
        style={{ width: '100%', border: `1.5px solid ${T.border}`, borderRadius: 10, padding: '10px 12px', fontSize: ts(15), fontFamily: F, marginBottom: 10, boxSizing: 'border-box', outline: 'none', background: T.bg }}
      />

      <label style={{ display: 'block', fontSize: ts(12), fontWeight: 700, color: T.textSub, marginBottom: 4 }}>Region / area</label>
      <input
        value={draft.location}
        onChange={(e) => updateDraft({ ...draft, location: e.target.value })}
        placeholder="e.g. Main Salmon River"
        style={{ width: '100%', border: `1.5px solid ${T.border}`, borderRadius: 10, padding: '10px 12px', fontSize: ts(15), fontFamily: F, marginBottom: 10, boxSizing: 'border-box', outline: 'none', background: T.bg }}
      />

      <label style={{ display: 'block', fontSize: ts(12), fontWeight: 700, color: T.textSub, marginBottom: 4 }}>Dates</label>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input
          type="date"
          aria-label="Start date"
          value={draft.startDate || ''}
          onChange={(e) => updateDraft({ ...draft, startDate: e.target.value })}
          style={{ flex: 1, border: `1.5px solid ${T.border}`, borderRadius: 10, padding: '10px 12px', fontSize: ts(15), fontFamily: F, boxSizing: 'border-box', outline: 'none', background: T.bg, minWidth: 0 }}
        />
        <input
          type="date"
          aria-label="End date"
          value={draft.endDate || ''}
          onChange={(e) => updateDraft({ ...draft, endDate: e.target.value })}
          style={{ flex: 1, border: `1.5px solid ${T.border}`, borderRadius: 10, padding: '10px 12px', fontSize: ts(15), fontFamily: F, boxSizing: 'border-box', outline: 'none', background: T.bg, minWidth: 0 }}
        />
      </div>

      <label style={{ display: 'block', fontSize: ts(12), fontWeight: 700, color: T.textSub, marginBottom: 6 }}>Trip types</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        {TRIP_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => toggleType(type)}
            style={{
              padding: '6px 10px',
              borderRadius: 14,
              cursor: 'pointer',
              fontSize: ts(12),
              fontWeight: 700,
              fontFamily: F,
              background: draft.types.includes(type) ? '#2A5C8E' : T.bg,
              color: draft.types.includes(type) ? 'white' : T.textSub,
              border: draft.types.includes(type) ? 'none' : `1px solid ${T.border}`,
            }}
          >
            {type}
          </button>
        ))}
      </div>

      <label style={{ display: 'block', fontSize: ts(12), fontWeight: 700, color: T.textSub, marginBottom: 6 }}>Privacy</label>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {['private', 'friends', 'public'].map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => updateDraft({ ...draft, privacy: p })}
            style={{
              padding: '6px 12px',
              borderRadius: 14,
              cursor: 'pointer',
              fontSize: ts(12),
              fontWeight: 700,
              fontFamily: F,
              background: draft.privacy === p ? '#2A5C8E' : T.bg,
              color: draft.privacy === p ? 'white' : T.textSub,
              border: draft.privacy === p ? 'none' : `1px solid ${T.border}`,
            }}
          >
            {p}
          </button>
        ))}
      </div>

      <div style={{ fontSize: ts(12), color: T.textSub, marginBottom: 6, fontWeight: 700 }}>GPS tracking (optional)</div>
      <div style={{ display: 'flex', gap: 6, marginBottom: draft.gpsTrackingEnabled ? 8 : 10 }}>
        {[{ id: false, label: 'Off' }, { id: true, label: 'On' }].map((opt) => (
          <button
            key={String(opt.id)}
            type="button"
            onClick={() => updateDraft({ ...draft, gpsTrackingEnabled: opt.id, gpsBackgroundTracking: opt.id ? draft.gpsBackgroundTracking : false })}
            style={{
              padding: '6px 12px',
              borderRadius: 14,
              cursor: 'pointer',
              fontSize: ts(12),
              fontWeight: 700,
              fontFamily: F,
              background: draft.gpsTrackingEnabled === opt.id ? '#2A5C8E' : T.bg,
              color: draft.gpsTrackingEnabled === opt.id ? 'white' : T.textSub,
              border: draft.gpsTrackingEnabled === opt.id ? 'none' : `1px solid ${T.border}`,
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {draft.gpsTrackingEnabled && (
        <>
          <div style={{ fontSize: ts(12), color: T.textSub, marginBottom: 6, fontWeight: 700 }}>Sample interval</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            {[{ ms: 5000, label: '5s' }, { ms: 15000, label: '15s' }, { ms: 30000, label: '30s' }].map((it) => (
              <button
                key={it.ms}
                type="button"
                onClick={() => updateDraft({ ...draft, gpsIntervalMs: it.ms })}
                style={{
                  padding: '6px 12px',
                  borderRadius: 14,
                  cursor: 'pointer',
                  fontSize: ts(12),
                  fontWeight: 700,
                  fontFamily: F,
                  background: draft.gpsIntervalMs === it.ms ? '#2A5C8E' : T.bg,
                  color: draft.gpsIntervalMs === it.ms ? 'white' : T.textSub,
                  border: draft.gpsIntervalMs === it.ms ? 'none' : `1px solid ${T.border}`,
                }}
              >
                {it.label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: ts(12), color: T.textSub, marginBottom: 6, fontWeight: 700 }}>Track in background</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            {[{ id: false, label: 'No' }, { id: true, label: 'Yes' }].map((opt) => (
              <button
                key={String(opt.id)}
                type="button"
                onClick={() => updateDraft({ ...draft, gpsBackgroundTracking: opt.id })}
                style={{
                  padding: '6px 12px',
                  borderRadius: 14,
                  cursor: 'pointer',
                  fontSize: ts(12),
                  fontWeight: 700,
                  fontFamily: F,
                  background: draft.gpsBackgroundTracking === opt.id ? T.amber : T.bg,
                  color: draft.gpsBackgroundTracking === opt.id ? 'white' : T.textSub,
                  border: draft.gpsBackgroundTracking === opt.id ? 'none' : `1px solid ${T.border}`,
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </>
      )}

      <div style={{ fontSize: ts(12), color: T.textSub, marginBottom: 6, fontWeight: 700 }}>Cover photo</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: draft.coverPhoto ? 8 : 10 }}>
        <label style={{ background: '#E4EFF8', border: '1px solid #3A72A840', borderRadius: 10, padding: '8px 12px', fontSize: ts(12), fontWeight: 700, color: '#2A5C8E', cursor: 'pointer' }}>
          {coverBusy ? 'Processing…' : 'Choose photo'}
          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => void onCoverSelected(e.target.files)} disabled={coverBusy} />
        </label>
        {!!draft.coverPhoto && (
          <button type="button" onClick={() => updateDraft({ ...draft, coverPhoto: null })} style={{ border: 'none', background: 'none', fontSize: ts(12), color: T.textFaint, cursor: 'pointer', fontWeight: 700, fontFamily: F }}>
            Remove
          </button>
        )}
      </div>
      {!!draft.coverPhoto && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: T.bg, border: `1px solid ${T.border}`, borderRadius: 10, padding: '8px 9px', marginBottom: 10 }}>
          <MediaThumb media={draft.coverPhoto} alt="Trip cover preview" style={{ width: 42, height: 42, borderRadius: 8, objectFit: 'cover' }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: ts(13), color: T.text, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{draft.coverPhoto.name}</div>
            <div style={{ fontSize: ts(11), color: T.textFaint }}>{Math.round((draft.coverPhoto.size || 0) / 1024)} KB</div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={onCancel}
          style={{ flex: 1, height: 40, borderRadius: 10, border: `1px solid ${T.border}`, background: T.bg, fontSize: ts(14), fontWeight: 700, color: T.textSub, cursor: 'pointer', fontFamily: F }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saveBusy}
          style={{ flex: 1, height: 40, borderRadius: 10, border: 'none', background: saveBusy ? '#7A9BB8' : '#2A5C8E', fontSize: ts(14), fontWeight: 800, color: 'white', cursor: saveBusy ? 'wait' : 'pointer', fontFamily: F }}
        >
          {saveBusy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
