import { RecordingBar } from './components/RecordingBar';
import { useState, useCallback, useEffect, useRef } from 'react';
import { QuickCapture } from './screens/QuickCapture';
import { Home }         from './screens/Home';
import { Trip }         from './screens/Trip';
import { Navigator }    from './screens/Navigator';
import { TripPlan }     from './screens/TripPlan';
import { NewTrip }      from './screens/NewTrip';
import { AuthScreen }   from './screens/Auth';
import { ProfileSetup } from './screens/ProfileSetup';
import { JoinTrip }     from './screens/JoinTrip';
import { TripRecap }    from './screens/TripRecap';
import { LocationPage } from './screens/LocationPage';
import { EventPage }    from './screens/EventPage';
import { useAuth } from './context/AuthContext';
import { claimAnonymousTripsForUser, clearActiveTrip, getActiveTrip, getRecordingDeviceId, getCurrentUserId, getTrips, isTripMember, isTripOpen, isTripOwner, setActiveTrip, updateEntry, updateEvent } from './lib/storage';
import { getSignedInUserId } from './lib/authUser';
import { Settings } from './screens/Settings';
import { useGPS } from './hooks/useGPS';
import { useAppNavigation } from './hooks/useAppNavigation';
import { useOfflineMapPreload } from './hooks/useOfflineMapPreload';
import { useTripMediaSync } from './hooks/useTripMediaSync';
import { useCloudTripSync } from './hooks/useCloudTripSync';
import { fetchGauge, fetchNearbyGaugesByGps, findNearbyKnownGauges } from './lib/usgs';
import { fetchWeatherAtTime } from './lib/weather';
import { weatherFieldsFromSnapshot } from './lib/eventWeather';

/** Deep links: ?join=CODE opens the join screen; ?story=TRIP_ID opens the trip story recap. */
function parseInitialUrl(url) {
  const join = url.searchParams.get('join') || url.searchParams.get('code');
  if (join?.trim()) {
    return { screen: 'join', params: { inviteCode: join.trim().toUpperCase() } };
  }
  const story = url.searchParams.get('story');
  if (story?.trim()) {
    setActiveTrip(story.trim());
    return { screen: 'recap', params: { tripId: story.trim(), tab: 'story' } };
  }
  return null;
}

