import { useEffect, useMemo, useState } from 'react';
import { Ic } from './Ic';
import { T, F, ICONS } from '../tokens';
import { ts } from '../lib/textScale';
import { getCurrentUserId, addExpense, removeExpense, updateExpense, addExpenseGroup, updateExpenseGroup, removeExpenseGroup } from '../lib/storage';
import { savePlanningToCloud } from '../lib/planningSave';
import {
  buildSplitPayload,
  getEventCrewIds,
  getExpenseGroups,
  inferSplitPreset,
  resolveGroupMembers,
  SPLIT_ALL,
  SPLIT_EVENT_CREW,
} from '../lib/expenseGroups';
import {
  buildTripParticipants,
  buildParticipantAliasMap,
  computeBalances,
  computeParticipantBreakdown,
  computeSettlements,
  expenseShareAmount,
  filterExpenses,
  formatExpenseContext,
  formatSplitLabel,
  labelFor,
  money,
  resolveParticipantId,
  resolveSplitIds,
} from '../lib/expenses';

/**
 * scope:
 * - trip: pre-planning / trip-wide costs only
 * - location: costs tied to a location
 * - event: costs for one event
 * - all: every expense (trip dashboard)
 *
 * layout:
 * - full: Trip Plan / location / event pages
 * - compact: trip overview widget
 */
