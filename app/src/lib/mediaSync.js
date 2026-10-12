// Immutable attachments; checksums, not byte counts, identify their contents.
import { requireSupabase, supabaseConfigured } from './supabase';
import { getSignedInUserId } from './authUser';
import { getMediaRecord, listMediaForTrip, putMediaRecord } from './mediaStore';
import { sha256 } from './offlineExchange';
import { collectMediaRefsFromTrip } from './mediaRefs';
import { getTrip } from './storage';
export const MEDIA_BUCKET='trip-media';
export const localFullByteSize=r=>r?.fullBlob?.size||r?.fullByteSize||0;
export const localThumbByteSize=r=>r?.thumbBlob?.size||r?.thumbByteSize||0;
export const mediaHasLocalBlobs=r=>Boolean(r?.fullBlob);
export const cloudMatchesLocal=(cloud,local)=>Boolean(cloud?.sha256 && local?.sha256===cloud.sha256);
export const shouldUploadToCloud=(local,cloud)=>mediaHasLocalBlobs(local)&&!cloudMatchesLocal(cloud,local);
export const shouldDownloadFromCloud=(cloud,local)=>Boolean(cloud?.id)&&!cloudMatchesLocal(cloud,local);
export async function uploadMediaToCloud(record,{cloudRow=null}={}) {
  if(!supabaseConfigured||!getSignedInUserId()||!record?.fullBlob) return {ok:false};
  const supabase=requireSupabase(), hash=await sha256(record.fullBlob);
  const thumbHash=record.thumbBlob?await sha256(record.thumbBlob):null;
  if(cloudRow) {
    let remoteHash=cloudRow.sha256;
    if(!remoteHash) {
      const {data,error}=await supabase.storage.from(MEDIA_BUCKET).download(cloudRow.storage_path);
      if(error)throw error;
      remoteHash=await sha256(data);
    }
    if(remoteHash!==hash)throw new Error('Attachment contents conflict: '+record.id+'. Original bytes were preserved.');
    await putMediaRecord({...record,sha256:hash,syncState:'synced',storagePath:cloudRow.storage_path});
    return {ok:true,skipped:true,path:cloudRow.storage_path};
  }
  const path=record.tripId+'/'+record.id+'/'+hash;
  async function uploadImmutable(key,blob) {
    const {error}=await supabase.storage.from(MEDIA_BUCKET).upload(key,blob,{upsert:false,contentType:blob.type||record.mime||'application/octet-stream'});
    if(error) {
      // A retry or another phone may have uploaded first. Verify before accepting it.
      const {data,error:readError}=await supabase.storage.from(MEDIA_BUCKET).download(key);
      if(readError||await sha256(data)!==await sha256(blob))throw error;
    }
  }
  await uploadImmutable(path,record.fullBlob);
  if(record.thumbBlob)await uploadImmutable(path+'-thumb',record.thumbBlob);
  const metadata={id:record.id,trip_id:record.tripId,uploaded_by:getSignedInUserId(),storage_path:path,
    mime_type:record.fullBlob.type||record.mime,byte_size:record.fullBlob.size,sha256:hash,thumb_sha256:thumbHash};
  const {error}=await supabase.from('media_objects').insert(metadata);
  if(error) {
    const {data:other,error:readError}=await supabase.from('media_objects').select('sha256,trip_id,storage_path').eq('id',record.id).single();
    if(readError || other.sha256!==hash || other.trip_id!==record.tripId || other.storage_path!==path)throw error;
  }
  await putMediaRecord({...record,sha256:hash,syncState:'synced',storagePath:path});
  return {ok:true,skipped:false,path};
}
export async function downloadMediaFromCloud(meta) {
  const supabase=requireSupabase(),existing=await getMediaRecord(meta.id);
  if(existing?.tripId && existing.tripId!==meta.trip_id)throw new Error('Attachment belongs to another trip.');
  const {data:full,error}=await supabase.storage.from(MEDIA_BUCKET).download(meta.storage_path);
  if(error)throw error;
  const hash=await sha256(full);
  if(meta.sha256 && hash!==meta.sha256)throw new Error('Downloaded attachment failed its checksum.');
  if(existing?.fullBlob && await sha256(existing.fullBlob)!==hash)throw new Error('Attachment contents conflict. Local bytes were preserved.');
  const {data:thumb}=await supabase.storage.from(MEDIA_BUCKET).download(meta.storage_path+'-thumb');
  if(meta.thumb_sha256 && (!thumb || await sha256(thumb)!==meta.thumb_sha256))throw new Error('Downloaded thumbnail failed its checksum.');
  const record={...existing,id:meta.id,tripId:meta.trip_id,fullBlob:full,thumbBlob:thumb||existing?.thumbBlob||null,
    mime:meta.mime_type,sha256:hash,size:full.size,fullByteSize:full.size,syncState:'synced',storagePath:meta.storage_path,
    createdAt:existing?.createdAt||Date.parse(meta.created_at)||Date.now()};
  await putMediaRecord(record);
  return {record,skipped:false};
}
export async function listCloudMediaForTrip(tripId) {
  const supabase=requireSupabase(),rows=[];
  for(let offset=0;;offset+=500) {
    const {data,error}=await supabase.from('media_objects').select('id,trip_id,storage_path,mime_type,byte_size,sha256,thumb_sha256,created_at')
      .eq('trip_id',tripId).order('id').range(offset,offset+499);
    if(error)throw error;
    rows.push(...data);if(data.length<500)return rows;
  }
}
export async function syncTripMedia(tripId,{readOnly=false}={}) {
  if(!supabaseConfigured)return {skipped:'not-configured'};
  const cloudRows=await listCloudMediaForTrip(tripId),cloud=new Map(cloudRows.map(r=>[r.id,r]));
  const local=new Map((await listMediaForTrip(tripId)).map(r=>[r.id,r]));
  let uploaded=0,downloaded=0;
  const errors=[];
  for(const ref of collectMediaRefsFromTrip(getTrip(tripId))) {
    const record=local.get(ref.id),row=cloud.get(ref.id);
    try {
      if(readOnly) {
        if(row && (!record?.fullBlob || !cloudMatchesLocal(row,record))) {await downloadMediaFromCloud(row);downloaded++;}
      } else if(record?.fullBlob) {
        const result=await uploadMediaToCloud(record,{cloudRow:row});
        if(!result.ok)throw new Error('Attachment upload is unavailable.');
        if(!result.skipped)uploaded++;
      } else if(row) {await downloadMediaFromCloud(row);downloaded++;}
      else throw new Error('Attachment '+ref.id+' has not been shared yet.');
    } catch(e) {errors.push(e.message);}
  }
  if(errors.length)throw new Error(errors.length+' attachment(s) need attention. '+errors[0]);
  return {uploaded,downloaded};
}
