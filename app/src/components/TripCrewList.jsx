import { useMemo } from 'react';
import { T, F } from '../tokens';
import { ts } from '../lib/textScale';
import { buildTripParticipants } from '../lib/expenses';
import { getSharedTripCountsByPerson } from '../lib/storage';

export function TripCrewList({ trip, currentUserId, onManageCrew, canManage = false }) {
  const participants = useMemo(
    () => buildTripParticipants(trip, currentUserId, { withOwnerMeta: true }),
    [trip, currentUserId],
  );
  const sharedCounts = useMemo(() => getSharedTripCountsByPerson(), [trip]);

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
        {participants.map((p) => {
          const cleanName = p.label.replace(/\s*\(owner\)\s*$/i, '').trim().toLowerCase();
          const tripCount = Math.max(sharedCounts.byId[p.id] || 0, sharedCounts.byName[cleanName] || 0);
          return (
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
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <span>{p.label}</span>
              {p.craft && (
                <span style={{ fontSize: ts(10), fontWeight: 800, color: '#2A5C8E', background: '#E4EFF8', borderRadius: 10, padding: '1px 6px' }}>
                  {p.craft}
                </span>
              )}
              {tripCount > 1 && (
                <span style={{ fontSize: ts(10), fontWeight: 700, color: T.textSub }}>
                  · {tripCount} trips
                </span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}
