import { useCallback, useEffect, useState } from 'react';
import { Ic } from './Ic';
import { T, F, ICONS } from '../tokens';
import { listMapRegions } from '../lib/mapRegions';
import { saveTrip } from '../lib/storage';
import {
  formatMapBytes,
  getRegionDownloadStatus,
  isRegionCached,
  preloadMapRegion,
  verifyRegionDownload,
} from '../lib/offlineMaps';

function formatVerifiedAt(ts) {
  if (!ts) return null;
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return null;
  }
}

export function OfflineMapsPanel({ trip, onTripUpdate, compact = false }) {
  const regions = listMapRegions();
  const selected = new Set(trip?.offlineRegions || []);
  const [statuses, setStatuses] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [verifyId, setVerifyId] = useState(null);
  const [confirmId, setConfirmId] = useState(null);

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
    saveTrip({ ...trip, offlineRegions: next, updatedAt: Date.now(), syncState: 'pending' });
    onTripUpdate?.();
  }

  async function handleDownload(regionId) {
    setBusyId(regionId);
    setConfirmId(null);
    try {
      const result = await preloadMapRegion(regionId, {
        onProgress: () => { void refreshStatuses(); },
      });
      if (result && !result.error) {
        setConfirmId(regionId);
      }
    } catch {
      // status stored in offlineMaps
    } finally {
      setBusyId(null);
      void refreshStatuses();
    }
  }

  async function handleVerify(regionId) {
    setVerifyId(regionId);
    try {
      const result = await verifyRegionDownload(regionId);
      if (result.ok) setConfirmId(regionId);
    } finally {
      setVerifyId(null);
      void refreshStatuses();
    }
  }

  if (!regions.length) return null;

  const tripReadyCount = regions.filter((r) => selected.has(r.id) && (statuses[r.id]?.cached || statuses[r.id]?.state === 'ready')).length;
  const tripSelectedCount = regions.filter((r) => selected.has(r.id)).length;

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
        Download map data on Wi‑Fi before you lose service. Verify here that the pack is stored on this device.
      </div>

      {tripSelectedCount > 0 && (
        <div style={{
          marginBottom: 12,
          padding: '9px 11px',
          borderRadius: 10,
          background: tripReadyCount === tripSelectedCount ? '#EBF5EB' : '#FBF0E4',
          border: `1px solid ${tripReadyCount === tripSelectedCount ? '#B8DFB8' : '#E8D4B8'}`,
          fontSize: 11,
          fontWeight: 600,
          color: tripReadyCount === tripSelectedCount ? '#2A6A14' : '#8A5526',
          lineHeight: 1.45,
        }}>
          {tripReadyCount === tripSelectedCount
            ? `✓ All ${tripSelectedCount} pack${tripSelectedCount === 1 ? '' : 's'} for this trip are on this device.`
            : `${tripReadyCount} of ${tripSelectedCount} trip pack${tripSelectedCount === 1 ? '' : 's'} on this device — download the rest before you go offline.`}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {regions.map((region) => {
          const st = statuses[region.id] || getRegionDownloadStatus(region.id);
          const isReady = st.state === 'ready' || st.cached;
          const isDownloading = st.state === 'downloading' || busyId === region.id;
          const isVerifying = verifyId === region.id;
          const onTrip = selected.has(region.id);
          const sizeLabel = formatMapBytes(st.bytes) || (region.estimatedMb ? `~${region.estimatedMb} MB` : null);
          const verifiedLabel = formatVerifiedAt(st.verifiedAt || st.updatedAt);
          const justConfirmed = confirmId === region.id && isReady;

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
                  {sizeLabel && (
                    <div style={{ fontSize: 10, color: T.textFaint, marginTop: 3 }}>{sizeLabel}</div>
                  )}
                </div>
                <div style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: isReady ? '#2E6D3A' : isDownloading ? '#2A5C8E' : st.state === 'error' ? '#8A1414' : T.textFaint,
                  flexShrink: 0,
                  textAlign: 'right',
                }}>
                  {isReady ? 'On device' : isDownloading ? `${st.progress || 0}%` : st.state === 'error' ? 'Failed' : 'Not on device'}
                </div>
              </div>

              {isDownloading && (
                <div style={{ marginTop: 8, height: 5, borderRadius: 99, background: T.border, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${st.progress || 0}%`,
                    background: T.accent,
                    borderRadius: 99,
                    transition: 'width 0.2s ease',
                  }} />
                </div>
              )}

              {isReady && (
                <div style={{
                  marginTop: 8,
                  padding: '9px 10px',
                  borderRadius: 9,
                  background: justConfirmed ? '#E2F4E2' : '#F3F8F4',
                  border: `1px solid ${justConfirmed ? '#9FD09F' : '#C8DFC8'}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      background: '#2A6A14',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      <Ic d="M20 6L9 17l-5-5" size={12} color="white" sw={3} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11.5, fontWeight: 800, color: '#2A6A14' }}>
                        {justConfirmed ? 'Download complete' : 'Stored on this device'}
                      </div>
                      <div style={{ fontSize: 10.5, color: T.textSub, marginTop: 2, lineHeight: 1.4 }}>
                        {sizeLabel ? `${sizeLabel}` : 'Map pack verified'}
                        {verifiedLabel ? ` · ${verifiedLabel}` : ''}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleVerify(region.id)}
                    disabled={isVerifying}
                    style={{
                      marginTop: 8,
                      width: '100%',
                      border: `1px solid ${T.border}`,
                      borderRadius: 8,
                      background: T.card,
                      padding: '7px 10px',
                      fontSize: 10.5,
                      fontWeight: 700,
                      fontFamily: F,
                      color: T.textSub,
                      cursor: isVerifying ? 'wait' : 'pointer',
                    }}
                  >
                    {isVerifying ? 'Checking…' : 'Verify download again'}
                  </button>
                </div>
              )}

              {!isReady && (
                <button
                  type="button"
                  onClick={() => !isDownloading && void handleDownload(region.id)}
                  disabled={isDownloading}
                  style={{
                    marginTop: 8,
                    width: '100%',
                    textAlign: 'center',
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: 'none',
                    background: T.accent,
                    color: 'white',
                    fontSize: 11,
                    fontWeight: 800,
                    fontFamily: F,
                    cursor: isDownloading ? 'wait' : 'pointer',
                    opacity: isDownloading ? 0.7 : 1,
                  }}
                >
                  {isDownloading ? 'Downloading to this device…' : 'Download to this device'}
                </button>
              )}

              {trip?.id && (
                <button
                  type="button"
                  onClick={() => toggleTripRegion(region.id)}
                  style={{
                    marginTop: 8,
                    width: '100%',
                    textAlign: 'center',
                    padding: '7px 10px',
                    borderRadius: 8,
                    border: `1px solid ${onTrip ? T.accent : T.border}`,
                    background: onTrip ? T.accentLight : T.card,
                    color: onTrip ? T.accent : T.textSub,
                    fontSize: 10.5,
                    fontWeight: 700,
                    fontFamily: F,
                    cursor: 'pointer',
                  }}
                >
                  {onTrip ? '✓ Using on this trip' : 'Use on this trip'}
                </button>
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
