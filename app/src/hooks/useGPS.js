import { useEffect, useRef, useState } from 'react';
import { appendTrackPoint } from '../lib/storage';

export function useGPS(tripId, { enabled = false, interval = 5000, sessionId = null, onTrackPoint } = {}) {
  const geolocationSupported = typeof navigator !== 'undefined' && Boolean(navigator.geolocation);
  const [position, setPosition] = useState(null); // {lng, lat, alt, accuracy, heading, speed}
  const [error, setError]       = useState(geolocationSupported ? null : 'Geolocation not supported by this browser');
  const [tracking, setTracking] = useState(false);
  const watchId = useRef(null);
  const lastSave = useRef(0);

  useEffect(() => {
    if (!enabled || !tripId) return;
    if (!geolocationSupported) return;

    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        setTracking(true);
        setError(null);
        const point = {
          lng:      pos.coords.longitude,
          lat:      pos.coords.latitude,
          alt:      pos.coords.altitude,
          accuracy: pos.coords.accuracy,
          heading:  pos.coords.heading,
          speed:    pos.coords.speed,
          ts:       pos.timestamp,
          sessionId,
        };
        setPosition(point);

        // Throttle writes to storage
        if (Date.now() - lastSave.current > interval) {
          appendTrackPoint(tripId, point);
          lastSave.current = Date.now();
          onTrackPoint?.(point);
        }
      },
      (err) => setError(err.message),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
    );

    return () => {
      if (watchId.current !== null) {
        navigator.geolocation.clearWatch(watchId.current);
        watchId.current = null;
      }
      setTracking(false);
    };
  }, [enabled, tripId, interval, sessionId, onTrackPoint, geolocationSupported]);

  return { position, error, tracking };
}
