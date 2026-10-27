import { importTripPackage, restoreTripCheckpoint, getTripCheckpointRaw } from '../lib/importTripPackage';
import { useRef, useState } from 'react';
import { getTrip, saveTrip, getCurrentUserId } from '../lib/storage';
import { ensureSync, materialize, resolveConflict, describeSyncRecord, describeDeletedRecords, restoreDeletedRecord } from '../lib/tripSync';
import { prepareTripUpdateFile, sharePreparedUpdate, downloadTripFile, readTripUpdateFile, mergeTripUpdate, formatMergeSummary } from '../lib/offlineExchange';
import { suggestImportPlacements, tripTimeZone } from '../lib/tripTimeline';
import { pushTripToCloud } from '../lib/tripCloud';
import { supabaseConfigured } from '../lib/supabase';
import { T, F } from '../tokens';
import { ts } from '../lib/textScale';

export function TripSyncPanel({trip,onTripUpdate}) {
  const [prepared,setPrepared]=useState(null),[preview,setPreview]=useState(null);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [includeMedia,setIncludeMedia]=useState(true);
  const [onlyUnsyncedMedia,setOnlyUnsyncedMedia]=useState(false);
  const fileRef=useRef(null);
  const synced=materialize(ensureSync(trip));
  const acked=new Set(synced._sync.acked||[]);
  const pending=synced._sync.ops.filter(o=>!acked.has(o.id)).length;
  const conflicts=synced._sync.conflicts||[];
  const deleted=describeDeletedRecords(synced);
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
    setPreview({update,summary:result.summary,placement:suggestImportPlacements(latest,result.trip)});
  }
  function updatePlaceChoice(incomingId, patch) {
    setPreview((current) => ({
      ...current,
      placement: {
        ...current.placement,
        places: current.placement.places.map((place) => place.incomingId === incomingId ? { ...place, ...patch } : place),
      },
    }));
  }
  function updateItemChoice(id, patchOrTargetId) {
    const patch = typeof patchOrTargetId === 'string'
      ? { targetId: patchOrTargetId, action: patchOrTargetId ? 'add' : 'keep' }
      : patchOrTargetId;
    setPreview((current) => ({
      ...current,
      placement: {
        ...current.placement,
        items: current.placement.items.map((item) => item.id === id ? { ...item, ...patch } : item),
      },
    }));
  }
  async function confirmImport() {
    const result=await importTripPackage(trip.id,preview.update,preview.placement);
    setPreview(null);setMessage(formatMergeSummary(result.summary));refresh();
  }
  function choose(conflict,value) {
    saveTrip(resolveConflict(getTrip(trip.id),conflict.key,value,getCurrentUserId()),{capture:false,schedule:true});
    refresh();
  }
  const statusLine = pending
    ? `${pending} ${pending === 1 ? 'change' : 'changes'} on this phone, waiting to sync.`
    : (synced._sync.lastCloudSync ? 'Saved on this phone and in the cloud.' : 'Saved on this phone.');

  return <section aria-label="Trip sync and offline exchange" style={cardStyle}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
      <div>
        <h3 style={titleStyle}>Sync &amp; offline sharing</h3>
        <p style={statusStyle}>{statusLine}</p>
        {synced._sync.lastCloudSync && <p style={quietStyle}>Last sync {formatSyncTime(synced._sync.lastCloudSync)}</p>}
      </div>
      {supabaseConfigured && <button type="button" disabled={busy} style={{ ...primaryBtn, width: 'auto', padding: '0 18px' }} onClick={()=>action(async()=>{const result=await pushTripToCloud(getTrip(trip.id));refresh();setMessage(result.readOnly?'Downloaded updates. Viewer access cannot upload local changes.':'Synced changes and attachments.');})}>Sync now</button>}
    </div>
    {conflicts.length > 0 && <p style={quietStyle}>{conflicts.length} {conflicts.length === 1 ? 'conflict' : 'conflicts'} to review.</p>}
    {synced._sync.mediaPending > 0 && <p style={quietStyle}>{synced._sync.mediaPending} attachments waiting.</p>}
    {synced._sync.mediaError && <p role="status" style={alertStyle}>{synced._sync.mediaError}</p>}

    <details style={{ marginTop: 10 }}>
      <summary style={summaryStyle}>Offline file sharing &amp; time zone</summary>
      <div style={{ marginTop: 10 }}>
        <label style={fieldLabelStyle}>Trip time zone
          <input aria-label="Trip time zone" defaultValue={tripTimeZone(trip)} key={tripTimeZone(trip)} style={inputStyle}
            onBlur={e=>{try{new Intl.DateTimeFormat('en',{timeZone:e.target.value});saveTrip({...getTrip(trip.id),timeZone:e.target.value});refresh();}catch{setMessage('Use a time zone such as America/Phoenix.');}}} />
        </label>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button type="button" disabled={busy} style={secondaryBtn} onClick={()=>action(async()=>{setPrepared(await prepareTripUpdateFile(getTrip(trip.id),getCurrentUserId(),{includeMedia,onlyUnsyncedMedia}));})}>Prepare a sharing file</button>
          <label style={checkStyle}><input type="checkbox" checked={includeMedia} onChange={e=>setIncludeMedia(e.target.checked)} /> Include photos and voice recordings (up to 100 MB)</label>
          {includeMedia && <label style={checkStyle}><input type="checkbox" checked={onlyUnsyncedMedia} onChange={e=>setOnlyUnsyncedMedia(e.target.checked)} /> Only include attachments not yet synced to cloud</label>}
          <button type="button" disabled={busy} style={secondaryBtn} onClick={()=>fileRef.current?.click()}>Import a trip file</button>
        </div>
      </div>
    </details>
    <input ref={fileRef} hidden type="file" accept=".json,.tripreport,application/json" onChange={e=>{const f=e.target.files?.[0];e.target.value='';void action(()=>importFile(f));}}/>

    {prepared && <div style={insetStyle}>
      <p style={{ ...quietStyle, marginTop: 0 }}>Ready: {(prepared.file.size/1048576).toFixed(1)} MB, {prepared.update.media.length} attachments.
        {prepared.update.missingMedia.length>0 && ' '+prepared.update.missingMedia.length+' attachments are not included; get them from another phone or the cloud.'}</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" disabled={busy} style={{ ...secondaryBtn, flex: 1 }} onClick={()=>action(async()=>{await sharePreparedUpdate(prepared);setMessage('Sharing file ready.');})}>Share file</button>
        <button type="button" style={{ ...secondaryBtn, flex: 1 }} onClick={()=>downloadTripFile(prepared.file)}>Download file</button>
      </div>
    </div>}

    {preview && <div style={insetStyle}>
      <h4 style={{ margin: '0 0 6px', fontSize: ts(15) }}>Review import: {preview.update.tripName}</h4>
      <p style={quietStyle}>{preview.summary.newChanges} new changes · {preview.update.mediaRecords.length} attachments · {preview.summary.conflicts} conflicts after merging</p>
      {preview.summary.socialDigest?.length > 0 && (
        <div style={{ margin: '8px 0', padding: '8px 10px', background: T.card, borderRadius: 9, border: `1px solid ${T.border}` }}>
          <div style={{ fontSize: ts(11), fontWeight: 800, color: T.accent, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
            What&apos;s new since last sync
          </div>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: ts(12), color: T.text, lineHeight: 1.45 }}>
            {preview.summary.socialDigest.slice(0, 8).map((line, i) => <li key={i}>{line}</li>)}
          </ul>
        </div>
      )}
      {preview.summary.localOnlyCount>0 && <p style={quietStyle}>This phone also has {preview.summary.localOnlyCount} {preview.summary.localOnlyCount===1?'change':'changes'} not in this file — share an updated file back after merging.</p>}
      {preview.update.schemaVersion===1 && <p style={quietStyle}>Older format: photo files and deletion history may be missing.</p>}
      <ImportPlacement
        placement={preview.placement}
        locations={trip.locations || []}
        onPlace={updatePlaceChoice}
        onItem={updateItemChoice}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" disabled={busy} style={{ ...primaryBtn, flex: 1 }} onClick={()=>action(confirmImport)}>Merge into this trip</button>
        <button type="button" disabled={busy} style={{ ...secondaryBtn, flex: 1 }} onClick={()=>setPreview(null)}>Cancel</button>
      </div>
    </div>}

    <details style={{ marginTop: 14 }}>
      <summary style={summaryStyle}>Backup</summary>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
        <button type="button" style={secondaryBtn} onClick={()=>action(async()=>{
          const raw=getTripCheckpointRaw(trip.id);
          if(!raw)throw new Error('No import checkpoint for this trip yet.');
          downloadTripFile(new Blob([raw],{type:'application/json'}),'trip-before-import.json');
        })}>Download pre-import checkpoint</button>
        <button type="button" disabled={busy} style={secondaryBtn} onClick={()=>action(()=>{
          if(!window.confirm('Restore the shared trip to its last pre-import contents? Later additions will be removed from the timeline.'))return;
          restoreTripCheckpoint(trip.id);refresh();setMessage('Checkpoint restored as new changes.');
        })}>Restore the last pre-import checkpoint</button>
      </div>
    </details>

    {conflicts.map(c=>{
      const desc=describeSyncRecord(synced,c.collection,c.recordId);
      const contextLabel=`${desc.kindLabel}: ${desc.label}${desc.parentLabel ? ` (${desc.parentLabel})` : ''}`;
      return <details key={c.key} style={{ marginTop: 8 }}>
        <summary style={summaryStyle}>Review {contextLabel} · {c.field} ({c.choices.length} versions)</summary>
        {c.choices.map(choice=><div key={choice.id} style={{ padding: '8px 0', borderBottom: `1px solid ${T.border}` }}>
          <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: '0 0 4px' }}>{typeof choice.value==='string'?choice.value:JSON.stringify(choice.value)}</p>
          <p style={quietStyle}>{trip.memberProfiles?.[choice.authorId]||choice.authorId||'Older record'} · {choice.at?new Date(choice.at).toLocaleString():'Original snapshot'}</p>
          <button type="button" style={secondaryBtn} onClick={()=>action(()=>choose(c,choice.value))}>Keep this version</button>
        </div>)}
      </details>;
    })}
    {deleted.length>0 && <details style={{ marginTop: 8 }}><summary style={summaryStyle}>Recover deleted records ({deleted.length})</summary>
      <p style={quietStyle}>Restoring an event or entry also restores its location if needed.</p>
      {deleted.map(item=><p key={item.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span><strong>{item.kindLabel}:</strong> {item.label}{item.parentLabel ? ` (at ${item.parentLabel})` : ''}</span>
        <button type="button" style={{ ...secondaryBtn, width: 'auto', padding: '8px 12px' }} onClick={()=>action(()=>{
          saveTrip(restoreDeletedRecord(getTrip(trip.id),item.collection,item.recordId,getCurrentUserId()),{capture:false,schedule:true});
          refresh();
        })}>Restore</button></p>)}
    </details>}
    <p role="status" aria-live="polite" style={{ ...quietStyle, minHeight: 18 }}>{busy?'Working…':message}</p>
  </section>;
}

