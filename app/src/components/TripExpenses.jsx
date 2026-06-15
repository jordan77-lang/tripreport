import { useEffect, useMemo, useState } from 'react';
import { Ic } from './Ic';
import { T, F, ICONS } from '../tokens';
import { getCurrentUserId, addExpense, removeExpense } from '../lib/storage';
import {
  buildTripParticipants,
  computeBalances,
  computeSettlements,
  filterExpenses,
  formatExpenseContext,
  formatSplitLabel,
  labelFor,
  money,
} from '../lib/expenses';

/**
 * scope:
 * - trip: pre-planning / trip-wide costs only
 * - location: costs tied to a location (any event at that stop)
 * - event: costs for one event (e.g. gas split for one vehicle group)
 * - all: every expense, with context labels (trip dashboard)
 */
export function TripExpenses({
  trip,
  onTripUpdate,
  showTitle = false,
  scope = 'trip',
  location = null,
  event = null,
}) {
  const currentUserId = getCurrentUserId();
  const participants = useMemo(() => buildTripParticipants(trip, currentUserId), [trip, currentUserId]);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [paidBy, setPaidBy] = useState(currentUserId);
  const [splitMode, setSplitMode] = useState('custom');
  const [splitIds, setSplitIds] = useState([]);
  const allExpenses = trip?.expenses || [];

  const visibleExpenses = useMemo(() => filterExpenses(allExpenses, scope, {
    locationId: location?.id,
    eventId: event?.id,
  }), [allExpenses, scope, location?.id, event?.id]);

  useEffect(() => {
    setSplitIds(participants.map((p) => p.id));
    if (!participants.some((p) => p.id === paidBy)) {
      setPaidBy(participants[0]?.id || currentUserId);
    }
    if (scope === 'event' || scope === 'location') {
      setSplitMode('custom');
    } else {
      setSplitMode('all');
    }
  }, [participants, paidBy, currentUserId, scope]);

  function toggleSplitId(id) {
    setSplitIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function selectAllSplit() {
    setSplitIds(participants.map((p) => p.id));
  }

  function add() {
    if (!trip?.id) return;
    const value = parseFloat(amount);
    if (!description.trim() || !Number.isFinite(value) || value <= 0) return;
    if (splitMode === 'custom' && splitIds.length === 0) return;

    const who = participants.find((p) => p.id === paidBy);
    const splitAmong = splitMode === 'all' ? 'all' : [...splitIds];
    const payload = {
      description,
      amount: value,
      paidBy,
      paidByLabel: who?.label || null,
      splitAmong,
    };

    if (scope === 'event' && event) {
      payload.eventId = event.id;
      payload.eventName = event.name;
      payload.locationId = event.locationId || location?.id || null;
      payload.locationName = event.locationName || location?.name || null;
    } else if (scope === 'location' && location) {
      payload.locationId = location.id;
      payload.locationName = location.name;
    }

    addExpense(trip.id, payload);
    setDescription('');
    setAmount('');
    onTripUpdate?.();
  }

  const total = visibleExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
  const balances = useMemo(() => computeBalances(visibleExpenses, participants), [visibleExpenses, participants]);
  const settlements = useMemo(() => computeSettlements(balances), [balances]);

  if (!trip) return null;

  const title = scope === 'event'
    ? 'Event Expenses'
    : scope === 'location'
      ? 'Location Expenses'
      : scope === 'all'
        ? 'Shared Expenses'
        : 'Trip Expenses';

  const hint = scope === 'event'
    ? 'Split costs for this event only — e.g. gas for people in this vehicle.'
    : scope === 'location'
      ? 'Costs for this stop. Open an event to split by vehicle or subgroup.'
      : scope === 'trip'
        ? 'Pre-trip costs not tied to a location yet.'
        : 'All trip costs. Event and location expenses are labeled below.';

  const placeholder = scope === 'event' ? 'Gas, tolls, permit…' : 'What was bought (gas, groceries…)';

  return (
    <div>
      {showTitle && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: T.textSub, letterSpacing: .7, textTransform: 'uppercase' }}>
            {title}
          </div>
          {!!(scope === 'event' && event?.name) && (
            <div style={{ fontSize: 11, color: T.textFaint, marginTop: 2 }}>{event.name}</div>
          )}
          {!!(scope === 'location' && location?.name) && (
            <div style={{ fontSize: 11, color: T.textFaint, marginTop: 2 }}>{location.name}</div>
          )}
        </div>
      )}

      <Composer>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={placeholder}
          style={inputStyle}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="Amount"
            style={{ ...inputStyle, maxWidth: 100 }}
          />
          <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)} style={selectStyle}>
            {participants.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <AddButton onClick={add} />
        </div>

        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: T.textSub, marginBottom: 6 }}>Split between</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: splitMode === 'custom' ? 8 : 0 }}>
            {(scope === 'trip' || scope === 'all') && (
              <SplitModeChip active={splitMode === 'all'} label="Whole group" onClick={() => setSplitMode('all')} />
            )}
            <SplitModeChip active={splitMode === 'custom'} label="Subgroup" onClick={() => setSplitMode('custom')} />
          </div>
          {splitMode === 'custom' && (
            <div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {participants.map((p) => {
                  const on = splitIds.includes(p.id);
                  return (
                    <div
                      key={p.id}
                      onClick={() => toggleSplitId(p.id)}
                      style={{
                        padding: '5px 10px',
                        borderRadius: 14,
                        fontSize: 10.5,
                        fontWeight: 700,
                        cursor: 'pointer',
                        background: on ? T.accent : T.bg,
                        color: on ? 'white' : T.textSub,
                        border: `1.5px solid ${on ? T.accent : T.border}`,
                      }}
                    >
                      {p.label}
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                <span onClick={selectAllSplit} style={{ fontSize: 10, color: T.accent, fontWeight: 700, cursor: 'pointer' }}>Select all</span>
                {splitIds.length === 0 && (
                  <span style={{ fontSize: 10, color: '#8A5526' }}>Pick at least one person</span>
                )}
              </div>
            </div>
          )}
        </div>
        <div style={{ fontSize: 10, color: T.textFaint, marginTop: 8 }}>{hint}</div>
      </Composer>

      {visibleExpenses.length > 0 && (
        <div style={{ background: T.accentLight, borderRadius: 12, padding: '12px 14px', marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: T.accent }}>
              {scope === 'all' ? 'Total spent' : 'Subtotal here'}
            </span>
            <span style={{ fontSize: 13, fontWeight: 800, color: T.text }}>{money(total)}</span>
          </div>
          {settlements.length === 0
            ? <div style={{ fontSize: 11, color: T.accentMid }}>All settled up{scope !== 'all' ? ' for this group' : ''}.</div>
            : settlements.map((s, i) => (
                <div key={i} style={{ fontSize: 11.5, color: T.text, marginTop: 3 }}>
                  <b>{labelFor(participants, s.from)}</b> owes <b>{labelFor(participants, s.to)}</b> {money(s.amount)}
                </div>
              ))}
        </div>
      )}

      {visibleExpenses.length === 0 && (
        <Empty text={hint} />
      )}

      {visibleExpenses.map((e) => (
        <div key={e.id} style={cardStyle}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{e.description}</div>
            <div style={{ fontSize: 10.5, color: T.textSub, marginTop: 2 }}>
              Paid by {e.paidByLabel || labelFor(participants, e.paidBy)}
            </div>
            <div style={{ fontSize: 10, color: T.textFaint, marginTop: 2 }}>
              Split: {formatSplitLabel(e, participants)}
            </div>
            {scope === 'all' && (
              <div style={{ fontSize: 10, color: T.accentMid, marginTop: 2 }}>
                {formatExpenseContext(e)}
              </div>
            )}
          </div>
          <div style={{ fontSize: 13, fontWeight: 800, color: T.text, flexShrink: 0 }}>{money(e.amount)}</div>
          <DeleteX onClick={() => { removeExpense(trip.id, e.id); onTripUpdate?.(); }} />
        </div>
      ))}
    </div>
  );
}

function SplitModeChip({ active, label, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: '6px 12px',
        borderRadius: 14,
        fontSize: 10.5,
        fontWeight: 700,
        cursor: 'pointer',
        background: active ? T.accentLight : T.bg,
        color: active ? T.accent : T.textSub,
        border: `1.5px solid ${active ? T.accent : T.border}`,
      }}
    >
      {label}
    </div>
  );
}

