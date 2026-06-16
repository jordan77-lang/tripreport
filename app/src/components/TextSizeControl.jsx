import { useEffect, useState } from 'react';
import { T, F } from '../tokens';
import { getTextScale, setTextScale, textScaleOptions, ts } from '../lib/textScale';

export function TextSizeControl({ compact = false }) {
  const [scale, setScale] = useState(getTextScale);

  useEffect(() => {
    const onChange = () => setScale(getTextScale());
    window.addEventListener('textscalechange', onChange);
    return () => window.removeEventListener('textscalechange', onChange);
  }, []);

  const options = textScaleOptions();

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: compact ? 2 : 4,
        background: T.bg,
        border: `1px solid ${T.border}`,
        borderRadius: 10,
        padding: compact ? '3px 4px' : '4px 5px',
      }}
      title="Text size"
    >
      {!compact && (
        <span style={{ fontSize: ts(11), fontWeight: 700, color: T.textFaint, padding: '0 4px', fontFamily: F }}>
          Text
        </span>
      )}
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => setTextScale(opt.id)}
          style={{
            border: 'none',
            borderRadius: 7,
            padding: compact ? '5px 7px' : '6px 8px',
            minWidth: compact ? 32 : 36,
            fontSize: ts(12),
            fontWeight: scale === opt.id ? 800 : 600,
            fontFamily: F,
            cursor: 'pointer',
            background: scale === opt.id ? T.accent : 'transparent',
            color: scale === opt.id ? 'white' : T.textSub,
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
