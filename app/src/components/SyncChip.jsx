import { T } from '../tokens';

const STYLES = {
  synced: { label: 'Synced', bg: '#EBF5EB', dot: '#4A8A34', text: '#2A6A14' },
  syncing: { label: 'Syncing', bg: '#E4EFF8', dot: '#3A72A8', text: '#2A5C8E' },
  pending: { label: 'Offline', bg: '#FBF0E4', dot: T.amber, text: '#7A4A14' },
  failed: { label: 'Sync Error', bg: '#FBE4E4', dot: '#C04040', text: '#8A1414' },
};

export function SyncChip({ state = 'pending', compact = false }) {
  const s = STYLES[state] || STYLES.pending;
  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: compact ? 4 : 6,
      background: s.bg,
      borderRadius: compact ? 8 : 10,
      padding: compact ? '3px 7px' : '4px 9px',
    }}>
      <div style={{ width: compact ? 6 : 7, height: compact ? 6 : 7, borderRadius: 999, background: s.dot }} />
      <span style={{ fontSize: compact ? 10 : 11, fontWeight: 700, color: s.text }}>{s.label}</span>
    </div>
  );
}
