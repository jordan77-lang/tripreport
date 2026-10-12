import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { ensureSync, materialize, captureChanges } from '../src/lib/tripSync.js';

async function fixture() {
  const media=new Map(),values=new Map();let current;
  let failBatch=false,failSave=false,saveCount=0;
  const context=vm.createContext({console,crypto:webcrypto,Blob,File,Date,btoa,atob,
    localStorage:{setItem:(k,v)=>values.set(k,v),getItem:k=>values.get(k)||null},setTimeout,URL});
  const modules=new Map();
  function mock(name,exports) {
    modules.set(name,new vm.SyntheticModule(Object.keys(exports),function(){
      for(const [k,v] of Object.entries(exports))this.setExport(k,v);
    },{context,identifier:name}));
  }
  mock('mediaStore',{getMediaRecord:async id=>media.get(id),putMediaBatch:async rows=>{
    if(failBatch)throw new Error('Storage full');
    for(const r of rows)media.set(r.id,r);
  }});
  mock('storage',{getTrip:()=>current,saveTrip:(t,options={})=>{
    if(failSave)throw new Error('Trip storage full');current=options.capture===false?materialize(t):captureChanges(t,current);saveCount++;return current;
  }});
  const loading=new Map();
  async function load(name) {
    name=name.replace(/^\.\//,'').replace(/\.js$/,'');
    if(loading.has(name))return loading.get(name);
    if(modules.has(name))return modules.get(name);
    const promise=(async()=>{
      const module=new vm.SourceTextModule(await readFile(new URL('../src/lib/'+name+'.js',import.meta.url),'utf8'),{context,identifier:name});
      modules.set(name,module);
      await module.link(specifier=>load(specifier));
      return module;
    })();loading.set(name,promise);return promise;
  }
  const exchange=await load('offlineExchange');await exchange.evaluate();
  const importer=await load('importTripPackage');await importer.evaluate();
  return {exchange:exchange.namespace,importer:importer.namespace,media,values,
    setTrip:t=>current=t,getTrip:()=>current,failBatch:()=>failBatch=true,failSave:()=>failSave=true,saves:()=>saveCount};
}
const trip=()=>materialize(ensureSync({id:'t',name:'River',locations:[],events:[],entries:[{id:'entry',notes:'before',photoFiles:[{id:'photo'}],voiceFiles:[{id:'audio'}]}]}));
test('file round trip includes verified photo and audio bytes and can be imported twice',async()=>{
 const f=await fixture(),t=trip();f.setTrip(t);
 f.media.set('photo',{id:'photo',tripId:'t',fullBlob:new Blob(['photo-bytes'],{type:'image/jpeg'})});
 f.media.set('audio',{id:'audio',tripId:'t',fullBlob:new Blob(['audio-bytes'],{type:'audio/webm'})});
 const prepared=await f.exchange.prepareTripUpdateFile(t,'author');
 const read=await f.exchange.readTripUpdateFile(prepared.file);
 assert.equal(read.mediaRecords.length,2);assert.equal(await read.mediaRecords[1].fullBlob.text(),'audio-bytes');
 const copy=structuredClone(t);copy.entries[0].notes='after';
 const update=f.exchange.createTripUpdate(captureChanges(copy,t));
 update.mediaRecords=read.mediaRecords;
 await f.importer.importTripPackage('t',update);
 const count=f.getTrip()._sync.ops.length;
 await f.importer.importTripPackage('t',update);
 assert.equal(f.getTrip()._sync.ops.length,count);
 assert.equal(f.getTrip().entries[0].notes,'after');
 assert.ok(f.values.has('tr_import_backup:t'));
});
test('corrupted media is rejected before preview or writes',async()=>{
 const f=await fixture(),t=trip();f.media.set('photo',{id:'photo',tripId:'t',fullBlob:new Blob(['original'])});
 const prepared=await f.exchange.prepareTripUpdateFile(t);
 const raw=JSON.parse(await prepared.file.text());raw.media[0].full.base64=btoa('modified');
 await assert.rejects(f.exchange.readTripUpdateFile(new File([JSON.stringify(raw)],'bad.json')),/checksum/);
 assert.equal(f.saves(),0);
});
test('same media ID with different bytes never replaces the original',async()=>{
 const f=await fixture(),t=trip();f.setTrip(t);f.media.set('photo',{id:'photo',tripId:'t',fullBlob:new Blob(['old'])});
 const u=f.exchange.createTripUpdate(t);u.mediaRecords=[{id:'photo',tripId:'t',fullBlob:new Blob(['new'])}];
 await assert.rejects(f.importer.importTripPackage('t',u),/different contents/);
 assert.equal(await f.media.get('photo').fullBlob.text(),'old');assert.equal(f.saves(),0);
});
test('media transaction failure leaves trip unchanged and saves recovery checkpoint',async()=>{
 const f=await fixture(),t=trip();f.setTrip(t);f.failBatch();
 const copy=structuredClone(t);copy.entries[0].notes='new';
 const u=f.exchange.createTripUpdate(captureChanges(copy,t));u.mediaRecords=[];
 await assert.rejects(f.importer.importTripPackage('t',u),/Storage full/);
 assert.equal(f.getTrip().entries[0].notes,'before');assert.ok(f.values.has('tr_import_backup:t'));
});
test('failed trip commit leaves original trip and attachments available for a retry',async()=>{
 const f=await fixture(),t=trip();f.setTrip(t);f.failSave();
 const u=f.exchange.createTripUpdate(t);u.mediaRecords=[{id:'photo',tripId:'t',fullBlob:new Blob(['new'])}];
 await assert.rejects(f.importer.importTripPackage('t',u),/Trip storage full/);
 assert.equal(f.getTrip(),t);assert.equal(await f.media.get('photo').fullBlob.text(),'new');
});
test('wrong trip and oversized files are rejected before writes',async()=>{
 const f=await fixture();f.setTrip(trip());
 const u=f.exchange.createTripUpdate({...trip(),id:'different',_sync:undefined});
 await assert.rejects(f.importer.importTripPackage('t',u),/matching trip/);
 assert.equal(f.values.size,0);
 await assert.rejects(f.exchange.readTripUpdateFile({size:101*1024*1024}),/100 MB/);
});

test('restoring a checkpoint records compensating edits and keeps imported history',async()=>{
 const f=await fixture(),t=trip();f.setTrip(t);
 const copy=structuredClone(t);copy.entries[0].notes='imported';copy.entries.push({id:'extra',notes:'new'});
 const update=f.exchange.createTripUpdate(captureChanges(copy,t));update.mediaRecords=[];
 await f.importer.importTripPackage('t',update);
 const beforeRestore=f.getTrip()._sync.ops.length;
 f.importer.restoreTripCheckpoint('t');
 assert.equal(f.getTrip().entries.length,1);assert.equal(f.getTrip().entries[0].notes,'before');
 assert.ok(f.getTrip()._sync.ops.length>beforeRestore);
 const repeated=f.exchange.mergeTripUpdate(f.getTrip(),update);
 assert.equal(repeated.trip.entries.length,1);assert.equal(repeated.trip.entries[0].notes,'before');
});
