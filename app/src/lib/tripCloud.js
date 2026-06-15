import { requireSupabase } from './supabase';
import { getSignedInUserId } from './authUser';
import { saveTrip, getTrip } from './storage';
import { syncTripMedia } from './mediaSync';
import { collectMediaRefsFromTrip, markMediaRefsSynced } from './mediaRefs';

function randomInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 8; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

/** Push local trip document to Supabase (creates or updates). */
export async function pushTripToCloud(localTrip) {
  const supabase = requireSupabase();
  const userId = getSignedInUserId();
  if (!userId) throw new Error('Sign in to sync trips');

  const payload = buildCloudPayload(localTrip);
  const row = {
    id: localTrip.id,
    owner_id: localTrip.ownerId || userId,
    name: localTrip.name,
    status: localTrip.status || 'planning',
    start_date: localTrip.startDate || null,
    end_date: localTrip.endDate || null,
    types: localTrip.types || [],
    location: localTrip.location || null,
    privacy: localTrip.privacy || 'friends',
    payload,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('trips')
    .upsert(row)
    .select('id, updated_at')
    .single();

  if (error) throw error;

  // Ensure owner is a member
  await supabase.from('trip_members').upsert({
    trip_id: localTrip.id,
    user_id: localTrip.ownerId || userId,
    role: 'owner',
  });

  try {
    await syncTripMedia(localTrip.id);
    const trip = getTrip(localTrip.id);
    if (trip) {
      const { listMediaForTrip } = await import('./mediaStore');
      const localMedia = await listMediaForTrip(localTrip.id);
      const syncedIds = new Set(localMedia.filter((r) => r.syncState === 'synced').map((r) => r.id));
      saveTrip({ ...markMediaRefsSynced(trip, syncedIds), syncState: 'synced' });
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
  const userId = getSignedInUserId();
  if (!userId) throw new Error('Sign in to invite others');

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

  if (error) throw error;
  return code;
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
