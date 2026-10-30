import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { TripMap } from '../components/TripMap';
import { PlaceSearch } from '../components/PlaceSearch';
import { Ic } from '../components/Ic';
import { T, F, ICONS } from '../tokens';
import { fetchGauge, findNearbyKnownGauges } from '../lib/usgs';
import { fetchWeatherAtTime } from '../lib/weather';
import { createPhotoMediaFromFile, createAudioMediaFromFile } from '../lib/media';
import { MediaThumb } from '../components/MediaThumb';
import { VoiceRecorder } from '../components/VoiceRecorder';
import { AudioAttachment } from '../components/AudioAttachment';
import { EntryLocationPicker } from '../components/EntryLocationPicker';
import { VIDEO_ENABLED, VIDEO_DISABLED_HINT, disabledMediaStyle, mediaCaptureLabel } from '../lib/featureFlags';
import { ts } from '../lib/textScale';
import { addMeal, getTrips } from '../lib/storage';
import { MEAL_SLOTS as MEAL_SLOT_IDS, SLOT_LABEL, mealDaysLabel, mealSlotOrder } from '../lib/mealSlots';
import { listSavedMeals, publishSavedMeal, refreshSharedMeals, rememberMeal, savedMealByName } from '../lib/mealLibrary';

/**
 * Entry capture inside an event.
 *
 * The event already establishes WHERE (its location) and WHEN (its observedAt),
 * so this form does not re-ask for either. It only collects what is specific to
 * this observation. Anything the app can derive — coordinates, time, weather at
 * that time, river flow at that time — is derived, not typed.
 *
 * `event` supplies the time/place context. When it is absent (legacy callers) the
 * form falls back to the selected location and "now".
 */
