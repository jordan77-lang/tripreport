import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as engine from '../src/lib/tripSync.js';
import * as refs from '../src/lib/mediaRefs.js';
const base=()=>engine.materialize(engine.ensureSync({id:'t',ownerId:'owner',name:'River',entries:[],locations:[],events:[]}));
const change=(t,text,id)=>{const e=structuredClone(t);e.entries.push({id,notes:text});return engine.captureChanges(e,t);};
async function fixture({duringRequest,fail=false,mediaFail=false}={}) {
 let local=change(base(),'phone A','a'),server=change(base(),'phone B','b'),calls=0;
 const context=vm.createContext({console,Date,localStorage:{getItem:()=>null}});
 const supabase={
  auth:{getSession:async()=>({data:{session:{access_token:'test'}}}),getUser:async()=>({data:{user:{id:'owner'}}})},
  from:table=>{
    if(table==='profiles')return {upsert:async()=>({})};
    return {select:()=>({eq:()=>({maybeSingle:async()=>({data:{
      id:'t',owner_id:'owner',updated_at:'2026-01-01T00:00:00Z',created_at:'2026-01-01T00:00:00Z',
      payload:{_sync:{version:2,ops:server._sync.ops}},
    }})})})};
  },
  rpc:async(name,args)=>{
    calls++;assert.equal(name,'sync_trip_changes');
    if(duringRequest&&calls===1)local=duringRequest(local);
    if(fail)return {error:{code:'PGRST202',message:'Missing RPC'}};
    server=engine.mergeSync(server,{...server,_sync:{version:2,ops:args.p_ops,acked:[]}});
    return {data:{ops:structuredClone(server._sync.ops),ownerId:'owner',updatedAt:'2026-01-02T00:00:00Z'}};
  },
 };
 const mocks={
  './supabase':{requireSupabase:()=>supabase,supabaseConfigured:true},
  './authUser':{getSignedInUserId:()=> 'owner',getSignedInDisplayName:()=> 'Owner'},
  './storage':{saveTrip:t=>(local=engine.materialize(t)),getTrip:()=>local,getTrips:()=>[local],claimAnonymousTripsForUser:()=>{},isTripOwner:()=>true,isTripMember:()=>true,deleteLocalTrip:()=>{}},
  './mediaSync':{syncTripMedia:async()=>{if(mediaFail)throw new Error('Attachment offline');}},
  './mediaRefs':refs,
  './tripSync':engine,
  './tripParticipants':{mergeCollaboratorsFromMembers:()=>[],memberProfilesFromRows:()=>({}),collaboratorsChanged:()=>false,dedupeCollaborators:x=>x},
  './mediaStore':{listMediaForTrip:async()=>[]},
 };
 const modules=new Map(Object.entries(mocks).map(([name,exports])=>[name,new vm.SyntheticModule(Object.keys(exports),function(){
   for(const [k,v] of Object.entries(exports))this.setExport(k,v);
 },{context,identifier:name})]));
 const mod=new vm.SourceTextModule(await readFile(new URL('../src/lib/tripCloud.js',import.meta.url),'utf8'),{
   context,identifier:'tripCloud',importModuleDynamically:async name=>{
     const m=modules.get(name);if(m.status==='unlinked')await m.link(()=>{});if(m.status==='linked')await m.evaluate();return m;
   },
 });
 await mod.link(name=>modules.get(name));await mod.evaluate();
 return {cloud:mod.namespace,local:()=>local,server:()=>server,calls:()=>calls};
}
test('cloud sync combines both phones and includes an edit made during the request',async()=>{
 const f=await fixture({duringRequest:t=>change(t,'late edit','late')});
 await f.cloud.pushTripToCloud(f.local());
 assert.deepEqual(new Set(f.local().entries.map(e=>e.id)),new Set(['a','b','late']));
 assert.deepEqual(new Set(f.server().entries.map(e=>e.id)),new Set(['a','b','late']));
 assert.equal(f.local().syncState,'synced');assert.equal(f.calls(),2);
});
test('missing migration preserves pending work with actionable error',async()=>{
 const f=await fixture({fail:true});
 await assert.rejects(f.cloud.pushTripToCloud(f.local()),/migration 009/);
 assert.equal(f.local().syncState,'pending');assert.ok(f.local().entries.some(e=>e.id==='a'));
});
test('attachment failure is visible without losing acknowledged trip data',async()=>{
 const f=await fixture({mediaFail:true});
 await assert.rejects(f.cloud.pushTripToCloud(f.local()),/Attachment offline/);
 assert.equal(f.local()._sync.mediaError,'Attachment offline');
 assert.ok(f.local()._sync.mediaPending>0);
 assert.equal(f.local().syncState,'pending');
});
test('overlapping sync requests share one upload',async()=>{
 const f=await fixture();
 await Promise.all([f.cloud.pushTripToCloud(f.local()),f.cloud.pushTripToCloud(f.local())]);
 assert.equal(f.calls(),1);
});
test('pull-only cloud sync skips RPC write when server already contains all local ops',async()=>{
 const f=await fixture();
 await f.cloud.pushTripToCloud(f.local());
 assert.equal(f.calls(),1);
 await f.cloud.pushTripToCloud(f.local());
 assert.equal(f.calls(),1);
 assert.equal(f.local().syncState,'synced');
});
