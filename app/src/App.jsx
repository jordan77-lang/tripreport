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
import { useAuth } from './context/AuthContext';
import { claimAnonymousTripsForUser, clearActiveTrip, getActiveTrip, getTrips, isTripOpen, setActiveTrip, updateEntry } from './lib/storage';
import { getSignedInUserId } from './lib/authUser';
import { Settings } from './screens/Settings';
import { useGPS } from './hooks/useGPS';
import { useOfflineMapPreload } from './hooks/useOfflineMapPreload';
import { useTripMediaSync } from './hooks/useTripMediaSync';
import { useCloudTripSync } from './hooks/useCloudTripSync';
import { fetchGauge, fetchNearbyGaugesByGps, findNearbyKnownGauges } from './lib/usgs';
import { fetchWeatherAtTime } from './lib/weather';

export default function App() {
  const auth = useAuth();
  const [screen, setScreen] = useState('home');
  const [trip, setTrip]     = useState(() => getActiveTrip());
  const [allTrips, setAllTrips] = useState(() => getTrips());
  const [newTripInviteCode, setNewTripInviteCode] = useState(null);
  const [planInitialTab, setPlanInitialTab] = useState(null);
  const [joinInviteCode, setJoinInviteCode] = useState('');
  const enrichmentRunningRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const join = params.get('join') || params.get('code');
    if (join?.trim()) {
      setJoinInviteCode(join.trim().toUpperCase());
      setScreen('join');
    }
  }, []);

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

            const gauge = await fetchGauge(siteId);
            updateEntry(active.id, entry.id, {
              gaugeSiteId: siteId,
              cfs: gauge.cfs ?? entry.cfs,
              gaugeHt: gauge.gaugeHt ?? entry.gaugeHt,
              gaugeSiteName: gauge.siteName || siteName || entry.gaugeSiteName,
              gaugeFetchedAt: gauge.updatedAt || new Date().toISOString(),
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

  const onNav = (tab) => {
    if (tab === 'plan-participants') {
      setPlanInitialTab('participants');
      setScreen('plan');
      return;
    }
    const map = { home: 'home', map: 'map', log: 'log', share: 'home', trip: 'trip', plan: 'plan' };
    if (tab === 'plan') setPlanInitialTab(null);
    setScreen(map[tab] || 'home');
  };

  const onSelectTrip = (tripId) => {
    if (!tripId) return;
    setActiveTrip(tripId);
    refreshTrip();
    setScreen('trip');
  };

  const onFab = () => setScreen('new-trip');

  const onOpenRecap = (tripId) => {
    if (tripId) setActiveTrip(tripId);
    refreshTrip();
    setScreen('recap');
  };

  const common = { trip, onNav, onFab };
  const onTripDeleted = () => {
    clearActiveTrip();
    refreshTrip();
    setScreen('home');
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

  switch (screen) {
    case 'home':    return <Home {...common} allTrips={allTrips} onSelectTrip={onSelectTrip} onOpenTrip={() => setScreen('trip')} onOpenPlan={() => { setPlanInitialTab(null); setScreen('plan'); }} onJoinTrip={() => setScreen('join')} onOpenSettings={() => setScreen('settings')} onOpenRecap={onOpenRecap} auth={auth} />;
    case 'settings': return <Settings onBack={() => setScreen('home')} auth={auth} />;
    case 'recap':   return <TripRecap trip={trip} onBack={() => setScreen('home')} onTripUpdate={refreshTrip} auth={auth} />;
    case 'trip':    return <Trip {...common} onTripUpdate={refreshTrip} onTripDeleted={onTripDeleted} onOpenRecap={onOpenRecap} />;
    case 'map':     return trip?.status === 'completed' ? <Trip {...common} onTripUpdate={refreshTrip} onTripDeleted={onTripDeleted} /> : <Navigator {...common} gps={gps} />;
    case 'log':     return trip?.status === 'completed' ? <Trip {...common} onTripUpdate={refreshTrip} onTripDeleted={onTripDeleted} /> : <FieldJournal {...common} onTripUpdate={refreshTrip} />;
    case 'plan':    return <TripPlan {...common} onTripUpdate={refreshTrip} onBack={() => setScreen('trip')} initialTab={planInitialTab} newTripInviteCode={newTripInviteCode} onDismissInvite={() => setNewTripInviteCode(null)} />;
    case 'new-trip':
      return <NewTrip
        onBack={() => setScreen('home')}
        onDone={(t, inviteCode) => {
          setTrip(t);
          refreshTrip();
          setNewTripInviteCode(inviteCode || null);
          setPlanInitialTab('participants');
          setScreen('plan');
        }}
      />;
    case 'join':
      return <JoinTrip
        initialCode={joinInviteCode}
        onBack={() => setScreen('home')}
        onJoined={(tripId) => {
          setActiveTrip(tripId);
          refreshTrip();
          setScreen('trip');
        }}
      />;
    default:        return <Home {...common} />;
  }
}
