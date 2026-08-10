import { useEffect, useMemo, useState } from 'react';
import { Ic } from './Ic';
import { T, F, ICONS } from '../tokens';
import { ts } from '../lib/textScale';
import { addExpense, getCurrentUserId } from '../lib/storage';
import { savePlanningToCloud } from '../lib/planningSave';
import {
  buildSplitPayload,
  formatCustomSplitLabel,
  getEventCrewIds,
  getExpenseGroups,
  resolveGroupMembers,
  SPLIT_ALL,
  SPLIT_EVENT_CREW,
} from '../lib/expenseGroups';
import { buildParticipantAliasMap, buildTripParticipants, money } from '../lib/expenses';

/**
 * Capture-only expense entry, opened from a Location or Event page.
 *
 * The full ledger (totals, balances, settle-up, editing) lives in one place —
 * Plan → Expenses. This sheet exists because the moment you pay for something in
 * the field is the moment you know which stop it belongs to, so it pre-fills that
 * context and gets out of the way.
 */
export function AddExpenseSheet({ trip, location = null, event = null, onClose, onSaved }) {
  const currentUserId = getCurrentUserId();
  const participants = useMemo(() => buildTripParticipants(trip, currentUserId), [trip, currentUserId]);
  const participantIds = useMemo(() => participants.map((p) => p.id), [participants]);
  const aliasMap = useMemo(
    () => (trip ? buildParticipantAliasMap(trip, participants) : new Map()),
    [trip, participants],
  );
  const groups = useMemo(() => getExpenseGroups(trip), [trip]);
  const eventCrew = useMemo(
    () => getEventCrewIds(event, participantIds, aliasMap),
    [event, participantIds, aliasMap],
  );

  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [paidBy, setPaidBy] = useState(currentUserId);
  // Default to the event's crew when there is one — that is the whole point of
  // tagging a car/raft crew to an event.
  const [preset, setPreset] = useState(eventCrew.length ? SPLIT_EVENT_CREW : SPLIT_ALL);
  const [groupId, setGroupId] = useState(eventCrew.length ? SPLIT_EVENT_CREW : null);
  const [splitIds, setSplitIds] = useState(eventCrew.length ? eventCrew : participantIds);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Derive rather than sync-in-effect: if the chosen payer is not a participant
  // (roster changed under us), fall back without triggering a second render.
  const effectivePaidBy = participantIds.includes(paidBy)
    ? paidBy
    : (participantIds.includes(currentUserId) ? currentUserId : participantIds[0] || paidBy);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose?.();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function applyPreset(next, gid = null) {
    setPreset(next);
    if (next === SPLIT_ALL) {
      setGroupId(null);
      setSplitIds(participantIds);
      return;
    }
    if (next === SPLIT_EVENT_CREW) {
      setGroupId(SPLIT_EVENT_CREW);
      setSplitIds(eventCrew);
      return;
    }
    if (next === 'group' && gid) {
      setGroupId(gid);
      setSplitIds(resolveGroupMembers(groups.find((g) => g.id === gid), participantIds, aliasMap));
      return;
    }
    setGroupId(null);
  }

  function toggleSplitId(id) {
    setPreset('custom');
    setGroupId(null);
    setSplitIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const value = parseFloat(amount);
  const amountValid = Number.isFinite(value) && value > 0;
  const splitValid = splitIds.length > 0;
  const canSave = Boolean(description.trim()) && amountValid && splitValid && !saving;
  const perPerson = amountValid && splitValid ? value / splitIds.length : 0;

  const contextLabel = event?.name
    ? (location?.name ? `${location.name} · ${event.name}` : event.name)
    : (location?.name || 'Trip');

  async function save() {
    if (!trip?.id || !canSave) return;
    setSaving(true);
    setError(null);
    try {
      const payer = participants.find((p) => p.id === effectivePaidBy);
      const splitFields = buildSplitPayload({
        preset,
        groupId,
        splitIds,
        participants,
        groups,
        event,
        aliasMap,
      });

      await savePlanningToCloud(trip.id, () => {
        addExpense(trip.id, {
          description: description.trim(),
          amount: value,
          paidBy: effectivePaidBy,
          paidByLabel: payer?.label || null,
          locationId: location?.id || event?.locationId || null,
          locationName: location?.name || event?.locationName || null,
          eventId: event?.id || null,
          eventName: event?.name || null,
          ...splitFields,
        });
      });
      onSaved?.();
      onClose?.();
    } catch (e) {
      setError(e?.message || 'Could not save that expense.');
    } finally {
      setSaving(false);
    }
  }

  if (!trip) return null;

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 900,
               display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: T.bg, width: '100%', maxWidth: 520, maxHeight: '92vh', overflowY: 'auto',
                 borderRadius: '18px 18px 0 0', fontFamily: F,
                 boxShadow: '0 -8px 32px rgba(0,0,0,.18)' }}>

        {/* Header */}
        <div style={{ position: 'sticky', top: 0, background: T.card, borderBottom: `1px solid ${T.border}`,
                      padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, zIndex: 1 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: ts(15), fontWeight: 800, color: T.text, letterSpacing: -0.3 }}>Add expense</div>
            <div style={{ fontSize: ts(11), color: T.textFaint, marginTop: 1,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {contextLabel}
            </div>
          </div>
          <button type="button" onClick={onClose}
                  style={{ width: 32, height: 32, borderRadius: 16, background: T.bg, border: 'none',
                           display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
            <Ic d={ICONS.close} size={16} color={T.textSub} sw={2} />
          </button>
        </div>

        <div style={{ padding: '14px 16px 20px' }}>

          {/* What + how much */}
          <input
            autoFocus
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What was bought (gas, groceries, permit…)"
            style={inputStyle}
          />
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            type="number"
            step="0.01"
            min="0"
            placeholder="Amount"
            style={{ ...inputStyle, marginBottom: 14 }}
          />

          {/* Who paid */}
          <FieldLabel>Who paid</FieldLabel>
          <div style={chipRowStyle}>
            {participants.map((p) => (
              <Chip key={p.id} active={effectivePaidBy === p.id} onClick={() => setPaidBy(p.id)}>
                {p.label}
              </Chip>
            ))}
          </div>

          {/* Split */}
          <FieldLabel>Split between</FieldLabel>
          <div style={chipRowStyle}>
            <Chip active={preset === SPLIT_ALL} onClick={() => applyPreset(SPLIT_ALL)}>Whole trip</Chip>
            {eventCrew.length > 0 && (
              <Chip active={preset === SPLIT_EVENT_CREW} onClick={() => applyPreset(SPLIT_EVENT_CREW)}>
                {event?.name ? `${event.name} crew` : 'Event crew'}
              </Chip>
            )}
            {groups.map((g) => (
              <Chip key={g.id} active={preset === 'group' && groupId === g.id}
                    onClick={() => applyPreset('group', g.id)}>
                {g.name}
              </Chip>
            ))}
          </div>

          {/* Per-person toggles — always visible so the split is never a mystery */}
          <div style={{ ...chipRowStyle, marginBottom: 6 }}>
            {participants.map((p) => (
              <Chip key={p.id} active={splitIds.includes(p.id)} subtle onClick={() => toggleSplitId(p.id)}>
                {splitIds.includes(p.id) ? '✓ ' : ''}{p.label}
              </Chip>
            ))}
          </div>

          <div style={{ fontSize: ts(11), color: splitValid ? T.textFaint : '#C0392B', marginBottom: 14 }}>
            {splitValid
              ? `${formatCustomSplitLabel(splitIds, participants)}${perPerson > 0 ? ` · ${money(perPerson)} each` : ''}`
              : 'Pick at least one person to split with.'}
          </div>

          {error && (
            <div style={{ fontSize: ts(11), color: '#C0392B', fontWeight: 600, marginBottom: 10,
                          padding: '7px 10px', background: '#FFF0EE', borderRadius: 8, border: '1px solid #F5C6C0' }}>
              {error}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={onClose}
                    style={{ flex: 1, height: 44, borderRadius: 11, border: `1px solid ${T.border}`,
                             background: T.card, cursor: 'pointer', fontSize: ts(12), fontWeight: 700,
                             color: T.textSub, fontFamily: F }}>
              Cancel
            </button>
            <button type="button" onClick={() => void save()} disabled={!canSave}
                    style={{ flex: 2, height: 44, borderRadius: 11, border: 'none',
                             background: canSave ? T.accent : T.border,
                             color: canSave ? 'white' : T.textFaint,
                             cursor: canSave ? 'pointer' : 'default', fontSize: ts(12), fontWeight: 700,
                             fontFamily: F }}>
              {saving ? 'Saving…' : 'Save expense'}
            </button>
          </div>

          <div style={{ fontSize: ts(10.5), color: T.textFaint, textAlign: 'center', marginTop: 10 }}>
            Totals and settle-up live in Plan → Expenses
          </div>
        </div>
      </div>
    </div>
  );
}

const inputStyle = {
  width: '100%',
  border: `1.5px solid ${T.border}`,
  borderRadius: 11,
  padding: '11px 12px',
  fontSize: 13,
  fontFamily: F,
  marginBottom: 8,
  boxSizing: 'border-box',
  outline: 'none',
  background: T.card,
};

const chipRowStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
  marginBottom: 12,
};

function FieldLabel({ children }) {
  return (
    <div style={{ fontSize: ts(10.5), fontWeight: 700, color: T.textSub, letterSpacing: 0.5,
                  textTransform: 'uppercase', marginBottom: 7 }}>
      {children}
    </div>
  );
}

function Chip({ active, subtle = false, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '7px 12px',
        borderRadius: 16,
        cursor: 'pointer',
        fontSize: ts(11),
        fontWeight: 700,
        fontFamily: F,
        background: active ? (subtle ? T.accentLight : T.accent) : T.card,
        color: active ? (subtle ? T.accent : 'white') : T.textSub,
        border: active && !subtle ? '1px solid transparent' : `1px solid ${active ? T.accent + '55' : T.border}`,
      }}>
      {children}
    </button>
  );
}
