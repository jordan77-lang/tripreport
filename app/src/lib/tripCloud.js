import { requireSupabase, supabaseConfigured } from './supabase';
import { getSignedInUserId, getSignedInDisplayName } from './authUser';
import {
  saveTrip,
  getTrip,
  getTrips,
  claimAnonymousTripsForUser,
  isTripOwner,
  isTripMember,
  deleteLocalTrip,
} from './storage';
import { syncTripMedia } from './mediaSync';
import {
  mergeCollaboratorsFromMembers,
  memberProfilesFromRows,
  collaboratorsChanged,
} from './tripParticipants';

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
  if (msg.includes('Trip is owned by another account')) {
    return 'This trip is tied to a different cloud account. Sign in with the account that created it, or run migration 006 in Supabase if you are the owner.';
  }
  return msg;
}

/** Decide owner vs contributor using local state, trip_members, and cloud owner_id. */
async function resolveSyncAccess(tripId, userId) {
  claimAnonymousTripsForUser(userId);
  let trip = getTrip(tripId);
  if (!trip) return { trip: null, role: null };

  try {
    await refreshTripMembersFromCloud(tripId);
  } catch (e) {
    console.warn('Member refresh during sync resolve failed', e);
  }
  trip = getTrip(tripId) || trip;

  let cloudOwnerId = null;
  try {
    const supabase = requireSupabase();
    const { data } = await supabase
      .from('trips')
      .select('owner_id')
      .eq('id', tripId)
      .maybeSingle();
    cloudOwnerId = data?.owner_id || null;
  } catch (e) {
    console.warn('Could not read cloud trip owner', e);
  }

  let memberRows = [];
  try {
    memberRows = await fetchTripMemberRows(tripId);
  } catch (e) {
    console.warn('Could not fetch trip members', e);
  }

  const myMemberRow = memberRows.find((r) => r.user_id === userId);
  const localOwner = isTripOwner(trip, userId);
  const cloudOwner = cloudOwnerId === userId;
  const memberOwnerRow = myMemberRow?.role === 'owner';

  if (cloudOwner || localOwner || memberOwnerRow || (!cloudOwnerId && localOwner)) {
    if (trip.ownerId !== userId) {
      saveTrip({
        ...trip,
        ownerId: userId,
        syncState: trip.syncState || 'pending',
        updatedAt: Date.now(),
      });
      trip = getTrip(tripId) || trip;
    }
    return { trip, role: 'owner' };
  }

  const contributor = Boolean(
    cloudOwnerId
    && (
      myMemberRow?.role === 'contributor'
      || (isTripMember(trip, userId) && myMemberRow?.role !== 'viewer')
    ),
  );
  if (contributor) {
    return { trip, role: 'contributor' };
  }

  return { trip, role: null };
}

/** Push local trip document to Supabase (creates or updates). */
export async function pushTripToCloud(localTrip) {
  const supabase = requireSupabase();
  const userId = await ensureSignedInProfile(supabase);
  if (getSignedInUserId() && getSignedInUserId() !== userId) {
    console.warn('Auth session user differs from app user cache — using Supabase session');
  }

  const { trip, role } = await resolveSyncAccess(localTrip.id, userId);
  if (!trip || !role) {
    throw new Error('You need to be a trip member to sync. If you created this trip, sign out and sign back in, then try again.');
  }

  if (role === 'contributor') {
    return pushTripPayloadAsMember(trip, userId);
  }

  const ownerId = resolveCloudOwnerId(trip, userId);
  let tripForPush = trip;
  try {
    const refreshed = await refreshTripMembersFromCloud(trip.id);
    tripForPush = refreshed.trip || trip;
  } catch (e) {
    console.warn('Trip members refresh before push failed', e);
  }
  const latest = getTrip(trip.id) || tripForPush;
  const payload = buildCloudPayload(latest);

  const { data: updatedAt, error } = await supabase.rpc('upsert_trip_for_owner', {
    p_id: trip.id,
    p_name: trip.name,
    p_status: trip.status || 'planning',
    p_start_date: trip.startDate || null,
    p_end_date: trip.endDate || null,
    p_types: trip.types || [],
    p_location: trip.location || null,
    p_privacy: trip.privacy || 'friends',
    p_payload: payload,
  });

  if (error) throw new Error(formatSupabaseError(error, 'Could not sync trip to cloud'));

  const data = { id: trip.id, updated_at: updatedAt };

  const saved = getTrip(trip.id);
  if (saved) {
    saveTrip({ ...saved, ownerId, syncState: 'synced', updatedAt: Date.now() });
  }

  try {
    await syncTripMedia(trip.id);
    const refreshed = getTrip(trip.id);
    if (refreshed) {
      const { listMediaForTrip } = await import('./mediaStore');
      const localMedia = await listMediaForTrip(trip.id);
      const syncedIds = new Set(localMedia.filter((r) => r.syncState === 'synced').map((r) => r.id));
      saveTrip({ ...markMediaRefsSynced(refreshed, syncedIds), syncState: 'synced', ownerId });
    }
  } catch (e) {
    console.warn('Media sync after trip push failed', e);
  }

  return data;
}

