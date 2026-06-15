import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { Ic } from '../components/Ic';
import { T, F, ICONS } from '../tokens';
import { createTrip, getContacts, saveContact } from '../lib/storage';
import { createCoverPhotoFromFile } from '../lib/media';
import { pushTripToCloud } from '../lib/tripCloud';
import { supabaseConfigured } from '../lib/supabase';
import { listMapRegions, regionMatchesTripTypes } from '../lib/mapRegions';
import { preloadMapRegions } from '../lib/offlineMaps';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const ALL_TYPES = ['Backpacking', 'Car Camping', 'Rafting', 'River Camping', 'Overlanding', 'Van Life', 'Day Hike', 'Paddling'];

// Zoom level size estimates (MB per zoom increment, rough)
const ZOOM_OPTIONS = [
  { level: 10, label: 'Region overview', detail: 'Roads, rivers, peaks', estimateMb: 8 },
  { level: 12, label: 'Trail detail',    detail: 'Trails, campsites, terrain', estimateMb: 35 },
  { level: 14, label: 'High detail',     detail: 'Fine terrain, rapids, features', estimateMb: 120 },
];

export function NewTrip({ onDone, onBack }) {
  const [step, setStep]       = useState(1);
  const [name, setName]       = useState('');
  const [types, setTypes]     = useState([]);
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState('');
  const [planAhead, setPlanAhead] = useState(false);
  const [privacy, setPrivacy] = useState('friends');
  const [inviteInput, setInviteInput] = useState('');
  const [invites, setInvites] = useState([]);
  const [contacts, setContacts] = useState(() => getContacts());
  const [coverPhoto, setCoverPhoto] = useState(null);
  // Map area state
  const [mapSearch, setMapSearch]     = useState('');
  const [mapCenter, setMapCenter]     = useState({ lng: -111.0, lat: 34.0 });
  const [mapZoom, setMapZoom]         = useState(7);
  const [mapBounds, setMapBounds]     = useState(null);
  const [maxZoom, setMaxZoom]         = useState(12);
  const [selectedOfflineRegions, setSelectedOfflineRegions] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching]     = useState(false);
  const mapContainerRef = useRef(null);
  const mapRef          = useRef(null);
  const boundsBoxRef    = useRef(null);

  function toggleType(t) {
    setTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
  }

  function addInvite(nameOverride) {
    const value = (nameOverride || inviteInput).trim();
    if (!value) return;
    if (invites.some(i => (i.handle || i.name || '').toLowerCase() === value.toLowerCase())) {
      setInviteInput('');
      return;
    }
    setInvites(prev => [...prev, { id: crypto.randomUUID(), handle: value, name: value, role: 'contributor' }]);
    saveContact(value);
    setContacts(getContacts());
    setInviteInput('');
  }

  function removeInvite(id) {
    setInvites(prev => prev.filter(i => i.id !== id));
  }

  async function onTripCoverSelected(files) {
    const file = Array.from(files || [])[0];
    if (!file) return;
    const nextCover = await createCoverPhotoFromFile(file);
    setCoverPhoto(nextCover);
  }

  async function searchPlace() {
    const q = mapSearch.trim();
    if (!q || !mapboxgl.accessToken) return;
    setSearching(true);
    setSearchResults([]);
    try {
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${mapboxgl.accessToken}&types=place,region,district,locality,neighborhood,poi&limit=5`;
      const res = await fetch(url);
      const data = await res.json();
      setSearchResults(data.features || []);
    } catch { /* ignore */ }
    setSearching(false);
  }

  function pickPlace(feature) {
    setSearchResults([]);
    setMapSearch(feature.place_name || feature.text || '');
    const [lng, lat] = feature.center;
    const bbox = feature.bbox; // [minLng, minLat, maxLng, maxLat]
    if (mapRef.current) {
      if (bbox) {
        mapRef.current.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 40, duration: 600 });
      } else {
        mapRef.current.flyTo({ center: [lng, lat], zoom: 11, duration: 600 });
      }
    }
    setMapCenter({ lng, lat });
  }

  // Init map on step 3
  useEffect(() => {
    if (step !== 3) return;
    if (mapRef.current) return;
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/outdoors-v12',
      center: [mapCenter.lng, mapCenter.lat],
      zoom: mapZoom,
    });
    mapRef.current = map;

    map.on('load', () => {
      updateBoundsBox(map);
    });
    map.on('moveend', () => {
      const c = map.getCenter();
      const z = map.getZoom();
      setMapCenter({ lng: c.lng, lat: c.lat });
      setMapZoom(z);
      setMapBounds(map.getBounds());
      updateBoundsBox(map);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  function updateBoundsBox(map) {
    const bounds = map.getBounds();
    setMapBounds(bounds);
  }

  function estimateMb() {
    const opt = ZOOM_OPTIONS.find(z => z.level === maxZoom);
    return opt ? opt.estimateMb : 35;
  }

  function isFutureStartDate(dateStr) {
    if (!dateStr) return false;
    const start = new Date(`${dateStr}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return start.getTime() > today.getTime();
  }

  function resolveTripStatus() {
    return planAhead || isFutureStartDate(startDate) ? 'planning' : 'active';
  }

  function toggleOfflineRegion(id) {
    setSelectedOfflineRegions((prev) => (
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    ));
  }

  async function handleLaunch() {
    const status = resolveTripStatus();
    const offlineRegions = selectedOfflineRegions;
    const catalogRegion = offlineRegions.length === 1 ? listMapRegions().find((r) => r.id === offlineRegions[0]) : null;

    const trip = createTrip({
      name: name || 'My Trip',
      types,
      privacy,
      startDate: startDate || new Date().toISOString().slice(0, 10),
      endDate: endDate || null,
      status,
      collaborators: invites,
      offlineRegions,
      gpsTrackingEnabled: false,
      gpsBackgroundTracking: false,
      gpsIntervalMs: 15000,
      coverPhoto,
      mapArea: mapBounds ? {
        sw: { lng: mapBounds.getWest(), lat: mapBounds.getSouth() },
        ne: { lng: mapBounds.getEast(), lat: mapBounds.getNorth() },
        center: mapCenter,
        maxZoom,
      } : (catalogRegion ? {
        sw: catalogRegion.bounds.sw,
        ne: catalogRegion.bounds.ne,
        center: catalogRegion.center,
        maxZoom: catalogRegion.defaultZoom || 12,
      } : null),
      location: catalogRegion ? catalogRegion.area : undefined,
    });

    if (offlineRegions.length) {
      void preloadMapRegions(offlineRegions);
    }

    if (supabaseConfigured) {
      try {
        await pushTripToCloud(trip);
      } catch (e) {
        console.error('Cloud sync failed — trip saved locally', e);
      }
    }

    onDone(trip);
  }

  const willPlanAhead = resolveTripStatus() === 'planning';

  const privacyOpts = [
    { id: 'private', icon: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', label: 'Private',    sub: 'Only you' },
    { id: 'friends', icon: ICONS.users,                                      label: 'Followers', sub: 'Your followers can view' },
    { id: 'public',  icon: ICONS.compass,                                    label: 'Public',    sub: 'Anyone can discover' },
  ];

  const currentCollaboratorNames = new Set(invites.map(i => (i.handle || i.name || '').toLowerCase()));
  const suggestions = contacts.filter(c => {
    if (currentCollaboratorNames.has(c.name.toLowerCase())) return false;
    if (!inviteInput.trim()) return true;
    return c.name.toLowerCase().includes(inviteInput.toLowerCase());
  });

  return (
    <div style={{ height: '100%', background: T.bg, display: 'flex', flexDirection: 'column', fontFamily: F, overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ background: T.card, padding: '10px 16px 14px', borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <div onClick={onBack} style={{ width: 36, height: 36, borderRadius: 18, background: T.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <Ic d="M19 12H5 M12 5l-7 7 7 7" size={18} color={T.text} sw={2} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: T.text, letterSpacing: -.4 }}>New Trip</div>
          </div>
          <div style={{ fontSize: 12, color: T.textFaint }}>{step} of 3</div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {[1, 2, 3].map(s => (
            <div key={s} style={{ flex: 1, height: 3, background: step >= s ? T.accent : T.border, borderRadius: 2 }} />
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: step === 3 ? 'hidden' : 'auto', padding: step === 3 ? 0 : '18px 16px', display: 'flex', flexDirection: 'column' }}>

        {/* ── Step 1: Basics ── */}
        {step === 1 && (
          <>
            <div style={{ marginBottom: 18 }}>
              <Label>Trip Name</Label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Salt River Run" style={inputStyle(T)} />
            </div>

            <div style={{ marginBottom: 18 }}>
              <Label>Trip Cover Photo</Label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <label style={{ background: '#E4EFF8', border: '1px solid #3A72A840', borderRadius: 10, padding: '8px 10px', fontSize: 11, fontWeight: 700, color: '#2A5C8E', cursor: 'pointer' }}>
                  Choose Photo
                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => onTripCoverSelected(e.target.files)} />
                </label>
                {!!coverPhoto && <span onClick={() => setCoverPhoto(null)} style={{ fontSize: 10.5, color: T.textFaint, cursor: 'pointer' }}>Remove</span>}
              </div>
              {!!coverPhoto && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: '8px 9px' }}>
                  {coverPhoto.thumbDataUrl
                    ? <img src={coverPhoto.thumbDataUrl} alt="Trip cover" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 8 }} />
                    : <div style={{ width: 44, height: 44, borderRadius: 8, background: T.bg, border: `1px solid ${T.border}` }} />}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11.5, color: T.text, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{coverPhoto.name}</div>
                    <div style={{ fontSize: 10, color: T.textFaint }}>{Math.round((coverPhoto.size || 0) / 1024)} KB</div>
                  </div>
                </div>
              )}
            </div>

            <div style={{ marginBottom: 18 }}>
              <Label>Activity Type (select all that apply)</Label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                {ALL_TYPES.map(t => (
                  <div key={t} onClick={() => toggleType(t)}
                       style={{ padding: '7px 13px', borderRadius: 22, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                                background: types.includes(t) ? T.accent : T.card,
                                color: types.includes(t) ? 'white' : T.textSub,
                                border: types.includes(t) ? 'none' : `1.5px solid ${T.border}` }}>
                    {t}
                  </div>
                ))}
              </div>
              {types.length > 0 && <div style={{ marginTop: 8, fontSize: 11, color: T.accentMid }}>✓ {types.join(' + ')}</div>}
            </div>

            <div style={{ marginBottom: 18 }}>
              <Label>Planned Dates</Label>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: T.textFaint, marginBottom: 4 }}>Start</div>
                  <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={inputStyle(T)} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: T.textFaint, marginBottom: 4 }}>End (optional)</div>
                  <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={inputStyle(T)} />
                </div>
              </div>
              <div onClick={() => setPlanAhead(v => !v)}
                   style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 13px', background: T.card, borderRadius: 12, cursor: 'pointer', border: `1.5px solid ${planAhead ? T.accent : T.border}`, boxShadow: planAhead ? `0 0 0 3px ${T.accent}14` : 'none' }}>
                <div style={{ width: 20, height: 20, borderRadius: 6, border: `2px solid ${planAhead ? T.accent : T.border}`, background: planAhead ? T.accent : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {planAhead && <Ic d="M20 6L9 17l-5-5" size={12} color="white" sw={3} />}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Plan ahead</div>
                  <div style={{ fontSize: 11, color: T.textFaint, marginTop: 1 }}>Save as upcoming trip — start GPS and journal when you hit the road</div>
                </div>
              </div>
              {(planAhead || isFutureStartDate(startDate)) && (
                <div style={{ fontSize: 10.5, color: T.accentMid, marginTop: 8 }}>
                  This trip will be saved under Upcoming until you start it.
                </div>
              )}
            </div>
          </>
        )}

        {/* ── Step 2: People & Privacy ── */}
        {step === 2 && (
          <>
            <div style={{ marginBottom: 18 }}>
              <Label>Trip Participants</Label>
              <div style={{ position: 'relative', marginBottom: 10 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    value={inviteInput}
                    onChange={e => setInviteInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') addInvite(); }}
                    placeholder="Search or add by name"
                    style={inputStyle(T)}
                  />
                  <div onClick={() => addInvite()} style={{ minWidth: 72, borderRadius: 12, background: T.accent, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 12, fontWeight: 800 }}>
                    Add
                  </div>
                </div>
                {suggestions.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 80, background: T.card, border: `1px solid ${T.border}`, borderRadius: 9, marginTop: 3, zIndex: 20, boxShadow: '0 4px 12px rgba(0,0,0,.10)', overflow: 'hidden' }}>
                    {suggestions.map(c => (
                      <div key={c.id} onClick={() => addInvite(c.name)}
                           style={{ padding: '8px 12px', fontSize: 12, color: T.text, cursor: 'pointer', borderBottom: `1px solid ${T.border}` }}>
                        {c.name}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {invites.length === 0
                ? <div style={{ fontSize: 11, color: T.textFaint }}>No participants yet. Continue solo or add people above.</div>
                : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {invites.map(i => (
                      <div key={i.id} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 700, color: T.text }}>{i.handle || i.name}</div>
                        </div>
                        <div onClick={() => removeInvite(i.id)} style={{ color: T.textFaint, cursor: 'pointer', fontSize: 13 }}>✕</div>
                      </div>
                    ))}
                  </div>
                )}
            </div>

            <div style={{ marginBottom: 18 }}>
              <Label>Who Can See This Trip</Label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {privacyOpts.map(opt => (
                  <div key={opt.id} onClick={() => setPrivacy(opt.id)}
                       style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', background: T.card, borderRadius: 12, cursor: 'pointer', border: `1.5px solid ${privacy === opt.id ? T.accent : T.border}`, boxShadow: privacy === opt.id ? `0 0 0 3px ${T.accent}14` : 'none' }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: privacy === opt.id ? T.accent : T.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Ic d={opt.icon} size={16} color={privacy === opt.id ? 'white' : T.textSub} sw={1.8} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{opt.label}</div>
                      <div style={{ fontSize: 11, color: T.textFaint, marginTop: 1 }}>{opt.sub}</div>
                    </div>
                    <div style={{ width: 20, height: 20, borderRadius: 10, border: `2px solid ${privacy === opt.id ? T.accent : T.border}`, background: privacy === opt.id ? T.accent : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {privacy === opt.id && <div style={{ width: 8, height: 8, borderRadius: 4, background: 'white' }} />}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ background: T.accentLight, borderRadius: 12, padding: '12px 14px', marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: T.accent, marginBottom: 4 }}>Trip summary</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: T.text }}>{name || 'Unnamed Trip'}</div>
              <div style={{ fontSize: 11, color: T.accentMid, marginTop: 2 }}>{types.join(' · ') || 'No activity type'}</div>
              <div style={{ fontSize: 11, color: T.accentMid, marginTop: 2 }}>{invites.length} {invites.length === 1 ? 'participant' : 'participants'}</div>
            </div>
          </>
        )}

        {/* ── Step 3: Map Area ── */}
        {step === 3 && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Search bar */}
            <div style={{ padding: '12px 16px 8px', background: T.card, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: T.textSub, letterSpacing: .7, textTransform: 'uppercase', marginBottom: 6 }}>Trip Map Area</div>
              <div style={{ fontSize: 11, color: T.textFaint, marginBottom: 8 }}>
                Search for your destination, then pan and zoom the map to frame your trip area. The map will cache tiles as you explore.
              </div>
              <div style={{ position: 'relative' }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    value={mapSearch}
                    onChange={e => setMapSearch(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') searchPlace(); }}
                    placeholder="Search place, river, trailhead…"
                    style={{ ...inputStyle(T), fontSize: 12, padding: '8px 11px' }}
                  />
                  <div onClick={searchPlace} style={{ padding: '8px 14px', borderRadius: 10, background: T.accent, color: 'white', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
                    {searching ? '…' : <><Ic d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" size={14} color="white" sw={2} /> Go</>}
                  </div>
                </div>
                {searchResults.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, marginTop: 3, zIndex: 30, boxShadow: '0 6px 20px rgba(0,0,0,.14)', overflow: 'hidden' }}>
                    {searchResults.map(f => (
                      <div key={f.id} onClick={() => pickPlace(f)}
                           style={{ padding: '10px 13px', fontSize: 12, color: T.text, cursor: 'pointer', borderBottom: `1px solid ${T.border}`, display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <span style={{ fontWeight: 700 }}>{f.text}</span>
                        <span style={{ fontSize: 10.5, color: T.textFaint }}>{f.place_name}</span>
                      </div>
                    ))}
                    <div onClick={() => setSearchResults([])} style={{ padding: '7px 13px', fontSize: 10.5, color: T.textFaint, cursor: 'pointer', textAlign: 'center' }}>Dismiss</div>
                  </div>
                )}
              </div>
            </div>

            {/* Map */}
            <div ref={mapContainerRef} style={{ flex: 1, minHeight: 0 }} />

            {/* Zoom / detail control */}
            <div style={{ padding: '10px 16px', background: T.card, borderTop: `1px solid ${T.border}`, flexShrink: 0 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: T.textSub, letterSpacing: .6, textTransform: 'uppercase', marginBottom: 6 }}>Map Detail Level</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {ZOOM_OPTIONS.map(z => (
                  <div key={z.level} onClick={() => setMaxZoom(z.level)}
                       style={{ flex: 1, padding: '8px 6px', borderRadius: 10, cursor: 'pointer', textAlign: 'center',
                                border: `1.5px solid ${maxZoom === z.level ? T.accent : T.border}`,
                                background: maxZoom === z.level ? T.accentLight : T.bg }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: maxZoom === z.level ? T.accent : T.text }}>{z.label}</div>
                    <div style={{ fontSize: 9.5, color: T.textFaint, marginTop: 2 }}>~{z.estimateMb} MB</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 10, color: T.textFaint, marginTop: 6 }}>
                Tiles load on demand when online. For no-service areas, add an offline map pack below.
              </div>

              <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${T.border}` }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: T.textSub, letterSpacing: .6, textTransform: 'uppercase', marginBottom: 6 }}>
                  Offline map packs (optional)
                </div>
                <div style={{ fontSize: 10.5, color: T.textFaint, marginBottom: 8 }}>
                  Download on Wi‑Fi before your trip. More regions will appear here over time.
                </div>
                {listMapRegions().map((region) => {
                  const suggested = regionMatchesTripTypes(region, types);
                  const checked = selectedOfflineRegions.includes(region.id);
                  return (
                    <div
                      key={region.id}
                      onClick={() => toggleOfflineRegion(region.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 10,
                        padding: '9px 10px',
                        marginBottom: 6,
                        borderRadius: 10,
                        cursor: 'pointer',
                        border: `1.5px solid ${checked ? T.accent : T.border}`,
                        background: checked ? T.accentLight : T.bg,
                      }}
                    >
                      <div style={{
                        width: 18, height: 18, borderRadius: 5, marginTop: 1, flexShrink: 0,
                        border: `2px solid ${checked ? T.accent : T.border}`,
                        background: checked ? T.accent : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {checked && <Ic d="M20 6L9 17l-5-5" size={10} color="white" sw={3} />}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: T.text }}>{region.name}</div>
                        <div style={{ fontSize: 10.5, color: T.textFaint }}>{region.description}</div>
                        {suggested && !checked && (
                          <div style={{ fontSize: 10, color: T.accentMid, marginTop: 3, fontWeight: 600 }}>Suggested for your activity types</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* CTA */}
      <div style={{ padding: '12px 16px 16px', background: T.card, borderTop: `1px solid ${T.border}`, flexShrink: 0 }}>
        {step < 3 ? (
          <div onClick={() => setStep(s => Math.min(3, s + 1))}
               style={{ background: T.accent, borderRadius: 14, padding: '15px', textAlign: 'center', boxShadow: `0 4px 16px ${T.accent}50`, cursor: 'pointer' }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: 'white' }}>Continue →</span>
          </div>
        ) : (
          <div onClick={handleLaunch}
               style={{ background: T.accent, borderRadius: 14, padding: '16px', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, boxShadow: `0 6px 22px ${T.accent}55`, cursor: 'pointer' }}>
            {!willPlanAhead && <div style={{ width: 10, height: 10, borderRadius: 5, background: '#5DBE7E' }} />}
            <span style={{ fontSize: 16, fontWeight: 800, color: 'white', letterSpacing: -.3 }}>
              {willPlanAhead ? 'Save Trip Plan' : 'Start Recording Trip'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

const Label = ({ children }) => (
  <div style={{ fontSize: 10.5, fontWeight: 700, color: T.textSub, letterSpacing: .7, textTransform: 'uppercase', marginBottom: 7 }}>{children}</div>
);

const inputStyle = (T) => ({
  width: '100%', border: `1.5px solid ${T.border}`, borderRadius: 12, padding: '11px 14px',
  fontSize: 13.5, fontFamily: F, color: T.text, background: T.card, outline: 'none', boxSizing: 'border-box',
});
