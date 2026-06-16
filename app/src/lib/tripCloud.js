import { requireSupabase, supabaseConfigured } from './supabase';
import { getSignedInUserId, getSignedInDisplayName } from './authUser';
import {
  saveTrip,
  getTrip,
  getTrips,
  claimAnonymousTripsForUser,
  isTripOwner,
  deleteLocalTrip,
} from './storage';
import { syncTripMedia } from './mediaSync';
import { markMediaRefsSynced } from './mediaRefs';

function randomInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 8; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function resolveCloudOwnerId(localTrip, userId) {
  const anonKey = 'tr_user_id';
  let ownerId = localTrip.ownerId || userId;
  try {
    const anonId = typeof localStorage !== 'undefined' ? localStorage.getItem(anonKey) : null;
    if (anonId && ownerId === anonId) ownerId = userId;
  } catch {
    // ignore
  }
  if (!ownerId) ownerId = userId;
  // RLS on trips insert requires owner_id = auth.uid() — never send a stale id.
  if (userId) ownerId = userId;
  return ownerId;
}

/** Ensure profile row exists and return the Supabase session user id (matches auth.uid()). */
async function ensureSignedInProfile(supabase) {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !session?.access_token) {
    throw new Error('Session expired — sign out and sign in again, then retry Cloud sync.');
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user?.id) throw new Error('Sign in to sync trips');

  const displayName = getSignedInDisplayName()
    || user.user_metadata?.display_name
    || user.email?.split('@')[0]
    || 'User';

  const { error: profileError } = await supabase.from('profiles').upsert({
    id: user.id,
    display_name: displayName,
    updated_at: new Date().toISOString(),
  });

  if (profileError) {
    throw new Error(formatSupabaseError(profileError, 'Could not save your profile'));
  }

  return user.id;
}

function formatSupabaseError(error, fallback) {
  const msg = error?.message || fallback;
  if (msg.includes('row-level security') || error?.code === '42501') {
    return 'Cloud sync blocked — run migration 004_upsert_trip_rpc.sql in Supabase SQL Editor, then tap Cloud sync again.';
  }
  return msg;
}

/** Push local trip document to Supabase (creates or updates). */
export async function pushTripToCloud(localTrip) {
  const supabase = requireSupabase();
  const userId = await ensureSignedInProfile(supabase);
  if (getSignedInUserId() && getSignedInUserId() !== userId) {
    console.warn('Auth session user differs from app user cache — using Supabase session');
  }

  if (!isTripOwner(localTrip, userId)) {
    claimAnonymousTripsForUser(userId);
    const refreshed = getTrip(localTrip.id);
    if (!refreshed || !isTripOwner(refreshed, userId)) {
      throw new Error('Only the trip owner can sync this trip to the cloud');
    }
    localTrip = refreshed;
  }

  const ownerId = resolveCloudOwnerId(localTrip, userId);
  const payload = buildCloudPayload(localTrip);

  const { data: updatedAt, error } = await supabase.rpc('upsert_trip_for_owner', {
    p_id: localTrip.id,
    p_name: localTrip.name,
    p_status: localTrip.status || 'planning',
    p_start_date: localTrip.startDate || null,
    p_end_date: localTrip.endDate || null,
    p_types: localTrip.types || [],
    p_location: localTrip.location || null,
    p_privacy: localTrip.privacy || 'friends',
    p_payload: payload,
  });

  if (error) throw new Error(formatSupabaseError(error, 'Could not sync trip to cloud'));

  const data = { id: localTrip.id, updated_at: updatedAt };

  const trip = getTrip(localTrip.id);
  if (trip) {
    saveTrip({ ...trip, ownerId, syncState: 'synced', updatedAt: Date.now() });
  }

  try {
    await syncTripMedia(localTrip.id);
    const refreshed = getTrip(localTrip.id);
    if (refreshed) {
      const { listMediaForTrip } = await import('./mediaStore');
      const localMedia = await listMediaForTrip(localTrip.id);
      const syncedIds = new Set(localMedia.filter((r) => r.syncState === 'synced').map((r) => r.id));
      saveTrip({ ...markMediaRefsSynced(refreshed, syncedIds), syncState: 'synced', ownerId });
    }
  } catch (e) {
    console.warn('Media sync after trip push failed', e);
  }

  return data;
}

