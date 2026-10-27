import { requireSupabase, supabaseConfigured } from './supabase';
import { getSignedInUserId, getSignedInDisplayName } from './authUser';
import {
  saveTrip,
  getTrip,
  getTrips,
  getCurrentUserId,
  claimAnonymousTripsForUser,
  isTripOwner,
  isTripMember,
  deleteLocalTrip,
} from './storage';
import { syncTripMedia } from './mediaSync';
import { markMediaRefsSynced, collectMediaRefsFromTrip } from './mediaRefs';
import { ensureSync, mergeSync, acknowledge, materialize } from './tripSync';
import {
  mergeCollaboratorsFromMembers,
  memberProfilesFromRows,
  collaboratorsChanged,
  dedupeCollaborators,
} from './tripParticipants';


function randomInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 8; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
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

const runningSyncs = new Map();

export function hasTripSyncedToCloud(trip, userId = null) {
  if (!trip) return false;
  if (trip._sync?.lastCloudSync) return true;
  if (Array.isArray(trip._sync?.acked) && trip._sync.acked.length > 0) return true;
  if (userId && trip.ownerId && trip.ownerId !== userId) return true;
  return false;
}

async function cleanupLocalTripMedia(tripId) {
  try {
    const { listMediaForTrip, deleteMediaRecord } = await import('./mediaStore');
    const media = await listMediaForTrip(tripId);
    for (const record of media) {
      await deleteMediaRecord(record.id);
    }
  } catch (e) {
    console.warn('Local media cleanup failed', e);
  }
}

export async function handleCloudDeletedTrip(localTrip, userId = getSignedInUserId()) {
  if (!localTrip?.id) return { action: 'none' };
  // If the signed-in user IS the owner who deleted this trip on another device,
  // remove it locally on this device too so it doesn't linger or resurrect.
  if (userId && isTripOwner(localTrip, userId)) {
    await cleanupLocalTripMedia(localTrip.id);
    deleteLocalTrip(localTrip.id);
    return { action: 'deleted-owner-copy', id: localTrip.id };
  }
  // Otherwise, this device belongs to another crew member: flag the trip so the
  // UI prompts them to either Delete it or Take Ownership.
  const synced = ensureSync(localTrip);
  const allOpIds = (synced._sync?.ops || []).map((o) => o.id);
  saveTrip({
    ...synced,
    ownerDeletedAt: localTrip.ownerDeletedAt || Date.now(),
    _sync: {
      ...synced._sync,
      acked: allOpIds,
      lastCloudSync: synced._sync?.lastCloudSync || Date.now(),
    },
    syncState: 'synced',
  }, { capture: false, schedule: false });
  return { action: 'prompt-member', id: localTrip.id };
}

export async function handleCloudDeletedTripById(tripId) {
  const local = getTrip(tripId);
  if (!local) return { action: 'none' };
  return handleCloudDeletedTrip(local, getSignedInUserId());
}

