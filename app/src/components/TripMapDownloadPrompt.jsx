import { useCallback, useEffect, useState } from 'react';
import { T, F } from '../tokens';
import {
  formatMapBytes,
  getTripOfflineMapReadiness,
  preloadAllTripMaps,
} from '../lib/offlineMaps';

/**
 * Prompts any crew member who joins or opens a trip to download the trip's
 * selected offline map(s) onto their local device, and confirms when the map
 * is stored locally for no-service areas.
 */
export function TripMapDownloadPrompt({ trip, onOpenMaps }) {
  const [readiness, setReadiness] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [justFinished, setJustFinished] = useState(false);
  const [error, setError] = useState(null);

  const checkReadiness = useCallback(async () => {
    if (!trip?.id) {
      setReadiness(null);
      return;
    }
    const status = await getTripOfflineMapReadiness(trip);
    setReadiness(status);
  }, [trip]);

  useEffect(() => {
    void checkReadiness();
  }, [checkReadiness, trip?.offlineRegions, trip?.mapArea]);

  async function handleDownloadNow() {
    if (!trip || downloading) return;
    setDownloading(true);
    setError(null);
    setProgress(1);
    try {
      const results = await preloadAllTripMaps(trip, {
        onProgress: (pct) => {
          setProgress(pct);
        },
      });
      const failed = results.find((r) => r?.error);
      if (failed) {
        setError(failed.error);
      } else {
        setJustFinished(true);
      }
    } catch (e) {
      setError(e?.message || 'Could not download map right now.');
    } finally {
      setDownloading(false);
      await checkReadiness();
    }
  }

  if (!trip?.id || trip.status === 'completed') return null;
  if (!readiness) return null;

  // Case 1: No map selected on the trip yet — remind the creator/crew to pick one before losing service.
  if (!readiness.configured) {
    if (!onOpenMaps) return null;
    return (
      <div style={{
        margin: '0 0 12px',
        padding: '10px 12px',
        borderRadius: 12,
        background: '#FBF0E4',
        border: '1px solid #E8D4B8',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        fontFamily: F,
      }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: '#8A4812' }}>
            🗺️ No offline map selected for this trip yet
          </div>
          <div style={{ fontSize: 10.5, color: '#7A4A1D', marginTop: 1 }}>
            Pick a map area now so everyone on the trip can download it before losing service.
          </div>
        </div>
        <button
          type="button"
          onClick={onOpenMaps}
          style={{
            border: `1px solid ${T.accent}`,
            background: T.card,
            color: T.accent,
            borderRadius: 8,
            padding: '6px 10px',
            fontSize: 11,
            fontWeight: 800,
            fontFamily: F,
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          Choose map
        </button>
      </div>
    );
  }

  // Case 2: Trip has selected map(s), and they ARE stored on this device!
  if (readiness.ready) {
    const totalBytes = readiness.regions.reduce((sum, r) => sum + (Number(r.bytes) || 0), 0);
    const sizeText = formatMapBytes(totalBytes);
    return (
      <div style={{
        margin: '0 0 12px',
        padding: '9px 12px',
        borderRadius: 11,
        background: justFinished ? '#E2F4E2' : '#EBF5EB',
        border: `1px solid ${justFinished ? '#8ED08E' : '#B8DFB8'}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        fontFamily: F,
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#2A6A14', minWidth: 0, flex: 1 }}>
          ✓ Offline map on this device: <strong>{readiness.primaryLabel}</strong>
          {sizeText ? ` (${sizeText})` : ''}
        </div>
        {onOpenMaps && (
          <button
            type="button"
            onClick={onOpenMaps}
            style={{
              border: 'none',
              background: 'transparent',
              color: '#2A6A14',
              fontSize: 10.5,
              fontWeight: 800,
              fontFamily: F,
              cursor: 'pointer',
              padding: '2px 4px',
              textDecoration: 'underline',
              flexShrink: 0,
            }}
          >
            Edit map
          </button>
        )}
      </div>
    );
  }

  // Case 3: Trip has selected map(s), and this device does NOT have them downloaded yet!
  const missingNames = readiness.regions.filter((r) => !r.cached).map((r) => r.name).join(' + ');
  const estMb = readiness.regions
    .filter((r) => !r.cached)
    .reduce((sum, r) => sum + (Number(r.estimatedMb) || 5), 0);

  return (
    <div
      role="region"
      aria-label="Download trip offline map"
      style={{
        margin: '0 0 14px',
        padding: '12px 14px',
        borderRadius: 12,
        background: '#FFF4E5',
        border: '1.5px solid #E5A95C',
        boxShadow: '0 4px 14px rgba(155, 81, 24, 0.08)',
        fontFamily: F,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: '#8A4812' }}>
            📡 Download Trip Map for Offline Use
          </div>
          <div style={{ fontSize: 11, color: '#6E3B10', marginTop: 3, lineHeight: 1.45 }}>
            This trip uses <strong>{missingNames}</strong> (~{estMb} MB). Download it to this device now while you have service so your map works when you go off-grid.
          </div>
        </div>
      </div>

      {downloading && (
        <div style={{ marginTop: 9, height: 6, borderRadius: 99, background: '#EED5B7', overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${Math.max(5, progress)}%`,
            background: T.accent,
            borderRadius: 99,
            transition: 'width 0.2s ease',
          }} />
        </div>
      )}

      {error && (
        <div style={{ fontSize: 10.5, color: T.red, marginTop: 6, fontWeight: 700 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => void handleDownloadNow()}
          disabled={downloading}
          style={{
            flex: 1,
            minWidth: 180,
            border: 'none',
            borderRadius: 9,
            padding: '9px 12px',
            background: T.accent,
            color: 'white',
            fontSize: 12,
            fontWeight: 800,
            fontFamily: F,
            cursor: downloading ? 'wait' : 'pointer',
          }}
        >
          {downloading ? `Downloading to this device (${progress}%)…` : `Download "${missingNames}" Now`}
        </button>
        {onOpenMaps && (
          <button
            type="button"
            onClick={onOpenMaps}
            style={{
              border: '1px solid #D9B07E',
              borderRadius: 9,
              padding: '9px 11px',
              background: T.card,
              color: '#7A4A1D',
              fontSize: 11,
              fontWeight: 700,
              fontFamily: F,
              cursor: 'pointer',
            }}
          >
            Edit or choose map
          </button>
        )}
      </div>
    </div>
  );
}
