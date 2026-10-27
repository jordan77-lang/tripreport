import { useState } from 'react';
import { claimDeletedTripOwnership, deleteTripCompletely } from '../lib/tripCloud';
import { T, F } from '../tokens';
import { ts } from '../lib/textScale';

export function OwnerDeletedTripBanner({ trip, onTripUpdate, onTripDeleted }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!trip?.ownerDeletedAt) return null;

  async function handleTakeOwnership() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await claimDeletedTripOwnership(trip.id);
      onTripUpdate?.();
    } catch (e) {
      setError(e?.message || 'Could not take ownership of this trip.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteLocal() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteTripCompletely(trip.id);
      if (onTripDeleted) onTripDeleted();
      else onTripUpdate?.();
    } catch (e) {
      setError(e?.message || 'Could not delete trip.');
      setBusy(false);
    }
  }

  return (
    <div
      role="region"
      aria-label="Trip deleted by owner"
      style={{
        background: '#FBF0E4',
        border: '1px solid #E8C9A0',
        borderRadius: 14,
        padding: '14px 16px',
        marginBottom: 14,
        fontFamily: F,
        color: T.text,
      }}
    >
      <div style={{ fontSize: ts(14), fontWeight: 800, color: '#7A4A14', marginBottom: 4 }}>
        The owner deleted &ldquo;{trip.name || 'this trip'}&rdquo;
      </div>
      <div style={{ fontSize: ts(13), color: '#5C3A12', lineHeight: 1.5, marginBottom: 12 }}>
        This trip was removed from the cloud by its owner. Would you like to delete it from your device, or take ownership to keep the trip and its memories?
      </div>
      {error && (
        <div style={{ fontSize: ts(12), color: '#8A1414', fontWeight: 700, marginBottom: 10 }}>
          {error}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleTakeOwnership()}
          style={{
            flex: '1 1 160px',
            minHeight: 42,
            border: 'none',
            borderRadius: 10,
            padding: '10px 14px',
            fontSize: ts(13),
            fontWeight: 800,
            color: 'white',
            background: T.accent,
            cursor: busy ? 'wait' : 'pointer',
            fontFamily: F,
          }}
        >
          {busy ? 'Working…' : 'Take ownership'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleDeleteLocal()}
          style={{
            flex: '1 1 140px',
            minHeight: 42,
            border: '1px solid #E7B5B5',
            borderRadius: 10,
            padding: '10px 14px',
            fontSize: ts(13),
            fontWeight: 800,
            color: '#8A1414',
            background: '#FFF0F0',
            cursor: busy ? 'wait' : 'pointer',
            fontFamily: F,
          }}
        >
          Delete trip
        </button>
      </div>
    </div>
  );
}
