// Supabase Storage — upload/download only. Viewing always uses local IndexedDB blobs.
// Each image id is transferred at most once unless blob bytes change (size fingerprint).

import { requireSupabase, supabaseConfigured } from './supabase';
import { getSignedInUserId } from './authUser';
import {
  getMediaRecord,
  listMediaForTrip,
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

export function localFullByteSize(record) {
  if (!record) return 0;
  return record.fullBlob?.size || record.fullByteSize || 0;
}

export function localThumbByteSize(record) {
  if (!record) return 0;
  return record.thumbBlob?.size || record.thumbByteSize || 0;
}

export function mediaHasLocalBlobs(record) {
  return Boolean(record?.fullBlob || record?.thumbBlob);
}

/** True when cloud already has the same full image bytes we would upload. */
export function cloudMatchesLocal(cloudRow, localRecord) {
  if (!cloudRow || !localRecord) return false;
  const localSize = localFullByteSize(localRecord);
  if (!localSize || !cloudRow.byte_size) return false;
  return Number(cloudRow.byte_size) === localSize;
}

/** Upload only when missing in cloud or local bytes differ from cloud. */
export function shouldUploadToCloud(localRecord, cloudRow) {
  if (!localRecord?.id || !mediaHasLocalBlobs(localRecord)) return false;
  if (!cloudRow) return true;
  if (cloudMatchesLocal(cloudRow, localRecord)) return false;
  return true;
}

/** Download only when we lack local blobs or cloud has newer/different bytes. */
export function shouldDownloadFromCloud(cloudRow, localRecord) {
  if (!cloudRow?.id) return false;
  if (!localRecord || !mediaHasLocalBlobs(localRecord)) return true;
  if (!cloudRow.byte_size) return false;
  const localSize = localFullByteSize(localRecord) || localThumbByteSize(localRecord);
  if (!localSize) return true;
  return Number(cloudRow.byte_size) !== localSize;
}

export async function uploadMediaToCloud(record, { cloudRow = null } = {}) {
  if (!record?.id || !record?.tripId) return { ok: false, reason: 'invalid-record' };
  if (!supabaseConfigured) return { ok: false, reason: 'not-configured' };

  const userId = getSignedInUserId();
  if (!userId) return { ok: false, reason: 'not-signed-in' };

  if (!mediaHasLocalBlobs(record)) {
    return { ok: false, reason: 'no-local-blobs' };
  }

  const path = fullPath(record.tripId, record.id);

  if (record.syncState === 'synced' && record.storagePath && cloudMatchesLocal(cloudRow, record)) {
    return { ok: true, path: record.storagePath, skipped: true };
  }

  if (cloudRow && cloudMatchesLocal(cloudRow, record)) {
    await updateMediaSyncState(record.id, 'synced', cloudRow.storage_path || path);
    return { ok: true, path: cloudRow.storage_path || path, skipped: true };
  }

  const supabase = requireSupabase();
  const thumb = thumbPath(record.tripId, record.id);
  const mime = record.mime || 'image/jpeg';
  const fullByteSize = localFullByteSize(record);
  const thumbByteSize = localThumbByteSize(record);

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
    byte_size: fullByteSize || thumbByteSize || 0,
  });
  if (metaError) throw metaError;

  await putMediaRecord({
    ...record,
    syncState: 'synced',
    storagePath: path,
    fullByteSize,
    thumbByteSize,
    updatedAt: Date.now(),
  });

  return { ok: true, path, skipped: false };
}

export async function downloadMediaFromCloud(meta) {
  if (!meta?.id || !meta?.trip_id) return null;
  if (!supabaseConfigured) return null;

  const existing = await getMediaRecord(meta.id);
  if (existing && mediaHasLocalBlobs(existing) && !shouldDownloadFromCloud(meta, existing)) {
    if (existing.syncState !== 'synced') {
      await updateMediaSyncState(meta.id, 'synced', meta.storage_path);
    }
    return { record: existing, skipped: true };
  }

  const supabase = requireSupabase();
  const path = meta.storage_path || fullPath(meta.trip_id, meta.id);
  const thumb = thumbPath(meta.trip_id, meta.id);

  const { data: fullData, error: fullError } = await supabase.storage.from(MEDIA_BUCKET).download(path);
  if (fullError) throw fullError;

  let thumbBlob = null;
  const { data: thumbData } = await supabase.storage.from(MEDIA_BUCKET).download(thumb);
  if (thumbData) thumbBlob = thumbData;

  const fullByteSize = fullData?.size || Number(meta.byte_size) || 0;
  const thumbByteSize = thumbBlob?.size || 0;

  const record = {
    id: meta.id,
    tripId: meta.trip_id,
    name: meta.storage_path?.split('/').pop() || meta.id,
    mime: meta.mime_type || fullData.type || 'image/jpeg',
    size: meta.byte_size || fullData.size,
    fullBlob: fullData,
    thumbBlob,
    fullByteSize,
    thumbByteSize,
    syncState: 'synced',
    storagePath: path,
    createdAt: meta.created_at ? Date.parse(meta.created_at) : Date.now(),
    updatedAt: Date.now(),
  };

  await putMediaRecord(record);
  return { record, skipped: false };
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

/** Upload changed/missing blobs, download missing/changed — skip when fingerprints match. */
export async function syncTripMedia(tripId) {
  if (!tripId || !supabaseConfigured) {
    return { uploaded: 0, downloaded: 0, uploadSkipped: 0, downloadSkipped: 0 };
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { uploaded: 0, downloaded: 0, uploadSkipped: 0, downloadSkipped: 0, offline: true };
  }

  const userId = getSignedInUserId();
  if (!userId) {
    return { uploaded: 0, downloaded: 0, uploadSkipped: 0, downloadSkipped: 0, skipped: 'not-signed-in' };
  }

  let uploaded = 0;
  let downloaded = 0;
  let uploadSkipped = 0;
  let downloadSkipped = 0;

  let cloudRows = [];
  try {
    cloudRows = await listCloudMediaForTrip(tripId);
  } catch (e) {
    console.warn('Could not list cloud media', e);
  }

  const cloudById = new Map(cloudRows.map((row) => [row.id, row]));
  const localRecords = await listMediaForTrip(tripId);
  const localById = new Map(localRecords.map((r) => [r.id, r]));

  for (const record of localRecords) {
    const cloudRow = cloudById.get(record.id) || null;
    if (!shouldUploadToCloud(record, cloudRow)) {
      if (cloudRow && record.syncState !== 'synced') {
        try {
          await updateMediaSyncState(record.id, 'synced', cloudRow.storage_path);
        } catch (e) {
          console.warn('Could not mark media synced locally', record.id, e);
        }
      }
      uploadSkipped += 1;
      continue;
    }
    try {
      const result = await uploadMediaToCloud(record, { cloudRow });
      if (result.ok && result.skipped) uploadSkipped += 1;
      else if (result.ok) uploaded += 1;
    } catch (e) {
      console.warn('Media upload failed', record.id, e);
    }
  }

  for (const row of cloudRows) {
    const localRecord = localById.get(row.id) || null;
    if (!shouldDownloadFromCloud(row, localRecord)) {
      downloadSkipped += 1;
      continue;
    }
    try {
      const result = await downloadMediaFromCloud(row);
      if (result?.skipped) downloadSkipped += 1;
      else if (result?.record) downloaded += 1;
    } catch (e) {
      console.warn('Media download failed', row.id, e);
    }
  }

  return { uploaded, downloaded, uploadSkipped, downloadSkipped };
}
