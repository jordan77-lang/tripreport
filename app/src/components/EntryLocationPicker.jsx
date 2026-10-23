import { T } from '../tokens';
import { ts } from '../lib/textScale';

export function EntryLocationPicker({ id = 'entry-location', locations = [], value = null, onChange, allowUnlinked = true }) {
  return <div style={{ marginBottom: 18 }}>
    <label htmlFor={id} style={{ display: 'block', fontSize: ts(15), fontWeight: 800, color: T.text, marginBottom: 8 }}>Add to location{allowUnlinked ? ' (optional)' : ''}</label>
    <select id={id} value={value || ''} onChange={event => onChange(event.target.value || null)}
      style={{ width: '100%', minHeight: 48, border: `1.5px solid ${T.border}`, borderRadius: 12, padding: '11px 12px', fontSize: ts(15), fontFamily: 'inherit', background: T.card, color: T.text }}>
      {allowUnlinked && <option value="">No saved location — use current GPS if available</option>}
      {locations.map(location => <option key={location.id} value={location.id}>{location.icon ? `${location.icon} ` : ''}{location.name}</option>)}
    </select>
    <p style={{ marginTop: 7, fontSize: ts(12), lineHeight: 1.5, color: T.textSub }}>{locations.length
      ? 'Choose a campsite or another saved place. Your entry will appear there.'
      : 'No saved places yet. Add a location from Add, then attach your moments to it.'}</p>
  </div>;
}
