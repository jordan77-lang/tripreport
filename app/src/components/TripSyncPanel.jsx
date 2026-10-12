import { importTripPackage, restoreTripCheckpoint } from '../lib/importTripPackage';
import { useRef, useState } from 'react';
import { getTrip, saveTrip, getCurrentUserId } from '../lib/storage';
import { ensureSync, materialize, resolveConflict } from '../lib/tripSync';
import { prepareTripUpdateFile, sharePreparedUpdate, downloadTripFile, readTripUpdateFile, mergeTripUpdate, formatMergeSummary } from '../lib/offlineExchange';
import { combineLocations, duplicateLocations } from '../lib/tripTimeline';
import { pushTripToCloud } from '../lib/tripCloud';
import { supabaseConfigured } from '../lib/supabase';
import { T } from '../tokens';

export function TripSyncPanel({trip,onTripUpdate}) {
  const [prepared,setPrepared]=useState(null),[preview,setPreview]=useState(null);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [includeMedia,setIncludeMedia]=useState(true);
  const fileRef=useRef(null);
  const synced=materialize(ensureSync(trip));
  const acked=new Set(synced._sync.acked||[]);
  const pending=synced._sync.ops.filter(o=>!acked.has(o.id)).length;
  const conflicts=synced._sync.conflicts||[];
  const candidates=duplicateLocations(trip);
  const deleted=synced._sync.ops.filter(o=>o.field==='$deleted'&&o.value===true &&
    !synced._sync.ops.some(n=>n.parents.includes(o.id)));
  async function action(fn) {
    setBusy(true);setMessage('');
    try{await fn();}catch(e){setMessage(e.message||'Could not complete that action.');}
    finally{setBusy(false);}
  }
  const refresh=()=>{setPrepared(null);onTripUpdate?.();};
  async function importFile(file) {
    if(!file)return;
    const update=await readTripUpdateFile(file),latest=getTrip(trip.id);
    const result=mergeTripUpdate(latest,update);
    setPreview({update,summary:result.summary});
  }
  async function confirmImport() {
    const result=await importTripPackage(trip.id,preview.update);
    setPreview(null);setMessage(formatMergeSummary(result.summary));refresh();
  }
  function choose(conflict,value) {
    saveTrip(resolveConflict(getTrip(trip.id),conflict.key,value,getCurrentUserId()),{capture:false,schedule:true});
    refresh();
  }
  return <section aria-label="Trip sync and offline exchange" style={{padding:16,margin:'12px 0',background:T.surface||'#fff',border:'1px solid #cbd5df',borderRadius:12}}>
    <h3 style={{marginTop:0}}>Sync &amp; offline sharing</h3>
    <p>{pending ? pending+' changes saved on this device, waiting for cloud sync.' : synced._sync.lastCloudSync ? 'All known changes are saved to the cloud.' : 'Saved on this device.'}
      {' '}{conflicts.length} conflicts to review.
      {synced._sync.mediaPending>0 && ' '+synced._sync.mediaPending+' attachments waiting.'}</p>
    {synced._sync.mediaError && <p role="status">{synced._sync.mediaError}</p>}
    <p style={{fontSize:13}}>Other phones may still have unshared updates. Exchange files during the trip and reconnect everyone before making the final report. Join the same trip online before leaving.</p>
    {synced._sync.lastCloudSync && <p style={{fontSize:13}}>Last successful data sync: {new Date(synced._sync.lastCloudSync).toLocaleString()}</p>}
    <label>Trip time zone <input aria-label="Trip time zone" defaultValue={trip.timeZone||'UTC'} key={trip.timeZone||'UTC'}
      onBlur={e=>{try{new Intl.DateTimeFormat('en',{timeZone:e.target.value});saveTrip({...getTrip(trip.id),timeZone:e.target.value});refresh();}catch{setMessage('Use a time zone such as America/Phoenix.');}}}/></label>
    <div style={{display:'flex',gap:8,flexWrap:'wrap',margin:'12px 0'}}>
      {supabaseConfigured && <button disabled={busy} onClick={()=>action(async()=>{const result=await pushTripToCloud(getTrip(trip.id));refresh();setMessage(result.readOnly?'Downloaded updates. Viewer access cannot upload local changes.':'Synced changes and attachments.');})}>Sync now</button>}
      <button disabled={busy} onClick={()=>fileRef.current?.click()}>Import a trip file</button>
      <button disabled={busy} onClick={()=>action(async()=>{setPrepared(await prepareTripUpdateFile(getTrip(trip.id),getCurrentUserId(),{includeMedia}));})}>Prepare a sharing file</button>
    </div>
    <label><input type="checkbox" checked={includeMedia} onChange={e=>setIncludeMedia(e.target.checked)}/> Include photos and voice recordings (up to 100 MB)</label>
    <input ref={fileRef} hidden type="file" accept=".json,.tripreport,application/json" onChange={e=>{const f=e.target.files?.[0];e.target.value='';void action(()=>importFile(f));}}/>
    {prepared && <div>
      <p>Ready: {(prepared.file.size/1048576).toFixed(1)} MB, {prepared.update.media.length} attachments.
        {prepared.update.missingMedia.length>0 && ' '+prepared.update.missingMedia.length+' attachments are not included; get them from another phone or the cloud.'}</p>
      <button disabled={busy} onClick={()=>action(async()=>{await sharePreparedUpdate(prepared);setMessage('Sharing file ready.');})}>Share file</button>{' '}
      <button onClick={()=>downloadTripFile(prepared.file)}>Download file</button>
    </div>}
    {preview && <div style={{border:'1px solid #a8b8c8',padding:12,marginTop:12}}>
      <h4>Review import: {preview.update.tripName}</h4>
      <p>{preview.summary.newChanges} new changes · {preview.update.mediaRecords.length} attachments · {preview.summary.conflicts} conflicts after merging</p>
      {preview.update.schemaVersion===1 && <p>Older format: photo files and deletion history may be missing.</p>}
      <p>This combines contributions with your saved trip. Conflicting versions remain available below.</p>
      <button disabled={busy} onClick={()=>action(confirmImport)}>Merge into this trip</button>{' '}
      <button disabled={busy} onClick={()=>setPreview(null)}>Cancel</button>
    </div>}
    <p><button onClick={()=>action(async()=>{
      const raw=localStorage.getItem('tr_import_backup:'+trip.id);
      if(!raw)throw new Error('No import checkpoint for this trip yet.');
      downloadTripFile(new Blob([raw],{type:'application/json'}),'trip-before-import.json');
    })}>Download pre-import checkpoint</button></p>
    <details><summary>Restore the last pre-import checkpoint</summary>
      <p>Restoring returns the shared trip contents to the saved checkpoint, including removing later additions. It creates new changes that will sync to other participants; history remains available.</p>
      <button disabled={busy} onClick={()=>action(()=>{
        if(!window.confirm('Restore the shared trip to its last pre-import contents? Later additions will be removed from the timeline.'))return;
        restoreTripCheckpoint(trip.id);refresh();setMessage('Checkpoint restored as new changes.');
      })}>Restore checkpoint contents</button>
    </details>
    {conflicts.map(c=><details key={c.key}>
      <summary>Review {c.collection} · {c.field} ({c.choices.length} versions)</summary>
      {c.choices.map(choice=><div key={choice.id} style={{padding:8,borderBottom:'1px solid #ddd'}}>
        <p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{typeof choice.value==='string'?choice.value:JSON.stringify(choice.value)}</p>
        <small>Contributor: {trip.memberProfiles?.[choice.authorId]||choice.authorId||'Older record'} · {choice.at?new Date(choice.at).toLocaleString():'Original snapshot'}</small>
        <p><button onClick={()=>action(()=>choose(c,choice.value))}>Keep this version</button></p>
      </div>)}
    </details>)}
    {deleted.length>0 && <details><summary>Recover deleted records ({deleted.length})</summary>
      <p>History is retained. Restore a location before restoring its events or notes.</p>
      {deleted.map(o=><p key={o.id}>{o.collection}: {o.recordId}{' '}<button onClick={()=>action(()=>{
        choose({key:JSON.stringify([o.collection,o.recordId,o.field])},false);
      })}>Restore</button></p>)}
    </details>}
    {candidates.length>0 && <details><summary>Possible duplicate places ({candidates.length})</summary>
      <p>These places share a name and are within approximately 110 metres. Combine only if they represent the same place. Separate visits stay as separate events.</p>
      {candidates.map(([a,b])=><p key={a.id+b.id}>{a.name} ({a.lat}, {a.lng}) / {b.name} ({b.lat}, {b.lng}){' '}
        <button onClick={()=>action(()=>{saveTrip(combineLocations(getTrip(trip.id),a.id,b.id));refresh();})}>Combine these places</button></p>)}
    </details>}
    <p role="status" aria-live="polite">{busy?'Working…':message}</p>
  </section>;
}