export function TripExpenses({
  trip,
  onTripUpdate,
  showTitle = false,
  scope = 'trip',
  location = null,
  event = null,
  layout = 'full',
  onOpenFull,
}) {
  const compact = layout === 'compact';
  const tripOverviewCompact = compact && scope === 'all';
  const embedCollapsed = scope === 'location' || scope === 'event';
  const startsCollapsed = embedCollapsed || tripOverviewCompact;
  const currentUserId = getCurrentUserId();
  const participants = useMemo(() => buildTripParticipants(trip, currentUserId), [trip, currentUserId]);
  const expenseGroups = useMemo(() => getExpenseGroups(trip), [trip]);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [paidBy, setPaidBy] = useState(currentUserId);
  const [splitPreset, setSplitPreset] = useState(SPLIT_ALL);
  const [splitGroupId, setSplitGroupId] = useState(null);
  const [splitIds, setSplitIds] = useState([]);
  const [panel, setPanel] = useState(compact ? 'summary' : 'ledger');
  const [sectionOpen, setSectionOpen] = useState(!startsCollapsed);
  const [showAddForm, setShowAddForm] = useState(!compact && !embedCollapsed);
  const [editingExpenseId, setEditingExpenseId] = useState(null);
  const [showAllItems, setShowAllItems] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [saving, setSaving] = useState(false);

  const allExpenses = trip?.expenses || [];
  const visibleExpenses = useMemo(() => filterExpenses(allExpenses, scope, {
    locationId: location?.id,
    eventId: event?.id,
  }), [allExpenses, scope, location?.id, event?.id]);

  const aliasMap = useMemo(
    () => (trip ? buildParticipantAliasMap(trip, participants) : new Map()),
    [trip, participants],
  );

  useEffect(() => {
    const participantIds = participants.map((p) => p.id);
    if (participantIds.length && !participantIds.includes(paidBy)) {
      const match = participants.find((p) => p.id === currentUserId);
      setPaidBy(match?.id || participantIds[0] || currentUserId);
    }
  }, [participants, paidBy, currentUserId]);

  function defaultSplitState() {
    const participantIds = participants.map((p) => p.id);
    const crew = getEventCrewIds(event, participantIds, aliasMap);
    if (scope === 'event' && crew.length > 0) {
      return { preset: SPLIT_EVENT_CREW, groupId: SPLIT_EVENT_CREW, ids: crew };
    }
    if (scope === 'all' || scope === 'trip' || scope === 'location') {
      return { preset: SPLIT_ALL, groupId: null, ids: participantIds };
    }
    return { preset: 'custom', groupId: null, ids: participantIds };
  }

  function applySplitPreset(preset, groupId = null) {
    const participantIds = participants.map((p) => p.id);
    setSplitPreset(preset);
    if (preset === SPLIT_ALL) {
      setSplitGroupId(null);
      setSplitIds(participantIds);
      return;
    }
    if (preset === SPLIT_EVENT_CREW) {
      setSplitGroupId(SPLIT_EVENT_CREW);
      setSplitIds(getEventCrewIds(event, participantIds, aliasMap));
      return;
    }
    if (preset === 'group' && groupId) {
      setSplitGroupId(groupId);
      const group = expenseGroups.find((g) => g.id === groupId);
      setSplitIds(resolveGroupMembers(group, participantIds, aliasMap));
      return;
    }
    setSplitGroupId(null);
  }

  function openAddForm() {
    setEditingExpenseId(null);
    setDescription('');
    setAmount('');
    const { preset, groupId, ids } = defaultSplitState();
    setSplitPreset(preset);
    setSplitGroupId(groupId);
    setSplitIds(ids);
    setSectionOpen(true);
    setShowAddForm(true);
    setPanel('ledger');
  }

  function closeAddForm() {
    setShowAddForm(false);
    setEditingExpenseId(null);
    if (startsCollapsed && visibleExpenses.length === 0) {
      setSectionOpen(false);
    }
  }

  function collapseSection() {
    setSectionOpen(false);
    setShowAddForm(false);
    setEditingExpenseId(null);
    setPanel('ledger');
    setExpandedId(null);
  }

  function startEdit(expense) {
    if (!expense) return;
    const participantIds = participants.map((p) => p.id);
    const payerId = resolveParticipantId(expense.paidBy, aliasMap, participantIds) || expense.paidBy;
    const inferred = inferSplitPreset(expense, {
      participantIds,
      groups: expenseGroups,
      event,
      aliasMap,
    });
    setEditingExpenseId(expense.id);
    setDescription(expense.description || '');
    setAmount(expense.amount != null ? String(expense.amount) : '');
    setPaidBy(participantIds.includes(payerId) ? payerId : (participantIds[0] || currentUserId));
    setSplitPreset(inferred.preset);
    setSplitGroupId(inferred.groupId);
    setSplitIds(inferred.splitIds.length ? inferred.splitIds : participantIds);
    setSectionOpen(true);
    setShowAddForm(true);
    setPanel('ledger');
    setExpandedId(null);
  }

  function splitIsValid() {
    if (splitPreset === SPLIT_ALL) return participants.length > 0;
    if (splitPreset === SPLIT_EVENT_CREW) {
      return getEventCrewIds(event, participants.map((p) => p.id), aliasMap).length > 0;
    }
    if (splitPreset === 'group' && splitGroupId) {
      const group = expenseGroups.find((g) => g.id === splitGroupId);
      return resolveGroupMembers(group, participants.map((p) => p.id), aliasMap).length > 0;
    }
    return splitIds.length > 0;
  }

  async function save() {
    if (!trip?.id || saving) return;
    const value = parseFloat(amount);
    if (!description.trim() || !Number.isFinite(value) || value <= 0) return;
    if (!splitIsValid()) return;

    const who = participants.find((p) => p.id === paidBy);
    const splitFields = buildSplitPayload({
      preset: splitPreset,
      groupId: splitGroupId,
      splitIds,
      participants,
      groups: expenseGroups,
      event,
      aliasMap,
    });
    const existing = editingExpenseId
      ? allExpenses.find((e) => e.id === editingExpenseId)
      : null;
    const payload = {
      description: description.trim(),
      amount: value,
      paidBy,
      paidByLabel: who?.label || null,
      ...splitFields,
    };

    if (scope === 'event' && event) {
      payload.eventId = event.id;
      payload.eventName = event.name;
      payload.locationId = event.locationId || location?.id || null;
      payload.locationName = event.locationName || location?.name || null;
    } else if (scope === 'location' && location) {
      payload.locationId = location.id;
      payload.locationName = location.name;
    } else if (existing) {
      payload.locationId = existing.locationId ?? null;
      payload.locationName = existing.locationName ?? null;
      payload.eventId = existing.eventId ?? null;
      payload.eventName = existing.eventName ?? null;
    }

    setSaving(true);
    try {
      await savePlanningToCloud(trip.id, () => {
        if (editingExpenseId) {
          updateExpense(trip.id, editingExpenseId, payload);
        } else {
          addExpense(trip.id, payload);
        }
      });
      setDescription('');
      setAmount('');
      setEditingExpenseId(null);
      setShowAddForm(false);
      onTripUpdate?.();
    } finally {
      setSaving(false);
    }
  }

  async function deleteExpense(expense) {
    if (!trip?.id || !expense?.id) return;
    if (!window.confirm(`Delete "${expense.description}" (${money(expense.amount)})?`)) return;
    await savePlanningToCloud(trip.id, () => {
      removeExpense(trip.id, expense.id);
    });
    if (editingExpenseId === expense.id) closeAddForm();
    if (expandedId === expense.id) setExpandedId(null);
    onTripUpdate?.();
  }

  const total = visibleExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
  const balances = useMemo(
    () => computeBalances(visibleExpenses, participants, { trip }),
    [visibleExpenses, participants, trip],
  );
  const settlements = useMemo(() => computeSettlements(balances), [balances]);
  const breakdown = useMemo(
    () => computeParticipantBreakdown(visibleExpenses, participants, { trip }),
    [visibleExpenses, participants, trip],
  );

  if (!trip) return null;

  const title = scope === 'event'
    ? 'Event Expenses'
    : scope === 'location'
      ? 'Location Expenses'
      : scope === 'all'
        ? 'Shared Expenses'
        : 'Trip Expenses';

  const hint = scope === 'event'
    ? 'Gas and tolls: split with this event\'s crew. Set crew in Edit Event above.'
    : scope === 'location'
      ? 'Tag costs to this stop, or open an event to split by vehicle crew.'
      : scope === 'trip'
        ? 'Pre-trip costs not tied to a location yet.'
        : 'All trip costs roll into one settle-up. Use whole trip for permits and group meals; saved groups or event crews for subgroups.';

  const placeholder = scope === 'event' ? 'Gas, tolls, permit…' : 'What was bought (gas, groceries…)';
  const listLimit = compact && !showAllItems ? 3 : visibleExpenses.length;
  const hiddenCount = Math.max(0, visibleExpenses.length - listLimit);
  const listedExpenses = visibleExpenses.slice(0, listLimit);
  const unsettledCount = settlements.length;

  if (startsCollapsed && !sectionOpen) {
    return (
      <CollapsedExpensesBar
        title={title}
        showTitle={showTitle || tripOverviewCompact}
        total={total}
        count={visibleExpenses.length}
        unsettledCount={unsettledCount}
        onExpand={() => { setSectionOpen(true); setPanel('ledger'); }}
        onAdd={openAddForm}
      />
    );
  }

  return (
    <div>
      {startsCollapsed && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
          <button type="button" onClick={collapseSection} style={collapseBtnStyle}>
            Hide expenses
          </button>
        </div>
      )}
      {showTitle && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: ts(11), fontWeight: 700, color: T.textSub, letterSpacing: .7, textTransform: 'uppercase' }}>
            {title}
          </div>
          {!!(scope === 'event' && event?.name) && (
            <div style={{ fontSize: ts(12), color: T.textFaint, marginTop: 2 }}>{event.name}</div>
          )}
          {!!(scope === 'location' && location?.name) && (
            <div style={{ fontSize: ts(12), color: T.textFaint, marginTop: 2 }}>{location.name}</div>
          )}
        </div>
      )}

      <SummaryBar
        total={total}
        count={visibleExpenses.length}
        unsettledCount={unsettledCount}
        compact={compact}
        onOpenBreakdown={() => setPanel('breakdown')}
      />

      {!compact && (
        <SegmentTabs
          active={panel}
          onChange={setPanel}
          tabs={[
            { id: 'ledger', label: 'Expenses' },
            { id: 'breakdown', label: 'Breakdown' },
          ]}
        />
      )}

      {compact && panel === 'breakdown' && (
        <BreakdownPanel
          breakdown={breakdown}
          settlements={settlements}
          participants={participants}
          onClose={() => setPanel('ledger')}
        />
      )}

      {tripOverviewCompact && onOpenFull && sectionOpen && panel !== 'breakdown' && (
        <div style={{ marginBottom: 10 }}>
          <button type="button" onClick={onOpenFull} style={viewAllStyle}>
            Manage in Trip Plan →
          </button>
        </div>
      )}

      {!compact && scope === 'all' && (
        <ExpenseGroupsPanel
          trip={trip}
          participants={participants}
          groups={expenseGroups}
          onTripUpdate={onTripUpdate}
        />
      )}

      {(panel === 'ledger' || (compact && panel !== 'breakdown')) && (
        <>
          {!showAddForm ? (
            <button
              type="button"
              onClick={openAddForm}
              style={addTriggerStyle}
            >
              <Ic d={ICONS.plus} size={14} color={T.accent} sw={2.4} />
              <span>Add expense</span>
            </button>
          ) : (
            <AddExpenseForm
              description={description}
              amount={amount}
              paidBy={paidBy}
              splitPreset={splitPreset}
              splitGroupId={splitGroupId}
              splitIds={splitIds}
              participants={participants}
              expenseGroups={expenseGroups}
              event={event}
              eventCrewCount={getEventCrewIds(event, participants.map((p) => p.id), aliasMap).length}
              scope={scope}
              hint={hint}
              placeholder={placeholder}
              editing={Boolean(editingExpenseId)}
              onDescription={setDescription}
              onAmount={setAmount}
              onPaidBy={setPaidBy}
              onSplitPreset={applySplitPreset}
              onToggleSplitId={(id) => {
                setSplitPreset('custom');
                setSplitGroupId(null);
                setSplitIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
              }}
              onSelectAllSplit={() => {
                setSplitPreset('custom');
                setSplitGroupId(null);
                setSplitIds(participants.map((p) => p.id));
              }}
              onAdd={() => void save()}
              saving={saving}
              splitValid={splitIsValid()}
              onCancel={closeAddForm}
            />
          )}

          {visibleExpenses.length === 0 && !showAddForm ? (
            <Empty text={hint} compact={embedCollapsed} />
          ) : visibleExpenses.length === 0 ? null : (
            <div style={{ marginTop: compact ? 8 : 12 }}>
              {listedExpenses.map((e) => (
                <ExpenseRow
                  key={e.id}
                  expense={e}
                  trip={trip}
                  participants={participants}
                  aliasMap={aliasMap}
                  scope={scope}
                  expanded={expandedId === e.id}
                  editing={editingExpenseId === e.id}
                  onToggle={() => setExpandedId((id) => (id === e.id ? null : e.id))}
                  onEdit={() => startEdit(e)}
                  onDelete={() => void deleteExpense(e)}
                />
              ))}
              {hiddenCount > 0 && (
                <button type="button" onClick={() => setShowAllItems(true)} style={viewAllStyle}>
                  View all {visibleExpenses.length} expenses
                </button>
              )}
              {compact && unsettledCount > 0 && panel !== 'breakdown' && (
                <button type="button" onClick={() => setPanel('breakdown')} style={breakdownLinkStyle}>
                  View {unsettledCount} settlement{unsettledCount === 1 ? '' : 's'} →
                </button>
              )}
            </div>
          )}
        </>
      )}

      {!compact && panel === 'breakdown' && (
        <BreakdownPanel
          breakdown={breakdown}
          settlements={settlements}
          participants={participants}
          embedded
        />
      )}
    </div>
  );
}

