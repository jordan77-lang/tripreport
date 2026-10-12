import { getSignedInUserId } from './authUser';
import { supabaseConfigured } from './supabase';
import { flushTripCloudSync, getCloudSyncStatus } from './tripAutoSync';

/** Save locally (caller), then push to Supabase immediately so crew sees updates. */
export async function savePlanningToCloud(tripId, saveLocal) {
  saveLocal();
  if (!tripId || !supabaseConfigured || !getSignedInUserId()) {
    return { local: true, synced: false, skipped: 'not-signed-in' };
  }
  try {
    const result = await flushTripCloudSync(tripId);
    // No connection is not a failure: it's saved here and auto sync retries.
    if (result?.error && getCloudSyncStatus().offline) {
      return { local: true, synced: false, skipped: 'offline' };
    }
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
