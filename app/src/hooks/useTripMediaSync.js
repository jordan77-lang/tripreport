import { useEffect } from 'react';
import { getTrips, getTrip, saveTrip } from '../lib/storage';
import { syncTripMedia } from '../lib/mediaSync';
import { listMediaForTrip } from '../lib/mediaStore';
import { markMediaRefsSynced } from '../lib/mediaRefs';
import { supabaseConfigured } from '../lib/supabase';
import { getSignedInUserId } from '../lib/authUser';

/** When online, upload pending photos and download crew photos — never used for display. */
export function useTripMediaSync({ enabled = true } = {}) {
  useEffect(() => {
    if (!enabled || !supabaseConfigured) return undefined;

    async function run() {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      if (!getSignedInUserId()) return;

      const trips = getTrips();
      for (const trip of trips) {
        try {
          await syncTripMedia(trip.id);
          const refreshed = getTrip(trip.id);
          if (refreshed) {
            const localMedia = await listMediaForTrip(trip.id);
            const syncedIds = new Set(localMedia.filter((r) => r.syncState === 'synced').map((r) => r.id));
            saveTrip(markMediaRefsSynced(refreshed, syncedIds));
          }
        } catch (e) {
          console.warn('Trip media sync failed', trip.id, e);
        }
      }
    }

    const onOnline = () => { void run(); };
    window.addEventListener('online', onOnline);
    void run();

    return () => window.removeEventListener('online', onOnline);
  }, [enabled]);
}