function CollapsedExpensesBar({ title, showTitle, total, count, unsettledCount, onExpand, onAdd }) {
  const status = count === 0
    ? 'Tap to track costs'
    : unsettledCount === 0
      ? 'All settled up'
      : `${unsettledCount} to settle`;

  return (
    <div style={collapsedBarStyle}>
      <div
        role="button"
        tabIndex={0}
        onClick={onExpand}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onExpand(); }}
        style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
      >
        {showTitle && (
          <div style={{ fontSize: ts(10), fontWeight: 700, color: T.textSub, letterSpacing: .7, textTransform: 'uppercase', marginBottom: 4 }}>
            {title}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: ts(18), fontWeight: 900, color: T.text, letterSpacing: -.3 }}>{money(total)}</span>
          <span style={{ fontSize: ts(12), color: T.textSub }}>
            {count === 0 ? status : `${count} item${count === 1 ? '' : 's'} · ${status}`}
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={onAdd}
        style={collapsedAddBtnStyle}
      >
        + Add
      </button>
    </div>
  );
}

function SummaryBar({ total, count, unsettledCount, compact, onOpenBreakdown }) {
  const status = count === 0
    ? 'No expenses yet'
    : unsettledCount === 0
      ? 'All settled up'
      : `${unsettledCount} payment${unsettledCount === 1 ? '' : 's'} to settle`;

  return (
    <div style={{
      background: T.accentLight,
      borderRadius: 12,
      padding: compact ? '10px 12px' : '12px 14px',
      marginBottom: compact ? 10 : 12,
      border: `1px solid ${T.accent}30`,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: ts(12), fontWeight: 700, color: T.accentMid }}>Total spent</div>
          <div style={{ fontSize: ts(22), fontWeight: 900, color: T.text, letterSpacing: -.4, lineHeight: 1.1 }}>
            {money(total)}
          </div>
          <div style={{ fontSize: ts(12), color: T.textSub, marginTop: 4 }}>
            {count} item{count === 1 ? '' : 's'} · {status}
          </div>
        </div>
        {count > 0 && (
          <button type="button" onClick={onOpenBreakdown} style={breakdownBtnStyle}>
            Breakdown
          </button>
        )}
      </div>
    </div>
  );
}

