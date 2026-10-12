import { COLLECTIONS, ensureSync, mergeSync, validateOps } from './tripSync';
import { collectMediaRefsFromTrip } from './mediaRefs';
import { getMediaRecord, putMediaBatch } from './mediaStore';
const LIMIT = 100 * 1024 * 1024;
const MIME = 'application/json';

export function createTripUpdate(trip, sourceUserId) {
  const synced=ensureSync(trip);
  return {schemaVersion:2,app:'TripReport',kind:'trip-update',tripId:trip.id,tripName:trip.name,
    sourceUserId:sourceUserId || null,exportedAt:Date.now(),
    payload:{trip:{id:trip.id,name:trip.name},_sync:{version:2,ops:synced._sync.ops}},media:[],missingMedia:[]};
}
export async function sha256(blob) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function encode(blob) {
  const bytes=new Uint8Array(await blob.arrayBuffer());
  let raw='';
  for(let i=0;i<bytes.length;i+=16384) raw+=String.fromCharCode(...bytes.subarray(i,i+16384));
  return {mimeType:blob.type || 'application/octet-stream',size:blob.size,sha256:await sha256(blob),base64:btoa(raw)};
}
async function decode(part) {
  if (!part || !Number.isInteger(part.size) || part.size<0 || part.size>LIMIT ||
      typeof part.base64!=='string' || part.base64.length>LIMIT*1.4 || !/^[a-f0-9]{64}$/.test(part.sha256)) throw new Error('Invalid attachment.');
  let raw;
  try {raw=atob(part.base64);} catch {throw new Error('Invalid attachment encoding.');}
  const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
  const blob=new Blob([bytes],{type:part.mimeType});
  if(blob.size!==part.size || await sha256(blob)!==part.sha256) throw new Error('Attachment checksum failed. Ask for a fresh file.');
  return blob;
}
export async function prepareTripUpdateFile(trip,sourceUserId,{includeMedia=true}={}) {
  const update=createTripUpdate(trip,sourceUserId);
  let bytes=JSON.stringify(update).length;
  for(const ref of collectMediaRefsFromTrip(trip)) {
    const record=includeMedia ? await getMediaRecord(ref.id) : null;
    if(!record?.fullBlob) {update.missingMedia.push(ref.id);continue;}
    bytes+=(record.fullBlob.size+(record.thumbBlob?.size||0))*1.4;
    if(bytes>LIMIT) throw new Error('This package exceeds 100 MB. Export changes only, or sync attachments online.');
    update.media.push({id:record.id,full:await encode(record.fullBlob),thumb:record.thumbBlob?await encode(record.thumbBlob):null});
  }
  const filename=String(trip.name||'trip').replace(/[^a-z0-9]+/gi,'-')+'-'+Date.now()+'.tripreport.json';
  const file=new File([JSON.stringify(update)],filename,{type:MIME});
  if(file.size>LIMIT) throw new Error('This package exceeds 100 MB.');
  return {update,file,filename};
}
export function downloadTripFile(file,filename=file.name) {
  const url=URL.createObjectURL(file),a=document.createElement('a');
  a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
export async function sharePreparedUpdate(prepared) {
  if(navigator.canShare?.({files:[prepared.file]})) {
    await navigator.share({title:'TripReport offline update',files:[prepared.file]});
    return 'shared';
  }
  downloadTripFile(prepared.file,prepared.filename);return 'downloaded';
}
export async function exportTripUpdateFile(trip,sourceUserId) {
  const prepared=await prepareTripUpdateFile(trip,sourceUserId);
  downloadTripFile(prepared.file,prepared.filename);
  return {...prepared,delivery:'downloaded'};
}
function validate(update) {
  if(update?.app!=='TripReport'||update.kind!=='trip-update'||![1,2].includes(update.schemaVersion)||
    typeof update.tripId!=='string'||!update.payload) throw new Error('Unsupported TripReport update.');
  for(const c of COLLECTIONS) if(update.payload[c]!==undefined && !Array.isArray(update.payload[c])) throw new Error('Invalid trip collection.');
  if(update.schemaVersion===2) {
    if(update.payload._sync?.version!==2)throw new Error('Invalid change history version.');
    validateOps(update.payload._sync.ops,update.tripId);
  }
  if(update.media!==undefined && (!Array.isArray(update.media)||update.media.length>10000)) throw new Error('Invalid attachments.');
}
export async function readTripUpdateFile(file) {
  if(!file || file.size>LIMIT) throw new Error('Choose a TripReport package smaller than 100 MB.');
  let update;try{update=JSON.parse(await file.text());}catch{throw new Error('That file is not valid JSON.');}
  validate(update);
  // Validate every byte before preview or local writes.
  const records=[],seen=new Set();
  for(const item of update.media||[]) {
    if(typeof item.id!=='string'||seen.has(item.id)) throw new Error('Invalid or duplicate attachment ID.');
    seen.add(item.id);
    records.push({id:item.id,tripId:update.tripId,fullBlob:await decode(item.full),
      thumbBlob:item.thumb?await decode(item.thumb):null,mimeType:item.full.mimeType,
      byteSize:item.full.size,createdAt:Date.now(),syncState:'pending'});
  }
  Object.defineProperty(update,'mediaRecords',{value:records,enumerable:false});
  return update;
}
export function mergeRemotePayloadIntoTrip(local,payload) {
  const remote={id:local.id,...payload.trip,...Object.fromEntries(COLLECTIONS.map(c=>[c,payload[c]||[]])),
    ...(payload._sync?{_sync:payload._sync}:{})};
  const merged=mergeSync(local,remote), summary={added:0,updated:0,ignored:0,localOnlyCount:0,byCollection:{}};
  for(const c of COLLECTIONS) {
    const old=new Map((local[c]||[]).map(r=>[r.id,r]));
    const added=merged[c].filter(r=>!old.has(r.id)).length;
    const updated=merged[c].filter(r=>old.has(r.id)&&JSON.stringify(old.get(r.id))!==JSON.stringify(r)).length;
    summary.byCollection[c]={added,updated};summary.added+=added;summary.updated+=updated;
  }
  summary.conflicts=merged._sync.conflicts.length;
  summary.newChanges=merged._sync.ops.length-ensureSync(local)._sync.ops.length;
  return {trip:merged,summary};
}
export function mergeTripUpdate(local,update) {
  validate(update);
  if(local?.id!==update.tripId) throw new Error('Open the matching trip before importing this package.');
  return mergeRemotePayloadIntoTrip(local,update.payload);
}
export async function storeUpdateMedia(update) {
  const missing=[];
  for(const record of update.mediaRecords||[]) {
    const existing=await getMediaRecord(record.id);
    if(existing) {
      if(existing.tripId!==record.tripId || await sha256(existing.fullBlob)!==await sha256(record.fullBlob))
        throw new Error('An attachment ID already has different contents. Nothing was imported.');
    } else missing.push(record);
  }
  // One IndexedDB transaction; failure cannot leave half an attachment batch.
  await putMediaBatch(missing);
}
export function formatMergeSummary(summary) {
  return summary.newChanges ? 'Merged '+summary.newChanges+' changes. '+summary.conflicts+' conflicts need review.' : 'No new changes in this package.';
}