export async function claimDeletedTripOwnership(tripId) {
  if (!tripId) throw new Error('Trip id required');
  const trip = getTrip(tripId);
  if (!trip) throw new Error('Trip not found');

  const signedInId = getSignedInUserId();
  const userId = signedInId || getCurrentUserId();
  const displayName = getSignedInDisplayName() || trip.memberProfiles?.[userId] || 'Owner';
  const previousOwnerId = trip.ownerId;

  const synced = ensureSync(trip);
  const filteredCollabs = (synced.collaborators || []).filter(
    (c) => (c.userId || c.id) !== previousOwnerId,
  );
  const hasSelf = filteredCollabs.some((c) => (c.userId || c.id) === userId);
  const nextCollabs = hasSelf
    ? filteredCollabs.map((c) => ((c.userId || c.id) === userId ? { ...c, role: 'owner', name: c.name || displayName } : c))
    : [{ id: userId, userId, name: displayName, handle: displayName, role: 'owner' }, ...filteredCollabs];

  const memberProfiles = { ...(synced.memberProfiles || {}), [userId]: displayName };
  const reclaimed = saveTrip({
    ...synced,
    ownerId: userId,
    ownerDeletedAt: null,
    claimingOwnership: true,
    collaborators: dedupeCollaborators(nextCollabs, { memberProfiles }),
    memberProfiles,
    _sync: {
      ...synced._sync,
      acked: [],
      lastCloudSync: null,
    },
    syncState: 'pending',
    updatedAt: Date.now(),
  }, { capture: true, schedule: false });

  if (supabaseConfigured && signedInId) {
    await pushTripToCloud(reclaimed);
    // Re-register any other collaborators who have cloud user IDs in trip_members
    try {
      const supabase = requireSupabase();
      const otherMembers = (getTrip(tripId)?.collaborators || []).filter(
        (c) => c.userId && c.userId !== signedInId && /^[0-9a-f-]{36}$/i.test(c.userId),
      );
      for (const m of otherMembers) {
        await supabase.from('trip_members').upsert({
          trip_id: tripId,
          user_id: m.userId,
          role: m.role === 'viewer' ? 'viewer' : 'contributor',
        });
      }
    } catch (e) {
      console.warn('Could not re-add crew members after ownership transfer', e);
    }
  }

  const finalTrip = getTrip(tripId);
  if (finalTrip?.claimingOwnership) {
    saveTrip({ ...finalTrip, claimingOwnership: false }, { capture: false, schedule: false });
  }
  return getTrip(tripId);
}

export async function pushTripToCloud(localTrip) {
  if (runningSyncs.has(localTrip.id)) return runningSyncs.get(localTrip.id);
  const task = syncChanges(localTrip.id).finally(()=>runningSyncs.delete(localTrip.id));
  runningSyncs.set(localTrip.id,task);
  return task;
}