/** Contributors merge journal data (locations, entries) into the shared trip payload. */
async function pushTripPayloadAsMember(localTrip, userId) {
  const supabase = requireSupabase();
  const payload = buildCloudPayload(localTrip);
  const updatedAt = new Date().toISOString();

  const { data, error } = await supabase
    .from('trips')
    .update({ payload, updated_at: updatedAt })
    .eq('id', localTrip.id)
    .select('updated_at')
    .single();

  if (error) throw new Error(formatSupabaseError(error, 'Could not sync trip updates'));

  const trip = getTrip(localTrip.id);
  if (trip) {
    saveTrip({ ...trip, syncState: 'synced', updatedAt: Date.now() });
  }

  try {
    await syncTripMedia(localTrip.id);
    const refreshed = getTrip(localTrip.id);
    if (refreshed) {
      const { listMediaForTrip } = await import('./mediaStore');
      const localMedia = await listMediaForTrip(localTrip.id);
      const syncedIds = new Set(localMedia.filter((r) => r.syncState === 'synced').map((r) => r.id));
      saveTrip({ ...markMediaRefsSynced(refreshed, syncedIds), syncState: 'synced' });
    }
  } catch (e) {
    console.warn('Media sync after member trip push failed', e);
  }

  return { id: localTrip.id, updated_at: data?.updated_at || updatedAt };
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
    await refreshTripMembersFromCloud(tripId);
  } catch (e) {
    console.warn('Trip members refresh after pull failed', e);
  }
  try {
    await syncTripMedia(tripId);
  } catch (e) {
    console.warn('Media download after trip pull failed', e);
  }
  return getTrip(tripId) || local;
}

/** Pull one trip when the cloud copy is newer; push first if local edits are pending. */
export async function pullTripIfCloudNewer(tripId) {
  if (!tripId || !supabaseConfigured) return { pulled: false };

  async function pushPendingLocal(local) {
    const userId = getSignedInUserId();
    if (!local?.syncState || local.syncState !== 'pending' || !userId || !isTripMember(local, userId)) {
      return false;
    }
    try {
      await pushTripToCloud(local);
      return true;
    } catch (e) {
      console.warn('Push before pull skipped', tripId, e);
      return false;
    }
  }

  let local = getTrip(tripId);
  if (await pushPendingLocal(local)) {
    return { pulled: false, pushed: true };
  }

  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('trips')
    .select('updated_at')
    .eq('id', tripId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return { pulled: false, missing: true };

  // Re-read after network — planning edits often land while we were fetching cloud metadata.
  local = getTrip(tripId);
  if (await pushPendingLocal(local)) {
    return { pulled: false, pushed: true };
  }
  if (local?.syncState === 'pending') {
    return { pulled: false, skipped: 'local-pending' };
  }

  const cloudUpdated = Date.parse(data.updated_at) || 0;
  const localUpdated = local?.updatedAt || 0;

  if (!local || cloudUpdated > localUpdated) {
    await pullTripFromCloud(tripId);
    return { pulled: true };
  }

  return { pulled: false };
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

/** Fetch trip_members joined with profile names (invite joiners). */
export async function fetchTripMemberRows(tripId) {
  if (!tripId || !supabaseConfigured) return [];
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('trip_members')
    .select('user_id, role, profiles(display_name)')
    .eq('trip_id', tripId);

  if (error) throw error;
  return data || [];
}

/** Merge Supabase trip_members into local collaborators for gear, meals, expenses. */
export async function refreshTripMembersFromCloud(tripId) {
  if (!tripId || !supabaseConfigured) return { trip: getTrip(tripId), changed: false };

  const rows = await fetchTripMemberRows(tripId);
  const trip = getTrip(tripId);
  if (!trip) return { trip: null, changed: false };

  const nextCollaborators = mergeCollaboratorsFromMembers(trip, rows);
  const nextProfiles = memberProfilesFromRows(rows);
  const changed = collaboratorsChanged(trip.collaborators, nextCollaborators)
    || JSON.stringify(trip.memberProfiles || {}) !== JSON.stringify(nextProfiles);

  if (changed) {
    saveTrip({
      ...trip,
      collaborators: nextCollaborators,
      memberProfiles: nextProfiles,
      updatedAt: Date.now(),
      syncState: 'pending',
    });
  }

  return { trip: getTrip(tripId), changed };
}

export async function createTripInvite(tripId, {
  role = 'contributor',
  maxUses = null,
  expiresInDays = 90,
  invitedEmail = null,
  invitedUserId = null,
} = {}) {
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
    invited_email: invitedEmail || null,
    invited_user_id: invitedUserId || null,
  });

  if (error) {
    throw new Error(formatSupabaseError(error, 'Could not create invite'));
  }
  return code;
}

