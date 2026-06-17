import { useState } from 'react';
import { T, F } from '../tokens';
import { ts } from '../lib/textScale';
import { LOCATION_TYPES } from '../lib/locationTypes';
import { EmojiPicker } from './EmojiPicker';
import { MediaThumb } from './MediaThumb';

const PIN_SOURCES = [
  { id: 'map', label: 'Map pin' },
  { id: 'current', label: 'My GPS' },
  { id: 'custom', label: 'Coordinates' },
];

const TIME_MODES = [
  { id: 'current', label: 'Now' },
  { id: 'custom', label: 'Set time' },
  { id: 'range', label: 'Range' },
];

export function LocationSaveForm({
  draft,
  onDraftChange,
  locationSource,
  onLocationSourceChange,
  locationPin,
  currentPos,
  currentPosError,
  coverPhoto,
  onCoverPhotoChange,
  error,
  onSave,
  onCancel,
  saveLabel = 'Save location',
  showPinControls = true,
  title = 'New location',
}) {
  const [showMore, setShowMore] = useState(false);
  const set = (patch) => onDraftChange((d) => ({ ...d, ...patch }));

  const pinStatus = locationSource === 'map'
    ? (locationPin ? `${locationPin.lat.toFixed(5)}, ${locationPin.lng.toFixed(5)}` : 'Tap the map to place a pin')
    : locationSource === 'current'
      ? (currentPos ? `${currentPos.lat.toFixed(5)}, ${currentPos.lng.toFixed(5)}` : (currentPosError || 'Waiting for GPS…'))
      : 'Enter coordinates or use the map';

  return (
    <div style={{ background: T.card, borderRadius: 12, border: `1px solid ${T.border}`, padding: '12px 13px', marginBottom: 12 }}>
      <div style={{ fontSize: ts(14), fontWeight: 800, color: T.text, marginBottom: 10 }}>{title}</div>

      <input
        value={draft.name}
        onChange={(e) => set({ name: e.target.value })}
        placeholder="Name (Put-In, Camp 2, takeout…)"
        style={inputStyle}
        autoFocus
      />

      <div style={{ fontSize: 10.5, color: T.textSub, fontWeight: 700, marginBottom: 6 }}>Type</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        {LOCATION_TYPES.map((tp) => (
          <button
            key={tp.id}
            type="button"
            onClick={() => set({ type: tp.id, icon: draft.icon || tp.icon })}
            style={{
              padding: '6px 10px',
              borderRadius: 14,
              cursor: 'pointer',
              fontSize: ts(11),
              fontWeight: 700,
              fontFamily: F,
              background: draft.type === tp.id ? '#2A5C8E' : T.bg,
              color: draft.type === tp.id ? 'white' : T.textSub,
              border: draft.type === tp.id ? 'none' : `1px solid ${T.border}`,
            }}
          >
            {tp.icon} {tp.label}
          </button>
        ))}
      </div>

      {showPinControls && (
        <>
      <div style={{ fontSize: 10.5, color: T.textSub, fontWeight: 700, marginBottom: 6 }}>Where</div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
        {PIN_SOURCES.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => onLocationSourceChange(opt.id)}
            style={chipStyle(locationSource === opt.id)}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {locationSource === 'custom' && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input
            value={draft.customLat}
            onChange={(e) => set({ customLat: e.target.value })}
            placeholder="Latitude"
            inputMode="decimal"
            style={{ ...inputStyle, marginBottom: 0, flex: 1 }}
          />
          <input
            value={draft.customLng}
            onChange={(e) => set({ customLng: e.target.value })}
            placeholder="Longitude"
            inputMode="decimal"
            style={{ ...inputStyle, marginBottom: 0, flex: 1 }}
          />
        </div>
      )}
      <div style={{ fontSize: ts(11), color: T.textFaint, marginBottom: 10 }}>{pinStatus}</div>
        </>
      )}

      <button
        type="button"
        onClick={() => setShowMore((v) => !v)}
        style={{
          width: '100%',
          border: 'none',
          background: 'transparent',
          color: '#2A5C8E',
          fontSize: ts(12),
          fontWeight: 700,
          cursor: 'pointer',
          fontFamily: F,
          textAlign: 'left',
          padding: '4px 0 10px',
        }}
      >
        {showMore ? '− Less options' : '+ More options (icon, notes, photo, time)'}
      </button>

      {showMore && (
        <>
          <EmojiPicker
            value={draft.icon}
            onChange={(icon) => set({ icon })}
            label="Map icon"
          />
          <textarea
            value={draft.notes}
            onChange={(e) => set({ notes: e.target.value })}
            placeholder="Optional notes"
            rows={2}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <label style={fileBtnStyle}>
              Cover photo
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => onCoverPhotoChange?.(e.target.files)} />
            </label>
            {coverPhoto && (
              <button type="button" onClick={() => onCoverPhotoChange?.(null)} style={{ border: 'none', background: 'transparent', color: T.textFaint, fontSize: 11, cursor: 'pointer', fontFamily: F }}>
                Remove
              </button>
            )}
          </div>
          {coverPhoto && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <MediaThumb media={coverPhoto} alt="Cover" style={{ width: 42, height: 42, borderRadius: 8, objectFit: 'cover' }} />
              <span style={{ fontSize: 11, color: T.textFaint }}>{coverPhoto.name}</span>
            </div>
          )}
          <div style={{ fontSize: 10.5, color: T.textSub, fontWeight: 700, marginBottom: 6 }}>Time</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
            {TIME_MODES.map((opt) => (
              <button key={opt.id} type="button" onClick={() => set({ timeMode: opt.id })} style={chipStyle(draft.timeMode === opt.id)}>
                {opt.label}
              </button>
            ))}
          </div>
          {draft.timeMode === 'custom' && (
            <input
              type="datetime-local"
              value={draft.observedAt}
              onChange={(e) => set({ observedAt: e.target.value })}
              style={inputStyle}
            />
          )}
          {draft.timeMode === 'range' && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input type="datetime-local" value={draft.observedStartAt} onChange={(e) => set({ observedStartAt: e.target.value })} style={{ ...inputStyle, marginBottom: 0, flex: 1 }} />
              <input type="datetime-local" value={draft.observedEndAt} onChange={(e) => set({ observedEndAt: e.target.value })} style={{ ...inputStyle, marginBottom: 0, flex: 1 }} />
            </div>
          )}
        </>
      )}

      {error && <div style={{ fontSize: ts(12), color: T.amber, marginBottom: 8 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={onCancel} style={secondaryBtn}>Cancel</button>
        <button type="button" onClick={onSave} style={primaryBtn}>{saveLabel}</button>
      </div>
    </div>
  );
}

const inputStyle = {
  width: '100%',
  border: `1.5px solid ${T.border}`,
  borderRadius: 10,
  padding: '9px 11px',
  fontSize: ts(13),
  fontFamily: F,
  marginBottom: 10,
  boxSizing: 'border-box',
  outline: 'none',
  background: T.bg,
};

const fileBtnStyle = {
  background: '#E4EFF8',
  border: '1px solid #3A72A840',
  borderRadius: 10,
  padding: '7px 10px',
  fontSize: 11,
  fontWeight: 700,
  color: '#2A5C8E',
  cursor: 'pointer',
};

function chipStyle(active) {
  return {
    padding: '6px 10px',
    borderRadius: 14,
    cursor: 'pointer',
    fontSize: ts(11),
    fontWeight: 700,
    fontFamily: F,
    background: active ? '#2A5C8E' : T.bg,
    color: active ? 'white' : T.textSub,
    border: active ? 'none' : `1px solid ${T.border}`,
  };
}

const secondaryBtn = {
  flex: 1,
  height: 38,
  borderRadius: 10,
  border: `1px solid ${T.border}`,
  background: T.bg,
  fontSize: ts(13),
  fontWeight: 700,
  color: T.textSub,
  cursor: 'pointer',
  fontFamily: F,
};

const primaryBtn = {
  flex: 1,
  height: 38,
  borderRadius: 10,
  border: 'none',
  background: '#2A5C8E',
  fontSize: ts(13),
  fontWeight: 800,
  color: 'white',
  cursor: 'pointer',
  fontFamily: F,
};
