import { useSyncExternalStore } from 'react';
import { T } from '../tokens';
import { ts } from '../lib/textScale';
import { supabaseConfigured } from '../lib/supabase';
import { getSignedInUserId } from '../lib/authUser';
import { getCloudSyncStatus, subscribeCloudSyncStatus } from '../lib/tripAutoSync';

const STYLES = {
  synced: { label: 'Data saved to cloud', bg: '#EBF5EB', dot: '#4A8A34', text: '#2A6A14' },
  syncing: { label: 'Saved here · syncing', bg: '#E4EFF8', dot: '#3A72A8', text: '#2A5C8E' },
  pending: { label: 'Saved on this phone', bg: '#FBF0E4', dot: T.amber, text: '#7A4A14' },
  failed: { label: 'Saved here · sync failed', bg: '#FBE4E4', dot: '#C04040', text: '#8A1414' },
};

// Status comes from the last real cloud request, not navigator.onLine, which
// can claim "offline" on a connected phone.
export function SyncChip({ state = 'pending', compact = false }) {
  const status = useSyncExternalStore(subscribeCloudSyncStatus, getCloudSyncStatus, getCloudSyncStatus);
  const cloudEnabled = supabaseConfigured && Boolean(getSignedInUserId());
  let shown = state;
  let label = (STYLES[state] || STYLES.pending).label;
  let title = 'Trip data status. Photos and audio upload separately when connected.';
  if (state === 'pending' && cloudEnabled) {
    if (status.ok === false && status.offline) label = 'Saved here · offline, will upload';
    else if (status.ok === false) { shown = 'failed'; title = status.message || title; }
    else { shown = 'syncing'; }
  }
  const s = STYLES[shown] || STYLES.pending;
  if (shown !== state) label = s.label;
  return (
    <span title={title}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: s.bg,
        borderRadius: 10, padding: compact ? '4px 8px' : '6px 10px', maxWidth: '100%' }}>
      <span aria-hidden="true" style={{ width: 7, height: 7, flexShrink: 0, borderRadius: 999, background: s.dot }} />
      <span style={{ fontSize: ts(compact ? 11 : 12), fontWeight: 700, color: s.text }}>{label}</span>
    </span>
  );
}
