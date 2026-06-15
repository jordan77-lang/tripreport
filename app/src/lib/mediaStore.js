// Local photo blobs — UI reads from here; Supabase is upload/download only.

const DB_NAME = 'tripreport-media';
const STORE = 'blobs';
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('byTripId', 'tripId', { unique: false });
        store.createIndex('bySyncState', 'syncState', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Could not open media database'));
  });
}

function runTransaction(mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    Promise.resolve(fn(store))
      .then((result) => {
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
      })
      .catch(reject);
  }));
}

export async function putMediaRecord(record) {
  if (!record?.id) throw new Error('Media record requires an id');
  await runTransaction('readwrite', (store) => store.put(record));
  return record;
}

export async function getMediaRecord(id) {
  if (!id) return null;
  return runTransaction('readonly', (store) => new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  }));
}

export async function deleteMediaRecord(id) {
  if (!id) return;
  await runTransaction('readwrite', (store) => store.delete(id));
}

export async function listMediaForTrip(tripId) {
  if (!tripId) return [];
  return runTransaction('readonly', (store) => new Promise((resolve, reject) => {
    const idx = store.index('byTripId');
    const req = idx.getAll(tripId);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  }));
}

export async function listPendingMediaForTrip(tripId) {
  const all = await listMediaForTrip(tripId);
  return all.filter((r) => r.syncState === 'pending' || r.syncState === 'local');
}

export async function updateMediaSyncState(id, syncState, storagePath = null) {
  const existing = await getMediaRecord(id);
  if (!existing) return null;
  const next = {
    ...existing,
    syncState,
    storagePath: storagePath ?? existing.storagePath,
    updatedAt: Date.now(),
  };
  await putMediaRecord(next);
  return next;
}

/** Object URL for display — caller should revoke when done. */
export async function createMediaObjectUrl(id, { preferThumb = true } = {}) {
  const record = await getMediaRecord(id);
  if (!record) return null;
  const blob = preferThumb
    ? (record.thumbBlob || record.fullBlob)
    : (record.fullBlob || record.thumbBlob);
  if (!blob) return null;
  return URL.createObjectURL(blob);
}

export function isLocalMediaRef(ref) {
  return Boolean(ref?.id && !ref?.thumbDataUrl && !ref?.dataUrl);
}

export function isLegacyMediaRef(ref) {
  return Boolean(ref?.thumbDataUrl || ref?.dataUrl);
}
