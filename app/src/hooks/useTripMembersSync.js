import { useEffect } from 'react';
import { refreshTripMembersFromCloud } from '../lib/tripCloud';
import { supabaseConfigured } from '../lib/supabase';

const ACTIVE_TRIP_SYNC_MS = 30_000;

/** Pull trip data and members while viewing a trip — for crew updates without local saves. */
export function useTripMembersSync({ tripId, enabled = true, onSynced } = {}) {
  useEffect(() => {
    if (!enabled || !tripId || !supabaseConfigured) return undefined;

    async function run() {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      try {
        const { pullTripIfCloudNewer } = await import('../lib/tripCloud');
        let changed = false;

        const pullResult = await pullTripIfCloudNewer(tripId);
        if (pullResult.pulled || pullResult.pushed) changed = true;

        const { changed: membersChanged } = await refreshTripMembersFromCloud(tripId);
        if (membersChanged) changed = true;

        if (changed && onSynced) onSynced();
      } catch (e) {
        console.warn('Trip cloud poll failed', tripId, e);
      }
    }

    const onOnline = () => { void run(); };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void run();
    };

    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibility);
    const onCloudSynced = (event) => {
      if (event?.detail?.tripId === tripId) onSynced?.();
    };
    window.addEventListener('tripreport:cloud-synced', onCloudSynced);
    void run();

    const intervalId = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      void run();
    }, ACTIVE_TRIP_SYNC_MS);

    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('tripreport:cloud-synced', onCloudSynced);
      clearInterval(intervalId);
    };
  }, [tripId, enabled, onSynced]);
}
