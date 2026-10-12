import { useState } from 'react';
import { Ic } from './Ic';
import { T, ICONS, CAPTURE_MODES } from '../tokens';
import { ts } from '../lib/textScale';

const QUICK = [
  { type: 'photo', label: 'Photo', icon: ICONS.camera },
  { type: 'note', label: 'Note', icon: ICONS.note },
  { type: 'voice', label: 'Voice', icon: ICONS.mic },
  { type: 'expense', label: 'Expense', icon: ICONS.gauge },
];

export function CaptureActions({ trip, onCapture }) {
  const [more, setMore] = useState(false);
  const river = trip?.types?.some(t => ['Rafting', 'River Camping', 'Paddling'].includes(t));
  const extras = CAPTURE_MODES[river ? 'river' : 'camping'].filter(item => !['note', 'voice', 'video'].includes(item.type));
  return (
    <section aria-label="Quick capture">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
        {QUICK.map(item => (
          <button type="button" key={item.type} onClick={() => onCapture(item.type)}
            style={{ minHeight: 76, border: '1px solid ' + T.border, borderRadius: 14, background: T.card,
              color: T.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              fontSize: ts(16), fontWeight: 800, cursor: 'pointer' }}>
            <Ic d={item.icon} size={24} color={T.accent} /><span>{item.label}</span>
          </button>
        ))}
      </div>
      <button type="button" aria-expanded={more} onClick={() => setMore(!more)}
        style={{ width: '100%', minHeight: 48, marginTop: 10, border: '1px solid ' + T.border,
          borderRadius: 12, background: T.card, color: T.text, fontSize: ts(14), fontWeight: 700, cursor: 'pointer' }}>
        {more ? 'Fewer options' : 'More observations'} {more ? '−' : '+'}
      </button>
      {more && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, marginTop: 10 }}>
        {extras.map(item => <button key={item.type} type="button" onClick={() => onCapture(item.type)}
          style={{ minHeight: 48, padding: 10, border: '1px solid ' + T.border, borderRadius: 10,
            background: T.card, color: T.text, fontSize: ts(14), cursor: 'pointer' }}>{item.label}</button>)}
      </div>}
    </section>
  );
}
