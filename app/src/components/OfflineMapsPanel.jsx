import { useCallback, useEffect, useState } from 'react';
import { T, F } from '../tokens';
import { listMapRegions } from '../lib/mapRegions';
import { saveTrip } from '../lib/storage';
import {
  getRegionDownloadStatus,
  isRegionCached,
  preloadMapRegion,
} from '../lib/offlineMaps';

export function OfflineMapsPanel({ trip, onTripUpdate, compact = false }) {
  const regions = listMapRegions();
  const selected = new Set(trip?.offlineRegions || []);
  const [statuses, setStatuses] = useState({});
  const [busyId, setBusyId] = useState(null);

  const refreshStatuses = useCallback(async () => {
    const next = {};
    for (const region of regions) {
      const cached = await isRegionCached(region.id);
      const stored = getRegionDownloadStatus(region.id);
      next[region.id] = {
        ...stored,
        cached,
        state: cached ? 'ready' : stored.state,
        progress: cached ? 100 : stored.progress,
      };
    }
    setStatuses(next);
  }, [regions]);

  useEffect(() => {
    void refreshStatuses();
  }, [refreshStatuses, trip?.offlineRegions]);

  async function toggleTripRegion(regionId) {
    if (!trip?.id) return;
    const current = trip.offlineRegions || [];
    const next = current.includes(regionId)
      ? current.filter((id) => id !== regionId)
      : [...current, regionId];
    saveTrip({ ...trip, offlineRegions: next, updatedAt: Date.now() });
    onTripUpdate?.();
  }

  async function handleDownload(regionId) {
    setBusyId(regionId);
    try {
      await preloadMapRegion(regionId, {
        onProgress: () => { void refreshStatuses(); },
      });
    } catch {
      // status stored in offlineMaps
    } finally {
      setBusyId(null);
      void refreshStatuses();
    }
  }

  if (!regions.length) return null;

  return (
    <div style={{
      background: T.card,
      borderRadius: 12,
      border: `1px solid ${T.border}`,
      padding: compact ? '10px 12px' : '12px 14px',
      marginBottom: 12,
    }}>
      <div style={{ fontSize: compact ? 12 : 13, fontWeight: 800, color: T.text, marginBottom: 4 }}>
        Offline map packs
      </div>
      <div style={{ fontSize: 11, color: T.textSub, marginBottom: 10, lineHeight: 1.45 }}>
        Download map data on Wi‑Fi before you lose service. Available for any trip that includes a pack.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {regions.map((region) => {
          const st = statuses[region.id] || getRegionDownloadStatus(region.id);
          const isReady = st.state === 'ready' || st.cached;
          const isDownloading = st.state === 'downloading' || busyId === region.id;
          const onTrip = selected.has(region.id);

          return (
            <div key={region.id} style={{
              border: `1px solid ${onTrip ? `${T.accent}55` : T.border}`,
              borderRadius: 10,
              padding: '10px 12px',
              background: onTrip ? T.accentLight : T.bg,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 800, color: T.text }}>{region.name}</div>
                  <div style={{ fontSize: 10.5, color: T.textSub, marginTop: 2 }}>{region.area}</div>
                  {region.estimatedMb && (
                    <div style={{ fontSize: 10, color: T.textFaint, marginTop: 3 }}>~{region.estimatedMb} MB</div>
                  )}
                </div>
                <div style={{ fontSize: 10, fontWeight: 700, color: isReady ? '#2E6D3A' : isDownloading ? '#2A5C8E' : T.textFaint, flexShrink: 0 }}>
                  {isReady ? 'Ready' : isDownloading ? `${st.progress || 0}%` : st.state === 'error' ? 'Retry' : 'Not downloaded'}
                </div>
              </div>

              {!isReady && (
                <div
                  onClick={() => !isDownloading && void handleDownload(region.id)}
                  style={{
                    marginTop: 8,
                    textAlign: 'center',
                    padding: '8px 10px',
                    borderRadius: 8,
                    background: T.accent,
                    color: 'white',
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: isDownloading ? 'wait' : 'pointer',
                    opacity: isDownloading ? 0.7 : 1,
                  }}
                >
                  {isDownloading ? 'Downloading…' : 'Download pack'}
                </div>
              )}

              {trip?.id && (
                <div
                  onClick={() => toggleTripRegion(region.id)}
                  style={{
                    marginTop: 8,
                    textAlign: 'center',
                    padding: '7px 10px',
                    borderRadius: 8,
                    border: `1px solid ${onTrip ? T.accent : T.border}`,
                    background: onTrip ? T.accentLight : T.card,
                    color: onTrip ? T.accent : T.textSub,
                    fontSize: 10.5,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {onTrip ? '✓ Using on this trip' : 'Use on this trip'}
                </div>
              )}

              {st.state === 'error' && (
                <div style={{ fontSize: 10, color: '#8A1414', marginTop: 6 }}>{st.error}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