function Composer({ children }) {
  return (
    <div style={{ background: T.card, borderRadius: 14, padding: '12px 14px', border: `1px solid ${T.border}`, marginBottom: 16 }}>
      {children}
    </div>
  );
}

function AddButton({ onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        flexShrink: 0, minWidth: 54, height: 38, borderRadius: 10, background: T.accent,
        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
      }}
    >
      <Ic d={ICONS.plus} size={16} color="white" sw={2.4} />
    </div>
  );
}

function DeleteX({ onClick }) {
  return (
    <div onClick={onClick} style={{ flexShrink: 0, color: T.textFaint, cursor: 'pointer', fontSize: 14, padding: '0 2px' }}>
      ✕
    </div>
  );
}

function Empty({ text }) {
  return <div style={{ textAlign: 'center', padding: '18px 10px', color: T.textFaint, fontSize: 11.5 }}>{text}</div>;
}

const inputStyle = {
  flex: 1, width: '100%', border: `1.5px solid ${T.border}`, borderRadius: 10, padding: '9px 11px',
  fontSize: 12.5, fontFamily: F, color: T.text, background: T.bg, outline: 'none', boxSizing: 'border-box',
};

const selectStyle = {
  flex: 1, border: `1.5px solid ${T.border}`, borderRadius: 10, padding: '9px 8px',
  fontSize: 11.5, fontFamily: F, color: T.text, background: T.bg, outline: 'none',
};

const cardStyle = {
  background: T.card, borderRadius: 12, padding: '10px 12px', marginBottom: 8,
  border: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', gap: 10,
};
