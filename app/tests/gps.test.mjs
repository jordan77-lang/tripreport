import { makeNativeGpsProvider } from '../src/lib/nativeGpsProvider.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouteRecorder,routeStats } from '../src/lib/gpsRecorder.js';
const tick=()=>new Promise(r=>setImmediate(r));
async function fixture({saveError=false}={}){
 let time=100000,receive,fail,stops=0,count=0;
 const saved=[],states=[];
 const provider={start:(p,e)=>{receive=p;fail=e;return ()=>stops++;}};
 const recorder=createRouteRecorder({provider,save:p=>{if(saveError)throw new Error('Storage full');saved.push(p);return true;},onState:s=>states.push(s),
   now:()=>time,newId:()=>String(++count)});
 await tick();
 return {saved,states,stop:recorder.stop,stops:()=>stops,
   emit:({advance=0,lat=34,lng=-111,accuracy=5,ts}={})=>{
     time+=advance;receive({coords:{latitude:lat,longitude:lng,accuracy},timestamp:ts??time});
   },fail:e=>fail(e)};
}
test('first valid fix is immediately saved, then status becomes recording',async()=>{
 const f=await fixture();assert.equal(f.states.at(-1).status,'acquiring');f.emit();
 assert.equal(f.saved.length,1);assert.equal(f.states.at(-1).status,'recording');
});
test('queued callbacks cannot save after Stop',async()=>{
 const f=await fixture();f.emit();f.stop();f.emit({advance:10000,lat:34.001});
 assert.equal(f.saved.length,1);assert.equal(f.stops(),1);
});
test('poor accuracy, stale fixes, and impossible jumps are rejected',async()=>{
 const f=await fixture();f.emit({accuracy:100});f.emit({ts:1});assert.equal(f.saved.length,0);
 f.emit();f.emit({advance:5000,lat:45});assert.equal(f.saved.length,1);
});
test('stationary jitter is not accumulated as route distance',async()=>{
 const f=await fixture();f.emit();f.emit({advance:10000,lat:34.000001});assert.equal(f.saved.length,1);
 assert.equal(f.states.at(-1).status,'recording');
});
test('signal gaps start new segments and do not inflate distance',async()=>{
 const f=await fixture();f.emit();f.emit({advance:70000,lat:35});
 assert.notEqual(f.saved[0].segmentId,f.saved[1].segmentId);
 assert.equal(routeStats(f.saved.map(p=>({...p,sessionId:'s'}))).miles,'0.00');
});
test('storage failure never claims recording and cancels the watcher',async()=>{
 const f=await fixture({saveError:true});f.emit();assert.equal(f.saved.length,0);
 assert.equal(f.states.at(-1).status,'interrupted');assert.match(f.states.at(-1).error,/not saved/);assert.equal(f.stops(),1);
});
test('permission denial is actionable and stops the watcher',async()=>{
 const f=await fixture();f.fail(new Error('Location permission denied'));
 assert.equal(f.states.at(-1).status,'interrupted');assert.match(f.states.at(-1).error,/permission/);assert.equal(f.stops(),1);
});
test('stopping during asynchronous provider startup still removes the watcher',async()=>{
 let resolve,stops=0;
 const provider={start:()=>new Promise(r=>{resolve=r;})};
 const r=createRouteRecorder({provider,save:()=>true,onState:()=>{}});
 await tick();r.stop();resolve(()=>stops++);await tick();assert.equal(stops,1);
});

test('native provider requests notification access, enables background mode and removes its watcher',async()=>{
 let options,callback,removed,requested=false;
 const plugin={addWatcher:async(o,c)=>{options=o;callback=c;return 'native-watch';},removeWatcher:async({id})=>{removed=id;}};
 const notifications={checkPermissions:async()=>({display:'prompt'}),requestPermissions:async()=>{requested=true;return {display:'granted'};}};
 const provider=makeNativeGpsProvider(plugin,notifications,'android');
 let point;const stop=await provider.start(p=>point=p,e=>{throw e;});
 assert.equal(requested,true);assert.ok(options.backgroundMessage);assert.equal(options.stale,false);
 callback({latitude:1,longitude:2,accuracy:5,time:123});assert.equal(point.timestamp,123);assert.equal(point.coords.latitude,1);
 stop();await tick();assert.equal(removed,'native-watch');
});
test('native notification denial prevents silently starting background tracking',async()=>{
 let started=false;
 const provider=makeNativeGpsProvider({addWatcher:()=>{started=true;}},{checkPermissions:async()=>({display:'denied'}),requestPermissions:async()=>({display:'denied'})},'android');
 await assert.rejects(provider.start(()=>{},()=>{}),/Allow notifications/);assert.equal(started,false);
});
