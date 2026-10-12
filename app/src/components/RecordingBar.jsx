import { useEffect, useMemo, useState } from 'react';
import { startGpsSession,pauseGpsSession,resumeGpsSession,stopGpsSession,updateGpsSession } from '../lib/storage';
import { routeStats } from '../lib/gpsRecorder';
import { T } from '../tokens';

export function RecordingBar({trip,gps={},onUpdate,onOpenTrip}) {
  const [error,setError]=useState(null),[finished,setFinished]=useState(null),[label,setLabel]=useState(''),[locationId,setLocationId]=useState('');
  const [now,setNow]=useState(()=>Date.now());
  useEffect(()=>{if(!trip?.gpsSessionId)return;const timer=setInterval(()=>setNow(Date.now()),1000);return ()=>clearInterval(timer);},[trip?.gpsSessionId]);
  const session=trip?.trackSessions?.find(s=>s.id===trip.gpsSessionId);
  const points=useMemo(()=>(trip?.track||[]).filter(p=>p.sessionId===session?.id),[trip?.track,session?.id]);
  const stats=useMemo(()=>routeStats(points),[points]);
  if(!trip)return null;
  const active=Boolean(trip.gpsSessionActive && !['completed','archived'].includes(trip.status)),paused=Boolean(session&&!active);
  const status=paused?'Paused':active?({acquiring:'Waiting for GPS…',recording:'Recording',interrupted:'Recording interrupted'}[gps.status]||'Waiting for GPS…'):'Route recording off';
  const button={minHeight:44,padding:'8px 12px',border:'1px solid '+T.border,borderRadius:10,background:T.card,color:T.text,fontWeight:700,cursor:'pointer'};
  function act(fn){try{setError(null);fn();onUpdate?.();}catch(e){setError(e.message);}}
  function finish(){const id=session?.id;act(()=>{stopGpsSession(trip.id);setFinished(points.length?{tripId:trip.id,sessionId:id}:null);setLabel('');setLocationId('');});}
  return <section aria-label="Route recording" style={{flexShrink:0,padding:'8px 12px',borderBottom:'1px solid '+T.border,background:active?T.accentLight:T.card,color:T.text}}>
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,flexWrap:'wrap'}}>
      <div style={{minWidth:0}}>
        <strong role="status">{status}</strong>
        <div style={{fontSize:12}}><button style={{border:0,padding:0,background:'transparent',color:T.accent,cursor:'pointer'}} onClick={onOpenTrip}>{trip.name}</button> · This phone
          {session && ' · '+stats.miles+' mi · '+Math.max(0,Math.floor((now-session.startedAt)/60000))+' min elapsed'}</div>
        {active && gps.lastSavedAt && <div style={{fontSize:12}}>Last saved {new Date(gps.lastSavedAt).toLocaleTimeString()}{gps.position?.accuracy!=null?' · ±'+Math.round(gps.position.accuracy)+' m':''}</div>}
      </div>
      <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
        {!session && trip.status!=='completed' && <button style={button} onClick={()=>act(()=>startGpsSession(trip.id))}>Start recording</button>}
        {active && <button style={button} onClick={()=>act(()=>pauseGpsSession(trip.id))}>Pause</button>}
        {paused && !['completed','archived'].includes(trip.status) && <button style={button} onClick={()=>act(()=>resumeGpsSession(trip.id))}>Resume</button>}
        {active && gps.status==='interrupted' && <button style={button} onClick={gps.retry}>Retry GPS</button>}
        {session && <button style={button} onClick={finish}>{points.length?'Finish':'Cancel'}</button>}
      </div>
    </div>
    {(error||gps.error) && <p role="alert" style={{fontSize:12,margin:'6px 0'}}>{error||gps.error}</p>}
    {active && <div style={{fontSize:11,marginTop:4}}>{gps.background?'Native mode supports recording with the screen locked; location permissions are required.':'Keep the app visible to record. Leaving it pauses recording; returning starts a new segment.'}</div>}
    {finished?.tripId===trip.id && <details open style={{marginTop:8}}>
      <summary>Route saved · optional details</summary>
      <div style={{display:'flex',gap:8,flexWrap:'wrap',paddingTop:8}}>
        <label>Leg name <input value={label} onChange={e=>setLabel(e.target.value)} placeholder="Morning paddle"/></label>
        <label>Destination <select value={locationId} onChange={e=>setLocationId(e.target.value)}><option value="">No linked place</option>{trip.locations?.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        <button style={button} onClick={()=>act(()=>{updateGpsSession(trip.id,finished.sessionId,{label:label.trim(),attachLocationId:locationId||null});setFinished(null);})}>Save details</button>
        <button style={button} onClick={()=>setFinished(null)}>Done</button>
      </div>
    </details>}
  </section>;
}
