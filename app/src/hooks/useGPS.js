import { useEffect, useRef, useState } from 'react';
import { appendTrackPoint } from '../lib/storage';
import { createRouteRecorder } from '../lib/gpsRecorder';
import { gpsProvider } from '../lib/gpsProvider';

export function useGPS(tripId,{enabled=false,interval=5000,sessionId=null,onTrackPoint,provider=gpsProvider}={}) {
  const [state,setState]=useState({status:'off',position:null,error:null,lastSavedAt:null});
  const [retryCount,setRetryCount]=useState(0);
  const callback=useRef(onTrackPoint);
  useEffect(()=>{callback.current=onTrackPoint;},[onTrackPoint]);
  useEffect(()=>{
    if(!enabled||!tripId||!sessionId)return;
    let recorder=null,disposed=false,lastFixAt=Date.now();
    const start=()=>{
      recorder?.stop();
      lastFixAt=Date.now();
      recorder=createRouteRecorder({provider,interval,
        save:point=>{
          const saved=appendTrackPoint(tripId,{...point,sessionId});
          if(saved)callback.current?.(point);
          return Boolean(saved);
        },
        onState:next=>{
          if(disposed)return;
          if(next.position)lastFixAt=Date.now();
          setState(previous=>({...previous,...next,tripId,sessionId}));
        },
      });
    };
    const visibility=()=>{
      if(provider.background)return;
      if(document.visibilityState==='hidden'){
        recorder?.stop();setState(previous=>({...previous,status:'interrupted',error:'Recording suspended while the app is hidden. Reopen it to continue with a new segment.',tripId,sessionId}));
      }else start();
    };
    queueMicrotask(()=>{if(!disposed)visibility();});
    if(provider.background)start();
    document.addEventListener('visibilitychange',visibility);
    const timer=setInterval(()=>{
      if(Date.now()-lastFixAt>30000)setState(previous=>previous.status==='recording'?{...previous,status:'interrupted',error:'No recent GPS fix. Recording will continue when the signal returns.'}:previous);
    },5000);
    return ()=>{disposed=true;recorder?.stop();clearInterval(timer);document.removeEventListener('visibilitychange',visibility);};
  },[enabled,tripId,sessionId,interval,provider,retryCount]);
  const active=enabled && state.tripId===tripId && state.sessionId===sessionId;
  return {...state,background:provider.background,status:enabled?(active?state.status:'acquiring'):'off',
    tracking:Boolean(active&&state.status==='recording'),error:active?state.error:null,
    retry:()=>setRetryCount(n=>n+1)};
}
