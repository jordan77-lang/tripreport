import { useState } from 'react';
import { T, F } from '../tokens';
import { ts } from '../lib/textScale';
import { POPULAR_EMOJIS, EMOJI_CATEGORIES } from '../lib/tripEmojis';

export function EmojiPicker({
  value,
  onChange,
  label = 'Choose icon',
  accentColor = '#2A5C8E',
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const selected = value || POPULAR_EMOJIS[0].emoji;
  const popularSet = new Set(POPULAR_EMOJIS.map((p) => p.emoji));
  const showCustom = selected && !popularSet.has(selected);

  return (
    <div style={{ marginBottom: 8 }}>
      {label && (
        <div style={{ fontSize: 10.5, color: T.textSub, marginBottom: 6, fontWeight: 700 }}>{label}</div>
      )}

      {showCustom && (
        <EmojiListRow
          emoji={selected}
          rowLabel="Selected"
          selected
          accentColor={accentColor}
          onClick={() => setMoreOpen(true)}
        />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
        {POPULAR_EMOJIS.map(({ emoji, label: rowLabel }) => (
          <EmojiListRow
            key={emoji}
            emoji={emoji}
            rowLabel={rowLabel}
            selected={selected === emoji}
            accentColor={accentColor}
            onClick={() => onChange(emoji)}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={() => setMoreOpen(true)}
        style={{
          width: '100%',
          border: `1px dashed ${T.border}`,
          borderRadius: 10,
          padding: '9px 12px',
          background: T.bg,
          color: accentColor,
          fontSize: ts(12),
          fontWeight: 700,
          cursor: 'pointer',
          fontFamily: F,
          textAlign: 'left',
        }}
      >
        More emojis…
      </button>

      {moreOpen && (
        <EmojiPickerModal
          value={selected}
          onSelect={(emoji) => {
            onChange(emoji);
            setMoreOpen(false);
          }}
          onClose={() => setMoreOpen(false)}
        />
      )}
    </div>
  );
}

function EmojiListRow({ emoji, rowLabel, selected, accentColor, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        border: `1.5px solid ${selected ? accentColor : T.border}`,
        borderRadius: 10,
        padding: '7px 10px',
        background: selected ? '#E4EFF8' : T.card,
        cursor: 'pointer',
        fontFamily: F,
        textAlign: 'left',
      }}
    >
      <span style={{ fontSize: 18, width: 28, textAlign: 'center', flexShrink: 0 }}>{emoji}</span>
      <span style={{ flex: 1, fontSize: ts(12), fontWeight: selected ? 700 : 500, color: selected ? accentColor : T.text }}>
        {rowLabel}
      </span>
      {selected && (
        <span style={{ fontSize: 11, fontWeight: 800, color: accentColor, flexShrink: 0 }}>✓</span>
      )}
    </button>
  );
}

function EmojiPickerModal({ value, onSelect, onClose }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.45)',
        zIndex: 1600,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        fontFamily: F,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 520,
          maxHeight: '85vh',
          overflowY: 'auto',
          background: T.card,
          borderRadius: '16px 16px 0 0',
          padding: '16px 14px 24px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: ts(17), fontWeight: 800, color: T.text }}>Choose emoji</div>
            <div style={{ fontSize: ts(12), color: T.textSub, marginTop: 4 }}>
              Tap an icon for your map pin or location.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ border: 'none', background: 'transparent', color: T.textFaint, fontSize: 22, cursor: 'pointer', lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        {EMOJI_CATEGORIES.map((cat) => (
          <div key={cat.id} style={{ marginBottom: 14 }}>
            <div style={{
              fontSize: ts(11),
              fontWeight: 700,
              color: T.textFaint,
              textTransform: 'uppercase',
              letterSpacing: 0.6,
              marginBottom: 8,
            }}>
              {cat.label}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {cat.emojis.map((emoji) => (
                <button
                  key={`${cat.id}-${emoji}`}
                  type="button"
                  onClick={() => onSelect(emoji)}
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 10,
                    border: `2px solid ${value === emoji ? '#2A5C8E' : T.border}`,
                    background: value === emoji ? '#E4EFF8' : T.bg,
                    fontSize: 20,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
