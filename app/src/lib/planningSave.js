import { getSignedInUserId } from './authUser';
import { supabaseConfigured } from './supabase';
import { flushTripCloudSync } from './tripAutoSync';

/** Save locally (caller), then push to Supabase immediately so crew sees updates. */
export async function savePlanningToCloud(tripId, saveLocal) {
  saveLocal();
  if (!tripId || !supabaseConfigured || !getSignedInUserId()) {
    return { local: true, synced: false, skipped: 'not-signed-in' };
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { local: true, synced: false, skipped: 'offline' };
  }
  try {
    const result = await flushTripCloudSync(tripId);
    if (result?.error) {
      const msg = result.error?.message || 'Could not sync to cloud';
      throw new Error(msg);
    }
    return { local: true, ...result };
  } catch (error) {
    console.warn('Planning cloud save failed', tripId, error);
    throw error;
  }
}