/** Reuse the latest invite code for a trip or create one. */
export async function getOrCreateTripInviteCode(tripId) {
  const supabase = requireSupabase();
  await ensureSignedInProfile(supabase);

  const { data, error } = await supabase
    .from('trip_invites')
    .select('code, expires_at, max_uses, uses')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) throw new Error(formatSupabaseError(error, 'Could not load invite codes'));

  const now = Date.now();
  const reusable = (data || []).find((row) => {
    if (row.expires_at && Date.parse(row.expires_at) < now) return false;
    if (row.max_uses != null && row.uses >= row.max_uses) return false;
    return Boolean(row.code);
  });

  if (reusable?.code) return reusable.code;
  return createTripInvite(tripId);
}

/** Look up a past crew member's email (owner / shared-trip check on server). */
export async function fetchUserEmailForInvite(userId) {
  if (!userId || !supabaseConfigured) return null;
  const supabase = requireSupabase();
  const { data, error } = await supabase.rpc('get_user_email_for_invite', { p_user_id: userId });
  if (error) throw new Error(formatSupabaseError(error, 'Could not look up email'));
  return data || null;
}

/** Create or reuse invite code and email join instructions. */
export async function sendTripInviteByEmail(tripId, {
  email,
  inviteeName = null,
  invitedUserId = null,
} = {}) {
  const to = String(email || '').trim().toLowerCase();
  if (!to) throw new Error('Email address is required');

  const trip = getTrip(tripId);
  if (!trip) throw new Error('Trip not found');

  const code = await getOrCreateTripInviteCode(tripId);

  if (invitedUserId || to) {
    const supabase = requireSupabase();
    await supabase.from('trip_invites').update({
      invited_email: to,
      invited_user_id: invitedUserId || null,
    }).eq('code', code);
  }

  const { emailTripInvite } = await import('./inviteApi');
  const emailResult = await emailTripInvite({
    tripId,
    tripName: trip.name,
    to,
    inviteCode: code,
    inviteeName: inviteeName || null,
  });

  return {
    code,
    emailId: emailResult?.id || null,
    sandboxLimited: Boolean(emailResult?.sandboxLimited),
  };
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
    if (!isTripMember(trip, userId)) continue;
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
        await refreshTripMembersFromCloud(row.id);
      } catch (e) {
        console.warn('Trip members refresh failed during cloud sync', row.id, e);
      }
    }
    for (const row of cloudList) {
      try {
        const local = getTrip(row.id);
        if (local?.syncState === 'pending') continue;
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
  try {
    await refreshTripMembersFromCloud(tripId);
  } catch {
    // non-fatal
  }

  const userId = getSignedInUserId();
  const trip = getTrip(tripId);
  if (trip && userId) {
    const label = getSignedInDisplayName() || 'Me';
    const hasSelf = (trip.collaborators || []).some((c) => (c.userId || c.id) === userId);
    if (!hasSelf) {
      saveTrip({
        ...getTrip(tripId),
        collaborators: [
          ...(getTrip(tripId)?.collaborators || []),
          { id: userId, userId, handle: label, name: label, role: 'contributor', joinedViaInvite: true },
        ],
        memberProfiles: { ...(getTrip(tripId)?.memberProfiles || {}), [userId]: label },
        syncState: 'pending',
        updatedAt: Date.now(),
      });
    }
  }

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
