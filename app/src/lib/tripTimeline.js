export function tripDayKey(ts,timeZone='UTC') {
  if(!ts) return 'unknown';
  const date=new Date(ts);
  if(!Number.isFinite(date.getTime()))return 'unknown';
  try {
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
    const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
    return p.year+'-'+p.month+'-'+p.day;
  } catch { return date.toISOString().slice(0,10); }
}
export function buildTripTimeline(trip) {
  const result=[];
  for(const [collection,kind] of [['locations','location'],['events','event'],['entries','entry']])
    for(const item of trip[collection]||[]) {
      const time=item.observedAt||item.observedStartAt||item.createdAt;
      result.push({id:kind+':'+item.id,kind,item,time,day:tripDayKey(time,tripTimeZone(trip)),
        authorId:item.authorId||item.createdBy||null});
    }
  for(const session of trip.trackSessions||[]) {
    const item={...session,name:session.label||'Recorded route',type:'route',locationId:session.attachLocationId,
      observedAt:session.startedAt,notes:(session.pointsCount||0)+' saved GPS points'+(session.endedAt?' · session finished':' · session unfinished')};
    result.push({id:'route:'+session.id,kind:'route',item,time:session.startedAt,day:tripDayKey(session.startedAt,tripTimeZone(trip)),authorId:session.createdBy||null});
  }
  return result.sort((a,b)=>(new Date(a.time||0)-new Date(b.time||0))||a.id.localeCompare(b.id));
}
export function duplicateLocations(trip) {
  const pairs=[],locs=trip.locations||[];
  for(let i=0;i<locs.length;i++)for(let j=i+1;j<locs.length;j++) {
    const a=locs[i],b=locs[j];
    if(a.name?.trim().toLowerCase()===b.name?.trim().toLowerCase() &&
       Number.isFinite(a.lat)&&Number.isFinite(b.lat)&&Number.isFinite(a.lng)&&Number.isFinite(b.lng)&&
       Math.hypot(a.lat-b.lat,(a.lng-b.lng)*Math.cos(a.lat*Math.PI/180))<0.001)
      pairs.push([a,b]);
  }
  return pairs.slice(0,20);
}
export function combineLocations(trip,keepId,removeId) {
  const keep=trip.locations.find(l=>l.id===keepId),other=trip.locations.find(l=>l.id===removeId);
  if(!keep||!other)return trip;
  const photos=[...new Map([...(keep.photos||[]),...(other.photos||[]),...(other.coverPhoto?[other.coverPhoto]:[])].map(p=>[p.id,p])).values()];
  return {...trip,locations:trip.locations.filter(l=>l.id!==removeId).map(l=>l.id===keepId?
    {...l,photos,notes:[l.notes,other.notes].filter(Boolean).filter((s,i,a)=>a.indexOf(s)===i).join('\n\n')}:l),
    events:(trip.events||[]).map(e=>e.locationId===removeId?{...e,locationId:keepId}:e),
    entries:(trip.entries||[]).map(e=>e.locationId===removeId?{...e,locationId:keepId}:e)};
}
export function trackSegments(track) {
  const groups=new Map();
  for(const p of track||[]) {
    // Unidentified legacy points have no reliable continuity; don't invent connecting legs.
    if(!p.sessionId)continue;
    const key=(p.authorId||'')+':'+(p.deviceId||'')+':'+p.sessionId+':'+(p.segmentId||'legacy');
    if(!groups.has(key))groups.set(key,[]);
    if(Number.isFinite(p.lat)&&Number.isFinite(p.lng)) groups.get(key).push(p);
  }
  return [...groups.values()].map(points=>points.sort((a,b)=>new Date(a.ts||a.createdAt||0)-new Date(b.ts||b.createdAt||0)));
}

/** Trip's own zone; trips saved before time zones were recorded use this phone's zone, not UTC. */
export function tripTimeZone(trip) {
  return trip?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/** "Mon, Oct 12 · Day 2" for a YYYY-MM-DD day key. */
export function formatTripDay(dayKey, startDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey || '')) return 'Undated';
  const date = new Date(dayKey + 'T12:00:00Z');
  const label = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const start = /^\d{4}-\d{2}-\d{2}/.test(startDate || '') ? new Date(startDate.slice(0, 10) + 'T12:00:00Z') : null;
  const dayNumber = start ? Math.round((date - start) / 86400000) + 1 : null;
  return dayNumber >= 1 ? `${label} · Day ${dayNumber}` : label;
}
