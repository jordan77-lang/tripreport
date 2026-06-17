import { useEffect } from 'react';
import { refreshTripMembersFromCloud } from '../lib/tripCloud';
import { supabaseConfigured } from '../lib/supabase';

/** Refresh trip_members from Supabase so invite joiners appear in gear/meals/expense lists. */
export function useTripMembersSync({ tripId, enabled = true, onSynced } = {}) {
  useEffect(() => {
    if (!enabled || !tripId || !supabaseConfigured) return undefined;

    async function run() {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      try {
        const { changed } = await refreshTripMembersFromCloud(tripId);
        if (changed && onSynced) onSynced();
      } catch (e) {
        console.warn('Trip members sync failed', tripId, e);
      }
    }

    const onOnline = () => { void run(); };
    window.addEventListener('online', onOnline);
    void run();

    return () => window.removeEventListener('online', onOnline);
  }, [tripId, enabled, onSynced]);
}
