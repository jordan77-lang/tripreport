import { useState, useEffect, useRef } from 'react';
import { TripMap } from '../components/TripMap';
import { Ic } from '../components/Ic';
import { T, F, ICONS } from '../tokens';
import { fetchGauge, findNearbyKnownGauges } from '../lib/usgs';
import { fetchCurrentWeather } from '../lib/weather';
import { getCurrentUserId } from '../lib/storage';
import { createPhotoMediaFromFile } from '../lib/media';
import { MediaThumb } from '../components/MediaThumb';
import { VIDEO_ENABLED, VIDEO_DISABLED_HINT, disabledMediaStyle, mediaCaptureLabel } from '../lib/featureFlags';
import { ts } from '../lib/textScale';

export function EntryForm({ type, trip, onSave, onCancel, initialEntry = null, locations = [], defaultLocationId = null }) {
  const initialObservedAt = initialEntry?.observedAt ? new Date(initialEntry.observedAt) : new Date();
  const [title, setTitle]         = useState(initialEntry?.title || '');
  const [notes, setNotes]         = useState(initialEntry?.notes || '');
  const [photoNotes, setPhotoNotes] = useState(initialEntry?.photoNotes || '');
  const [videoNotes, setVideoNotes] = useState(initialEntry?.videoNotes || '');
  const [voiceNotes, setVoiceNotes] = useState(initialEntry?.voiceNotes || '');
  const [photoFiles, setPhotoFiles] = useState(initialEntry?.photoFiles || []);
  const [videoFiles, setVideoFiles] = useState(initialEntry?.videoFiles || []);
  const [voiceFiles, setVoiceFiles] = useState(initialEntry?.voiceFiles || []);
  const [rating, setRating]       = useState(initialEntry?.rating || 0);
  const [featureType, setFeatureType] = useState(initialEntry?.featureType || 'rapid');
  const [mapTagSymbol, setMapTagSymbol] = useState(initialEntry?.mapTagSymbol || defaultTagSymbol(type, initialEntry?.featureType || 'rapid'));
  const [rapidClass, setRapidClass] = useState(initialEntry?.rapidClass || 'III');
  const [cfs, setCfs]             = useState(initialEntry?.cfs != null ? String(initialEntry.cfs) : '');
  const [gaugeSiteId, setGaugeSiteId] = useState(initialEntry?.gaugeSiteId || '');
  const [gaugeSiteName, setGaugeSiteName] = useState(initialEntry?.gaugeSiteName || '');
  const [observedTimeMode, setObservedTimeMode] = useState(initialEntry?.observedAt ? 'custom' : 'now');
  const [observedDate, setObservedDate] = useState(toDateInput(initialObservedAt));
  const [observedTime, setObservedTime] = useState(toTimeInput(initialObservedAt));
  const [gpsMode, setGpsMode]     = useState(initialEntry?.lat && initialEntry?.lng ? 'pin' : 'now');
  const [position, setPosition]   = useState(null);
  const [pinPos, setPinPos]       = useState(initialEntry?.lat && initialEntry?.lng ? { lat: initialEntry.lat, lng: initialEntry.lng } : null);
  const [gpsError, setGpsError]   = useState(null);
  const [locationError, setLocationError] = useState(null);
  const [selectedLocationId, setSelectedLocationId] = useState(
    initialEntry?.locationId || defaultLocationId || locations[0]?.id || null
  );
  const [nearbyGauges, setNearbyGauges] = useState([]);
  const [gaugesLoading, setGaugesLoading] = useState(false);
  const [gaugeError, setGaugeError] = useState(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState(null);
  const [weatherSnapshot, setWeatherSnapshot] = useState(() => {
    if (initialEntry?.weatherTempC == null && !initialEntry?.weatherSummary) return null;
    return {
      temperatureC: initialEntry?.weatherTempC ?? null,
      feelsLikeC: initialEntry?.weatherFeelsLikeC ?? null,
      windKph: initialEntry?.weatherWindKph ?? null,
      windDirectionDeg: initialEntry?.weatherWindDirectionDeg ?? null,
      weatherCode: initialEntry?.weatherCode ?? null,
      summary: initialEntry?.weatherSummary || null,
      fetchedAt: initialEntry?.weatherFetchedAt || null,
      source: initialEntry?.weatherSource || 'open-meteo',
    };
  });
  const [weatherObservation, setWeatherObservation] = useState(initialEntry?.weatherObservation || '');
  const [mediaMode, setMediaMode] = useState('photo');
  const photoCaptureRef = useRef(null);
  const photoAttachRef = useRef(null);
  const videoCaptureRef = useRef(null);
  const videoAttachRef = useRef(null);
  const voiceCaptureRef = useRef(null);
  const voiceAttachRef = useRef(null);

  // Auto-grab GPS on mount
  useEffect(() => {
    if (initialEntry?.lat && initialEntry?.lng) return;
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      pos => setPosition({ lng: pos.coords.longitude, lat: pos.coords.latitude }),
      err => setGpsError(err.message),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }, [initialEntry?.lat, initialEntry?.lng]);

  const isRiver = ['river-feature', 'rapid', 'gauge'].includes(type);
  const isCamp  = type === 'campsite';
  const isRiverFeature = type === 'river-feature' || type === 'rapid';
  const isGaugeEvent = type === 'gauge';
  const selectedLocation = locations.find((l) => l.id === selectedLocationId) || null;
  const coords  = selectedLocation
    ? { lng: selectedLocation.lng, lat: selectedLocation.lat }
    : (gpsMode === 'now' ? position : pinPos);
  const userColor = colorForUser(getCurrentUserId());

  async function lookupNearbyGauges() {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setGaugeError('Offline right now. Save with station info and flow will sync when back online.');
      return;
    }
    if (!coords?.lat || !coords?.lng) {
      setGaugeError('Tag GPS first to find nearby gauges.');
      return;
    }
    setGaugesLoading(true);
    setGaugeError(null);
    try {
      const nearby = findNearbyKnownGauges(coords.lat, coords.lng, { limit: 4, maxMiles: 250 });
      if (!nearby.length) {
        setNearbyGauges([]);
        setGaugeError('No known gauges found nearby.');
        return;
      }
      const detailed = await Promise.all(
        nearby.map(async (g) => {
          try {
            const live = await fetchGauge(g.id);
            return {
              ...g,
              siteName: live.siteName || g.name,
              cfs: live.cfs,
              gaugeHt: live.gaugeHt,
              updatedAt: live.updatedAt,
            };
          } catch {
            return {
              ...g,
              siteName: g.name,
              cfs: null,
              gaugeHt: null,
              updatedAt: null,
            };
          }
        }),
      );
      setNearbyGauges(detailed);
    } finally {
      setGaugesLoading(false);
    }
  }

  function importGaugeFlow(g) {
    if (g.cfs != null) setCfs(String(Math.round(g.cfs)));
    setGaugeSiteId(g.id || '');
    setGaugeSiteName(g.siteName || g.name || '');
    if (!title.trim()) setTitle(`${featureLabel(featureType)} near ${g.siteName.split(',')[0]}`);
    const stamped = `Imported from ${g.siteName} (#${g.id})${g.cfs != null ? ` · ${Math.round(g.cfs)} CFS` : ''} at ${new Date().toLocaleString()}`;
    setNotes(prev => (prev ? `${prev}\n${stamped}` : stamped));
  }

  async function pullCurrentWeather() {
    if (!coords?.lat || !coords?.lng) {
      setWeatherError('Tag GPS first to pull weather for this location.');
      return;
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setWeatherError('Offline right now. Save and weather will sync once you are back online.');
      return;
    }
    setWeatherLoading(true);
    setWeatherError(null);
    try {
      const weather = await fetchCurrentWeather(coords.lat, coords.lng);
      setWeatherSnapshot(weather);
    } catch (err) {
      setWeatherError(err?.message || 'Could not fetch current weather.');
    } finally {
      setWeatherLoading(false);
    }
  }

  function handleSave() {
    if (locations.length && !selectedLocationId) {
      setLocationError('Select a location for this entry.');
      return;
    }

    const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
    const weatherPending = type === 'weather' && coords?.lat != null && coords?.lng != null && (!weatherSnapshot || isOffline);
    const gaugePending = type === 'gauge' && Boolean(gaugeSiteId) && (!cfs || isOffline);

    onSave({
      type,
      locationId: selectedLocationId || undefined,
      locationName: selectedLocation?.name,
      locationType: selectedLocation?.type,
      title: title || defaultTitle(type),
      notes,
      photoNotes: photoNotes || undefined,
      videoNotes: videoNotes || undefined,
      voiceNotes: voiceNotes || undefined,
      photoFiles: photoFiles.length ? photoFiles : undefined,
      videoFiles: videoFiles.length ? videoFiles : undefined,
      voiceFiles: voiceFiles.length ? voiceFiles : undefined,
      rating: isCamp ? rating : undefined,
      featureType: isRiverFeature ? featureType : undefined,
      mapTagSymbol: mapTagSymbol || defaultTagSymbol(type, featureType),
      rapidClass: isRiverFeature && featureType === 'rapid' ? rapidClass : undefined,
      cfs: isRiver && cfs ? parseFloat(cfs) : undefined,
      gaugeSiteId: type === 'gauge' ? (gaugeSiteId || undefined) : undefined,
      gaugeSiteName: type === 'gauge' ? (gaugeSiteName || undefined) : undefined,
      gaugeFetchedAt: type === 'gauge' && !gaugePending ? new Date().toISOString() : undefined,
      gaugeSyncPending: gaugePending || undefined,
      weatherTempC: type === 'weather' ? weatherSnapshot?.temperatureC : undefined,
      weatherFeelsLikeC: type === 'weather' ? weatherSnapshot?.feelsLikeC : undefined,
      weatherWindKph: type === 'weather' ? weatherSnapshot?.windKph : undefined,
      weatherWindDirectionDeg: type === 'weather' ? weatherSnapshot?.windDirectionDeg : undefined,
      weatherCode: type === 'weather' ? weatherSnapshot?.weatherCode : undefined,
      weatherSummary: type === 'weather' ? weatherSnapshot?.summary : undefined,
      weatherFetchedAt: type === 'weather' ? weatherSnapshot?.fetchedAt : undefined,
      weatherSource: type === 'weather' ? weatherSnapshot?.source : undefined,
      weatherObservation: type === 'weather' ? (weatherObservation || undefined) : undefined,
      weatherSyncPending: weatherPending || undefined,
      observedAt: resolveObservedAt({ mode: observedTimeMode, observedDate, observedTime }),
      lng: coords?.lng,
      lat: coords?.lat,
    });
  }

  const RAPID_CLASSES = ['I', 'II', 'III', 'III+', 'IV', 'V'];
  const FEATURE_TYPES = ['rapid', 'obstruction', 'possible camp', 'wildlife', 'hazard', 'portage'];
  const typeColor = isRiver ? '#3A72A8' : isCamp ? T.amber : T.accent;
  const activeMediaFiles = mediaMode === 'photo' ? photoFiles : mediaMode === 'video' ? videoFiles : voiceFiles;
  const activeMediaNotes = mediaMode === 'photo' ? photoNotes : mediaMode === 'video' ? videoNotes : voiceNotes;
  const activeCaptureRef = mediaMode === 'photo' ? photoCaptureRef : mediaMode === 'video' ? videoCaptureRef : voiceCaptureRef;
  const activeAttachRef = mediaMode === 'photo' ? photoAttachRef : mediaMode === 'video' ? videoAttachRef : voiceAttachRef;
  const activeAccept = mediaMode === 'photo' ? 'image/*' : mediaMode === 'video' ? 'video/*' : 'audio/*';
  const activeCaptureMode = mediaMode === 'voice' ? 'microphone' : 'environment';
  const activeCaptureLabel = mediaMode === 'photo' ? 'Take Photo' : mediaMode === 'video' ? 'Record Video' : 'Record Voice';
  const activeAttachLabel = mediaMode === 'photo' ? 'Add Photo' : mediaMode === 'video' ? 'Add Video' : 'Add Audio';

  function setCurrentObservedTime() {
    const now = new Date();
    setObservedDate(toDateInput(now));
    setObservedTime(toTimeInput(now));
  }

  async function addMediaFiles(mode, fileList) {
    if (mode === 'video' && !VIDEO_ENABLED) return;
    const rawFiles = Array.from(fileList || []);
    if (!rawFiles.length) return;
    const files = await Promise.all(rawFiles.map(async (f) => {
      const meta = { name: f.name, size: f.size, type: f.type };
      if (f.type?.startsWith('image/') && trip?.id) {
        try {
          return await createPhotoMediaFromFile(f, trip.id);
        } catch {
          return meta;
        }
      }
      return meta;
    }));
    if (mode === 'photo') setPhotoFiles((prev) => [...prev, ...files]);
    if (mode === 'video') setVideoFiles((prev) => [...prev, ...files]);
    if (mode === 'voice') setVoiceFiles((prev) => [...prev, ...files]);
  }

  function removeMediaFile(mode, index) {
    if (mode === 'photo') setPhotoFiles((prev) => prev.filter((_, i) => i !== index));
    if (mode === 'video') setVideoFiles((prev) => prev.filter((_, i) => i !== index));
    if (mode === 'voice') setVoiceFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function setMediaNotes(mode, value) {
    if (mode === 'photo') setPhotoNotes(value);
    if (mode === 'video') setVideoNotes(value);
    if (mode === 'voice') setVoiceNotes(value);
  }

  return (
    <div style={{ height: '100%', background: T.bg, display: 'flex', flexDirection: 'column', fontFamily: F, overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ background: T.card, padding: '10px 16px 14px', borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div onClick={onCancel} style={{ width: 36, height: 36, borderRadius: 18, background: T.bg,
                                           display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <Ic d="M19 12H5 M12 5l-7 7 7 7" size={18} color={T.text} sw={2} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: ts(19), fontWeight: 800, color: T.text, letterSpacing: -.4, textTransform: 'capitalize' }}>
              {initialEntry ? 'Edit' : 'Log'} {typeLabel(type)}
            </div>
          </div>
          <div style={{ width: 10, height: 10, borderRadius: 5, background: typeColor }} />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>

        {/* Title */}
        {!!locations.length && (
          <div style={{ marginBottom: 16 }}>
            <Label>Attach To Location</Label>
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
              {locations.map((loc) => (
                <div
                  key={loc.id}
                  onClick={() => { setSelectedLocationId(loc.id); setLocationError(null); }}
                  style={{
                    flexShrink: 0,
                    padding: '8px 12px',
                    borderRadius: 16,
                    cursor: 'pointer',
                    fontSize: ts(13),
                    fontWeight: 700,
                    background: selectedLocationId === loc.id ? '#2A5C8E' : T.card,
                    color: selectedLocationId === loc.id ? 'white' : T.textSub,
                    border: selectedLocationId === loc.id ? 'none' : `1px solid ${T.border}`,
                  }}
                >
                  {loc.name}
                </div>
              ))}
            </div>
            {!!selectedLocation && (
              <div style={{ fontSize: ts(12), color: T.textFaint, marginTop: 6 }}>
                {selectedLocation.type} · {selectedLocation.lat?.toFixed(5)}, {selectedLocation.lng?.toFixed(5)}
              </div>
            )}
            {locationError && <div style={{ fontSize: ts(13), color: T.amber, marginTop: 6 }}>{locationError}</div>}
          </div>
        )}

        {locations.length === 0 && (
          <div style={{ marginBottom: 16, background: T.card, border: `1px dashed ${T.border}`, borderRadius: 10, padding: '10px 11px' }}>
            <div style={{ fontSize: ts(14), fontWeight: 700, color: T.text }}>No trip locations yet</div>
            <div style={{ fontSize: ts(13), color: T.textFaint, marginTop: 3 }}>
              Create a map location from the Trip page first, then add entries to it.
            </div>
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <Label>Title</Label>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder={defaultTitle(type)}
            style={inputStyle(T)}
          />
        </div>

        {isRiverFeature && (
          <div style={{ marginBottom: 16 }}>
            <Label>River Feature Type</Label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
              {FEATURE_TYPES.map(ft => (
                <div key={ft} onClick={() => setFeatureType(ft)}
                     style={{ padding: '8px 12px', borderRadius: 20, fontSize: ts(13), fontWeight: 700,
                               cursor: 'pointer', transition: 'all .15s',
                               background: featureType === ft ? '#3A72A8' : T.card,
                               color: featureType === ft ? 'white' : T.textSub,
                               border: featureType === ft ? 'none' : `1.5px solid ${T.border}` }}>
                  {featureLabel(ft)}
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <Label>Map Tag Icon</Label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {['📍', '🌊', '⚠', '⛺', '🦌', '🛶', '📈', '📝'].map((s) => (
              <div key={s} onClick={() => setMapTagSymbol(s)}
                   style={{ width: 40, height: 40, borderRadius: 10, cursor: 'pointer',
                            border: `2px solid ${mapTagSymbol === s ? userColor : T.border}`,
                            background: mapTagSymbol === s ? `${userColor}22` : T.card,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: ts(18) }}>
                {s}
              </div>
            ))}
          </div>
          <div style={{ fontSize: ts(12), color: T.textFaint, marginTop: 4 }}>Tag color follows your user color.</div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <Label>Observed Time</Label>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            {[{ id: 'now', label: 'Use Current Time' }, { id: 'custom', label: 'Pick Date/Time' }].map((opt) => (
              <div key={opt.id} onClick={() => setObservedTimeMode(opt.id)}
                   style={{ padding: '7px 12px', borderRadius: 14, cursor: 'pointer', fontSize: ts(12), fontWeight: 700,
                            background: observedTimeMode === opt.id ? '#2A5C8E' : T.bg,
                            color: observedTimeMode === opt.id ? 'white' : T.textSub,
                            border: observedTimeMode === opt.id ? 'none' : `1px solid ${T.border}` }}>
                {opt.label}
              </div>
            ))}
          </div>
          {observedTimeMode === 'custom' ? (
            <>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input
                  value={observedDate}
                  onChange={e => setObservedDate(e.target.value)}
                  type="date"
                  style={{ ...inputStyle(T), flex: 1 }}
                />
                <input
                  value={observedTime}
                  onChange={e => setObservedTime(e.target.value)}
                  type="time"
                  style={{ ...inputStyle(T), flex: 1 }}
                />
              </div>
              <div onClick={setCurrentObservedTime}
                   style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: T.bg,
                            border: `1px solid ${T.border}`, borderRadius: 9, padding: '6px 9px', cursor: 'pointer' }}>
                <span style={{ fontSize: ts(12), fontWeight: 700, color: T.textSub }}>Set to current time</span>
              </div>
            </>
          ) : (
            <div style={{ fontSize: ts(13), color: T.textFaint }}>This entry will save with the current time when you tap Save.</div>
          )}
        </div>

        {/* Rapid class — river only */}
        {isRiverFeature && featureType === 'rapid' && (
          <div style={{ marginBottom: 16 }}>
            <Label>Rapid Class</Label>
            <div style={{ display: 'flex', gap: 8 }}>
              {RAPID_CLASSES.map(cls => (
                <div key={cls} onClick={() => setRapidClass(cls)}
                     style={{ flex: 1, height: 50, borderRadius: 12, display: 'flex',
                               alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                               background: rapidClass === cls ? classColor(cls) : T.card,
                               border: `1.5px solid ${rapidClass === cls ? classColor(cls) : T.border}`,
                               fontSize: ts(14), fontWeight: 800,
                               color: rapidClass === cls ? 'white' : T.textSub }}>
                  {cls}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CFS — river only */}
        {isRiver && (
          <div style={{ marginBottom: 16 }}>
            <Label>Flow (CFS)</Label>
            <input
              value={cfs}
              onChange={e => setCfs(e.target.value)}
              placeholder="e.g. 1240"
              type="number"
              style={inputStyle(T)}
            />
          </div>
        )}

        {isGaugeEvent && (
          <div style={{ marginBottom: 16 }}>
            <Label>Gauge Station</Label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input
                value={gaugeSiteId}
                onChange={(e) => setGaugeSiteId(e.target.value)}
                placeholder="USGS station id"
                style={{ ...inputStyle(T), flex: 1 }}
              />
              <input
                value={gaugeSiteName}
                onChange={(e) => setGaugeSiteName(e.target.value)}
                placeholder="Station name"
                style={{ ...inputStyle(T), flex: 1 }}
              />
            </div>
            {gaugeSiteId && !cfs && (
              <div style={{ fontSize: ts(12), color: T.textFaint }}>
                Flow can be synced later when you are back online.
              </div>
            )}
          </div>
        )}

        {(isRiverFeature || isGaugeEvent) && (
          <div style={{ marginBottom: 16 }}>
            <Label>Nearby USGS Gauges</Label>
            <div
              onClick={lookupNearbyGauges}
              style={{
                background: gaugesLoading ? T.bg : '#E4EFF8',
                border: `1px solid ${gaugesLoading ? T.border : '#3A72A840'}`,
                borderRadius: 12,
                padding: '10px 12px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                cursor: 'pointer',
                marginBottom: 10,
              }}
            >
              <Ic d={ICONS.gauge} size={14} color={gaugesLoading ? T.textFaint : '#2A5C8E'} sw={1.8} />
              <span style={{ fontSize: ts(13), fontWeight: 700, color: gaugesLoading ? T.textFaint : '#2A5C8E' }}>
                {gaugesLoading ? 'Looking up gauges...' : 'Find nearby gauges'}
              </span>
            </div>

            {gaugeError && <div style={{ fontSize: ts(13), color: T.amber, marginBottom: 8 }}>{gaugeError}</div>}

            {!!nearbyGauges.length && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {nearbyGauges.map(g => (
                  <div key={g.id} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: '10px 11px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: ts(14), fontWeight: 700, color: T.text }}>{g.siteName}</div>
                        <div style={{ fontSize: ts(12), color: T.textFaint }}>
                          #{g.id} · {g.distanceMiles.toFixed(1)} mi away
                        </div>
                        <div style={{ fontSize: ts(12), color: '#2A5C8E', marginTop: 2 }}>
                          {g.cfs != null ? `${Math.round(g.cfs).toLocaleString()} CFS` : 'Flow unavailable'}
                          {g.gaugeHt != null ? ` · ${g.gaugeHt.toFixed(1)} ft` : ''}
                        </div>
                      </div>
                      <div
                        onClick={() => importGaugeFlow(g)}
                        style={{
                          flexShrink: 0,
                          background: '#3A72A8',
                          color: 'white',
                          borderRadius: 9,
                          padding: '8px 12px',
                          fontSize: ts(12),
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        Import
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {type === 'weather' && (
          <div style={{ marginBottom: 16 }}>
            <Label>Current Conditions</Label>
            <div
              onClick={pullCurrentWeather}
              style={{
                background: weatherLoading ? T.bg : '#E4EFF8',
                border: `1px solid ${weatherLoading ? T.border : '#3A72A840'}`,
                borderRadius: 12,
                padding: '10px 12px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                cursor: 'pointer',
                marginBottom: 10,
              }}
            >
              <Ic d={ICONS.compass} size={14} color={weatherLoading ? T.textFaint : '#2A5C8E'} sw={1.8} />
              <span style={{ fontSize: ts(13), fontWeight: 700, color: weatherLoading ? T.textFaint : '#2A5C8E' }}>
                {weatherLoading ? 'Fetching weather...' : 'Pull current weather'}
              </span>
            </div>

            {weatherError && <div style={{ fontSize: ts(13), color: T.amber, marginBottom: 8 }}>{weatherError}</div>}

            {weatherSnapshot && (
              <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: '10px 11px', marginBottom: 8 }}>
                <div style={{ fontSize: ts(14), fontWeight: 700, color: T.text, marginBottom: 2 }}>{weatherSnapshot.summary || 'Conditions'}</div>
                <div style={{ fontSize: ts(12), color: T.textFaint, marginBottom: 4 }}>
                  {weatherSnapshot.fetchedAt ? new Date(weatherSnapshot.fetchedAt).toLocaleString() : 'Now'}
                </div>
                <div style={{ fontSize: ts(13), color: '#2A5C8E', fontWeight: 600 }}>
                  {weatherSnapshot.temperatureC != null ? `${Math.round(cToF(weatherSnapshot.temperatureC))}°F` : 'Temp n/a'}
                  {weatherSnapshot.windKph != null ? ` · Wind ${Math.round(weatherSnapshot.windKph)} km/h` : ''}
                </div>
              </div>
            )}

            <textarea
              value={weatherObservation}
              onChange={(e) => setWeatherObservation(e.target.value)}
              placeholder="Personal weather observations (cloud cover, visibility, gusts, etc.)"
              rows={2}
              style={{ ...inputStyle(T), resize: 'none', height: 'auto' }}
            />
          </div>
        )}

        {/* Star rating — campsite only */}
        {isCamp && (
          <div style={{ marginBottom: 16 }}>
            <Label>Site Rating</Label>
            <div style={{ display: 'flex', gap: 8 }}>
              {[1, 2, 3, 4, 5].map(n => (
                <div key={n} onClick={() => setRating(n)}
                     style={{ flex: 1, height: 50, borderRadius: 12, display: 'flex',
                               alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: ts(20),
                               background: rating >= n ? T.amberLight : T.card,
                               border: `1.5px solid ${rating >= n ? T.amber : T.border}` }}>
                  {rating >= n ? '★' : '☆'}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
        <div style={{ marginBottom: 16 }}>
          <Label>Notes</Label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Describe what you found..."
            rows={3}
            style={{ ...inputStyle(T), resize: 'none', height: 'auto' }}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <Label>Media</Label>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            {[
              { id: 'photo', label: `Photos (${photoFiles.length})`, icon: ICONS.camera },
              { id: 'video', label: `Videos (${videoFiles.length})`, icon: ICONS.video, videoOnly: true },
              { id: 'voice', label: `Audio (${voiceFiles.length})`, icon: ICONS.mic },
            ].map((opt) => {
              const disabled = opt.videoOnly && !VIDEO_ENABLED;
              return (
              <div key={opt.id} onClick={() => { if (!disabled) setMediaMode(opt.id); }}
                   title={disabled ? VIDEO_DISABLED_HINT : undefined}
                   style={{ flex: 1, padding: '10px 12px', borderRadius: 10, cursor: disabled ? 'not-allowed' : 'pointer',
                            border: `1.5px solid ${mediaMode === opt.id ? '#2A5C8E' : T.border}`,
                            background: mediaMode === opt.id ? '#E4EFF8' : T.card,
                            display: 'flex', alignItems: 'center', gap: 7, justifyContent: 'center',
                            ...(disabled ? disabledMediaStyle() : {}) }}>
                <Ic d={opt.icon} size={14} color={disabled ? T.textFaint : mediaMode === opt.id ? '#2A5C8E' : T.textSub} sw={1.8} />
                <span style={{ fontSize: ts(12), fontWeight: 700, color: disabled ? T.textFaint : mediaMode === opt.id ? '#2A5C8E' : T.textSub }}>{opt.label}</span>
              </div>
            );})}
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <div onClick={() => { if (mediaMode !== 'video' || VIDEO_ENABLED) activeCaptureRef.current?.click(); }}
                 style={{ background: '#E4EFF8', border: '1px solid #3A72A840', borderRadius: 10, padding: '10px 12px', fontSize: ts(13), fontWeight: 700, color: '#2A5C8E', cursor: 'pointer', ...(mediaMode === 'video' && !VIDEO_ENABLED ? disabledMediaStyle() : {}) }}>
              {activeCaptureLabel}
            </div>
            <div onClick={() => { if (mediaMode !== 'video' || VIDEO_ENABLED) activeAttachRef.current?.click(); }}
                 style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 10, padding: '10px 12px', fontSize: ts(13), fontWeight: 700, color: T.textSub, cursor: 'pointer', ...(mediaMode === 'video' && !VIDEO_ENABLED ? disabledMediaStyle() : {}) }}>
              {activeAttachLabel}
            </div>
          </div>

          <input ref={activeCaptureRef} type="file" accept={activeAccept} capture={activeCaptureMode} style={{ display: 'none' }} onChange={(e) => addMediaFiles(mediaMode, e.target.files)} />
          <input ref={activeAttachRef} type="file" accept={activeAccept} style={{ display: 'none' }} onChange={(e) => addMediaFiles(mediaMode, e.target.files)} />

          {!!activeMediaFiles.length && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
              {activeMediaFiles.map((f, idx) => (
                <div key={f.id || `${f.name}-${idx}`} style={{ position: 'relative' }}>
                  {f.thumbDataUrl || f.id ? (
                    <MediaThumb media={f} alt={f.name}
                         style={{ width: 72, height: 72, borderRadius: 10, objectFit: 'contain', background: '#F0EDE8', border: `1px solid ${T.border}`, display: 'block' }} />
                  ) : (
                    <div style={{ width: 72, height: 72, borderRadius: 10, background: T.card, border: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 3 }}>
                      <span style={{ fontSize: 18 }}>{mediaMode === 'video' ? '🎥' : mediaMode === 'voice' ? '🎙' : '📷'}</span>
                      <span style={{ fontSize: 9, color: T.textFaint, textAlign: 'center', padding: '0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 68 }}>{f.name}</span>
                    </div>
                  )}
                  <div onClick={() => removeMediaFile(mediaMode, idx)}
                       style={{ position: 'absolute', top: -5, right: -5, width: 18, height: 18, borderRadius: 9, background: '#C04040', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                    <span style={{ fontSize: 10, color: 'white', fontWeight: 700, lineHeight: 1 }}>✕</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <textarea
            value={activeMediaNotes}
            onChange={(e) => setMediaNotes(mediaMode, e.target.value)}
            placeholder={mediaMode === 'photo' ? 'Photo caption (optional)' : mediaMode === 'video' ? 'Video note (optional)' : 'Audio summary (optional)'}
            rows={2}
            style={{ ...inputStyle(T), resize: 'none', height: 'auto' }}
          />
        </div>

        {/* GPS */}
        <div style={{ marginBottom: 16 }}>
          <Label>GPS Tag</Label>
          {!!selectedLocation && (
            <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: '10px 12px', fontSize: ts(13), color: T.textSub, marginBottom: 10 }}>
              GPS is linked from location: <span style={{ color: '#2A5C8E', fontWeight: 700 }}>{selectedLocation.name}</span>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            {[
              { id: 'now', label: 'Tag Now', sub: position ? `${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}` : 'Getting location…' },
              { id: 'pin', label: 'Pin on Map', sub: pinPos ? `${pinPos.lat.toFixed(5)}, ${pinPos.lng.toFixed(5)}` : 'Tap map below' },
            ].map(opt => (
              <div key={opt.id} onClick={() => setGpsMode(opt.id)}
                   style={{ flex: 1, padding: '10px 12px', borderRadius: 12, cursor: 'pointer',
                             background: gpsMode === opt.id ? T.accentLight : T.card,
                             border: `1.5px solid ${gpsMode === opt.id ? T.accent : T.border}` }}>
                <div style={{ fontSize: ts(12), fontWeight: 700, color: gpsMode === opt.id ? T.accent : T.text }}>{opt.label}</div>
                <div style={{ fontSize: ts(11), color: T.textFaint, marginTop: 2 }}>{opt.sub}</div>
              </div>
            ))}
          </div>

          {gpsError && (
            <div style={{ fontSize: ts(13), color: T.amber, marginBottom: 8 }}>⚠ {gpsError}</div>
          )}

          {gpsMode === 'pin' && (
            <div style={{ borderRadius: 12, overflow: 'hidden', height: 200 }}>
              <TripMap
                zoom={13}
                center={selectedLocation ? { lng: selectedLocation.lng, lat: selectedLocation.lat } : position}
                track={trip?.track ?? []}
                interactive
                onMapClick={pos => setPinPos(pos)}
              />
              {pinPos && (
                <div style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
                               background: T.accent, borderRadius: 8, padding: '4px 10px',
                               fontSize: 11, fontWeight: 700, color: 'white', pointerEvents: 'none' }}>
                  ✓ Pin placed
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Save CTA */}
      <div style={{ padding: '12px 16px 16px', background: T.card, borderTop: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div onClick={handleSave}
             style={{ background: typeColor, borderRadius: 14, padding: '15px', textAlign: 'center',
                      boxShadow: `0 4px 16px ${typeColor}50`, cursor: locations.length && !selectedLocationId ? 'not-allowed' : 'pointer',
                      opacity: locations.length && !selectedLocationId ? 0.6 : 1 }}>
          <span style={{ fontSize: ts(16), fontWeight: 800, color: 'white', letterSpacing: -.2 }}>
            {initialEntry ? 'Update Entry' : 'Save Entry'}
          </span>
        </div>
      </div>
    </div>
  );
}

const Label = ({ children }) => (
  <div style={{ fontSize: ts(11), fontWeight: 700, color: T.textSub, letterSpacing: .7,
                 textTransform: 'uppercase', marginBottom: 7, fontFamily: F }}>{children}</div>
);

const inputStyle = (T) => ({
  width: '100%', border: `1.5px solid ${T.border}`, borderRadius: 12, padding: '12px 14px',
  fontSize: ts(14), fontFamily: F, color: T.text, background: T.card, outline: 'none', boxSizing: 'border-box',
});

function defaultTitle(type) {
  const map = { campsite: 'Campsite', water: 'Water Crossing', wildlife: 'Wildlife Sighting',
                rapid: 'Rapid', 'river-feature': 'River Feature', gauge: 'River Flow Check', weather: 'Weather Check', note: 'Event', food: 'Meal', voice: 'Voice Note', video: mediaCaptureLabel('Photo / Video'), 'custom-event': 'Custom Event' };
  return map[type] || type;
}

function typeLabel(type) {
  const map = { 'river-feature': 'River Feature', 'custom-event': 'Custom Event', gauge: 'River Flow', weather: 'Weather', video: mediaCaptureLabel('Photo / Video') };
  return map[type] || type;
}

function featureLabel(featureType) {
  const map = {
    rapid: 'Rapid',
    obstruction: 'Obstruction',
    'possible camp': 'Possible Camp',
    wildlife: 'Wildlife',
    hazard: 'Hazard',
    portage: 'Portage',
  };
  return map[featureType] || featureType;
}

function toDateInput(date) {
  const pad = (n) => String(n).padStart(2, '0');
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  return `${y}-${m}-${d}`;
}

function toTimeInput(date) {
  const pad = (n) => String(n).padStart(2, '0');
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());
  return `${h}:${min}`;
}

function resolveObservedAt({ mode, observedDate, observedTime }) {
  if (mode === 'now') return new Date().toISOString();
  if (!observedDate) return new Date().toISOString();
  const composed = `${observedDate}T${observedTime || '00:00'}`;
  const parsed = new Date(composed);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function classColor(cls) {
  if (cls === 'V') return '#C04040';
  if (cls.startsWith('IV')) return '#B8702E';
  if (cls.startsWith('III')) return '#3A72A8';
  return '#4A8A34';
}

function defaultTagSymbol(type, featureType) {
  if (type === 'river-feature') {
    const map = {
      rapid: '🌊', obstruction: '⚠', 'possible camp': '⛺', wildlife: '🦌', hazard: '⛔', portage: '🛶',
    };
    return map[featureType] || '🌊';
  }
  const map = {
    campsite: '⛺',
    water: '💧',
    wildlife: '🦌',
    weather: '⛅',
    rapid: '🌊',
    gauge: '📈',
    'custom-event': '✨',
    note: '📝',
    food: '🍴',
    voice: '🎙',
    video: '🎥',
  };
  return map[type] || '📍';
}

function colorForUser(authorId) {
  const palette = ['#3A72A8', '#B8702E', '#4A7A34', '#7A4ACF', '#C05050', '#2A5C8E', '#9A6D1A'];
  let hash = 0;
  const id = authorId || 'unknown';
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash) + id.charCodeAt(i);
  return palette[Math.abs(hash) % palette.length];
}

function cToF(c) {
  return (c * 9) / 5 + 32;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function resizeDataUrl(dataUrl, maxSide, mimeType) {
  const mime = mimeType === 'image/png' ? 'image/png' : mimeType === 'image/webp' ? 'image/webp' : 'image/jpeg';
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const ratio = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * ratio));
      const h = Math.max(1, Math.round(img.height * ratio));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('no ctx')); return; }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL(mime, 0.72));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

