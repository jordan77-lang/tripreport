import { useEffect, useMemo, useRef, useState } from 'react';
import { T, F } from '../tokens';
import { ts } from '../lib/textScale';
import {
  addTripCollaborator,
  getCurrentUserId,
  getSharedTripCountsByPerson,
  getTrip,
  isTripOwner,
  removeTripCollaborator,
  saveTrip,
  updateCollaboratorCraft,
  updateCollaboratorTripNickname,
} from '../lib/storage';
import { dedupeCollaborators, isJoinedMember } from '../lib/tripParticipants';
import { buildTripParticipants } from '../lib/expenses';
import { savePlanningToCloud } from '../lib/planningSave';
import { TripInvitePanel } from './TripInvitePanel';

const CRAFT_OPTIONS = [
  '',
  'Oar Rig',
  'Kayak',
  'Packraft',
  'Canoe',
  'Hiker',
  'Camp Chef',
  'Photographer',
  'Navigator',
];

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
  const [editingNicknameId, setEditingNicknameId] = useState(null);
  const [nicknameDraft, setNicknameDraft] = useState('');
  const [inviteFocus, setInviteFocus] = useState({ name: null, mode: 'email', token: 0 });
  const inviteRef = useRef(null);

  const participants = useMemo(
    () => buildTripParticipants(trip, currentUserId, { withOwnerMeta: true }),
    [trip, currentUserId],
  );
  const sharedCounts = useMemo(() => getSharedTripCountsByPerson(), [trip]);

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
          const nameKey = displayName.trim().toLowerCase();
          const tripCount = Math.max(sharedCounts.byId[p.id] || 0, sharedCounts.byName[nameKey] || 0);
          const canEditThisName = p.id === currentUserId || isTripOwner(trip, currentUserId);
          const isEditingNickname = editingNicknameId === p.id;
          return (
            <div key={p.id} style={{ ...rowStyle, flexDirection: 'column', alignItems: 'stretch' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: ts(13), fontWeight: 700, color: T.text }}>{p.label}</span>
                  {p.craft && (
                    <span style={{ fontSize: ts(10.5), fontWeight: 800, color: '#2A5C8E', background: '#E4EFF8', borderRadius: 8, padding: '1px 7px' }}>
                      {p.craft}
                    </span>
                  )}
                  {tripCount > 1 && (
                    <span style={{ fontSize: ts(10.5), fontWeight: 700, color: '#2E6D3A', background: '#E5F4E8', borderRadius: 8, padding: '1px 7px' }}>
                      {tripCount} trips together
                    </span>
                  )}
                </div>
                <div style={{ fontSize: ts(11), color: T.textFaint, marginTop: 2 }}>
                  {isOwner ? 'Owner' : joined ? 'Joined via invite' : 'Roster only — not in app yet'}
                  {canEditThisName && (
                    <>
                      {' · '}
                      <button
                        type="button"
                        onClick={() => {
                          if (isEditingNickname) {
                            setEditingNicknameId(null);
                          } else {
                            setEditingNicknameId(p.id);
                            setNicknameDraft(p.tripNickname || displayName);
                          }
                        }}
                        style={{
                          border: 'none',
                          background: 'transparent',
                          color: '#2A5C8E',
                          fontSize: ts(11),
                          fontWeight: 700,
                          padding: 0,
                          cursor: 'pointer',
                          fontFamily: F,
                        }}
                      >
                        {isEditingNickname ? 'Cancel' : (p.id === currentUserId ? 'Change my trip name' : 'Edit trip name')}
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                <select
                  aria-label={`Craft or role for ${displayName}`}
                  value={p.craft || ''}
                  onChange={(e) => {
                    const nextCraft = e.target.value;
                    void savePlanningToCloud(trip.id, () => {
                      updateCollaboratorCraft(trip.id, p.id, nextCraft);
                    }).then(() => onTripUpdate?.());
                  }}
                  style={{
                    fontSize: ts(11),
                    color: T.textSub,
                    border: `1px solid ${T.border}`,
                    borderRadius: 8,
                    padding: '4px 6px',
                    background: T.bg,
                    fontFamily: F,
                  }}
                >
                  {CRAFT_OPTIONS.map((opt) => (
                    <option key={opt || 'none'} value={opt}>{opt || 'Role / craft…'}</option>
                  ))}
                </select>
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
              {isEditingNickname && (
                <div style={{ display: 'flex', gap: 6, marginTop: 8, paddingTop: 8, borderTop: `1px solid ${T.border}` }}>
                  <input
                    value={nicknameDraft}
                    onChange={(e) => setNicknameDraft(e.target.value)}
                    placeholder="Name people call you on this trip…"
                    maxLength={40}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      border: `1px solid ${T.border}`,
                      borderRadius: 8,
                      padding: '6px 10px',
                      fontSize: ts(12),
                      fontFamily: F,
                      background: T.bg,
                      color: T.text,
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void savePlanningToCloud(trip.id, () => {
                        updateCollaboratorTripNickname(trip.id, p.id, nicknameDraft);
                      }).then(() => {
                        setEditingNicknameId(null);
                        onTripUpdate?.();
                      });
                    }}
                    style={rowInviteBtn}
                  >
                    Save
                  </button>
                  {p.tripNickname && (
                    <button
                      type="button"
                      onClick={() => {
                        void savePlanningToCloud(trip.id, () => {
                          updateCollaboratorTripNickname(trip.id, p.id, '');
                        }).then(() => {
                          setEditingNicknameId(null);
                          onTripUpdate?.();
                        });
                      }}
                      style={{
                        ...rowInviteBtn,
                        background: T.bg,
                        color: T.textSub,
                        borderColor: T.border,
                      }}
                    >
                      Use account default
                    </button>
                  )}
                </div>
              )}
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