const cardStyle = { padding: 16, margin: '12px 0', background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, fontFamily: F, color: T.text };
const titleStyle = { margin: '0 0 6px', fontSize: ts(16), fontWeight: 800 };
const statusStyle = { margin: '0 0 2px', fontSize: ts(14), lineHeight: 1.45 };
const quietStyle = { margin: '0 0 8px', fontSize: ts(12), color: T.textSub, lineHeight: 1.45 };
const alertStyle = { margin: '0 0 8px', fontSize: ts(13), color: '#8A1414' };
const fieldLabelStyle = { display: 'flex', flexDirection: 'column', gap: 6, margin: '12px 0', fontSize: ts(12), fontWeight: 700, color: T.textSub };
const inputStyle = { width: '100%', boxSizing: 'border-box', minHeight: 44, border: `1px solid ${T.border}`, borderRadius: 10, padding: '8px 12px', fontSize: ts(14), fontFamily: F, color: T.text, background: T.bg };
const primaryBtn = { width: '100%', minHeight: 44, border: 'none', borderRadius: 12, background: T.accent, color: 'white', fontSize: ts(14), fontWeight: 800, fontFamily: F, cursor: 'pointer' };
const secondaryBtn = { width: '100%', minHeight: 44, border: `1px solid ${T.border}`, borderRadius: 12, background: T.bg, color: T.text, fontSize: ts(14), fontWeight: 700, fontFamily: F, cursor: 'pointer' };
const checkStyle = { display: 'flex', alignItems: 'center', gap: 8, fontSize: ts(13), color: T.textSub, lineHeight: 1.4 };
const summaryStyle = { cursor: 'pointer', fontSize: ts(13), fontWeight: 700, color: T.textSub };
const insetStyle = { border: `1px solid ${T.border}`, borderRadius: 12, padding: 12, marginTop: 12, background: T.bg };

function formatSyncTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function ImportPlacement({ placement, locations, onPlace, onItem }) {
  const places = placement?.places || [];
  const items = placement?.items || [];
  if (!places.length && !items.length) return null;
  return (
    <div style={{ margin: '12px 0' }}>
      <p style={{ marginBottom: 8 }}>New stops and events near a saved location can be added to it so your crew does not double up on pins for the same place.</p>
      {places.map((place) => (
        <div key={place.incomingId} style={{ border: '1px solid #d5dee6', borderRadius: 10, padding: 10, marginBottom: 8 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{place.name}</div>
          <p style={{ margin: '0 0 6px', fontSize: 13 }}>
            {place.nearestName
              ? `Nearest saved place is ${place.nearestName}${place.distanceMeters != null ? ` (${place.distanceMeters} m away)` : ''}. Their events will be added there unless you choose otherwise.`
              : 'No saved place is within 200 m, so this stays its own stop unless you add it to one.'}
          </p>
          {place.events?.length > 0 && (
            <p style={{ margin: '0 0 8px', fontSize: 12, color: T.textSub }}>
              Events at this stop: {place.events.map((e) => e.name).join(', ')}
            </p>
          )}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {[['add', 'Add events to place'], ['merge', 'Merge places'], ['keep', 'Keep separate']].map(([action, label]) => (
              <button key={action} type="button" onClick={() => onPlace(place.incomingId, {
                action,
                targetId: action === 'keep' ? null : (place.targetId || place.nearestId || locations[0]?.id || null),
              })} style={{ ...secondaryBtn, width: 'auto', padding: '8px 12px', flex: '1 1 120px', background: place.action === action ? T.accent : T.bg, color: place.action === action ? 'white' : T.text }}>
                {label}
              </button>
            ))}
          </div>
          {place.action !== 'keep' && (
            <label style={{ fontSize: 13 }}>
              Place{' '}
              <select value={place.targetId || ''} onChange={(e) => onPlace(place.incomingId, { targetId: e.target.value })}>
                {locations.map((loc) => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
              </select>
            </label>
          )}
        </div>
      ))}
      {items.map((item) => {
        const activeAction = item.action || (item.targetId ? 'add' : 'keep');
        return (
          <div key={item.kind + item.id} style={{ border: '1px solid #d5dee6', borderRadius: 10, padding: 10, marginBottom: 8 }}>
            <div style={{ fontWeight: 700 }}>{item.name}</div>
            <p style={{ margin: '4px 0 8px', fontSize: 13 }}>
              Happened {item.distanceMeters != null ? `${item.distanceMeters} m from ` : 'near '}
              <strong>{item.nearestName}</strong>. Add this event to {item.nearestName}?
            </p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              <button
                type="button"
                onClick={() => onItem(item.id, { action: 'add', targetId: item.targetId || item.nearestId || locations[0]?.id || null })}
                style={{ ...secondaryBtn, width: 'auto', padding: '8px 12px', flex: '1 1 140px', background: activeAction === 'add' ? T.accent : T.bg, color: activeAction === 'add' ? 'white' : T.text }}
              >
                Add to a location
              </button>
              <button
                type="button"
                onClick={() => onItem(item.id, { action: 'keep', targetId: null })}
                style={{ ...secondaryBtn, width: 'auto', padding: '8px 12px', flex: '1 1 140px', background: activeAction === 'keep' ? T.accent : T.bg, color: activeAction === 'keep' ? 'white' : T.text }}
              >
                Keep separate
              </button>
            </div>
            {activeAction !== 'keep' && (
              <label style={{ fontSize: 13 }}>
                Location{' '}
                <select value={item.targetId || ''} onChange={(e) => onItem(item.id, { action: 'add', targetId: e.target.value })}>
                  {locations.map((loc) => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
                </select>
              </label>
            )}
          </div>
        );
      })}
    </div>
  );
}