export default function App() {
  const auth = useAuth();
  const nav = useAppNavigation({
    defaultRoute: { screen: 'home', params: {} },
    parseUrl: parseInitialUrl,
  });
  const { screen, params } = nav;
  const [trip, setTrip]     = useState(() => getActiveTrip());
  const [allTrips, setAllTrips] = useState(() => getTrips());
  const [newTripInviteCode, setNewTripInviteCode] = useState(null);
  const enrichmentRunningRef = useRef(false);

  const refreshTrip = useCallback(() => {
    setTrip(getActiveTrip());
    setAllTrips(getTrips());
  }, []);

  useOfflineMapPreload({
    enabled: auth.configured && auth.isSignedIn && !auth.needsProfile,
  });

  useTripMediaSync({
    enabled: auth.configured && auth.isSignedIn && !auth.needsProfile,
  });

  useCloudTripSync({
    enabled: auth.configured && auth.isSignedIn && !auth.needsProfile,
    onSynced: refreshTrip,
  });

  useEffect(() => {
    const userId = getSignedInUserId();
    if (!userId || !auth.isSignedIn) return;
    const claimed = claimAnonymousTripsForUser(userId);
    if (claimed > 0) refreshTrip();
  }, [auth.isSignedIn, refreshTrip]);
  const recordingTrip=allTrips.find(t=>t.gpsSessionId && t.gpsRecordingDeviceId===getRecordingDeviceId());
  const recorderTrip=recordingTrip || trip;
  const gpsEnabled=Boolean(recordingTrip?.gpsSessionActive && isTripOpen(recordingTrip) &&
    (!auth.configured || (auth.isSignedIn && !auth.needsProfile)));
  const gps=useGPS(recordingTrip?.id,{
    enabled:gpsEnabled,interval:recordingTrip?.gpsIntervalMs||5000,
    sessionId:recordingTrip?.gpsSessionId,onTrackPoint:refreshTrip,
  });

  const syncPendingEntryEnrichment = useCallback(async () => {
    if (!trip?.id) return;
    // No navigator.onLine gate: it can report offline while connected, and each
    // lookup below already leaves the entry pending if its request fails.
    if (enrichmentRunningRef.current) return;

    enrichmentRunningRef.current = true;
    try {
      const active = getActiveTrip();
      if (!active || active.id !== trip.id) return;

      let changed = false;
      for (const entry of active.entries || []) {
        const wantsGauge = entry.type === 'conditions'
          ? entry.gaugeSyncPending
          : entry.type === 'gauge' && (entry.gaugeSyncPending || entry.cfs == null);
        if (wantsGauge) {
          try {
            let siteId = entry.gaugeSiteId;
            let siteName = entry.gaugeSiteName;

            if (!siteId && entry.lat != null && entry.lng != null) {
              const lat = Number(entry.lat);
              const lng = Number(entry.lng);
              if (Number.isFinite(lat) && Number.isFinite(lng)) {
                const nearby = await fetchNearbyGaugesByGps(lat, lng, { radiusMiles: 120, limit: 1 });
                const pick = nearby[0] || (await fetchNearbyGaugesByGps(lat, lng, { radiusMiles: 300, limit: 1 }))[0];
                siteId = pick?.id || null;
                siteName = siteName || pick?.name || null;

                if (!siteId) {
                  const known = findNearbyKnownGauges(lat, lng, { limit: 1, maxMiles: 500 });
                  siteId = known[0]?.id || null;
                  siteName = siteName || known[0]?.name || null;
                }
              }
            }

            if (siteId) {
              // Reading for when the entry was observed, not when we reconnected.
              const when = entry.gaugeRequestedAt || entry.observedAt || null;
              const gauge = await fetchGauge(siteId, { at: when });
              updateEntry(active.id, entry.id, {
                gaugeSiteId: siteId,
                cfs: gauge.cfs ?? entry.cfs,
                gaugeHt: gauge.gaugeHt ?? entry.gaugeHt,
                gaugeSiteName: gauge.siteName || siteName || entry.gaugeSiteName,
                gaugeFetchedAt: gauge.updatedAt || when || new Date().toISOString(),
                gaugeSyncPending: false,
              });
              changed = true;
            }
          } catch {
            // Leave pending for next reconnect.
          }
        }

        if ((entry.type === 'weather' || entry.type === 'conditions') && entry.weatherSyncPending && entry.lat != null && entry.lng != null) {
          try {
            const when = entry.weatherRequestedAt || entry.observedAt || new Date().toISOString();
            const weather = await fetchWeatherAtTime(entry.lat, entry.lng, when);
            updateEntry(active.id, entry.id, {
              weatherTempC: weather.temperatureC,
              weatherFeelsLikeC: weather.feelsLikeC,
              weatherWindKph: weather.windKph,
              weatherWindDirectionDeg: weather.windDirectionDeg,
              weatherCode: weather.weatherCode,
              weatherSummary: weather.summary,
              weatherFetchedAt: weather.fetchedAt,
              weatherSource: weather.source,
              weatherSyncPending: false,
            });
            changed = true;
          } catch {
            // Leave pending for next reconnect.
          }
        }
      }

      for (const evt of active.events || []) {
        if (evt.type !== 'custom-event' || !evt.weatherSyncPending) continue;
        const loc = (active.locations || []).find((l) => l.id === evt.locationId);
        if (loc?.lat == null || loc?.lng == null) continue;

        try {
          const when = evt.observedAt || new Date().toISOString();
          const weather = await fetchWeatherAtTime(loc.lat, loc.lng, when);
          updateEvent(active.id, evt.id, {
            ...weatherFieldsFromSnapshot(weather),
            weatherSyncPending: false,
          });
          changed = true;
        } catch {
          // Leave pending for next reconnect.
        }
      }

      if (changed) refreshTrip();
    } finally {
      enrichmentRunningRef.current = false;
    }
  }, [trip?.id, refreshTrip]);

  useEffect(() => {
    const onOnline = () => {
      void syncPendingEntryEnrichment();
    };

    window.addEventListener('online', onOnline);
    void syncPendingEntryEnrichment();

    return () => window.removeEventListener('online', onOnline);
  }, [syncPendingEntryEnrichment]);

  // Bottom-nav tabs replace the current screen; drill-downs push. That way back
  // from a Location goes to the Trip it came from, not through every tab visited.
  const onNav = (tab) => {
    if (tab === 'add-location') {
      if (isTripOpen(trip)) nav.push('capture', { type: 'location' });
      return;
    }
    if (tab === 'capture' || tab.startsWith('capture-')) {
      if (!trip || !isTripOpen(trip)) return;
      const atPlace = tab !== 'capture' && ['location', 'event', 'log'].includes(screen) ? params.locationId : null;
      nav.push('capture', {
        captureId: crypto.randomUUID(),
        type: tab === 'capture' ? null : tab.slice(8),
        locationId: atPlace || null,
        eventId: tab !== 'capture' && (screen === 'event' || (screen === 'log' && params.eventId)) ? params.eventId : null,
      });
      return;
    }
    if (tab === 'log') {
      nav.replace('trip');
      return;
    }
    if (tab === 'plan-participants' || tab === 'plan-money') {
      nav.replace('plan', { tab: tab === 'plan-money' ? 'expenses' : 'participants' });
      return;
    }
    const map = { home: 'home', map: 'map', trip: 'trip', plan: 'plan' };
    const target = map[tab];
    if (!target) return;
    nav.replace(target, target === 'plan' ? {} : undefined);
  };

  const onSelectTrip = (tripId, { screen: target = 'trip', params: routeParams = {} } = {}) => {
    if (!tripId) return;
    setActiveTrip(tripId);
    refreshTrip();
    nav.push(target, { ...routeParams, tripId });
  };

  const onFab = () => nav.push('new-trip');

  const onOpenRecap = (tripId, { tab = null } = {}) => {
    if (tripId) setActiveTrip(tripId);
    refreshTrip();
    nav.push('recap', { tripId, ...(tab ? { tab } : {}) });
  };

  const onOpenLocation = (locationId, eventId = null, { edit = false } = {}) => {
    if (!locationId) return;
    nav.push('location', { locationId, eventId: eventId || null, edit: edit || null });
  };

  // addType opens that entry form straight away (a new Weather event goes to the reading).
  const onOpenEvent = (locationId, eventId, { addType = null, edit = false } = {}) => {
    if (!eventId) return;
    nav.push('event', { locationId: locationId || null, eventId, addType, edit: edit || null });
  };

  const common = { trip, onNav, onFab };
  const onTripDeleted = () => {
    clearActiveTrip();
    refreshTrip();
    nav.reset('home');
  };

  if (auth.configured) {
    if (auth.loading) {
      return (
        <div style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6B6560', fontFamily: 'system-ui' }}>
          Loading…
        </div>
      );
    }
    if (!auth.isSignedIn) return <AuthScreen inviteCode={screen === 'join' ? params.inviteCode : null} />;
    if (auth.needsProfile) return <ProfileSetup />;
  }

  const tripPages = { ...common, onTripUpdate: refreshTrip, onOpenLocation, onOpenEvent };

  function renderScreen() {
  switch (screen) {
    case 'capture': return <QuickCapture key={`${trip?.id || ''}:${params.locationId || ''}:${params.eventId || ''}:${params.type || ''}:${params.captureId || ''}`} trip={trip} initialType={params.type}
      locationId={params.locationId} eventId={params.eventId}
      onCancel={() => nav.canGoBack ? nav.back() : nav.replace('trip')}
      onNav={onNav}
      onSaved={(notice, saved = {}) => {
        refreshTrip();
        nav.replace(saved.locationId ? 'location' : 'trip', { ...saved, notice });
      }} />;
    case 'home':    return <Home {...common} allTrips={allTrips} onSelectTrip={onSelectTrip} onJoinTrip={() => nav.push('join')} onOpenSettings={() => nav.push('settings')} onOpenRecap={onOpenRecap} auth={auth} />;
    case 'settings': return <Settings onBack={nav.back} auth={auth} />;
    case 'recap':   return <TripRecap trip={trip} onBack={nav.back} onTripUpdate={refreshTrip} onForkedTrip={(forkedId) => onSelectTrip(forkedId)} initialTab={params.tab || 'report'} auth={auth} />;
    case 'trip':    return <Trip {...tripPages} onTripDeleted={onTripDeleted} onOpenRecap={onOpenRecap} />;
    case 'map':     return trip?.status === 'completed' ? <Trip {...tripPages} onTripDeleted={onTripDeleted} /> : <Navigator {...common} onTripUpdate={refreshTrip} gps={recordingTrip?.id===trip?.id?gps:null} />;
    case 'log':     return <Trip {...tripPages} onTripDeleted={onTripDeleted} onOpenRecap={onOpenRecap} />;
    case 'plan':    return <TripPlan {...common} onTripUpdate={refreshTrip} onBack={nav.back} initialTab={params.tab || null} newTripInviteCode={newTripInviteCode} onDismissInvite={() => setNewTripInviteCode(null)} />;

    case 'location': {
      const location = (trip?.locations || []).find((l) => l.id === params.locationId) || null;
      return <LocationPage
        key={location?.id || 'missing-location'}
        {...tripPages}
        location={location}
        onBack={nav.back}
        initialEventId={params.eventId || null}
        initialEdit={Boolean(params.edit)}
        notice={params.notice}
      />;
    }

    case 'event': {
      const event = (trip?.events || []).find((e) => e.id === params.eventId) || null;
      const locationId = params.locationId || event?.locationId || null;
      const location = (trip?.locations || []).find((l) => l.id === locationId) || null;
      return <EventPageRoute
        trip={trip}
        location={location}
        event={event}
        onNav={onNav}
        onFab={onFab}
        onTripUpdate={refreshTrip}
        onBack={nav.back}
        onOpenEvent={onOpenEvent}
        initialAddType={params.addType || null}
        initialEdit={Boolean(params.edit)}
        // Drop addType once used so returning to this event shows the event, not the form again.
        onInitialAddDone={() => params.addType && nav.replace('event', { ...params, addType: null })}
      />;
    }

    case 'new-trip':
      return <NewTrip
        onBack={nav.back}
        onDone={(t, inviteCode) => {
          setTrip(t);
          refreshTrip();
          setNewTripInviteCode(inviteCode || null);
          nav.reset('trip', { tripId: t.id });
        }}
      />;
    case 'join':
      return <JoinTrip
        initialCode={params.inviteCode || ''}
        onBack={nav.back}
        onJoined={(tripId) => {
          setActiveTrip(tripId);
          refreshTrip();
          nav.reset('trip', { tripId });
        }}
      />;
    default:        return <Home {...common} />;
  }
  }
  return <div style={{height:'100%',display:'flex',flexDirection:'column',overflow:'hidden',paddingTop:'env(safe-area-inset-top, 0px)',boxSizing:'border-box'}}> 
    {recorderTrip && (recordingTrip || (isTripOpen(trip) && !['home','settings','join','new-trip','recap'].includes(screen))) &&
      <RecordingBar trip={recorderTrip} gps={gps} onUpdate={refreshTrip} onOpenTrip={()=>onSelectTrip(recorderTrip.id)}/>}
    <div style={{flex:1,minHeight:0,overflow:'hidden'}}>{renderScreen()}</div>
  </div>;
}

