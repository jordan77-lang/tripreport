import { useEffect } from 'react';
import { supabaseConfigured } from '../lib/supabase';
import {
  initPassiveCloudSync,
  initTripAutoSync,
  initTripCloudRealtime,
  runFullCloudSync,
  stopCloudSyncListeners,
} from '../lib/tripAutoSync';

/** After sign-in: push on save, pull on interval/focus/realtime, and on reconnect. */
export function useCloudTripSync({ enabled = true, onSynced } = {}) {
  useEffect(() => {
    if (!enabled || !supabaseConfigured) return undefined;

    initTripAutoSync({ onSynced: () => onSynced?.() });
    initPassiveCloudSync({ onSynced, intervalMs: 90_000 });
    initTripCloudRealtime({ onSynced });

    async function runFullSync() {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      try {
        const result = await runFullCloudSync();
        if ((result.pulled || result.pushed) && onSynced) onSynced();
      } catch (e) {
        console.warn('Cloud trip sync failed', e);
      }
    }

    const onOnline = () => { void runFullSync(); };
    window.addEventListener('online', onOnline);
    void runFullSync();

    return () => {
      window.removeEventListener('online', onOnline);
      stopCloudSyncListeners();
    };
  }, [enabled, onSynced]);
}
