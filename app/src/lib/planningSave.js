import { getSignedInUserId } from './authUser';
import { supabaseConfigured } from './supabase';
import { flushTripCloudSync, getCloudSyncStatus } from './tripAutoSync';

/** Local failure is synchronous; successful edits can render before any cloud request finishes. */
export function savePlanningLocally(tripId, saveLocal, { onSaved, onSynced, onError } = {}) {
  const result = saveLocal();
  onSaved?.(result);
  void savePlanningToCloud(tripId, () => {}).then(onSynced).catch(error => onError?.(error));
  return result;
}

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
