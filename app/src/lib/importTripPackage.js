import { materialize } from './tripSync';
import { getTrip, saveTrip } from './storage';
import { applyImportPlacement } from './tripTimeline';
import { createTripUpdate, mergeTripUpdate, storeUpdateMedia } from './offlineExchange';

const memoryCheckpoints = new Map();

function saveCheckpointRaw(tripId, raw) {
  const key = 'tr_import_backup:' + tripId;
  memoryCheckpoints.set(tripId, raw);
  try {
    localStorage.setItem(key, raw);
  } catch {
    // Free older import backups from other trips if browser quota is tight.
    try {
      if (typeof localStorage.length === 'number' && typeof localStorage.key === 'function') {
        const staleKeys = [];
        for (let i = 0; i < localStorage.length; i += 1) {
          const k = localStorage.key(i);
          if (k && k.startsWith('tr_import_backup:') && k !== key) staleKeys.push(k);
        }
        for (const k of staleKeys) localStorage.removeItem?.(k);
        localStorage.setItem(key, raw);
      }
    } catch {
      // In-memory checkpoint remains available for this session.
    }
  }
}

export function getTripCheckpointRaw(tripId) {
  return localStorage.getItem('tr_import_backup:' + tripId) || memoryCheckpoints.get(tripId) || null;
}

// The checkpoint is saved first, attachments are one atomic additive batch,
// then the latest local trip is merged and committed synchronously.
// If the final save fails, the original trip is intact and retry is safe.
export async function importTripPackage(tripId, update, placement = null) {
  const before=getTrip(tripId);
  mergeTripUpdate(before,update); // Validate trip identity before any write.
  saveCheckpointRaw(tripId, JSON.stringify(createTripUpdate(before)));
  await storeUpdateMedia(update);
  const result=mergeTripUpdate(getTrip(tripId),update);
  const placed=placement ? applyImportPlacement(result.trip, placement) : result.trip;
  if (placed !== result.trip) {
    saveTrip(result.trip,{capture:false,schedule:false});
    return {...result, trip: saveTrip(placed)};
  }
  saveTrip(result.trip,{capture:false,schedule:true});
  return result;
}

export function restoreTripCheckpoint(tripId) {
  const raw=getTripCheckpointRaw(tripId);
  if(!raw)throw new Error('No import checkpoint for this trip yet.');
  const update=JSON.parse(raw),latest=getTrip(tripId);
  if(update.tripId!==tripId || update.payload?._sync?.version!==2)throw new Error('Invalid checkpoint.');
  const snapshot=materialize({...latest,_sync:update.payload._sync});
  // New compensating edits supersede current field heads. History remains intact.
  return saveTrip({...snapshot,_sync:latest._sync});
}
