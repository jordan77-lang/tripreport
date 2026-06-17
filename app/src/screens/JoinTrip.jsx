import { useState } from 'react';
import { joinTripByCode } from '../lib/tripCloud';
import { T, F } from '../tokens';

export function JoinTrip({ onJoined, onBack, initialCode = '' }) {
  const [code, setCode] = useState(() => String(initialCode || '').trim().toUpperCase());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleJoin(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const tripId = await joinTripByCode(code);
      onJoined?.(tripId);
    } catch (err) {
      setError(err?.message || 'Could not join trip');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: '100%', background: T.bg, fontFamily: F }}>
      <div style={{ padding: '16px 16px 24px', maxWidth: 420, margin: '0 auto' }}>
        <button type="button" onClick={onBack} style={backBtn}>← Back</button>
        <div style={{ fontSize: 22, fontWeight: 900, color: T.text, marginBottom: 8 }}>Join a trip</div>
        <div style={{ fontSize: 13, color: T.textSub, marginBottom: 20, lineHeight: 1.5 }}>
          Enter the invite code from your trip lead.
        </div>

        <form onSubmit={handleJoin}>
          <input
            type="text"
            required
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="INVITE CODE"
            maxLength={12}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              border: `1px solid ${T.border}`,
              borderRadius: 10,
              padding: '14px 13px',
              fontSize: 18,
              letterSpacing: 3,
              textAlign: 'center',
              fontWeight: 800,
              background: T.card,
            }}
          />

          {!!error && (
            <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 10, background: '#FBE4E4', color: '#8A1414', fontSize: 12, fontWeight: 600 }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={busy || !code.trim()} style={primaryBtn(busy || !code.trim())}>
            {busy ? 'Joining…' : 'Join trip'}
          </button>
        </form>
      </div>
    </div>
  );
}

const backBtn = {
  border: 'none',
  background: 'transparent',
  color: T.textSub,
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
  padding: '0 0 12px',
};

function primaryBtn(disabled) {
  return {
    width: '100%',
    marginTop: 14,
    border: 'none',
    borderRadius: 12,
    padding: '13px 16px',
    background: T.accent,
    color: 'white',
    fontSize: 14,
    fontWeight: 800,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.65 : 1,
  };
}
