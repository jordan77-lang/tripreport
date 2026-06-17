import { useEffect, useMemo, useRef, useState } from 'react';
import { T, F } from '../tokens';
import { ts } from '../lib/textScale';
import {
  addTripCollaborator,
  getCurrentUserId,
  getTrip,
  removeTripCollaborator,
  saveTrip,
} from '../lib/storage';
import { dedupeCollaborators, isJoinedMember } from '../lib/tripParticipants';
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
  const [inviteFocus, setInviteFocus] = useState({ name: null, mode: 'email', token: 0 });
  const inviteRef = useRef(null);

  const participants = useMemo(
    () => buildTripParticipants(trip, currentUserId, { withOwnerMeta: true }),
    [trip, currentUserId],
  );

  useEffect(() => {
    if (newTripInviteCode) {
      setInviteFocus({ name: null, mode: 'code', token: Date.now() });
    }
  }, [newTripInviteCode]);

  useEffect(() => {
    if (!trip?.id) return;
    const cleaned = dedupeCollaborators(trip.collaborators, { memberProfiles: trip.memberProfiles });
    if (cleaned.length === (trip.collaborators || []).length) return;
    void savePlanningToCloud(trip.id, () => {
      const latest = getTrip(trip.id);
      if (!latest) return;
      saveTrip({
        ...latest,
        collaborators: cleaned,
        updatedAt: Date.now(),
        syncState: 'pending',
      });
    }).then(() => onTripUpdate?.());
  }, [trip, onTripUpdate]);

  function openInvite(personName = null) {
    setInviteFocus({
      name: personName,
      mode: personName ? 'email' : (newTripInviteCode ? 'code' : 'email'),
      token: Date.now(),
    });
    requestAnimationFrame(() => {
      inviteRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

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
        <strong style={{ color: T.text }}>Invited</strong> — joined via email or join code. Tap <strong style={{ color: T.text }}>Invite</strong> on anyone not in the app yet.
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <SectionLabel>Trip crew ({participants.length})</SectionLabel>
        {canInvite && (
          <button type="button" onClick={() => openInvite()} style={headerInviteBtn}>
            + Invite
          </button>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        {participants.map((p) => {
          const rosterEntry = !p.isOwner && !p.joinedViaInvite
            ? (trip.collaborators || []).find(
              (c) => !c.userId && !isJoinedMember(c) && (c.id === p.id || (c.handle || c.name) === p.label),
            )
            : null;
          const isOwner = p.isOwner;
          const joined = !isOwner && p.joinedViaInvite;
          const displayName = p.label.replace(/\s*\(owner\)\s*$/i, '');
          return (
            <div key={p.id} style={rowStyle}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: ts(13), fontWeight: 700, color: T.text }}>{p.label}</div>
                <div style={{ fontSize: ts(11), color: T.textFaint, marginTop: 2 }}>
                  {isOwner ? 'Owner' : joined ? 'Joined via invite' : 'Roster only — not in app yet'}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                {canInvite && !isOwner && !joined && (
                  <button
                    type="button"
                    onClick={() => openInvite(displayName)}
                    style={rowInviteBtn}
                  >
                    Invite
                  </button>
                )}
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
            </div>
          );
        })}
      </div>

      {canInvite ? (
        <div ref={inviteRef} style={invitePanelWrap}>
          <TripInvitePanel
            trip={trip}
            initialCode={newTripInviteCode}
            onDismissInitial={onDismissInvite}
            onTripUpdate={onTripUpdate}
            initialMode={inviteFocus.mode}
            initialInviteeName={inviteFocus.name}
            focusToken={inviteFocus.token}
          />
        </div>
      ) : (
        <div style={{ fontSize: ts(12), color: T.textSub, lineHeight: 1.45, padding: '12px 14px', background: T.card, borderRadius: 12, border: `1px solid ${T.border}`, marginBottom: 16 }}>
          Only the trip owner can send invites. Ask them to invite you from Trip Plan → Crew.
        </div>
      )}

      <SectionLabel>Add to roster (name only)</SectionLabel>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
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
      <div style={{ fontSize: ts(11), color: T.textFaint, lineHeight: 1.4 }}>
        Names here are for planning only. Use Invite above to bring them into the trip.
      </div>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{ fontSize: 10.5, fontWeight: 700, color: T.textSub, letterSpacing: 0.7, textTransform: 'uppercase' }}>
      {children}
    </div>
  );
}

const invitePanelWrap = {
  background: T.card,
  border: `1px solid ${T.border}`,
  borderRadius: 12,
  padding: '14px 16px',
  marginBottom: 16,
};

const headerInviteBtn = {
  border: `1px solid ${T.accent}50`,
  borderRadius: 9,
  padding: '5px 10px',
  background: T.accentLight,
  color: T.accent,
  fontSize: ts(11),
  fontWeight: 800,
  fontFamily: F,
  cursor: 'pointer',
  flexShrink: 0,
};

const rowInviteBtn = {
  border: `1px solid ${T.accent}40`,
  borderRadius: 8,
  padding: '5px 9px',
  background: T.bg,
  color: T.accent,
  fontSize: ts(11),
  fontWeight: 700,
  fontFamily: F,
  cursor: 'pointer',
};

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
