import { useEffect } from 'react';
import { syncUserTripsWithCloud } from '../lib/tripCloud';
import { supabaseConfigured } from '../lib/supabase';

/** After sign-in (and when back online), pull cloud trips and push local pending trips. */
export function useCloudTripSync({ enabled = true, onSynced } = {}) {
  useEffect(() => {
    if (!enabled || !supabaseConfigured) return undefined;

    async function run() {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      try {
        const result = await syncUserTripsWithCloud();
        if ((result.pulled || result.pushed) && onSynced) onSynced();
      } catch (e) {
        console.warn('Cloud trip sync failed', e);
      }
    }

    const onOnline = () => { void run(); };
    window.addEventListener('online', onOnline);
    void run();

    return () => window.removeEventListener('online', onOnline);
  }, [enabled, onSynced]);
}
