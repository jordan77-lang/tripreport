import { materialize } from './tripSync';
import { getTrip, saveTrip } from './storage';
import { applyImportPlacement } from './tripTimeline';
import { createTripUpdate, mergeTripUpdate, storeUpdateMedia } from './offlineExchange';
// The checkpoint is saved first, attachments are one atomic additive batch,
// then the latest local trip is merged and committed synchronously.
// If the final save fails, the original trip is intact and retry is safe.
export async function importTripPackage(tripId, update, placement = null) {
  const before=getTrip(tripId);
  mergeTripUpdate(before,update); // Validate trip identity before any write.
  localStorage.setItem('tr_import_backup:'+tripId,JSON.stringify(createTripUpdate(before)));
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
  const raw=localStorage.getItem('tr_import_backup:'+tripId);
  if(!raw)throw new Error('No import checkpoint for this trip yet.');
  const update=JSON.parse(raw),latest=getTrip(tripId);
  if(update.tripId!==tripId || update.payload?._sync?.version!==2)throw new Error('Invalid checkpoint.');
  const snapshot=materialize({...latest,_sync:update.payload._sync});
  // New compensating edits supersede current field heads. History remains intact.
  return saveTrip({...snapshot,_sync:latest._sync});
}
