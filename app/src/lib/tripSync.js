// Immutable field changes shared by cloud sync and offline packages.
export const COLLECTIONS = ['locations','events','entries','track','trackSessions','collaborators','gearItems','meals','expenses','expenseGroups','shoppingItems'];
const TRIP_FIELDS = ['name','types','location','startDate','endDate','privacy','status','startedAt','endedAt','coverPhoto','mapArea','offlineRegions','recap','timeZone'];
const MEDIA = ['photos','photoFiles','voiceFiles'];
const OMIT = new Set(['syncState','updatedAt','orphanedLocationId','orphanedEventId','ownerDeletedAt','claimingOwnership']);
const unsafe = k => ['__proto__','constructor','prototype'].includes(k);
export function canonical(value) {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k)+':'+canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([k]) => !OMIT.has(k) && !unsafe(k)).map(([k,v]) => [k,clean(v)]));
}
// Compact deterministic migration IDs. An ID collision is rejected by unionOps.
function seedId(key,value) {
  const text=canonical([key,value]),h=[2166136261,2246822519,3266489917,668265263];
  for(let i=0;i<text.length;i++)for(let j=0;j<4;j++)h[j]=Math.imul(h[j]^text.charCodeAt(i),16777619+j*2)>>>0;
  return 'seed:'+h.map(n=>n.toString(16).padStart(8,'0')).join('');
}
const keyOf = op => canonical([op.collection,op.recordId,op.field]);
const cmpOp = (a,b) => ((Number(a.at)||0) - (Number(b.at)||0)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const KIND_LABELS = {
  trip:'Trip', locations:'Location', events:'Event', entries:'Entry', track:'Track point',
  trackSessions:'Route leg', collaborators:'Crew member', gearItems:'Gear item',
  meals:'Meal', expenses:'Expense', expenseGroups:'Expense group', shoppingItems:'Shopping item',
};
function records(trip) {
  const out = new Map();
  const add = (collection,id,field,value) => out.set(canonical([collection,id,field]), {collection,recordId:id,field,value:clean(value)});
  for (const f of TRIP_FIELDS) if (trip[f] !== undefined) add('trip',trip.id,f,trip[f]);
  for (const c of COLLECTIONS) for (const row of trip[c] || []) {
    const id = String(row.id || (c==='track' ? canonical([row.sessionId||row.authorId,row.ts,row.lat,row.lng]) : canonical(row)));
    add(c,id,'$deleted',false);
    if(c==='track') {add(c,id,'$record',row);continue;}
    for (const [f,v] of Object.entries(row)) {
      if (f === 'id' || OMIT.has(f) || unsafe(f) || (c==='trackSessions' && f==='pointsCount')) continue;
      if (MEDIA.includes(f)) {
        for (const ref of v || []) if (ref && typeof ref === 'object') add(c,id,f + '/' + (ref.id || seedId(f,ref)),ref);
      } else add(c,id,f,v);
    }
  }
  return out;
}
export function validateOps(ops, tripId) {
  if (!Array.isArray(ops) || ops.length > 150000) throw new Error('Invalid or oversized change history.');
  const ids = new Map();
  for (const o of ops) {
    if (!o || typeof o.id !== 'string' || o.id.length > 2000000 ||
      !['trip',...COLLECTIONS].includes(o.collection) || typeof o.recordId !== 'string' ||
      typeof o.field !== 'string' || unsafe(o.field) || o.field === 'id' || o.field.length > 500 ||
      !Array.isArray(o.parents) || o.parents.some(p=>typeof p !== 'string') ||
      (o.collection === 'trip' && (o.recordId !== tripId || !TRIP_FIELDS.includes(o.field))) ||
      (o.field.includes('/') && !MEDIA.includes(o.field.split('/')[0])) ||
      (o.field === '$deleted' && typeof o.value !== 'boolean') ||
      (o.field === '$record' && (o.collection!=='track' || !o.value || typeof o.value!=='object' || Array.isArray(o.value)))) throw new Error('Invalid trip change.');
    if (ids.has(o.id) && canonical(ids.get(o.id)) !== canonical(o)) throw new Error('A change ID has conflicting contents.');
    ids.set(o.id,o);
  }
  const remaining=new Map(),children=new Map(),ready=[];
  for(const o of ids.values()) {
    const parents=[...new Set(o.parents)];remaining.set(o.id,parents.length);
    if(!parents.length)ready.push(o.id);
    for(const p of parents) {
      if(!ids.has(p)||p===o.id||keyOf(ids.get(p))!==keyOf(o))throw new Error('Invalid change ancestry.');
      if(!children.has(p))children.set(p,[]);children.get(p).push(o.id);
    }
  }
  let visited=0;
  for(let i=0;i<ready.length;i++) {
    visited++;
    for(const child of children.get(ready[i])||[]) {remaining.set(child,remaining.get(child)-1);if(!remaining.get(child))ready.push(child);}
  }
  if(visited!==ids.size)throw new Error('Cyclic change history.');
}
const validatedOps = new WeakMap();
export function ensureSync(trip) {
  if (trip._sync?.version === 2) {
    if (validatedOps.get(trip._sync.ops) !== trip.id) {
      validateOps(trip._sync.ops,trip.id);
      validatedOps.set(trip._sync.ops,trip.id);
    }
    return trip;
  }
  const ops = [...records(trip)].map(([key,r])=>({...r,id:seedId(key,r.value),parents:[],authorId:trip.ownerId || null,at:0}));
  validatedOps.set(ops,trip.id);
  return {...trip,_sync:{version:2,ops,acked:[],conflicts:[]}};
}
function heads(ops) {
  const superseded = new Set(ops.flatMap(o=>o.parents));
  const map = new Map();
  for (const o of ops) if (!superseded.has(o.id)) {
    const k=keyOf(o); if (!map.has(k)) map.set(k,[]);
    map.get(k).push(o);
  }
  for (const list of map.values()) list.sort(cmpOp);
  return map;
}
export function unionOps(a,b) {
  const map = new Map(a.map(o=>[o.id,o]));
  for (const o of b) {
    if (map.has(o.id) && canonical(map.get(o.id)) !== canonical(o)) throw new Error('A change ID has conflicting contents.');
    map.set(o.id,o);
  }
  return [...map.values()].sort((x,y)=>x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
}
export function materialize(trip) {
  const synced=ensureSync(trip), ops=synced._sync.ops;
  const result={...synced}, rows=new Map(), conflicts=[];
  for (const c of COLLECTIONS) result[c]=[];
  for (const [key,list] of heads(ops)) {
    const winner=list[list.length-1], {collection,recordId,field}=winner;
    const distinct=new Set(list.map(o=>canonical(o.value)));
    if (distinct.size > 1) conflicts.push({key,collection,recordId,field,choices:list});
    const rowKey=canonical([collection,recordId]);
    if (!rows.has(rowKey)) rows.set(rowKey,{collection,row:{id:recordId}});
    const target=collection==='trip' ? result : rows.get(rowKey).row;
    if(field==='$record') {Object.assign(target,clean(winner.value),{id:recordId});}
    else if (field.includes('/')) {
      const group=field.split('/')[0];
      target[group] ||= [];
      if (winner.value != null) target[group].push(winner.value);
    } else target[field]=winner.value;
  }
  for (const {collection,row} of rows.values()) if (collection!=='trip' && !row.$deleted) {
    delete row.$deleted; result[collection].push(row);
  }
  const counts=new Map();
  for(const p of result.track)counts.set(p.sessionId,(counts.get(p.sessionId)||0)+1);
  result.trackSessions=result.trackSessions.map(s=>({...s,pointsCount:counts.get(s.id)||0}));
  const locs=new Map(result.locations.map(l=>[l.id,l]));
  result.events=result.events.filter(e=>!e.locationId || locs.has(e.locationId));
  const events=new Map(result.events.map(e=>[e.id,e]));
  result.entries=result.entries.map(e=>{
    const hasLoc=!e.locationId || locs.has(e.locationId);
    const hasEvt=!e.eventId || events.has(e.eventId);
    if (hasLoc && hasEvt) return e;
    const next={...e};
    if (!hasLoc) { next.orphanedLocationId=next.locationId; next.locationId=null; delete next.locationName; delete next.locationType; }
    if (!hasEvt) { next.orphanedEventId=next.eventId; delete next.eventId; delete next.eventName; }
    return next;
  });
  for (const row of [...result.events,...result.entries]) {
    const loc=locs.get(row.locationId), event=events.get(row.eventId);
    if (loc) {row.locationName=loc.name;row.locationType=loc.type;}
    if (event) row.eventName=event.name;
  }
  for (const c of COLLECTIONS) result[c].sort((a,b)=>
    (new Date(a.observedAt || a.ts || a.createdAt || 0).getTime()||0)-(new Date(b.observedAt || b.ts || b.createdAt || 0).getTime()||0) || String(a.id).localeCompare(String(b.id)));
  result.entries.reverse();
  const acked=new Set(synced._sync.acked || []);
  // Per-record status for UI chips; syncState is omitted from ops so this never becomes a change.
  const unsent=new Set(ops.filter(o=>!acked.has(o.id)).map(o=>canonical([o.collection,o.recordId])));
  for (const c of COLLECTIONS) for (const row of result[c]) row.syncState=unsent.has(canonical([c,row.id])) ? 'pending' : 'synced';
  result._sync={...synced._sync,conflicts};
  result.syncState=ops.some(o=>!acked.has(o.id)) || synced._sync.mediaPending > 0 ? 'pending' : 'synced';
  return result;
}
export function captureChanges(edited, latest, {authorId=null, newId=()=>crypto.randomUUID(), at=Date.now()}={}) {
  const canReuseLatest=Boolean(latest?._sync?.version===2 && edited._sync?.version===2 &&
    latest._sync.ops.length===edited._sync.ops.length &&
    latest._sync.ops.at(-1)?.id===edited._sync.ops.at(-1)?.id);
  const basis=canReuseLatest ? ensureSync(latest) : ensureSync(edited._sync ? materialize(edited) : (latest || edited));
  const current=ensureSync(latest || basis);
  const old=records(basis), next=records(edited), frontier=heads(basis._sync.ops), added=[];
  const nextRows=new Set([...next.values()].map(n=>canonical([n.collection,n.recordId])));
  const emit=(k,r,value)=>added.push({...r,value,id:newId(),parents:(frontier.get(k)||[]).map(o=>o.id),authorId,at});
  for (const [k,r] of next) if (!old.has(k) || canonical(old.get(k).value)!==canonical(r.value)) emit(k,r,r.value);
  for (const [k,r] of old) if (!next.has(k)) {
    const rowExists=nextRows.has(canonical([r.collection,r.recordId]));
    if (r.field==='$deleted' && !rowExists) emit(k,r,true);
    else if (rowExists && r.field!=='$deleted') emit(k,r,null);
  }
  return materialize({...current,...edited,_sync:{...current._sync,ops:unionOps(current._sync.ops,unionOps(basis._sync.ops,added))}});
}
export function mergeSync(local, remote) {
  const a=ensureSync(local),b=ensureSync(remote);
  if (a.id!==b.id) throw new Error('This update belongs to another trip.');
  return materialize({...a,_sync:{...a._sync,ops:unionOps(a._sync.ops,b._sync.ops)}});
}
export function acknowledge(trip, ids) {
  const t=ensureSync(trip);
  return materialize({...t,_sync:{...t._sync,acked:[...new Set([...(t._sync.acked||[]),...ids])],lastCloudSync:Date.now()}});
}
export function resolveConflict(trip,key,value,authorId) {
  const t=ensureSync(trip), list=heads(t._sync.ops).get(key);
  if (!list?.length) return t;
  const op={...list[0],id:crypto.randomUUID(),parents:list.map(o=>o.id),value,authorId,at:Date.now()};
  return materialize({...t,_sync:{...t._sync,ops:unionOps(t._sync.ops,[op])}});
}
function snapshotRowsFromHeads(headMap) {
  const rows=new Map();
  for (const list of headMap.values()) {
    const winner=list[list.length-1], {collection,recordId,field}=winner;
    if (collection==='trip') continue;
    const rowKey=canonical([collection,recordId]);
    if (!rows.has(rowKey)) rows.set(rowKey,{collection,recordId,row:{id:recordId}});
    const target=rows.get(rowKey).row;
    if (field==='$record') Object.assign(target,clean(winner.value),{id:recordId});
    else if (!field.includes('/')) target[field]=winner.value;
  }
  return rows;
}
function rowDisplayLabel(row, recordId) {
  for (const candidate of [row?.name,row?.title,row?.description,row?.handle,row?.label]) {
    if (typeof candidate==='string' && candidate.trim()) return candidate.trim();
  }
  if (typeof row?.notes==='string' && row.notes.trim()) {
    const snippet=row.notes.trim().replace(/\s+/g,' ');
    return snippet.length>42 ? snippet.slice(0,42)+'…' : snippet;
  }
  if (typeof row?.type==='string' && row.type.trim()) return row.type.trim();
  return recordId;
}
export function describeSyncRecord(trip, collection, recordId) {
  const synced=ensureSync(trip), headMap=heads(synced._sync.ops);
  const kindLabel=KIND_LABELS[collection] || collection;
  if (collection==='trip') {
    return {collection,recordId,kindLabel,label:synced.name || 'Trip',locationId:null,eventId:null,parentLabel:null};
  }
  const rows=snapshotRowsFromHeads(headMap);
  const entry=rows.get(canonical([collection,recordId]));
  const row=entry?.row || {id:recordId};
  const label=rowDisplayLabel(row,recordId);
  const locRow=row.locationId ? rows.get(canonical(['locations',row.locationId]))?.row : null;
  const evtRow=row.eventId ? rows.get(canonical(['events',row.eventId]))?.row : null;
  const parentLabel=evtRow ? rowDisplayLabel(evtRow,row.eventId) : (locRow ? rowDisplayLabel(locRow,row.locationId) : null);
  return {
    collection,
    recordId,
    kindLabel,
    label,
    locationId:row.locationId || evtRow?.locationId || null,
    eventId:row.eventId || null,
    parentLabel,
    deleted:Boolean(row.$deleted),
  };
}
export function describeDeletedRecords(trip) {
  const synced=ensureSync(trip), headMap=heads(synced._sync.ops);
  const rows=snapshotRowsFromHeads(headMap);
  const order={locations:0,events:1,entries:2};
  const out=[];
  for (const {collection,recordId,row} of rows.values()) {
    if (!row.$deleted) continue;
    const desc=describeSyncRecord(synced,collection,recordId);
    const parentDeleted=Boolean(
      (desc.locationId && rows.get(canonical(['locations',desc.locationId]))?.row?.$deleted) ||
      (desc.eventId && rows.get(canonical(['events',desc.eventId]))?.row?.$deleted),
    );
    out.push({...desc,key:canonical([collection,recordId,'$deleted']),parentDeleted});
  }
  return out.sort((a,b)=>((order[a.collection]??3)-(order[b.collection]??3)) || a.label.localeCompare(b.label));
}
export function restoreDeletedRecord(trip, collection, recordId, authorId=null) {
  const t=ensureSync(trip), headMap=heads(t._sync.ops), rows=snapshotRowsFromHeads(headMap);
  const targets=[[collection,recordId]];
  const targetRow=rows.get(canonical([collection,recordId]))?.row;
  if (targetRow?.eventId) {
    const evtRow=rows.get(canonical(['events',targetRow.eventId]))?.row;
    if (evtRow?.locationId) targets.unshift(['locations',evtRow.locationId]);
    targets.unshift(['events',targetRow.eventId]);
  } else if (targetRow?.locationId) {
    targets.unshift(['locations',targetRow.locationId]);
  }
  const now=Date.now(), added=[], seen=new Set();
  for (const [col,id] of targets) {
    const k=canonical([col,id,'$deleted']);
    if (seen.has(k)) continue;
    seen.add(k);
    const list=headMap.get(k);
    if (!list?.length || list[list.length-1].value!==true) continue;
    added.push({...list[0],id:crypto.randomUUID(),parents:list.map(o=>o.id),value:false,authorId,at:now});
  }
  if (!added.length) return materialize(t);
  return materialize({...t,_sync:{...t._sync,ops:unionOps(t._sync.ops,added)}});
}