/** Pull cloud trip into local storage. */
export async function pullTripFromCloud(tripId) {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('trips')
    .select('*')
    .eq('id', tripId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('Trip not found in cloud');

  const local = cloudRowToLocalTrip(data);
  saveTrip(local);
  try {
    await syncTripMedia(tripId);
  } catch (e) {
    console.warn('Media download after trip pull failed', e);
  }
  return getTrip(tripId) || local;
}

/** List trips the signed-in user can access. */
export async function listCloudTrips() {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('trips')
    .select('id, name, status, start_date, end_date, location, updated_at')
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function createTripInvite(tripId, { role = 'contributor', maxUses = null, expiresInDays = 90 } = {}) {
  const supabase = requireSupabase();
  const userId = await ensureSignedInProfile(supabase);

  const localTrip = getTrip(tripId);
  if (!localTrip) throw new Error('Trip not found on this device');

  if (!isTripOwner(localTrip, userId)) {
    claimAnonymousTripsForUser(userId);
    const refreshed = getTrip(tripId);
    if (!refreshed || !isTripOwner(refreshed, userId)) {
      throw new Error('Only the trip owner can create invite codes');
    }
  }

  // Invites require the trip row in Supabase with matching owner_id (RLS).
  await pushTripToCloud(getTrip(tripId) || localTrip);

  const code = randomInviteCode();
  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 864e5).toISOString()
    : null;

  const { error } = await supabase.from('trip_invites').insert({
    code,
    trip_id: tripId,
    created_by: userId,
    role,
    max_uses: maxUses,
    expires_at: expiresAt,
  });

  if (error) {
    throw new Error(formatSupabaseError(error, 'Could not create invite'));
  }
  return code;
}

/** Pull cloud trips and push local changes after sign-in or on reconnect. */
export async function syncUserTripsWithCloud() {
  if (!supabaseConfigured) return { pulled: 0, pushed: 0, skipped: 'not-configured' };

  const supabase = requireSupabase();
  let userId;
  try {
    userId = await ensureSignedInProfile(supabase);
  } catch {
    return { pulled: 0, pushed: 0, skipped: 'not-signed-in' };
  }

  claimAnonymousTripsForUser(userId);

  let pulled = 0;
  let pushed = 0;

  for (const trip of getTrips()) {
    if (!isTripOwner(trip, userId)) continue;
    if (trip.syncState === 'synced') continue;
    try {
      await pushTripToCloud(trip);
      pushed += 1;
    } catch (e) {
      console.warn('Trip push failed during cloud sync', trip.id, e);
    }
  }

  try {
    const cloudList = await listCloudTrips();
    for (const row of cloudList) {
      try {
        const local = getTrip(row.id);
        const cloudUpdated = Date.parse(row.updated_at) || 0;
        const localUpdated = local?.updatedAt || 0;
        if (!local || cloudUpdated > localUpdated) {
          await pullTripFromCloud(row.id);
          pulled += 1;
        }
      } catch (e) {
        console.warn('Trip pull failed during cloud sync', row.id, e);
      }
    }
  } catch (e) {
    console.warn('Could not list cloud trips', e);
  }

  return { pulled, pushed };
}

export async function deleteTripFromCloud(tripId) {
  if (!tripId || !supabaseConfigured) return;
  const supabase = requireSupabase();
  await ensureSignedInProfile(supabase);
  const { error } = await supabase.from('trips').delete().eq('id', tripId);
  if (error) throw new Error(formatSupabaseError(error, 'Could not delete trip from cloud'));
}

/** Remove trip locally, from cloud, and clear local photo blobs. Owner-only in UI. */
export async function deleteTripCompletely(tripId) {
  if (!tripId) throw new Error('Trip id required');

  try {
    await deleteTripFromCloud(tripId);
  } catch (e) {
    console.warn('Cloud trip delete failed (local delete will continue)', e);
  }

  try {
    const { listMediaForTrip, deleteMediaRecord } = await import('./mediaStore');
    const media = await listMediaForTrip(tripId);
    for (const record of media) {
      await deleteMediaRecord(record.id);
    }
  } catch (e) {
    console.warn('Local media cleanup failed', e);
  }

  deleteLocalTrip(tripId);
}

export async function joinTripByCode(code) {
  const supabase = requireSupabase();
  const { data, error } = await supabase.rpc('join_trip_by_code', {
    invite_code: code.trim(),
  });

  if (error) throw error;

  const tripId = data;
  await pullTripFromCloud(tripId);
  return tripId;
}

export async function fetchMapRegions() {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('map_regions')
    .select('*')
    .eq('active', true)
    .order('sort_order', { ascending: true });

  if (error) throw error;
  return data || [];
}

function buildCloudPayload(trip) {
  const {
    entries, locations, events, track, trackSessions, collaborators,
    gearItems, meals, expenses, shoppingItems,
    coverPhoto, mapArea, offlineRegions,
    gpsTrackingEnabled, gpsBackgroundTracking, gpsIntervalMs,
    startedAt, endedAt, gpsSessionActive, gpsSessionId, gpsSessionStartedAt,
    recap,
  } = trip;

  return {
    entries: entries || [],
    locations: locations || [],
    events: events || [],
    track: track || [],
    trackSessions: trackSessions || [],
    collaborators: collaborators || [],
    gearItems: gearItems || [],
    meals: meals || [],
    expenses: expenses || [],
    shoppingItems: shoppingItems || [],
    coverPhoto: stripHeavyMedia(coverPhoto),
    mapArea: mapArea || null,
    offlineRegions: offlineRegions || [],
    gpsTrackingEnabled: Boolean(gpsTrackingEnabled),
    gpsBackgroundTracking: Boolean(gpsBackgroundTracking),
    gpsIntervalMs: gpsIntervalMs || 15000,
    startedAt: startedAt || null,
    endedAt: endedAt || null,
    gpsSessionActive: Boolean(gpsSessionActive),
    gpsSessionId: gpsSessionId || null,
    gpsSessionStartedAt: gpsSessionStartedAt || null,
    recap: recap || null,
  };
}

function cloudRowToLocalTrip(row) {
  const p = row.payload || {};
  const existing = getTrip(row.id);

  return {
    id: row.id,
    name: row.name,
    types: row.types || [],
    location: row.location,
    startDate: row.start_date,
    endDate: row.end_date,
    privacy: row.privacy,
    status: row.status,
    ownerId: row.owner_id,
    createdAt: existing?.createdAt || Date.parse(row.created_at) || Date.now(),
    updatedAt: Date.parse(row.updated_at) || Date.now(),
    syncState: 'synced',
    entries: p.entries || [],
    locations: p.locations || [],
    events: p.events || [],
    track: p.track || [],
    trackSessions: p.trackSessions || [],
    collaborators: p.collaborators || [],
    gearItems: p.gearItems || [],
    meals: p.meals || [],
    expenses: p.expenses || [],
    shoppingItems: p.shoppingItems || [],
    coverPhoto: p.coverPhoto || null,
    mapArea: p.mapArea || null,
    offlineRegions: p.offlineRegions || [],
    gpsTrackingEnabled: p.gpsTrackingEnabled,
    gpsBackgroundTracking: p.gpsBackgroundTracking,
    gpsIntervalMs: p.gpsIntervalMs,
    startedAt: p.startedAt,
    endedAt: p.endedAt,
    gpsSessionActive: p.gpsSessionActive,
    gpsSessionId: p.gpsSessionId,
    gpsSessionStartedAt: p.gpsSessionStartedAt,
    recap: p.recap || existing?.recap || null,
  };
}

function stripHeavyMedia(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(stripHeavyMedia);
  const next = { ...obj };
  delete next.dataUrl;
  if (next.thumbDataUrl && next.thumbDataUrl.length > 120_000) {
    delete next.thumbDataUrl;
  }
  return next;
}
