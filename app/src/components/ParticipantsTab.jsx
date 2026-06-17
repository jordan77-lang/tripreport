import { useMemo, useState } from 'react';
import { T, F } from '../tokens';
import { ts } from '../lib/textScale';
import {
  addTripCollaborator,
  getCurrentUserId,
  removeTripCollaborator,
} from '../lib/storage';
import { isJoinedMember } from '../lib/tripParticipants';
import { buildTripParticipants } from '../lib/expenses';
import { savePlanningToCloud } from '../lib/planningSave';
import { TripInvitePanel } from './TripInvitePanel';

export function ParticipantsTab({
  trip,
  canInvite,
  onTripUpdate,
  newTripInviteCode,
  onDismissInvite,
}) {
  const currentUserId = getCurrentUserId();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const participants = useMemo(
    () => buildTripParticipants(trip, currentUserId, { withOwnerMeta: true }),
    [trip, currentUserId],
  );

  async function addToRoster() {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      await savePlanningToCloud(trip.id, () => {
        addTripCollaborator(trip.id, { name: name.trim() });
      });
      setName('');
      onTripUpdate?.();
    } finally {
      setSaving(false);
    }
  }

  async function removeFromRoster(collaboratorId) {
    if (saving) return;
    setSaving(true);
    try {
      await savePlanningToCloud(trip.id, () => {
        removeTripCollaborator(trip.id, collaboratorId);
      });
      onTripUpdate?.();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div style={{ fontSize: ts(12), color: T.textSub, marginBottom: 14, lineHeight: 1.5 }}>
        <strong style={{ color: T.text }}>On the roster</strong> — names for gear and meal planning.
        <br />
        <strong style={{ color: T.text }}>Invited</strong> — they joined with your code or were emailed an invite.
      </div>

      <SectionLabel>Trip crew ({participants.length})</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        {participants.map((p) => {
          const rosterEntry = !p.isOwner && !p.joinedViaInvite
            ? (trip.collaborators || []).find(
              (c) => !c.userId && !isJoinedMember(c) && (c.id === p.id || (c.handle || c.name) === p.label),
            )
            : null;
          const isOwner = p.isOwner;
          const joined = !isOwner && p.joinedViaInvite;
          return (
            <div key={p.id} style={rowStyle}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: ts(13), fontWeight: 700, color: T.text }}>{p.label}</div>
                <div style={{ fontSize: ts(11), color: T.textFaint, marginTop: 2 }}>
                  {isOwner ? 'Owner' : joined ? 'Joined via invite' : 'Roster only — not in app yet'}
                </div>
              </div>
              {rosterEntry && (
                <button
                  type="button"
                  onClick={() => void removeFromRoster(rosterEntry.id)}
                  disabled={saving}
                  style={removeBtn}
                  aria-label="Remove from roster"
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}
      </div>

      <SectionLabel>Add to roster (name only)</SectionLabel>
      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void addToRoster(); }}
          placeholder="Name for gear & meals"
          style={inputStyle}
        />
        <button
          type="button"
          onClick={() => void addToRoster()}
          disabled={!name.trim() || saving}
          style={saveBtn(!name.trim() || saving)}
        >
          {saving ? '…' : 'Save'}
        </button>
      </div>

      {canInvite ? (
        <TripInvitePanel
          trip={trip}
          compact
          initialCode={newTripInviteCode}
          onDismissInitial={onDismissInvite}
          onTripUpdate={onTripUpdate}
        />
      ) : (
        <div style={{ fontSize: ts(12), color: T.textSub, lineHeight: 1.45, padding: '12px 14px', background: T.card, borderRadius: 12, border: `1px solid ${T.border}` }}>
          Only the trip owner can send invites. Ask them to invite you from Trip Plan → Crew.
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{ fontSize: 10.5, fontWeight: 700, color: T.textSub, letterSpacing: 0.7, textTransform: 'uppercase', marginBottom: 8 }}>
      {children}
    </div>
  );
}

const rowStyle = {
  background: T.card,
  borderRadius: 12,
  padding: '10px 12px',
  border: `1px solid ${T.border}`,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
};

const inputStyle = {
  flex: 1,
  border: `1.5px solid ${T.border}`,
  borderRadius: 10,
  padding: '10px 12px',
  fontSize: ts(14),
  fontFamily: F,
  background: T.bg,
  outline: 'none',
  minWidth: 0,
};

function saveBtn(disabled) {
  return {
    flexShrink: 0,
    minWidth: 72,
    height: 42,
    borderRadius: 10,
    border: 'none',
    background: disabled ? '#7A9BB8' : T.accent,
    color: 'white',
    fontSize: ts(12),
    fontWeight: 800,
    cursor: disabled ? 'wait' : 'pointer',
    fontFamily: F,
    padding: '0 14px',
  };
}

const removeBtn = {
  border: 'none',
  background: 'transparent',
  color: T.textFaint,
  cursor: 'pointer',
  fontSize: 14,
  padding: '4px 6px',
};
