import { useEffect, useRef, useState } from 'react';
import { Ic } from './Ic';
import { T, F, ICONS } from '../tokens';
import { ts } from '../lib/textScale';

export function TripOverflowMenu({ items = [] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('touchstart', onDoc);
    };
  }, [open]);

  if (!items.length) return null;

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="More actions"
        style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          border: `1px solid ${T.border}`,
          background: T.bg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
        }}
      >
        <Ic d="M12 5v.01 M12 12v.01 M12 19v.01" size={18} color={T.textSub} sw={2.2} />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 44,
            right: 0,
            minWidth: 200,
            background: T.card,
            border: `1px solid ${T.border}`,
            borderRadius: 12,
            boxShadow: '0 10px 28px rgba(0,0,0,.12)',
            zIndex: 20,
            overflow: 'hidden',
          }}
        >
          {items.map((item, i) => (
            <button
              key={item.id || item.label}
              type="button"
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled) return;
                setOpen(false);
                item.onClick?.();
              }}
              style={{
                width: '100%',
                border: 'none',
                borderBottom: i < items.length - 1 ? `1px solid ${T.border}` : 'none',
                background: item.danger ? '#FFF5F5' : T.card,
                padding: '12px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                cursor: item.disabled ? 'not-allowed' : 'pointer',
                opacity: item.disabled ? 0.5 : 1,
                textAlign: 'left',
                fontFamily: F,
              }}
            >
              {item.icon && (
                <Ic d={item.icon} size={15} color={item.danger ? '#B03030' : T.textSub} sw={1.8} />
              )}
              <span style={{ fontSize: ts(14), fontWeight: 700, color: item.danger ? '#B03030' : T.text }}>
                {item.label}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function tripMenuIcon(name) {
  if (name === 'share') return ICONS.share;
  if (name === 'sync') return ICONS.compass;
  if (name === 'export') return ICONS.share2;
  if (name === 'import') return ICONS.note;
  if (name === 'edit') return ICONS.note;
  return ICONS.chevR;
}