/**
 * Event route wrapper — resolves prev/next siblings so the EventPage keeps its
 * "step through events in order" controls now that it is a top-level route.
 */
function EventPageRoute({ trip, location, event, onOpenEvent, ...rest }) {
  const siblings = (trip?.events || [])
    .filter((e) => e.locationId === (location?.id || event?.locationId))
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const idx = siblings.findIndex((e) => e.id === event?.id);
  const prev = idx > 0 ? siblings[idx - 1] : null;
  const next = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;

  // Anonymous (not-yet-signed-in) trips fall back to the local device id.
  const currentUserId = getSignedInUserId() || getCurrentUserId();
  const isMember = Boolean(trip && isTripMember(trip, currentUserId));
  // Any member can correct an event's details — a shared log is only useful if
  // whoever is standing there can fix the name or time. Deleting stays with the
  // owner and the person who created it.
  const canEdit = isMember;
  const canDelete = Boolean(event && trip && (
    isTripOwner(trip, currentUserId) || event.createdBy === currentUserId
  ));

  return <EventPage
    key={event?.id}
    trip={trip}
    location={location}
    event={event}
    eventIndex={idx >= 0 ? idx : null}
    eventCount={siblings.length}
    onPrev={prev ? () => onOpenEvent(location?.id, prev.id) : null}
    onNext={next ? () => onOpenEvent(location?.id, next.id) : null}
    canEditEvent={canEdit}
    canDeleteEvent={canDelete}
    canAddToEvent={isMember}
    {...rest}
  />;
}