function SegmentTabs({ active, onChange, tabs }) {
  return (
    <div style={{
      display: 'flex',
      gap: 4,
      marginBottom: 12,
      background: T.bg,
      border: `1px solid ${T.border}`,
      borderRadius: 10,
      padding: 3,
    }}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          style={{
            flex: 1,
            border: 'none',
            borderRadius: 8,
            padding: '8px 10px',
            fontSize: ts(13),
            fontWeight: active === tab.id ? 800 : 600,
            fontFamily: F,
            cursor: 'pointer',
            background: active === tab.id ? T.card : 'transparent',
            color: active === tab.id ? T.text : T.textSub,
            boxShadow: active === tab.id ? '0 1px 3px rgba(0,0,0,.06)' : 'none',
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function BreakdownPanel({ breakdown, settlements, participants, embedded = false, onClose }) {
  return (
    <div style={{
      background: embedded ? 'transparent' : T.card,
      borderRadius: embedded ? 0 : 12,
      border: embedded ? 'none' : `1px solid ${T.border}`,
      padding: embedded ? 0 : '12px 14px',
      marginBottom: embedded ? 0 : 12,
    }}>
      {!embedded && onClose && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: ts(14), fontWeight: 800, color: T.text }}>Expense breakdown</div>
          <button type="button" onClick={onClose} style={ghostBtnStyle}>Close</button>
        </div>
      )}

      <div style={{ fontSize: ts(11), fontWeight: 700, color: T.textSub, letterSpacing: .6, textTransform: 'uppercase', marginBottom: 8 }}>
        By person
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
        {breakdown.map((row) => (
          <div key={row.id} style={breakdownRowStyle}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: ts(13), fontWeight: 700, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {row.label}
              </div>
              <div style={{ fontSize: ts(11), color: T.textFaint, marginTop: 2 }}>
                Paid {money(row.paid)} · Share {money(row.share)}
              </div>
            </div>
            <div style={{
              fontSize: ts(13),
              fontWeight: 800,
              color: row.net > 0.01 ? '#2E6D3A' : row.net < -0.01 ? '#8A5526' : T.textSub,
              flexShrink: 0,
            }}>
              {row.net > 0.01 ? `+${money(row.net)}` : row.net < -0.01 ? `-${money(Math.abs(row.net))}` : 'Even'}
            </div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: ts(11), fontWeight: 700, color: T.textSub, letterSpacing: .6, textTransform: 'uppercase', marginBottom: 8 }}>
        Settle up
      </div>
      {settlements.length === 0 ? (
        <div style={{ fontSize: ts(13), color: T.accentMid, fontWeight: 600 }}>Everyone is square.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {settlements.map((s, i) => (
            <div key={i} style={settlementRowStyle}>
              <span style={{ fontSize: ts(13), color: T.text }}>
                <b>{labelFor(participants, s.from)}</b>
                {' → '}
                <b>{labelFor(participants, s.to)}</b>
              </span>
              <span style={{ fontSize: ts(13), fontWeight: 800, color: T.text }}>{money(s.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ExpenseRow({ expense, trip, participants, aliasMap, scope, expanded, editing, onToggle, onEdit, onDelete }) {
  const participantIds = participants.map((p) => p.id);
  const split = resolveSplitIds(expense, participantIds, aliasMap);
  const shareEach = expenseShareAmount(expense, split);
  const payer = expense.paidByLabel || labelFor(participants, resolveParticipantId(expense.paidBy, aliasMap, participantIds) || expense.paidBy);
  const context = scope === 'all' ? formatExpenseContext(expense) : null;

  return (
    <div style={{ ...expenseRowStyle, borderColor: editing ? T.accent : T.border }}>
      <button type="button" onClick={onToggle} style={expenseMainBtnStyle}>
        <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: ts(14), fontWeight: 700, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {expense.description}
            </span>
            <span style={{ fontSize: ts(14), fontWeight: 800, color: T.text, flexShrink: 0 }}>{money(expense.amount)}</span>
          </div>
          {!expanded && (
            <div style={{ fontSize: ts(11), color: T.textFaint, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {payer}{split.length > 0 ? ` · ${money(shareEach)} each` : ''}{context ? ` · ${context}` : ''}
            </div>
          )}
          {expanded && (
            <div style={{ marginTop: 6, fontSize: ts(12), color: T.textSub, lineHeight: 1.45 }}>
              <div>Paid by {payer}</div>
              <div>Split: {formatSplitLabel(expense, participants, trip)}</div>
              {split.length > 0 && (
                <div>{money(shareEach)} per person ({split.length} {split.length === 1 ? 'person' : 'people'})</div>
              )}
              {!!context && <div style={{ color: T.accentMid }}>{context}</div>}
              <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                <button type="button" onClick={(ev) => { ev.stopPropagation(); onEdit(); }} style={rowActionBtnStyle}>
                  Edit
                </button>
                <button type="button" onClick={(ev) => { ev.stopPropagation(); void onDelete(); }} style={{ ...rowActionBtnStyle, color: '#8A1414' }}>
                  Delete
                </button>
              </div>
            </div>
          )}
        </div>
        <span style={{ fontSize: ts(11), color: T.textFaint, flexShrink: 0, transform: expanded ? 'rotate(90deg)' : 'none' }}>›</span>
      </button>
    </div>
  );
}

function ExpenseGroupsPanel({ trip, participants, groups, onTripUpdate }) {
  const [open, setOpen] = useState(groups.length > 0);
  const [editingId, setEditingId] = useState(null);
  const [name, setName] = useState('');
  const [memberIds, setMemberIds] = useState([]);
  const [saving, setSaving] = useState(false);

  function resetDraft() {
    setEditingId(null);
    setName('');
    setMemberIds([]);
  }

  function startAdd() {
    setEditingId('new');
    setName('');
    setMemberIds(participants.map((p) => p.id));
    setOpen(true);
  }

  function startEditGroup(group) {
    setEditingId(group.id);
    setName(group.name);
    setMemberIds(group.memberIds || []);
    setOpen(true);
  }

  async function saveGroup() {
    if (!trip?.id || saving || !name.trim() || memberIds.length === 0) return;
    setSaving(true);
    try {
      await savePlanningToCloud(trip.id, () => {
        if (editingId === 'new') {
          addExpenseGroup(trip.id, { name: name.trim(), memberIds });
        } else {
          updateExpenseGroup(trip.id, editingId, { name: name.trim(), memberIds });
        }
      });
      resetDraft();
      onTripUpdate?.();
    } finally {
      setSaving(false);
    }
  }

  async function deleteGroup(group) {
    if (!trip?.id || !window.confirm(`Delete split group "${group.name}"?`)) return;
    await savePlanningToCloud(trip.id, () => {
      removeExpenseGroup(trip.id, group.id);
    });
    if (editingId === group.id) resetDraft();
    onTripUpdate?.();
  }

  return (
    <div style={{ marginBottom: 12, background: T.bg, borderRadius: 12, border: `1px solid ${T.border}`, padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <button type="button" onClick={() => setOpen((v) => !v)} style={{ ...ghostBtnStyle, padding: 0, color: T.text, fontWeight: 800 }}>
          Split groups ({groups.length})
        </button>
        <button type="button" onClick={startAdd} style={{ ...ghostBtnStyle, padding: 0, color: T.accent }}>
          + New group
        </button>
      </div>
      <div style={{ fontSize: ts(11), color: T.textFaint, marginTop: 4, lineHeight: 1.4 }}>
        Save crews like &quot;Our car&quot; or &quot;Raft team&quot; — reuse when splitting gas, groceries, etc.
      </div>

      {open && groups.length > 0 && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {groups.map((group) => (
            <div key={group.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: T.card, borderRadius: 10, border: `1px solid ${T.border}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: ts(13), fontWeight: 700, color: T.text }}>{group.name}</div>
                <div style={{ fontSize: ts(11), color: T.textFaint }}>
                  {(group.memberIds || []).length} people
                </div>
              </div>
              <button type="button" onClick={() => startEditGroup(group)} style={rowActionBtnStyle}>Edit</button>
              <button type="button" onClick={() => void deleteGroup(group)} style={{ ...rowActionBtnStyle, color: '#8A1414' }}>Delete</button>
            </div>
          ))}
        </div>
      )}

      {editingId && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${T.border}` }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Group name (e.g. Car 1)"
            style={{ ...inputStyle, marginBottom: 8 }}
          />
          <ParticipantChips
            participants={participants}
            selectedIds={memberIds}
            onToggle={(id) => setMemberIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))}
            onSelectAll={() => setMemberIds(participants.map((p) => p.id))}
          />
          {memberIds.length === 0 && (
            <div style={{ fontSize: ts(11), color: '#8A5526', marginTop: 6 }}>Pick at least one person</div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button type="button" onClick={resetDraft} style={{ ...ghostBtnStyle, flex: 1 }}>Cancel</button>
            <button
              type="button"
              onClick={() => void saveGroup()}
              disabled={saving || !name.trim() || memberIds.length === 0}
              style={{ ...breakdownBtnStyle, flex: 1, opacity: saving || !name.trim() || memberIds.length === 0 ? 0.6 : 1 }}
            >
              {saving ? 'Saving…' : 'Save group'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ParticipantChips({ participants, selectedIds, onToggle, onSelectAll, compact = false }) {
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {participants.map((p) => {
          const on = selectedIds.includes(p.id);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onToggle(p.id)}
              style={{
                padding: compact ? '4px 9px' : '5px 10px',
                borderRadius: 14,
                fontSize: ts(11),
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: F,
                background: on ? T.accent : T.bg,
                color: on ? 'white' : T.textSub,
                border: `1.5px solid ${on ? T.accent : T.border}`,
              }}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      {onSelectAll && (
        <button type="button" onClick={onSelectAll} style={{ ...ghostBtnStyle, marginTop: 6, padding: 0 }}>
          Select all
        </button>
      )}
    </>
  );
}

function AddExpenseForm({
  description,
  amount,
  paidBy,
  splitPreset,
  splitGroupId,
  splitIds,
  participants,
  expenseGroups,
  event,
  eventCrewCount,
  scope,
  hint,
  placeholder,
  editing = false,
  onDescription,
  onAmount,
  onPaidBy,
  onSplitPreset,
  onToggleSplitId,
  onSelectAllSplit,
  onAdd,
  saving = false,
  splitValid = true,
  onCancel,
}) {
  const showCustom = splitPreset === 'custom';
  const eventCrewLabel = event?.name ? `${event.name} crew` : 'Event crew';

  return (
    <div style={composerStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: ts(13), fontWeight: 800, color: T.text }}>{editing ? 'Edit expense' : 'New expense'}</div>
        <button type="button" onClick={onCancel} style={ghostBtnStyle}>Cancel</button>
      </div>
      <input
        value={description}
        onChange={(e) => onDescription(e.target.value)}
        placeholder={placeholder}
        style={inputStyle}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <input
          value={amount}
          onChange={(e) => onAmount(e.target.value)}
          inputMode="decimal"
          placeholder="$0.00"
          style={{ ...inputStyle, maxWidth: 96 }}
        />
        <select value={paidBy} onChange={(e) => onPaidBy(e.target.value)} style={selectStyle}>
          {participants.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <button type="button" onClick={onAdd} disabled={saving || !splitValid} style={{ ...addBtnStyle, width: 'auto', minWidth: 72, padding: '0 14px', opacity: saving || !splitValid ? 0.7 : 1, cursor: saving ? 'wait' : 'pointer' }} aria-label={editing ? 'Save expense changes' : 'Save expense'}>
          <span style={{ color: 'white', fontSize: ts(12), fontWeight: 800, fontFamily: F }}>{saving ? 'Saving…' : 'Save'}</span>
        </button>
      </div>

      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: ts(11), fontWeight: 700, color: T.textSub, marginBottom: 6 }}>Split between</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: showCustom ? 8 : 0 }}>
          {(scope === 'trip' || scope === 'all' || scope === 'location') && (
            <SplitModeChip
              active={splitPreset === SPLIT_ALL}
              label="Whole trip"
              onClick={() => onSplitPreset(SPLIT_ALL)}
            />
          )}
          {scope === 'event' && eventCrewCount > 0 && (
            <SplitModeChip
              active={splitPreset === SPLIT_EVENT_CREW}
              label={eventCrewLabel}
              onClick={() => onSplitPreset(SPLIT_EVENT_CREW)}
            />
          )}
          {expenseGroups.map((group) => (
            <SplitModeChip
              key={group.id}
              active={splitPreset === 'group' && splitGroupId === group.id}
              label={group.name}
              onClick={() => onSplitPreset('group', group.id)}
            />
          ))}
          <SplitModeChip
            active={splitPreset === 'custom'}
            label="Pick people"
            onClick={() => onSplitPreset('custom')}
          />
        </div>
        {scope === 'event' && eventCrewCount === 0 && (
          <div style={{ fontSize: ts(11), color: T.textFaint, marginBottom: 8 }}>
            Tip: set this event&apos;s crew in Edit Event to default gas splits to your car.
          </div>
        )}
        {showCustom && (
          <ParticipantChips
            participants={participants}
            selectedIds={splitIds}
            onToggle={onToggleSplitId}
            onSelectAll={onSelectAllSplit}
          />
        )}
        {showCustom && splitIds.length === 0 && (
          <div style={{ fontSize: ts(11), color: '#8A5526', marginTop: 6 }}>Pick at least one person</div>
        )}
        {splitPreset === SPLIT_EVENT_CREW && eventCrewCount === 0 && (
          <div style={{ fontSize: ts(11), color: '#8A5526', marginTop: 6 }}>No crew on this event yet — pick people or set crew above.</div>
        )}
        {splitPreset === 'group' && splitGroupId && !splitIds.length && (
          <div style={{ fontSize: ts(11), color: '#8A5526', marginTop: 6 }}>This group has no members on the trip.</div>
        )}
      </div>
      <div style={{ fontSize: ts(11), color: T.textFaint, marginTop: 8, lineHeight: 1.4 }}>{hint}</div>
    </div>
  );
}

function SplitModeChip({ active, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '6px 12px',
        borderRadius: 14,
        fontSize: ts(11),
        fontWeight: 700,
        cursor: 'pointer',
        fontFamily: F,
        background: active ? T.accentLight : T.bg,
        color: active ? T.accent : T.textSub,
        border: `1.5px solid ${active ? T.accent : T.border}`,
      }}
    >
      {label}
    </button>
  );
}

function Empty({ text, compact = false }) {
  return (
    <div style={{ textAlign: 'center', padding: compact ? '8px 6px' : '14px 10px', color: T.textFaint, fontSize: ts(12), lineHeight: 1.45 }}>
      {text}
    </div>
  );
}

const collapsedBarStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  background: T.card,
  borderRadius: 12,
  border: `1px solid ${T.border}`,
  padding: '10px 12px',
  cursor: 'pointer',
  fontFamily: F,
};

const collapsedAddBtnStyle = {
  flexShrink: 0,
  border: `1px solid ${T.accent}50`,
  borderRadius: 9,
  padding: '7px 11px',
  background: T.accentLight,
  color: T.accent,
  fontSize: ts(12),
  fontWeight: 800,
  fontFamily: F,
  cursor: 'pointer',
};

const collapseBtnStyle = {
  border: 'none',
  background: 'transparent',
  color: T.textFaint,
  fontSize: ts(12),
  fontWeight: 600,
  fontFamily: F,
  cursor: 'pointer',
  padding: '2px 0',
};

const composerStyle = {
  background: T.card,
  borderRadius: 12,
  padding: '12px 14px',
  border: `1px solid ${T.border}`,
  marginBottom: 10,
};

const inputStyle = {
  flex: 1,
  width: '100%',
  border: `1.5px solid ${T.border}`,
  borderRadius: 10,
  padding: '9px 11px',
  fontSize: ts(14),
  fontFamily: F,
  color: T.text,
  background: T.bg,
  outline: 'none',
  boxSizing: 'border-box',
};

const selectStyle = {
  flex: 1,
  border: `1.5px solid ${T.border}`,
  borderRadius: 10,
  padding: '9px 8px',
  fontSize: ts(13),
  fontFamily: F,
  color: T.text,
  background: T.bg,
  outline: 'none',
};

const addTriggerStyle = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  border: `1px dashed ${T.border}`,
  borderRadius: 10,
  padding: '10px 12px',
  background: T.bg,
  color: T.accent,
  fontSize: ts(13),
  fontWeight: 700,
  fontFamily: F,
  cursor: 'pointer',
  marginBottom: 8,
};

const breakdownBtnStyle = {
  border: `1px solid ${T.accent}50`,
  borderRadius: 10,
  padding: '8px 12px',
  background: T.card,
  color: T.accent,
  fontSize: ts(12),
  fontWeight: 800,
  fontFamily: F,
  cursor: 'pointer',
  flexShrink: 0,
};

const ghostBtnStyle = {
  border: 'none',
  background: 'transparent',
  color: T.textSub,
  fontSize: ts(12),
  fontWeight: 700,
  fontFamily: F,
  cursor: 'pointer',
};

const viewAllStyle = {
  width: '100%',
  border: 'none',
  background: 'transparent',
  color: T.accent,
  fontSize: ts(13),
  fontWeight: 700,
  fontFamily: F,
  cursor: 'pointer',
  padding: '10px 0 4px',
  textAlign: 'center',
};

const breakdownLinkStyle = {
  ...viewAllStyle,
  color: T.textSub,
};

const addBtnStyle = {
  flexShrink: 0,
  width: 42,
  height: 42,
  borderRadius: 10,
  border: 'none',
  background: T.accent,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
};

const expenseRowStyle = {
  display: 'flex',
  alignItems: 'stretch',
  gap: 4,
  marginBottom: 6,
  background: T.card,
  borderRadius: 10,
  border: `1px solid ${T.border}`,
  overflow: 'hidden',
};

const expenseMainBtnStyle = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  border: 'none',
  background: 'transparent',
  padding: '10px 12px',
  cursor: 'pointer',
  fontFamily: F,
  minWidth: 0,
};

const rowActionBtnStyle = {
  border: 'none',
  background: 'transparent',
  color: T.accent,
  fontSize: ts(12),
  fontWeight: 700,
  fontFamily: F,
  cursor: 'pointer',
  padding: 0,
};

const breakdownRowStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  padding: '10px 12px',
  borderRadius: 10,
  background: T.bg,
  border: `1px solid ${T.border}`,
};

const settlementRowStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  padding: '10px 12px',
  borderRadius: 10,
  background: '#F7F3ED',
  border: `1px solid ${T.border}`,
};