async function syncChanges(tripId) {
  const supabase = requireSupabase();
  const userId = await ensureSignedInProfile(supabase);
  claimAnonymousTripsForUser(userId);
  // Read first to bootstrap pre-v2 trips. The RPC checks this snapshot's revision.
  for (let attempt=0; attempt<4; attempt++) {
    const {data:row,error:readError} = await supabase.from('trips').select('*').eq('id',tripId).maybeSingle();
    if (readError) throw readError;
    let latest=getTrip(tripId);
    if (!latest && !row) throw new Error('Trip not found.');
    if (!row && latest && !latest.claimingOwnership && hasTripSyncedToCloud(latest, userId)) {
      const outcome = await handleCloudDeletedTrip(latest, userId);
      return { id: tripId, deletedInCloud: true, action: outcome.action };
    }
    if (!latest) latest=cloudRowToLocalTrip(row);
    if (!row && !isTripOwner(latest,userId)) throw new Error('Join this trip online before syncing contributions.');
    let merged=row ? mergeSync(latest,cloudRowToLocalTrip(row)) : ensureSync(latest);
    if(row && row.owner_id !== userId) {
      const members=await fetchTripMemberRows(tripId);
      const membership=members.find(m=>m.user_id===userId);
      if(membership?.role==='viewer') {
        const remote=ensureSync(cloudRowToLocalTrip(row));
        const readOnly=acknowledge(merged,remote._sync.ops.map(o=>o.id));
        saveTrip(readOnly,{capture:false});
        await syncTripMedia(tripId,{readOnly:true});
        return {id:tripId,updated_at:row.updated_at,readOnly:true};
      }
    }
    merged=saveTrip(merged,{capture:false});
    const remoteOps=row?.payload?._sync?.version===2 && Array.isArray(row.payload._sync.ops) ? row.payload._sync.ops : null;
    const remoteOpIds=remoteOps ? new Set(remoteOps.map(o=>o.id)) : null;
    const hasLocalDelta=!remoteOpIds || merged._sync.ops.some(o=>!remoteOpIds.has(o.id));
    let data;
    if (!hasLocalDelta) {
      data={ops:remoteOps,ownerId:row.owner_id,updatedAt:row.updated_at};
    } else {
      const sent=merged._sync.ops;
      const rpcResult=await supabase.rpc('sync_trip_changes',{
        p_id:tripId,p_ops:sent,p_metadata:{name:merged.name},
        p_legacy_updated_at:row?.payload?._sync?.version===2 ? null : (row?.updated_at || null),
      });
      const {error}=rpcResult;
      data=rpcResult.data;
      if (error?.code==='40001') continue;
      if (error) throw new Error(error.code==='PGRST202'
        ? 'Cloud sync needs database migration 009. Your changes are saved on this device.'
        : error.message || 'Cloud sync failed; local changes are still saved.');
    }
    // Re-read AFTER the request. Only changes actually returned by the server are acknowledged.
    const current=getTrip(tripId) || merged;
    const received=mergeSync(current,{...merged,_sync:{version:2,ops:data.ops,acked:[]}});
    const saved=acknowledge({...received,ownerId:data.ownerId,ownerDeletedAt:null,claimingOwnership:false},data.ops.map(o=>o.id));
    saved._sync={...saved._sync,lastCloudSync:Date.parse(data.updatedAt)||Date.now()};
    saveTrip(saved,{capture:false});
    const acknowledged=new Set(saved._sync.acked);
    if (saved._sync.ops.some(o=>!acknowledged.has(o.id))) continue;
    try {
      await syncTripMedia(tripId);
    } catch(error) {
      const fresh=getTrip(tripId);
      saveTrip({...fresh,_sync:{...fresh._sync,mediaPending:Math.max(1,collectMediaRefsFromTrip(fresh).length),mediaError:error.message}},{capture:false});
      throw error;
    }
    const {listMediaForTrip}=await import('./mediaStore');
    const media=await listMediaForTrip(tripId);
    const ids=new Set(media.filter(r=>r.syncState==='synced').map(r=>r.id));
    const fresh=getTrip(tripId);
    const missing=collectMediaRefsFromTrip(fresh).filter(ref=>!ids.has(ref.id));
    saveTrip({...markMediaRefsSynced(fresh,ids),_sync:{...fresh._sync,mediaPending:missing.length,mediaError:missing.length?'Some attachments still need to sync.':null}},{capture:false});
    if (missing.length) throw new Error('Trip changes synced. '+missing.length+' attachments still need to sync; retry when online.');
    const finalTrip=getTrip(tripId),finalAck=new Set(finalTrip._sync.acked);
    if(finalTrip._sync.ops.some(o=>!finalAck.has(o.id)))continue;
    return {id:tripId,updated_at:data.updatedAt};
  }
  throw new Error('New changes are saved locally. Sync will retry.');
}

