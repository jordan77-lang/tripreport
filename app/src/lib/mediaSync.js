// Supabase Storage — upload/download only. Viewing always uses local IndexedDB blobs.

import { requireSupabase, supabaseConfigured } from './supabase';
import { getSignedInUserId } from './authUser';
import {
  getMediaRecord,
  listMediaForTrip,
  listPendingMediaForTrip,
  putMediaRecord,
  updateMediaSyncState,
} from './mediaStore';

export const MEDIA_BUCKET = 'trip-media';

function fullPath(tripId, mediaId) {
  return `${tripId}/${mediaId}`;
}

function thumbPath(tripId, mediaId) {
  return `${tripId}/${mediaId}-thumb`;
}

export async function uploadMediaToCloud(record) {
  if (!record?.id || !record?.tripId) return { ok: false, reason: 'invalid-record' };
  if (!supabaseConfigured) return { ok: false, reason: 'not-configured' };

  const userId = getSignedInUserId();
  if (!userId) return { ok: false, reason: 'not-signed-in' };

  const supabase = requireSupabase();
  const path = fullPath(record.tripId, record.id);
  const thumb = thumbPath(record.tripId, record.id);
  const mime = record.mime || 'image/jpeg';

  if (record.fullBlob) {
    const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, record.fullBlob, {
      upsert: true,
      contentType: mime,
    });
    if (error) throw error;
  }

  if (record.thumbBlob) {
    const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(thumb, record.thumbBlob, {
      upsert: true,
      contentType: mime,
    });
    if (error) throw error;
  }

  const { error: metaError } = await supabase.from('media_objects').upsert({
    id: record.id,
    trip_id: record.tripId,
    uploaded_by: userId,
    storage_path: path,
    mime_type: mime,
    byte_size: record.fullBlob?.size || record.thumbBlob?.size || 0,
  });
  if (metaError) throw metaError;

  await updateMediaSyncState(record.id, 'synced', path);
  return { ok: true, path };
}

export async function downloadMediaFromCloud(meta) {
  if (!meta?.id || !meta?.trip_id) return null;
  if (!supabaseConfigured) return null;

  const existing = await getMediaRecord(meta.id);
  if (existing?.fullBlob || existing?.thumbBlob) {
    if (existing.syncState !== 'synced') {
      await updateMediaSyncState(meta.id, 'synced', meta.storage_path);
    }
    return existing;
  }

  const supabase = requireSupabase();
  const path = meta.storage_path || fullPath(meta.trip_id, meta.id);
  const thumb = thumbPath(meta.trip_id, meta.id);

  const { data: fullData, error: fullError } = await supabase.storage.from(MEDIA_BUCKET).download(path);
  if (fullError) throw fullError;

  let thumbBlob = null;
  const { data: thumbData } = await supabase.storage.from(MEDIA_BUCKET).download(thumb);
  if (thumbData) thumbBlob = thumbData;

  const record = {
    id: meta.id,
    tripId: meta.trip_id,
    name: meta.storage_path?.split('/').pop() || meta.id,
    mime: meta.mime_type || fullData.type || 'image/jpeg',
    size: meta.byte_size || fullData.size,
    fullBlob: fullData,
    thumbBlob,
    syncState: 'synced',
    storagePath: path,
    createdAt: meta.created_at ? Date.parse(meta.created_at) : Date.now(),
    updatedAt: Date.now(),
  };

  await putMediaRecord(record);
  return record;
}

export async function listCloudMediaForTrip(tripId) {
  if (!tripId || !supabaseConfigured) return [];
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('media_objects')
    .select('id, trip_id, storage_path, mime_type, byte_size, created_at')
    .eq('trip_id', tripId);
  if (error) throw error;
  return data || [];
}

/** Upload pending local blobs, then download any cloud media missing locally. */
export async function syncTripMedia(tripId) {
  if (!tripId || !supabaseConfigured) return { uploaded: 0, downloaded: 0 };
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { uploaded: 0, downloaded: 0, offline: true };
  }

  const userId = getSignedInUserId();
  if (!userId) return { uploaded: 0, downloaded: 0, skipped: 'not-signed-in' };

  let uploaded = 0;
  let downloaded = 0;

  const pending = await listPendingMediaForTrip(tripId);
  for (const record of pending) {
    try {
      const result = await uploadMediaToCloud(record);
      if (result.ok) uploaded += 1;
    } catch (e) {
      console.warn('Media upload failed', record.id, e);
    }
  }

  try {
    const cloudRows = await listCloudMediaForTrip(tripId);
    const local = await listMediaForTrip(tripId);
    const localIds = new Set(local.map((r) => r.id));

    for (const row of cloudRows) {
      if (localIds.has(row.id)) continue;
      try {
        await downloadMediaFromCloud(row);
        downloaded += 1;
      } catch (e) {
        console.warn('Media download failed', row.id, e);
      }
    }
  } catch (e) {
    console.warn('Could not list cloud media', e);
  }

  return { uploaded, downloaded };
}
