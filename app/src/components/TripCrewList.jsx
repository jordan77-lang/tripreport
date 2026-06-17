import { useMemo } from 'react';
import { T, F } from '../tokens';
import { ts } from '../lib/textScale';
import { buildTripParticipants } from '../lib/expenses';

export function TripCrewList({ trip, currentUserId, onManageCrew, canManage = false }) {
  const participants = useMemo(
    () => buildTripParticipants(trip, currentUserId),
    [trip, currentUserId],
  );

  if (!trip || participants.length === 0) return null;

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: ts(11), fontWeight: 700, color: T.textSub, letterSpacing: 0.7, textTransform: 'uppercase' }}>
          Crew ({participants.length})
        </span>
        {canManage && onManageCrew && (
          <button
            type="button"
            onClick={onManageCrew}
            style={{
              border: 'none',
              background: 'transparent',
              color: T.accent,
              fontSize: ts(12),
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: F,
              padding: 0,
            }}
          >
            Invite & manage →
          </button>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {participants.map((p) => (
          <span
            key={p.id}
            style={{
              fontSize: ts(12),
              fontWeight: 600,
              color: T.text,
              background: T.card,
              border: `1px solid ${T.border}`,
              borderRadius: 20,
              padding: '5px 11px',
              lineHeight: 1.2,
            }}
          >
            {p.label}
          </span>
        ))}
      </div>
    </div>
  );
}
