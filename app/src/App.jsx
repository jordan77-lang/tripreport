import { useState, useCallback, useEffect, useRef } from 'react';
import { Home }         from './screens/Home';
import { Trip }         from './screens/Trip';
import { Navigator }    from './screens/Navigator';
import { FieldJournal } from './screens/FieldJournal';
import { TripPlan }     from './screens/TripPlan';
import { NewTrip }      from './screens/NewTrip';
import { AuthScreen }   from './screens/Auth';
import { ProfileSetup } from './screens/ProfileSetup';
import { JoinTrip }     from './screens/JoinTrip';
import { TripRecap }    from './screens/TripRecap';
import { LocationPage } from './screens/LocationPage';
import { EventPage }    from './screens/EventPage';
import { useAuth } from './context/AuthContext';
import { claimAnonymousTripsForUser, clearActiveTrip, getActiveTrip, getCurrentUserId, getTrips, isTripMember, isTripOpen, isTripOwner, setActiveTrip, updateEntry, updateEvent } from './lib/storage';
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

/** Deep links: ?join=CODE opens the join screen on a cold load. */
function parseInitialUrl(url) {
  const join = url.searchParams.get('join') || url.searchParams.get('code');
  if (join?.trim()) {
    return { screen: 'join', params: { inviteCode: join.trim().toUpperCase() } };
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
  const gpsEnabled = isTripOpen(trip) && (
    Boolean(trip?.gpsSessionActive) ||
    (Boolean(trip?.gpsTrackingEnabled) && (screen === 'map' || Boolean(trip?.gpsBackgroundTracking)))
  );
  const gps = useGPS(trip?.id, {
    enabled: gpsEnabled,
    interval: trip?.gpsIntervalMs || 5000,
    sessionId: trip?.gpsSessionId || null,
    onTrackPoint: refreshTrip,
  });

  const syncPendingEntryEnrichment = useCallback(async () => {
    if (!trip?.id) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    if (enrichmentRunningRef.current) return;

    enrichmentRunningRef.current = true;
    try {
      const active = getActiveTrip();
      if (!active || active.id !== trip.id) return;

      let changed = false;
      for (const entry of active.entries || []) {
        if (entry.type === 'gauge' && (entry.gaugeSyncPending || entry.cfs == null)) {
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

            if (!siteId) {
              continue;
            }

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
          } catch {
            // Leave pending for next reconnect.
          }
        }

        if (entry.type === 'weather' && entry.weatherSyncPending && entry.lat != null && entry.lng != null) {
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
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      void syncPendingEntryEnrichment();
    }

    return () => window.removeEventListener('online', onOnline);
  }, [syncPendingEntryEnrichment]);

  // Bottom-nav tabs replace the current screen; drill-downs push. That way back
  // from a Location goes to the Trip it came from, not through every tab visited.
  const onNav = (tab) => {
    if (tab === 'plan-participants') {
      nav.replace('plan', { tab: 'participants' });
      return;
    }
    const map = { home: 'home', map: 'map', log: 'log', trip: 'trip', plan: 'plan' };
    const target = map[tab];
    if (!target) return;
    nav.replace(target, target === 'plan' ? {} : undefined);
  };

  const onSelectTrip = (tripId) => {
    if (!tripId) return;
    setActiveTrip(tripId);
    refreshTrip();
    nav.push('trip', { tripId });
  };

  const onFab = () => nav.push('new-trip');

  const onOpenRecap = (tripId) => {
    if (tripId) setActiveTrip(tripId);
    refreshTrip();
    nav.push('recap', { tripId });
  };

  const onOpenLocation = (locationId, eventId = null) => {
    if (!locationId) return;
    nav.push('location', { locationId, eventId: eventId || null });
  };

  const onOpenEvent = (locationId, eventId) => {
    if (!eventId) return;
    nav.push('event', { locationId: locationId || null, eventId });
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
    if (!auth.isSignedIn) return <AuthScreen />;
    if (auth.needsProfile) return <ProfileSetup />;
  }

  const tripPages = { ...common, onTripUpdate: refreshTrip, onOpenLocation, onOpenEvent };

  switch (screen) {
    case 'home':    return <Home {...common} allTrips={allTrips} onSelectTrip={onSelectTrip} onOpenTrip={() => nav.push('trip')} onOpenPlan={() => nav.push('plan')} onJoinTrip={() => nav.push('join')} onOpenSettings={() => nav.push('settings')} onOpenRecap={onOpenRecap} auth={auth} />;
    case 'settings': return <Settings onBack={nav.back} auth={auth} />;
    case 'recap':   return <TripRecap trip={trip} onBack={nav.back} onTripUpdate={refreshTrip} auth={auth} />;
    case 'trip':    return <Trip {...tripPages} onTripDeleted={onTripDeleted} onOpenRecap={onOpenRecap} />;
    case 'map':     return trip?.status === 'completed' ? <Trip {...tripPages} onTripDeleted={onTripDeleted} /> : <Navigator {...common} gps={gps} />;
    case 'log':     return trip?.status === 'completed' ? <Trip {...tripPages} onTripDeleted={onTripDeleted} /> : <FieldJournal {...common} onTripUpdate={refreshTrip} />;
    case 'plan':    return <TripPlan {...common} onTripUpdate={refreshTrip} onBack={nav.back} initialTab={params.tab || null} newTripInviteCode={newTripInviteCode} onDismissInvite={() => setNewTripInviteCode(null)} />;

    case 'location': {
      const location = (trip?.locations || []).find((l) => l.id === params.locationId) || null;
      return <LocationPage
        {...tripPages}
        location={location}
        onBack={nav.back}
        initialEventId={params.eventId || null}
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
      />;
    }

    case 'new-trip':
      return <NewTrip
        onBack={nav.back}
        onDone={(t, inviteCode) => {
          setTrip(t);
          refreshTrip();
          setNewTripInviteCode(inviteCode || null);
          nav.reset('plan', { tab: 'participants' });
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
  // Owners edit anything; members edit what they created themselves.
  const canEdit = Boolean(event && trip && (
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
    canAddToEvent={Boolean(trip && isTripMember(trip, currentUserId))}
    {...rest}
  />;
}