export async function pullTripFromCloud(tripId) {
  const local=getTrip(tripId);
  if (local) { await pushTripToCloud(local); return getTrip(tripId); }
  const supabase=requireSupabase();
  const {data,error}=await supabase.from('trips').select('*').eq('id',tripId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Trip not found in cloud');
  saveTrip(cloudRowToLocalTrip(data),{capture:false});
  await pushTripToCloud(getTrip(tripId));
  await refreshTripMembersFromCloud(tripId);
  return getTrip(tripId);
}

export async function pullTripIfCloudNewer(tripId) {
  if (!tripId || !supabaseConfigured) return {pulled:false};
  await pullTripFromCloud(tripId);
  return {pulled:true};
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

  const nextProfiles = memberProfilesFromRows(rows);
  const nextCollaborators = rows.length
    ? mergeCollaboratorsFromMembers(trip, rows)
    : dedupeCollaborators(trip.collaborators || [], { memberProfiles: nextProfiles });
  const cleanedCollaborators = dedupeCollaborators(nextCollaborators, { memberProfiles: nextProfiles });
  const changed = collaboratorsChanged(trip.collaborators, cleanedCollaborators)
    || JSON.stringify(trip.memberProfiles || {}) !== JSON.stringify(nextProfiles);

  if (changed) {
    saveTrip({
      ...trip,
      collaborators: cleanedCollaborators,
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
  if (!supabaseConfigured) return { pulled: 0, pushed: 0, reconciled: 0, skipped: 'not-configured' };

  const supabase = requireSupabase();
  let userId;
  try {
    userId = await ensureSignedInProfile(supabase);
  } catch {
    return { pulled: 0, pushed: 0, reconciled: 0, skipped: 'not-signed-in' };
  }

  claimAnonymousTripsForUser(userId);

  let pulled = 0;
  let pushed = 0;
  let reconciled = 0;

  let cloudList = null;
  try {
    cloudList = await listCloudTrips();
  } catch (e) {
    console.warn('Could not list cloud trips', e);
  }

  // Reconcile local trips that were previously synced to the cloud but deleted by the owner.
  if (Array.isArray(cloudList)) {
    const cloudIds = new Set(cloudList.map((row) => row.id));
    for (const localTrip of getTrips()) {
      if (cloudIds.has(localTrip.id)) continue;
      if (!hasTripSyncedToCloud(localTrip, userId)) continue;
      if (localTrip.ownerDeletedAt && !isTripOwner(localTrip, userId)) continue;
      try {
        const { data: verifyRow, error: verifyErr } = await supabase
          .from('trips')
          .select('id')
          .eq('id', localTrip.id)
          .maybeSingle();
        if (!verifyErr && !verifyRow) {
          await handleCloudDeletedTrip(localTrip, userId);
          reconciled += 1;
        }
      } catch (e) {
        console.warn('Could not verify deleted cloud trip', localTrip.id, e);
      }
    }
  }

  for (const trip of getTrips()) {
    if (trip.ownerDeletedAt) continue;
    if (!isTripMember(trip, userId)) continue;
    if (trip.syncState === 'synced') continue;
    try {
      await pushTripToCloud(trip);
      pushed += 1;
    } catch (e) {
      console.warn('Trip push failed during cloud sync', trip.id, e);
    }
  }

  if (Array.isArray(cloudList)) {
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
        // Always merge immutable changes, including when this device has edits.
        const cloudUpdated = Date.parse(row.updated_at) || 0;
        const localUpdated = local?.updatedAt || 0;
        if (!local || cloudUpdated > localUpdated || local.syncState === 'pending' || local._sync?.version === 2) {
          await pullTripFromCloud(row.id);
          pulled += 1;
        }
      } catch (e) {
        console.warn('Trip pull failed during cloud sync', row.id, e);
      }
    }
  }

  return { pulled, pushed, reconciled };
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
    const collaborators = [...(trip.collaborators || [])];
    const hasSelf = collaborators.some((c) => (c.userId || c.id) === userId);
    if (!hasSelf) {
      collaborators.push({
        id: userId,
        userId,
        handle: label,
        name: label,
        role: 'contributor',
        joinedViaInvite: true,
      });
    }
    const memberProfiles = { ...(trip.memberProfiles || {}), [userId]: label };
    const cleaned = dedupeCollaborators(collaborators, { memberProfiles });
    if (!hasSelf || cleaned.length !== (trip.collaborators || []).length) {
      saveTrip({
        ...trip,
        collaborators: cleaned,
        memberProfiles,
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

function cloudRowToLocalTrip(row) {
  const cloudSyncTs = Date.parse(row.updated_at) || Date.now();
  if (row.payload?._sync?.version === 2) return materialize({
    id: row.id, ownerId: row.owner_id, ownerDeletedAt: null, createdAt: Date.parse(row.created_at),
    _sync: { ...row.payload._sync, acked: row.payload._sync.ops.map(o=>o.id), lastCloudSync: cloudSyncTs },
  });
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
    expenseGroups: p.expenseGroups || existing?.expenseGroups || [],
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

