import { useSyncExternalStore } from 'react';
import { T } from '../tokens';
import { ts } from '../lib/textScale';
import { supabaseConfigured } from '../lib/supabase';
import { getSignedInUserId } from '../lib/authUser';

const STYLES = {
  synced: { label: 'Data saved to cloud', bg: '#EBF5EB', dot: '#4A8A34', text: '#2A6A14' },
  syncing: { label: 'Saved here · syncing', bg: '#E4EFF8', dot: '#3A72A8', text: '#2A5C8E' },
  pending: { label: 'Saved on this phone', bg: '#FBF0E4', dot: T.amber, text: '#7A4A14' },
  failed: { label: 'Saved here · sync failed', bg: '#FBE4E4', dot: '#C04040', text: '#8A1414' },
};

function subscribe(callback) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}
const getOnline = () => navigator.onLine;

export function SyncChip({ state = 'pending', compact = false }) {
  const online = useSyncExternalStore(subscribe, getOnline, () => true);
  const cloudEnabled = supabaseConfigured && Boolean(getSignedInUserId());
  const s = STYLES[state] || STYLES.pending;
  const label = state === 'pending' && cloudEnabled
    ? (online ? 'Saved here · upload pending' : 'Saved here · offline')
    : s.label;
  return (
    <span title="Trip data status. Photos and audio upload separately when connected."
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: s.bg,
        borderRadius: 10, padding: compact ? '4px 8px' : '6px 10px', maxWidth: '100%' }}>
      <span aria-hidden="true" style={{ width: 7, height: 7, flexShrink: 0, borderRadius: 999, background: s.dot }} />
      <span style={{ fontSize: ts(compact ? 11 : 12), fontWeight: 700, color: s.text }}>{label}</span>
    </span>
  );
}
