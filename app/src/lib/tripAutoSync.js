import { requireSupabase, supabaseConfigured } from './supabase';
import { getSignedInUserId } from './authUser';

const DEBOUNCE_MS = 2000;
const BACKGROUND_SYNC_MS = 90_000;
const timers = new Map();
const inflight = new Map();
let onSyncedCallback = null;
let passiveCleanup = null;
let realtimeCleanup = null;
let fullSyncInflight = null;

function isOnline() {
  return typeof navigator === 'undefined' || navigator.onLine;
}

function isDocumentVisible() {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

function notifySynced(tripId) {
  onSyncedCallback?.(tripId);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('tripreport:cloud-synced', { detail: { tripId } }));
  }
}

/** Register UI refresh callback (e.g. from App). */
export function setTripAutoSyncHandler(onSynced) {
  onSyncedCallback = onSynced || null;
}

/** Push pending trips, then pull newer cloud trips — used on interval, focus, and reconnect. */
export async function runFullCloudSync() {
  if (!supabaseConfigured || !isOnline()) return { skipped: 'offline' };
  if (!getSignedInUserId()) return { skipped: 'not-signed-in' };

  if (fullSyncInflight) return fullSyncInflight;

  fullSyncInflight = (async () => {
    await flushAllPendingTripSyncs();
    const { syncUserTripsWithCloud } = await import('./tripCloud');
    const result = await syncUserTripsWithCloud();
    if (result.pulled || result.pushed) notifySynced();
    return result;
  })().finally(() => {
    fullSyncInflight = null;
  });

  return fullSyncInflight;
}

/** Push a single pending trip now (skips if already running for this id). */
export async function runTripCloudSync(tripId) {
  if (!tripId || !supabaseConfigured || !isOnline()) return { skipped: 'offline' };
  if (!getSignedInUserId()) return { skipped: 'not-signed-in' };

  if (inflight.has(tripId)) return inflight.get(tripId);

  const promise = (async () => {
    const [{ getTrip, isTripMember }, { pushTripToCloud }] = await Promise.all([
      import('./storage'),
      import('./tripCloud'),
    ]);

    const trip = getTrip(tripId);
    if (!trip || trip.syncState !== 'pending') return { skipped: 'not-pending' };

    const userId = getSignedInUserId();
    if (!userId || !isTripMember(trip, userId)) return { skipped: 'not-member' };

    try {
      await pushTripToCloud(trip);
      notifySynced(tripId);
      return { synced: true };
    } catch (e) {
      console.warn('Auto trip cloud sync failed', tripId, e);
      return { error: e };
    } finally {
      inflight.delete(tripId);
    }
  })();

  inflight.set(tripId, promise);
  return promise;
}

/** Debounced push for one trip — call after local saves while online. */
export function scheduleTripCloudSync(tripId, { debounceMs = DEBOUNCE_MS } = {}) {
  if (!tripId || !supabaseConfigured || !getSignedInUserId() || !isOnline()) return;

  const existing = timers.get(tripId);
  if (existing) clearTimeout(existing);

  timers.set(tripId, setTimeout(() => {
    timers.delete(tripId);
    void runTripCloudSync(tripId);
  }, debounceMs));
}

/** Cancel any debounced push and upload now (e.g. after tapping Save). */
export async function flushTripCloudSync(tripId) {
  if (!tripId) return { skipped: 'no-trip' };
  const existing = timers.get(tripId);
  if (existing) {
    clearTimeout(existing);
    timers.delete(tripId);
  }
  return runTripCloudSync(tripId);
}

/** When back online, push every trip that has pending local changes. */
export async function flushAllPendingTripSyncs() {
  if (!supabaseConfigured || !isOnline() || !getSignedInUserId()) return { pushed: 0 };

  const { getTrips, isTripMember } = await import('./storage');
  const userId = getSignedInUserId();
  let pushed = 0;

  for (const trip of getTrips()) {
    if (trip.syncState !== 'pending') continue;
    if (!isTripMember(trip, userId)) continue;
    const result = await runTripCloudSync(trip.id);
    if (result?.synced) pushed += 1;
  }

  return { pushed };
}

/** Poll while the app is open — catches updates from other crew members without local saves. */
export function initPassiveCloudSync({ onSynced, intervalMs = BACKGROUND_SYNC_MS } = {}) {
  if (passiveCleanup || typeof window === 'undefined') return passiveCleanup;

  let intervalId = null;

  const runIfReady = () => {
    if (!isOnline() || !isDocumentVisible()) return;
    void runFullCloudSync().then((result) => {
      if ((result?.pulled || result?.pushed) && onSynced) onSynced();
    });
  };

  const startInterval = () => {
    if (intervalId) return;
    intervalId = setInterval(runIfReady, intervalMs);
  };

  const stopInterval = () => {
    if (!intervalId) return;
    clearInterval(intervalId);
    intervalId = null;
  };

  const onVisibility = () => {
    if (document.visibilityState === 'visible') {
      runIfReady();
      startInterval();
    } else {
      stopInterval();
    }
  };

  document.addEventListener('visibilitychange', onVisibility);
  if (isDocumentVisible()) startInterval();

  passiveCleanup = () => {
    document.removeEventListener('visibilitychange', onVisibility);
    stopInterval();
    passiveCleanup = null;
  };

  return passiveCleanup;
}

/** Supabase Realtime — pull when another device updates a shared trip (push from server). */
export function initTripCloudRealtime({ onSynced } = {}) {
  if (realtimeCleanup || !supabaseConfigured || typeof window === 'undefined') return realtimeCleanup;

  const supabase = requireSupabase();
  const channel = supabase
    .channel('tripreport-trip-sync')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'trips' },
      (payload) => {
        const tripId = payload.new?.id ?? payload.old?.id;
        if (!tripId || !isOnline()) return;

        void (async () => {
          const { pullTripIfCloudNewer } = await import('./tripCloud');
          try {
            const result = await pullTripIfCloudNewer(tripId);
            if (result.pulled || result.pushed) {
              notifySynced(tripId);
              onSynced?.();
            }
          } catch (e) {
            console.warn('Realtime trip sync failed', tripId, e);
          }
        })();
      },
    )
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR') {
        console.warn('Trip realtime sync unavailable — background polling will continue');
      }
    });

  realtimeCleanup = () => {
    supabase.removeChannel(channel);
    realtimeCleanup = null;
  };

  return realtimeCleanup;
}

export function initTripAutoSync({ onSynced } = {}) {
  setTripAutoSyncHandler(onSynced);
}

export function requestTripAutoSync(tripId) {
  scheduleTripCloudSync(tripId);
}

export function stopCloudSyncListeners() {
  passiveCleanup?.();
  realtimeCleanup?.();
}
