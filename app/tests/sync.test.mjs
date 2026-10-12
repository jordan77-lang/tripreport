import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureSync, materialize, captureChanges, mergeSync, acknowledge, resolveConflict, canonical } from '../src/lib/tripSync.js';
import { buildTripTimeline, tripDayKey, trackSegments, combineLocations } from '../src/lib/tripTimeline.js';
const base=()=>materialize(ensureSync({id:'trip',name:'River',timeZone:'America/Phoenix',locations:[{id:'camp',name:'Camp',lat:34,lng:-111}],events:[{id:'lunch',locationId:'camp',name:'Lunch',notes:'original',photos:[],observedAt:'2026-07-20T01:00:00Z'}],entries:[]}));
const edit=(trip,fn,author='A')=>{const copy=structuredClone(trip);fn(copy);return captureChanges(copy,trip,{authorId:author});};
const visible=t=>canonical({locations:t.locations,events:t.events,entries:t.entries,conflicts:t._sync.conflicts});
test('independent fields and attachments survive every merge order and repeated transfer',()=>{
 const b=base();
 const a=edit(b,t=>{t.events[0].notes='A';t.events[0].photos=[{id:'photo-a'}];});
 const c=edit(b,t=>{t.events[0].name='B';t.events[0].photos=[{id:'photo-b'}];},'B');
 const ab=mergeSync(a,c),ba=mergeSync(c,a);
 assert.equal(visible(ab),visible(ba));
 assert.equal(ab.events[0].notes,'A');assert.equal(ab.events[0].name,'B');
 assert.equal(ab.events[0].photos.length,2);
 assert.equal(ab._sync.conflicts.length,0);
 assert.equal(visible(mergeSync(ab,c)),visible(ab));
 assert.equal(mergeSync(ab,c)._sync.ops.length,ab._sync.ops.length);
});
test('concurrent notes converge and retain both versions until deliberate resolution',()=>{
 const b=base(),a=edit(b,t=>t.events[0].notes='A'),c=edit(b,t=>t.events[0].notes='B','B');
 const merged=mergeSync(a,c);
 assert.equal(visible(merged),visible(mergeSync(c,a)));
 const conflict=merged._sync.conflicts.find(c=>c.field==='notes');
 assert.deepEqual(new Set(conflict.choices.map(c=>c.value)),new Set(['A','B']));
 const resolved=resolveConflict(merged,conflict.key,'A and B','owner');
 const again=mergeSync(resolved,c);
 assert.equal(again.events[0].notes,'A and B');assert.equal(again._sync.conflicts.length,0);
});
test('deletions survive old packages and concurrent edits remain recoverable',()=>{
 const b=base(),deleted=edit(b,t=>t.events=[]),changed=edit(b,t=>t.events[0].notes='offline detail','B');
 const merged=mergeSync(deleted,changed);
 assert.equal(merged.events.length,0);
 const recovered=resolveConflict(merged,canonical(['events','lunch','$deleted']),false,'owner');
 assert.equal(recovered.events[0].notes,'offline detail');
 assert.equal(mergeSync(deleted,b).events.length,0);
});
test('attachment deletion does not resurrect on an old import',()=>{
 const b=edit(base(),t=>t.events[0].photos=[{id:'a'},{id:'b'}]);
 const removed=edit(b,t=>t.events[0].photos=t.events[0].photos.filter(p=>p.id!=='a'));
 assert.deepEqual(mergeSync(removed,b).events[0].photos.map(p=>p.id),['b']);
});
test('stale UI edits preserve changes saved while the form was open',()=>{
 const b=base(),latest=edit(b,t=>t.events[0].notes='new note');
 const stale=structuredClone(b);stale.name='Changed trip name';
 const saved=captureChanges(stale,latest);
 assert.equal(saved.events[0].notes,'new note');assert.equal(saved.name,'Changed trip name');
});
test('acknowledgement never marks unsent edits synced',()=>{
 const b=base(),sent=b._sync.ops.map(o=>o.id),latest=edit(b,t=>t.name='edit during upload');
 assert.equal(acknowledge(latest,sent).syncState,'pending');
 assert.equal(acknowledge(latest,latest._sync.ops.map(o=>o.id)).syncState,'synced');
});
test('three-phone exchange converges through forwarding and arbitrary retry order',()=>{
 const b=base(),phones=['a','b','c'].map(id=>edit(b,t=>t.entries.push({id,notes:id,createdAt:100}),id));
 const orders=[[0,1,2],[2,0,1],[1,2,0],[2,1,0]];
 const results=orders.map(order=>order.reduce((t,i)=>mergeSync(t,phones[i]),b));
 for(const r of results){assert.equal(r.entries.length,3);assert.equal(visible(r),visible(results[0]));}
});
test('events without entries appear on the same trip day on every device',()=>{
 const t=base(),timeline=buildTripTimeline(t);
 assert.ok(timeline.some(p=>p.kind==='event'&&p.day==='2026-07-19'));
 assert.equal(tripDayKey('2026-07-20T01:00:00Z','America/Phoenix'),'2026-07-19');
 assert.equal(trackSegments([{sessionId:'a',lat:1,lng:1},{sessionId:'b',lat:2,lng:2},{lat:3,lng:3}]).length,2);
});
test('confirmed duplicate places preserve notes, photos, events and references',()=>{
 const b=base();b.locations.push({id:'camp2',name:'Camp',notes:'other',photos:[{id:'p'}]});
 b.events[0].locationId='camp2';
 const combined=combineLocations(b,'camp','camp2');
 assert.equal(combined.locations.length,1);assert.equal(combined.events[0].locationId,'camp');
 assert.equal(combined.locations[0].notes,'other');assert.equal(combined.locations[0].photos[0].id,'p');
});
test('same operation ID with different contents is rejected',()=>{
 const b=base(),c=structuredClone(b);c._sync.ops[0].value='corrupted';
 assert.throws(()=>mergeSync(b,c),/conflicting contents/);
});

test('cyclic and dangling history is rejected before materialization',()=>{
 const b=base(),one={id:'one',collection:'events',recordId:'lunch',field:'notes',value:'a',parents:['two']};
 const two={...one,id:'two',parents:['one']};
 assert.throws(()=>materialize({...b,_sync:{version:2,ops:[one,two]}}),/Cyclic/);
 assert.throws(()=>materialize({...b,_sync:{version:2,ops:[one]}}),/ancestry/);
});
test('embedded legacy image bytes survive first migration and later edits',()=>{
 const b=materialize(ensureSync({id:'legacy',entries:[{id:'photo',photoFiles:[{name:'old.jpg',dataUrl:'data:image/jpeg;base64,YQ=='}]}]}));
 const c=edit(b,t=>t.name='renamed');
 assert.equal(c.entries[0].photoFiles[0].dataUrl,'data:image/jpeg;base64,YQ==');
});
test('track sessions count merged points and never combine recording sessions',()=>{
 const b=materialize(ensureSync({id:'track',trackSessions:[{id:'s',pointsCount:0}],track:[]}));
 const a=edit(b,t=>t.track.push({id:'p1',sessionId:'s',lat:1,lng:1,ts:1}));
 const c=edit(b,t=>t.track.push({id:'p2',sessionId:'s',lat:2,lng:2,ts:2}));
 const merged=mergeSync(a,c);assert.equal(merged.track.length,2);assert.equal(merged.trackSessions[0].pointsCount,2);
});