export function EntryForm({
  type,
  trip,
  onSave,
  onCancel,
  initialEntry = null,
  locations = [],
  defaultLocationId = null,
  event = null,
  allowUnlinked = false,
  lockLocation = false,
  saveError = null,
}) {
  const [notes, setNotes]         = useState(initialEntry?.notes || '');
  const [photoFiles, setPhotoFiles] = useState(initialEntry?.photoFiles || []);
  const [videoFiles, setVideoFiles] = useState(initialEntry?.videoFiles || []);
  const [voiceFiles, setVoiceFiles] = useState(initialEntry?.voiceFiles || []);
  const [rating, setRating]       = useState(initialEntry?.rating || 0);
  const [featureType, setFeatureType] = useState(initialEntry?.featureType || 'rapid');
  const [rapidClass, setRapidClass] = useState(initialEntry?.rapidClass || 'III');
  const [cfs, setCfs]             = useState(initialEntry?.cfs != null ? String(initialEntry.cfs) : '');
  const [gaugeSiteId, setGaugeSiteId] = useState(initialEntry?.gaugeSiteId || '');
  const [gaugeSiteName, setGaugeSiteName] = useState(initialEntry?.gaugeSiteName || '');
  const [gaugeReadingAt, setGaugeReadingAt] = useState(initialEntry?.gaugeFetchedAt || null);
  const [position, setPosition]   = useState(null);
  const [pinPos, setPinPos]       = useState(
    initialEntry?.lat != null && initialEntry?.lng != null
      ? { lat: initialEntry.lat, lng: initialEntry.lng }
      : null,
  );
  const [adjustingPin, setAdjustingPin] = useState(false);
  const [gpsError, setGpsError]   = useState(null);
  const [selectedLocationId, setSelectedLocationId] = useState(
    initialEntry?.locationId || defaultLocationId || (allowUnlinked ? null : locations[0]?.id) || null
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
  const [mediaMode, setMediaMode] = useState(type === 'voice' ? 'voice' : type === 'video' && VIDEO_ENABLED ? 'video' : 'photo');
  const canUseAudio = type === 'custom-event' || type === 'voice' || (initialEntry?.voiceFiles || []).length > 0;
  const [customTitle, setCustomTitle] = useState(type === 'custom-event' ? initialEntry?.title || '' : '');
  const [recording, setRecording] = useState(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaError, setMediaError] = useState(null);
  const [capturedAt] = useState(() => new Date().toISOString());
  const [selectedMealId, setSelectedMealId] = useState(initialEntry?.mealId || null);
  const [addingNewMeal, setAddingNewMeal] = useState(() => {
    if (initialEntry?.mealId) return false;
    if (type === 'food' && initialEntry) return true;
    return type === 'food' && !(trip?.meals || []).length;
  });
  const [newMealName, setNewMealName] = useState(
    initialEntry?.mealId ? '' : (initialEntry?.title && initialEntry.title !== 'Meal' ? initialEntry.title : ''),
  );
  const [newMealSlot, setNewMealSlot] = useState(initialEntry?.mealSlot || slotForNow());
  const [mealError, setMealError] = useState(null);
  const photoCaptureRef = useRef(null);
  const photoAttachRef = useRef(null);
  const videoCaptureRef = useRef(null);
  const videoAttachRef = useRef(null);
  const voiceCaptureRef = useRef(null);
  const voiceAttachRef = useRef(null);
  // Imperative map handle, supplied by TripMap once its map exists.
  const mapApiRef = useRef(null);
  const handleMapReady = useCallback((api) => { mapApiRef.current = api; }, []);
  const chooseSavedPlace = useCallback((entry) => {
    setSelectedLocationId(entry.id);
    setPinPos(null);
  }, []);
  const chooseMapSpot = useCallback((spot) => setPinPos(spot), []);

  const isRiver = ['river-feature', 'rapid', 'gauge'].includes(type);
  const isCamp  = type === 'campsite';
  const placeOnMap = ['campsite', 'river-feature', 'rapid', 'wildlife', 'food', 'water'].includes(type);
  const isRiverFeature = type === 'river-feature' || type === 'rapid';
  const isGaugeEvent = type === 'gauge';
  const isWeatherEvent = type === 'weather';
  const selectedLocation = locations.find((l) => l.id === selectedLocationId) || null;
  const placeEntries = useMemo(() => locations
    .filter((loc) => loc.lat != null && loc.lng != null)
    .map((loc) => ({
      id: loc.id,
      lng: loc.lng,
      lat: loc.lat,
      title: loc.name,
      symbol: loc.icon || '📍',
      col: loc.id === selectedLocationId ? '#2A5C8E' : '#3A72A8',
    })), [locations, selectedLocationId]);

  // The observation inherits the event's time. Editing an existing entry keeps
  // whatever it was saved with so re-saving never silently re-stamps it.
  // A new Weather or Gauge reading asks "now or another time?" before looking
  // anything up — conditions and flow both depend on the moment chosen.
  const asksWhen = !initialEntry && (isWeatherEvent || isGaugeEvent);
  const [whenChoice, setWhenChoice] = useState(null); // null | 'now' | 'custom'
  const [customWhen, setCustomWhen] = useState(() => toDatetimeLocal(
    event?.observedAt || selectedLocation?.observedAt || capturedAt));
  const customWhenIso = isValidDate(customWhen) ? new Date(customWhen).toISOString() : capturedAt;
  const observedAt = asksWhen
    ? (whenChoice === 'custom' ? customWhenIso : null)
    : (initialEntry?.observedAt || event?.observedAt || null);
  const observedAtIso = observedAt || capturedAt;
  const observedIsHistoric = Boolean(observedAt);

  // Coordinates: the pin wins if the user explicitly adjusted it, otherwise the
  // event's location, otherwise a live GPS fix.
  const coords = pinPos
    || (selectedLocation?.lat != null ? { lng: selectedLocation.lng, lat: selectedLocation.lat } : null)
    || position;

  // Auto-grab GPS only when we have nothing better.
  useEffect(() => {
    if (pinPos || selectedLocation?.lat != null) return;
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      pos => setPosition({ lng: pos.coords.longitude, lat: pos.coords.latitude }),
      err => setGpsError(err.message),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }, [pinPos, selectedLocation?.lat]);

  async function lookupNearbyGauges() {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setGaugeError('Offline right now. Save with station info and flow will sync when back online.');
      return;
    }
    if (!coords?.lat || !coords?.lng) {
      setGaugeError('No coordinates yet for this event.');
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
            // Flow AT THE EVENT'S TIME, not right now.
            const live = await fetchGauge(g.id, { at: observedAtIso });
            return {
              ...g,
              siteName: live.siteName || g.name,
              cfs: live.cfs,
              gaugeHt: live.gaugeHt,
              updatedAt: live.updatedAt,
            };
          } catch {
            return { ...g, siteName: g.name, cfs: null, gaugeHt: null, updatedAt: null };
          }
        }),
      );
      setNearbyGauges(detailed);
    } finally {
      setGaugesLoading(false);
    }
  }

  // Once "Now" is chosen, look up straight away. "Another time" waits for the
  // user to set the time and tap the lookup button.
  const hasCoords = coords?.lat != null && coords?.lng != null;
  const runLookup = () => void (isWeatherEvent ? pullWeatherForEvent() : lookupNearbyGauges());
  useEffect(() => {
    if (!asksWhen || whenChoice !== 'now' || !hasCoords) return undefined;
    const timer = setTimeout(runLookup, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whenChoice, hasCoords]);

  function chooseWhen(choice) {
    setWhenChoice(choice);
    // A reading belongs to one moment; changing the moment discards the old one.
    setWeatherSnapshot(null);
    setWeatherError(null);
    setNearbyGauges([]);
    setGaugeError(null);
    if (isGaugeEvent) { setCfs(''); setGaugeSiteId(''); setGaugeSiteName(''); }
  }

  function importGaugeFlow(g) {
    if (g.cfs != null) setCfs(String(Math.round(g.cfs)));
    setGaugeSiteId(g.id || '');
    setGaugeSiteName(g.siteName || g.name || '');
    setGaugeReadingAt(g.updatedAt || observedAtIso);
    setGaugeError(null);
  }

  async function pullWeatherForEvent() {
    if (!coords?.lat || !coords?.lng) {
      setWeatherError('No coordinates yet for this event.');
      return;
    }
    setWeatherLoading(true);
    setWeatherError(null);
    try {
      // Conditions at the event's location and time — the archive API handles
      // anything more than a couple of hours old.
      const weather = await fetchWeatherAtTime(coords.lat, coords.lng, observedAtIso);
      setWeatherSnapshot(weather);
    } catch (err) {
      setWeatherError(err?.offline
        ? 'Offline right now. Save and weather will sync once you are back online.'
        : (err?.message || 'Could not fetch weather for that time.'));
    } finally {
      setWeatherLoading(false);
    }
  }

  function resolveMeal() {
    if (type !== 'food') return { ok: true, meal: null };
    const planned = trip?.meals || [];
    if (!addingNewMeal && selectedMealId) {
      const meal = planned.find((item) => item.id === selectedMealId);
      if (!meal) return { ok: false, error: 'That planned meal is no longer on this trip.' };
      return { ok: true, meal };
    }
    const name = newMealName.trim();
    if (!name) return { ok: false, error: planned.length ? 'Pick a planned meal, or name a new one.' : 'Name this meal.' };
    const saved = savedMealByName(name, getTrips());
    const ingredients = saved?.ingredients || [];
    const created = addMeal(trip.id, {
      name,
      slot: newMealSlot,
      dayIndex: tripDayIndex(trip),
      ingredients,
    });
    if (created) {
      rememberMeal({ name, slot: newMealSlot, ingredients }, { keepIngredientsIfEmpty: true });
      void publishSavedMeal({ name, slot: newMealSlot, ingredients });
    }
    if (!created) return { ok: false, error: 'Could not add that meal to the plan.' };
    return { ok: true, meal: created };
  }

  function handleSave() {
    if (mediaBusy || recording) return;
    const mealPick = resolveMeal();
    if (!mealPick.ok) {
      setMealError(mealPick.error);
      return;
    }
    setMealError(null);
    const meal = mealPick.meal;
    const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
    const weatherPending = isWeatherEvent && coords?.lat != null && coords?.lng != null && !weatherSnapshot;
    const gaugePending = isGaugeEvent && Boolean(gaugeSiteId) && (!cfs || isOffline);

    onSave({
      type,
      locationId: selectedLocationId || undefined,
      locationName: selectedLocation?.name,
      locationType: selectedLocation?.type,
      title: meal?.name || (type === 'custom-event' && customTitle.trim()) || defaultTitle(type),
      mealId: meal?.id,
      mealSlot: meal?.slot,
      mealDayIndex: meal?.dayIndex,
      notes,
      photoFiles: photoFiles.length ? photoFiles : undefined,
      videoFiles: videoFiles.length ? videoFiles : undefined,
      voiceFiles: voiceFiles.length ? voiceFiles : undefined,
      rating: isCamp ? rating : undefined,
      featureType: isRiverFeature ? featureType : undefined,
      mapTagSymbol: defaultTagSymbol(type, featureType),
      rapidClass: isRiverFeature && featureType === 'rapid' ? rapidClass : undefined,
      cfs: isRiver && cfs ? parseFloat(cfs) : undefined,
      gaugeSiteId: isGaugeEvent ? (gaugeSiteId || undefined) : undefined,
      gaugeSiteName: isGaugeEvent ? (gaugeSiteName || undefined) : undefined,
      gaugeFetchedAt: isGaugeEvent && !gaugePending ? (gaugeReadingAt || observedAtIso) : undefined,
      gaugeSyncPending: gaugePending || undefined,
      // Requested time is what the enrichment retry keys off when offline.
      gaugeRequestedAt: isGaugeEvent ? observedAtIso : undefined,
      weatherTempC: isWeatherEvent ? weatherSnapshot?.temperatureC : undefined,
      weatherFeelsLikeC: isWeatherEvent ? weatherSnapshot?.feelsLikeC : undefined,
      weatherWindKph: isWeatherEvent ? weatherSnapshot?.windKph : undefined,
      weatherWindDirectionDeg: isWeatherEvent ? weatherSnapshot?.windDirectionDeg : undefined,
      weatherCode: isWeatherEvent ? weatherSnapshot?.weatherCode : undefined,
      weatherSummary: isWeatherEvent ? weatherSnapshot?.summary : undefined,
      weatherFetchedAt: isWeatherEvent ? weatherSnapshot?.fetchedAt : undefined,
      weatherSource: isWeatherEvent ? weatherSnapshot?.source : undefined,
      weatherObservation: isWeatherEvent ? (weatherObservation || undefined) : undefined,
      weatherRequestedAt: isWeatherEvent ? observedAtIso : undefined,
      weatherSyncPending: weatherPending || undefined,
      observedAt: observedAtIso,
      lng: coords?.lng,
      lat: coords?.lat,
    });
  }

  const RAPID_CLASSES = ['I', 'II', 'III', 'III+', 'IV', 'V'];
  const FEATURE_TYPES = ['rapid', 'obstruction', 'possible camp', 'wildlife', 'hazard', 'portage'];
  const typeColor = isRiver ? '#3A72A8' : isCamp ? T.amber : T.accent;
  const activeMediaFiles = mediaMode === 'photo' ? photoFiles : mediaMode === 'video' ? videoFiles : voiceFiles;
  const activeCaptureRef = mediaMode === 'photo' ? photoCaptureRef : mediaMode === 'video' ? videoCaptureRef : voiceCaptureRef;
  const activeAttachRef = mediaMode === 'photo' ? photoAttachRef : mediaMode === 'video' ? videoAttachRef : voiceAttachRef;
  const activeAccept = mediaMode === 'photo' ? 'image/*' : mediaMode === 'video' ? 'video/*' : 'audio/*';
  const activeCaptureMode = mediaMode === 'voice' ? 'microphone' : 'environment';
  const activeCaptureLabel = mediaMode === 'photo' ? 'Take Photo' : mediaMode === 'video' ? 'Record Video' : 'Choose voice recording';
  const activeAttachLabel = mediaMode === 'photo' ? 'Add Photo' : mediaMode === 'video' ? 'Add Video' : 'Add Audio';

  async function addMediaFiles(mode, fileList) {
    if (mediaBusy || (mode === 'video' && !VIDEO_ENABLED)) return;
    const rawFiles = Array.from(fileList || []);
    if (!rawFiles.length) return;
    setMediaBusy(true);
    setMediaError(null);
    try {
      for (const file of rawFiles) {
        if (mode === 'photo') {
          if (!file.type?.startsWith('image/')) throw new Error('Choose an image file.');
          const media = await createPhotoMediaFromFile(file, trip.id);
          setPhotoFiles(prev => [...prev, media]);
        } else if (mode === 'voice') {
          const media = await createAudioMediaFromFile(file, trip.id);
          setVoiceFiles(prev => [...prev, media]);
        } else {
          throw new Error('Video capture is not available yet.');
        }
      }
    } catch (error) {
      setMediaError(error.message || 'Could not store this file. Please try again.');
    } finally {
      setMediaBusy(false);
    }
  }

  function removeMediaFile(mode, index) {
    if (mode === 'photo') setPhotoFiles((prev) => prev.filter((_, i) => i !== index));
    if (mode === 'video') setVideoFiles((prev) => prev.filter((_, i) => i !== index));
    if (mode === 'voice') setVoiceFiles((prev) => prev.filter((_, i) => i !== index));
  }

  /** Caption lives on the media ref itself, matching location/event galleries. */
  function captionMediaFile(mode, index, caption) {
    const patch = (prev) => prev.map((f, i) => (i === index ? { ...f, caption } : f));
    if (mode === 'photo') setPhotoFiles(patch);
    if (mode === 'video') setVideoFiles(patch);
    if (mode === 'voice') setVoiceFiles(patch);
  }

  return (
    <div style={{ height: '100%', background: T.bg, display: 'flex', flexDirection: 'column', fontFamily: F, overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ background: T.card, padding: '10px 16px 14px', borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button type="button" onClick={onCancel} aria-label="Cancel entry" style={{ border: 'none', width: 44, height: 44, borderRadius: 18, background: T.bg,
                                           display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <Ic d="M19 12H5 M12 5l-7 7 7 7" size={18} color={T.text} sw={2} />
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: ts(19), fontWeight: 800, color: T.text, letterSpacing: -.4, textTransform: 'capitalize' }}>
              {initialEntry ? 'Edit' : 'Add'} {typeLabel(type)}
            </div>
            {/* The inherited context, stated once, read-only. */}
            <div style={{ fontSize: ts(11), color: T.textFaint, marginTop: 2,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {[event?.name || selectedLocation?.name, formatWhen(observedAtIso)].filter(Boolean).join(' · ')}
            </div>
          </div>
          <div style={{ width: 10, height: 10, borderRadius: 5, background: typeColor, flexShrink: 0 }} />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>

        {!lockLocation && (allowUnlinked || locations.length > 1) && <EntryLocationPicker
          locations={locations} value={selectedLocationId} allowUnlinked={allowUnlinked}
          onChange={id => { setSelectedLocationId(id); setPinPos(null); }} />}

        {type === 'custom-event' && <div style={{ marginBottom: 18 }}>
          <label htmlFor="custom-event-name" style={{ display: 'block', fontSize: ts(14), fontWeight: 800, marginBottom: 8 }}>Event name</label>
          <input id="custom-event-name" value={customTitle} onChange={event => setCustomTitle(event.target.value)} placeholder="What happened here?" style={inputStyle(T)} />
          <div aria-label="Custom entry format" style={{ display: 'flex', gap: 10, marginTop: 10 }}>
            <button className="dashboard-button secondary" type="button" aria-pressed={mediaMode !== 'voice'} onClick={() => setMediaMode('photo')} disabled={recording}>Note</button>
            <button className="dashboard-button secondary" type="button" aria-pressed={mediaMode === 'voice'} onClick={() => setMediaMode('voice')} disabled={recording}>Voice recording</button>
          </div>
        </div>}

        {type === 'food' && (
          <MealChoice
            meals={trip?.meals || []}
            selectedMealId={selectedMealId}
            addingNewMeal={addingNewMeal}
            newMealName={newMealName}
            newMealSlot={newMealSlot}
            error={mealError}
            onPick={(id) => { setSelectedMealId(id); setAddingNewMeal(false); setMealError(null); }}
            onStartNew={() => { setAddingNewMeal(true); setSelectedMealId(null); setMealError(null); }}
            onName={setNewMealName}
            onSlot={setNewMealSlot}
          />
        )}

        {placeOnMap && !lockLocation && !selectedLocation && (
          <div style={{ marginBottom: 16 }}>
            <Label>Place on the map</Label>
            <PlaceSearch
              onPick={({ lng, lat, bbox, setPin }) => {
                if (setPin) setPinPos({ lat, lng });
                mapApiRef.current?.flyTo({ lng, lat, bbox, zoom: setPin ? 15 : undefined });
              }}
              placeholder="Search a place, or paste coordinates…"
            />
            <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', height: 240 }}>
              <TripMap
                trip={trip}
                zoom={14}
                center={coords || undefined}
                track={trip?.track ?? []}
                entries={placeEntries}
                selectedEntryId={selectedLocationId}
                interactive
                pin={pinPos}
                onEntrySelect={chooseSavedPlace}
                onPinChange={chooseMapSpot}
                onMapClick={chooseMapSpot}
                onReady={handleMapReady}
              />
            </div>
            <div style={{ fontSize: ts(11), color: T.textFaint, marginTop: 6, lineHeight: 1.4 }}>
              Tap a saved place to use it, or tap the map to set this spot.
              {coords ? ` ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}` : ''}
              {pinPos ? ' · adjusted' : selectedLocation ? ` · ${selectedLocation.name}` : ''}
              {pinPos && selectedLocation && (
                <button type="button" onClick={() => setPinPos(null)} style={{ ...linkBtnStyle, marginLeft: 6 }}>
                  Reset to {selectedLocation.name}
                </button>
              )}
            </div>
          </div>
        )}

        {isRiverFeature && (
          <div style={{ marginBottom: 16 }}>
            <Label>Feature</Label>
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

        {asksWhen && (
          <div style={{ marginBottom: 16 }}>
            <Label>When was this?</Label>
            <div style={{ display: 'flex', gap: 8 }}>
              {[{ id: 'now', label: 'Right now' }, { id: 'custom', label: 'Another time' }].map((opt) => (
                <button key={opt.id} type="button" onClick={() => chooseWhen(opt.id)}
                  style={{ flex: 1, height: 48, borderRadius: 12, cursor: 'pointer', fontFamily: F,
                           fontSize: ts(14), fontWeight: 700,
                           background: whenChoice === opt.id ? typeColor : T.card,
                           color: whenChoice === opt.id ? 'white' : T.text,
                           border: `1.5px solid ${whenChoice === opt.id ? typeColor : T.border}` }}>
                  {opt.label}
                </button>
              ))}
            </div>
            {whenChoice === 'custom' && (
              <input type="datetime-local" aria-label="Reading date and time" value={customWhen}
                max={toDatetimeLocal(new Date().toISOString())}
                onChange={(e) => { setCustomWhen(e.target.value); chooseWhen('custom'); }}
                style={{ ...inputStyle(T), marginTop: 8 }} />
            )}
          </div>
        )}

        {/* River flow — fetched for the event's time, never typed by hand. */}
        {isGaugeEvent && (!asksWhen || whenChoice) && (
          <div style={{ marginBottom: 16 }}>
            <Label>River Flow{observedIsHistoric ? ' at event time' : ''}</Label>

            {gaugeSiteName ? (
              <div style={{ background: '#EAF3FB', border: '1px solid #3A72A835', borderRadius: 12, padding: '11px 12px', marginBottom: 8 }}>
                <div style={{ fontSize: ts(14), fontWeight: 700, color: T.text }}>{gaugeSiteName}</div>
                <div style={{ fontSize: ts(13), color: '#2A5C8E', fontWeight: 600, marginTop: 2 }}>
                  {cfs ? `${Number(cfs).toLocaleString()} cfs` : 'Flow syncs when back online'}
                </div>
                <div style={{ fontSize: ts(11), color: T.textFaint, marginTop: 2 }}>
                  {gaugeSiteId ? `#${gaugeSiteId} · ` : ''}reading for {formatWhen(gaugeReadingAt || observedAtIso)}
                </div>
                <button type="button" onClick={() => { setGaugeSiteId(''); setGaugeSiteName(''); setCfs(''); setGaugeReadingAt(null); }}
                        style={linkBtnStyle}>
                  Choose a different station
                </button>
              </div>
            ) : (
              <>
                <div onClick={lookupNearbyGauges} style={fetchBtnStyle(gaugesLoading)}>
                  <Ic d={ICONS.gauge} size={14} color={gaugesLoading ? T.textFaint : '#2A5C8E'} sw={1.8} />
                  <span style={{ fontSize: ts(13), fontWeight: 700, color: gaugesLoading ? T.textFaint : '#2A5C8E' }}>
                    {gaugesLoading ? 'Looking up gauges…' : 'Find nearby gauges'}
                  </span>
                </div>
                {gaugeError && <div style={{ fontSize: ts(13), color: T.amber, marginTop: 8 }}>{gaugeError}</div>}
                {!!nearbyGauges.length && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                    {nearbyGauges.map(g => (
                      <div key={g.id} onClick={() => importGaugeFlow(g)}
                           style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: '10px 11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: ts(14), fontWeight: 700, color: T.text }}>{g.siteName}</div>
                          <div style={{ fontSize: ts(12), color: T.textFaint }}>{g.distanceMiles.toFixed(1)} mi away</div>
                          <div style={{ fontSize: ts(12), color: '#2A5C8E', marginTop: 2 }}>
                            {g.cfs != null ? `${Math.round(g.cfs).toLocaleString()} cfs` : 'Flow unavailable'}
                            {g.gaugeHt != null ? ` · ${g.gaugeHt.toFixed(1)} ft` : ''}
                          </div>
                        </div>
                        <Ic d="M9 18l6-6-6-6" size={14} color={T.textFaint} sw={2} />
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Weather — fetched for the event's location and time. */}
        {isWeatherEvent && (!asksWhen || whenChoice) && (
          <div style={{ marginBottom: 16 }}>
            <Label>Conditions{observedIsHistoric ? ' at event time' : ''}</Label>

            {weatherSnapshot ? (
              <div style={{ background: '#EBF3FA', border: '1px solid #517EA335', borderRadius: 12, padding: '11px 12px', marginBottom: 8 }}>
                <div style={{ fontSize: ts(14), fontWeight: 700, color: T.text }}>{weatherSnapshot.summary || 'Conditions'}</div>
                <div style={{ fontSize: ts(13), color: '#2A5C8E', fontWeight: 600, marginTop: 2 }}>
                  {weatherSnapshot.temperatureC != null ? `${Math.round(cToF(weatherSnapshot.temperatureC))}°F` : 'Temp n/a'}
                  {weatherSnapshot.feelsLikeC != null ? ` · feels ${Math.round(cToF(weatherSnapshot.feelsLikeC))}°F` : ''}
                  {weatherSnapshot.windKph != null ? ` · wind ${Math.round(weatherSnapshot.windKph)} km/h` : ''}
                </div>
                <div style={{ fontSize: ts(11), color: T.textFaint, marginTop: 2 }}>
                  for {formatWhen(weatherSnapshot.fetchedAt || observedAtIso)}
                </div>
                <button type="button" onClick={() => void pullWeatherForEvent()} style={linkBtnStyle}>
                  {weatherLoading ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>
            ) : (
              <div onClick={() => void pullWeatherForEvent()} style={fetchBtnStyle(weatherLoading)}>
                <Ic d={ICONS.compass} size={14} color={weatherLoading ? T.textFaint : '#2A5C8E'} sw={1.8} />
                <span style={{ fontSize: ts(13), fontWeight: 700, color: weatherLoading ? T.textFaint : '#2A5C8E' }}>
                  {weatherLoading ? 'Fetching weather…' : `Get weather for ${formatWhen(observedAtIso)}`}
                </span>
              </div>
            )}

            {weatherError && <div style={{ fontSize: ts(13), color: T.amber, marginBottom: 8 }}>{weatherError}</div>}

            <textarea
              aria-label="Weather observation"
              value={weatherObservation}
              onChange={(e) => setWeatherObservation(e.target.value)}
              placeholder="What you actually saw (cloud cover, gusts, visibility…)"
              rows={2}
              style={{ ...inputStyle(T), resize: 'none', height: 'auto' }}
            />
          </div>
        )}

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

        {/* Media — one section, one caption (the notes field below). */}
        <div style={{ marginBottom: 16 }}>
          <Label>{canUseAudio ? 'Photos & Audio' : 'Photos'}</Label>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            {[
              { id: 'photo', label: `Photos (${photoFiles.length})`, icon: ICONS.camera },
              ...(VIDEO_ENABLED ? [{ id: 'video', label: `Videos (${videoFiles.length})`, icon: ICONS.video, videoOnly: true }] : []),
              ...(canUseAudio ? [{ id: 'voice', label: `Audio (${voiceFiles.length})`, icon: ICONS.mic }] : []),
            ].map((opt) => {
              const disabled = opt.videoOnly && !VIDEO_ENABLED;
              return (
              <button type="button" disabled={disabled || mediaBusy || recording} key={opt.id} onClick={() => { if (!disabled) setMediaMode(opt.id); }}
                   title={disabled ? VIDEO_DISABLED_HINT : undefined}
                   style={{ flex: 1, padding: '10px 12px', borderRadius: 10, cursor: disabled ? 'not-allowed' : 'pointer',
                            border: `1.5px solid ${mediaMode === opt.id ? '#2A5C8E' : T.border}`,
                            background: mediaMode === opt.id ? '#E4EFF8' : T.card,
                            display: 'flex', alignItems: 'center', gap: 7, justifyContent: 'center',
                            ...(disabled ? disabledMediaStyle() : {}) }}>
                <Ic d={opt.icon} size={14} color={disabled ? T.textFaint : mediaMode === opt.id ? '#2A5C8E' : T.textSub} sw={1.8} />
                <span style={{ fontSize: ts(12), fontWeight: 700, color: disabled ? T.textFaint : mediaMode === opt.id ? '#2A5C8E' : T.textSub }}>{opt.label}</span>
              </button>
            );})}
          </div>

          {mediaMode === 'voice' && <VoiceRecorder disabled={mediaBusy} onRecordingChange={setRecording} onRecorded={(file) => void addMediaFiles('voice', [file])} />}
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <button type="button" hidden={mediaMode === 'voice'} disabled={mediaBusy || recording} onClick={() => { if (mediaMode !== 'video' || VIDEO_ENABLED) activeCaptureRef.current?.click(); }}
                 style={{ minHeight: 48, background: '#E4EFF8', border: '1px solid #3A72A840', borderRadius: 10, padding: '10px 12px', fontSize: ts(13), fontWeight: 700, color: '#2A5C8E', cursor: 'pointer', ...(mediaMode === 'video' && !VIDEO_ENABLED ? disabledMediaStyle() : {}) }}>
              {activeCaptureLabel}
            </button>
            <button type="button" disabled={mediaBusy || recording} onClick={() => { if (mediaMode !== 'video' || VIDEO_ENABLED) activeAttachRef.current?.click(); }}
                 style={{ minHeight: 48, background: T.bg, border: `1px solid ${T.border}`, borderRadius: 10, padding: '10px 12px', fontSize: ts(13), fontWeight: 700, color: T.textSub, cursor: 'pointer', ...(mediaMode === 'video' && !VIDEO_ENABLED ? disabledMediaStyle() : {}) }}>
              {activeAttachLabel}
            </button>
          </div>

          <input ref={activeCaptureRef} type="file" accept={activeAccept} capture={activeCaptureMode} style={{ display: 'none' }} onChange={(e) => addMediaFiles(mediaMode, e.target.files)} />
          <input ref={activeAttachRef} type="file" accept={activeAccept} style={{ display: 'none' }} onChange={(e) => addMediaFiles(mediaMode, e.target.files)} />

          {mediaError && <p role="alert" style={{ color: '#8A1414', padding: '8px 0', fontSize: ts(14) }}>{mediaError}</p>}
          {mediaBusy && <p role="status">Storing attachment on this phone…</p>}
          {!!activeMediaFiles.length && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {activeMediaFiles.map((f, idx) => (
                <div key={f.id || `${f.name}-${idx}`} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-start' }}>
                  <div style={{ position: 'relative', flexShrink: 0, maxWidth: '100%', paddingTop: mediaMode === 'voice' ? 44 : 0 }}>
                    {mediaMode === 'voice' ? <AudioAttachment media={f} /> : f.thumbDataUrl || f.id ? (
                      <MediaThumb media={f} alt={f.name}
                           style={{ width: 72, height: 72, borderRadius: 10, objectFit: 'contain', background: '#F0EDE8', border: `1px solid ${T.border}`, display: 'block' }} />
                    ) : (
                      <div style={{ width: 72, height: 72, borderRadius: 10, background: T.card, border: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 3 }}>
                        <span style={{ fontSize: 18 }}>{mediaMode === 'video' ? '🎥' : mediaMode === 'voice' ? '🎙' : '📷'}</span>
                        <span style={{ fontSize: 9, color: T.textFaint, textAlign: 'center', padding: '0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 68 }}>{f.name}</span>
                      </div>
                    )}
                    <button type="button" aria-label="Remove attachment" onClick={() => removeMediaFile(mediaMode, idx)}
                         style={{ position: 'absolute', top: -5, right: -5, width: 44, height: 44, border: 'none', borderRadius: 22, background: '#C04040', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                      <span style={{ fontSize: 10, color: 'white', fontWeight: 700, lineHeight: 1 }}>✕</span>
                    </button>
                  </div>
                  {/* Per-file caption — the entry's Notes field below still describes the whole observation. */}
                  <textarea
                    aria-label="Attachment caption"
                    value={f.caption || ''}
                    onChange={(e) => captionMediaFile(mediaMode, idx, e.target.value)}
                    placeholder="Caption this one…"
                    rows={2}
                    style={{ flex: 1, minWidth: 0, border: `1.5px solid ${T.border}`, borderRadius: 10,
                             padding: '8px 10px', fontSize: ts(12), fontFamily: F, background: T.card,
                             outline: 'none', boxSizing: 'border-box', resize: 'vertical' }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* One notes field, captioning the whole entry. */}
        <div style={{ marginBottom: 16 }}>
          <Label>Notes</Label>
          <textarea id="entry-notes"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Describe what you found…"
            rows={3}
            style={{ ...inputStyle(T), resize: 'none', height: 'auto' }}
          />
        </div>

        {/* Coordinates are inherited; adjusting them is opt-in. */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: adjustingPin ? 8 : 0 }}>
            <div style={{ minWidth: 0 }}>
              <Label>Coordinates</Label>
              <div style={{ fontSize: ts(12), color: T.textFaint }}>
                {coords
                  ? `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`
                  : (gpsError ? `⚠ ${gpsError}` : 'Getting location…')}
                {pinPos ? ' · adjusted' : selectedLocation ? ` · from ${selectedLocation.name}` : ''}
              </div>
            </div>
            {!placeOnMap && !lockLocation && (
              <button type="button" onClick={() => setAdjustingPin((v) => !v)} style={linkBtnStyle}>
                {adjustingPin ? 'Done' : 'Adjust'}
              </button>
            )}
          </div>

          {adjustingPin && !placeOnMap && !lockLocation && (
            <>
              <PlaceSearch
                onPick={({ lng, lat, bbox, setPin }) => {
                  // Coordinates set the entry's exact spot; names only pan.
                  if (setPin) setPinPos({ lat, lng });
                  mapApiRef.current?.flyTo({ lng, lat, bbox, zoom: setPin ? 15 : undefined });
                }}
                placeholder="Search a place, or paste coordinates…"
              />
              <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', height: 240 }}>
                <TripMap
                  trip={trip}
                  zoom={14}
                  center={coords || undefined}
                  track={trip?.track ?? []}
                  entries={placeEntries}
                  selectedEntryId={selectedLocationId}
                  interactive
                  pin={pinPos}
                  onEntrySelect={chooseSavedPlace}
                  onPinChange={chooseMapSpot}
                  onMapClick={chooseMapSpot}
                  onReady={handleMapReady}
                />
              </div>
              <div style={{ fontSize: ts(11), color: T.textFaint, marginTop: 6, lineHeight: 1.4 }}>
                Drag the pin or tap the map to set the exact spot.
                {pinPos && selectedLocation && (
                  <button type="button" onClick={() => setPinPos(null)} style={{ ...linkBtnStyle, marginLeft: 6 }}>
                    Reset to {selectedLocation.name}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {saveError && <p role="alert" style={{ padding: 12, color: '#8A1414', background: '#FBE4E4' }}>{saveError}</p>}
      {/* Save CTA */}
      <div style={{ padding: '12px 16px 16px', background: T.card, borderTop: `1px solid ${T.border}`, flexShrink: 0 }}>
        <button type="button" onClick={handleSave} disabled={mediaBusy || recording}
             style={{ width: '100%', border: 'none', opacity: mediaBusy ? 0.6 : 1, background: typeColor, borderRadius: 14, padding: '15px', textAlign: 'center',
                      boxShadow: `0 4px 16px ${typeColor}50`, cursor: 'pointer' }}>
          <span style={{ fontSize: ts(16), fontWeight: 800, color: 'white', letterSpacing: -.2 }}>
            {recording ? 'Stop recording to save' : mediaBusy ? 'Storing attachment…' : initialEntry ? 'Save changes' : 'Save'}
          </span>
        </button>
      </div>
    </div>
  );
}

const MEAL_SLOTS = MEAL_SLOT_IDS.map((id) => ({ id, label: SLOT_LABEL[id] }));

function slotForNow(date = new Date()) {
  const hour = date.getHours();
  if (hour < 10) return 'breakfast';
  if (hour < 15) return 'lunch';
  if (hour < 21) return 'dinner';
  return 'snack';
}

function tripDayIndex(trip, date = new Date()) {
  const start = trip?.startDate;
  if (!/^\d{4}-\d{2}-\d{2}/.test(start || '')) return 1;
  const startDay = new Date(start.slice(0, 10) + 'T12:00:00');
  const today = new Date(date);
  today.setHours(12, 0, 0, 0);
  const diff = Math.round((today - startDay) / 864e5) + 1;
  return diff >= 1 ? diff : 1;
}

function SavedMealChoices({ name, onPick }) {
  const [sharedTick, setSharedTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    refreshSharedMeals().then(() => {
      if (!cancelled) setSharedTick((tick) => tick + 1);
    });
    return () => { cancelled = true; };
  }, []);
  const saved = useMemo(() => listSavedMeals(getTrips()), [sharedTick]);
  const match = savedMealByName(name, getTrips());
  if (!saved.length && !match?.ingredients?.length) return null;
  const selectedKey = saved.find((m) => m.nameKey === name.trim().toLowerCase())?.nameKey || '';
  return (
    <div style={{ marginTop: 8 }}>
      {saved.length > 0 && (
        <>
          <div style={{ fontSize: ts(11), fontWeight: 700, color: T.textSub, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 4 }}>
            Saved meals
          </div>
          <select
            aria-label="Saved meals"
            value={selectedKey}
            onChange={(e) => {
              const picked = saved.find((m) => m.nameKey === e.target.value);
              if (picked) onPick(picked);
            }}
            style={{ ...inputStyle(T), marginTop: 0 }}
          >
            <option value="">Choose a saved meal template…</option>
            {MEAL_SLOTS.map((slotObj) => {
              const items = saved.filter((m) => (m.slot || 'dinner') === slotObj.id);
              if (!items.length) return null;
              return (
                <optgroup key={slotObj.id} label={slotObj.label}>
                  {items.map((meal) => (
                    <option key={meal.nameKey} value={meal.nameKey}>
                      {meal.name}{meal.ingredients?.length ? ` (${meal.ingredients.length} ingredients)` : ''}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        </>
      )}
      {match?.ingredients?.length > 0 && (
        <p style={{ fontSize: ts(12), color: T.textSub, lineHeight: 1.4, margin: '8px 0 0' }}>
          Saved ingredients: {match.ingredients.map((item) => item.name).join(', ')}
        </p>
      )}
    </div>
  );
}

function mealSlotLabel(slot) {
  return MEAL_SLOTS.find((item) => item.id === slot)?.label || 'Meal';
}

function MealChoice({
  meals, selectedMealId, addingNewMeal, newMealName, newMealSlot, error,
  onPick, onStartNew, onName, onSlot,
}) {
  const ordered = [...meals].sort((a, b) => {
    const day = (a.dayIndex || 1) - (b.dayIndex || 1);
    if (day) return day;
    return mealSlotOrder(a.slot) - mealSlotOrder(b.slot);
  });
  return (
    <div style={{ marginBottom: 16 }}>
      <Label>Meal</Label>
      <p style={{ fontSize: ts(13), color: T.textSub, lineHeight: 1.45, margin: '0 0 8px' }}>
        {ordered.length ? 'Pick a meal from the plan, or add a new one.' : 'Nothing is planned yet. Add this meal and it goes on the plan too.'}
      </p>
      {ordered.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
          {ordered.map((meal) => {
            const selected = !addingNewMeal && selectedMealId === meal.id;
            return (
              <button key={meal.id} type="button" onClick={() => onPick(meal.id)}
                style={{ textAlign: 'left', minHeight: 44, padding: '8px 12px', borderRadius: 12, cursor: 'pointer', fontFamily: F,
                  border: `1.5px solid ${selected ? '#B06030' : T.border}`, background: selected ? '#F8EDE4' : T.card }}>
                <span style={{ display: 'block', fontSize: ts(14), fontWeight: 800, color: T.text }}>{meal.name}</span>
                <span style={{ display: 'block', fontSize: ts(12), color: T.textSub, marginTop: 2 }}>
                  {mealDaysLabel(meal)} · {mealSlotLabel(meal.slot)}{meal.assignedToLabel ? ` · ${meal.assignedToLabel}` : ''}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <button type="button" onClick={onStartNew}
        style={{ width: '100%', minHeight: 44, marginBottom: addingNewMeal ? 8 : 0, borderRadius: 12, cursor: 'pointer', fontFamily: F,
          fontSize: ts(14), fontWeight: 800, border: `1.5px solid ${addingNewMeal ? '#B06030' : T.border}`,
          background: addingNewMeal ? '#F8EDE4' : T.card, color: T.text }}>
        New meal
      </button>
      {addingNewMeal && (
        <>
          <input value={newMealName} onChange={(e) => onName(e.target.value)} placeholder="Meal name (chili, oatmeal…)" style={{ ...inputStyle(T), marginTop: 0 }} />
          <SavedMealChoices
            name={newMealName}
            onPick={(meal) => { onName(meal.name); if (meal.slot) onSlot(meal.slot); }}
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {MEAL_SLOTS.map((slot) => (
              <button key={slot.id} type="button" onClick={() => onSlot(slot.id)}
                style={{ minHeight: 36, padding: '6px 10px', borderRadius: 14, cursor: 'pointer', fontFamily: F, fontSize: ts(12), fontWeight: 700,
                  border: newMealSlot === slot.id ? 'none' : `1px solid ${T.border}`,
                  background: newMealSlot === slot.id ? '#B06030' : T.bg,
                  color: newMealSlot === slot.id ? 'white' : T.textSub }}>
                {slot.label}
              </button>
            ))}
          </div>
        </>
      )}
      {error && <p role="alert" style={{ color: '#8A1414', fontSize: ts(13), margin: '8px 0 0' }}>{error}</p>}
    </div>
  );
}

const Label = ({ children }) => (
  <div style={{ fontSize: ts(11), fontWeight: 700, color: T.textSub, letterSpacing: .7,
                 textTransform: 'uppercase', marginBottom: 7, fontFamily: F }}>{children}</div>
);

const inputStyle = (T) => ({
  width: '100%', border: `1.5px solid ${T.border}`, borderRadius: 12, padding: '12px 14px',
  fontSize: ts(16), fontFamily: F, color: T.text, background: T.card, outline: 'none', boxSizing: 'border-box',
});

const linkBtnStyle = {
  border: 'none',
  background: 'transparent',
  color: '#2A5C8E',
  fontSize: ts(11.5),
  fontWeight: 700,
  cursor: 'pointer',
  fontFamily: F,
  padding: '4px 0 0',
};

function fetchBtnStyle(loading) {
  return {
    background: loading ? T.bg : '#E4EFF8',
    border: `1px solid ${loading ? T.border : '#3A72A840'}`,
    borderRadius: 12,
    padding: '11px 13px',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    cursor: loading ? 'default' : 'pointer',
    marginBottom: 8,
  };
}

/** "Jul 21, 6:40 PM" — or "Today, 6:40 PM" for same-day. */
function toDatetimeLocal(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isValidDate(value) {
  return Boolean(value) && Number.isFinite(new Date(value).getTime());
}

function formatWhen(iso) {
  if (!iso) return 'now';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'now';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `today, ${time}`;
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
}

function defaultTitle(type) {
  const map = { photo: 'Photo', campsite: 'Campsite', water: 'Water Crossing', wildlife: 'Wildlife Sighting',
                rapid: 'Rapid', 'river-feature': 'River Feature', gauge: 'River Flow Check', weather: 'Weather Check', note: 'Note', food: 'Meal', voice: 'Voice Note', video: mediaCaptureLabel('Photo / Video'), 'custom-event': 'Custom Event' };
  return map[type] || type;
}

function typeLabel(type) {
  const map = { photo: 'Photo', food: 'Meal', 'river-feature': 'River Feature', 'custom-event': 'Custom Event', gauge: 'River Flow', weather: 'Weather', video: mediaCaptureLabel('Photo / Video'), note: 'Note' };
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
    photo: '📷',
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

function cToF(c) {
  return (c * 9) / 5 + 32;
}
