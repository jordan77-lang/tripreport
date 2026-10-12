import { trackSegments } from './tripTimeline.js';
export function distanceMeters(a,b) {
  const rad=Math.PI/180, dLat=(b.lat-a.lat)*rad,dLng=(b.lng-a.lng)*rad;
  const h=Math.sin(dLat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dLng/2)**2;
  return 6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
}
export function routeStats(points=[]) {
  let distance=0,ascent=0;
  for(const segment of trackSegments(points))for(let i=1;i<segment.length;i++){
    distance+=distanceMeters(segment[i-1],segment[i]);
    if(Number.isFinite(segment[i].alt)&&Number.isFinite(segment[i-1].alt))ascent+=Math.max(0,segment[i].alt-segment[i-1].alt);
  }
  return {miles:(distance/1609.344).toFixed(2),elev:Math.round(ascent*3.28084).toLocaleString(),pts:String(points.length)};
}
// Provider-independent recording engine. No callback may save after stop, including
// callbacks already queued by the OS. Every restart and long signal gap is a new segment.
export function createRouteRecorder({provider,save,onState,interval=5000,now=()=>Date.now(),newId=()=>crypto.randomUUID()}) {
  let stopped=false,cleanup=null,previous=null,segmentId=newId(),lastSavedAt=null;
  const report=state=>{if(!stopped)onState({...state,lastSavedAt});};
  const stop=()=>{stopped=true;cleanup?.();};
  const error=e=>{report({status:'interrupted',error:e?.message||'GPS is unavailable.'});stop();};
  const receive=pos=>{
    if(stopped)return;
    const point={lat:pos.coords.latitude,lng:pos.coords.longitude,alt:pos.coords.altitude,
      accuracy:pos.coords.accuracy,heading:pos.coords.heading,speed:pos.coords.speed,ts:pos.timestamp};
    if(!Number.isFinite(point.lat)||!Number.isFinite(point.lng)||Math.abs(point.lat)>90||Math.abs(point.lng)>180||
      !Number.isFinite(point.ts)||point.ts<now()-30000||point.ts>now()+5000){
      report({status:'acquiring',error:'Waiting for a fresh GPS fix.'});return;
    }
    if(!Number.isFinite(point.accuracy)||point.accuracy<0||point.accuracy>60){
      report({status:'acquiring',position:point,error:'GPS accuracy is low; waiting for a better fix.'});return;
    }
    if(previous){
      const elapsed=point.ts-previous.ts;
      if(elapsed<=0)return;
      if(elapsed>60000){segmentId=newId();previous=null;}
      else {
        const distance=distanceMeters(previous,point);
        if(distance/(elapsed/1000)>70){report({status:'acquiring',position:point,error:'GPS jump ignored; waiting for a stable fix.'});return;}
        if(elapsed<interval || distance<Math.max(5,Math.min(point.accuracy,previous.accuracy)*0.5)){
          report({status:'recording',position:point,error:null});return;
        }
      }
    }
    try{
      const saved=save({...point,segmentId});
      if(saved===false){error(new Error('Recording stopped. No further points were saved.'));return;}
      previous=point;lastSavedAt=now();
      report({status:'recording',position:point,error:null});
    }catch(e){error(new Error('Point not saved: '+e.message));}
  };
  report({status:'acquiring',error:null});
  Promise.resolve().then(()=>stopped?null:provider.start(receive,error)).then(fn=>{
    cleanup=fn;if(stopped)cleanup?.();
  }).catch(error);
  return {stop};
}
export const browserGpsProvider={
  background:false,
  async start(onPosition,onError){
    if(!globalThis.navigator?.geolocation)throw new Error('Location is unavailable in this browser.');
    const id=navigator.geolocation.watchPosition(onPosition,onError,{enableHighAccuracy:true,maximumAge:0,timeout:15000});
    return ()=>navigator.geolocation.clearWatch(id);
  },
};
