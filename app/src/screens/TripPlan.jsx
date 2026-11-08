import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BottomNav } from '../components/BottomNav';
import { MyResponsibilities } from '../components/MyResponsibilities';
import { MealPlanningTab as MealsTab } from '../components/MealPlanningTab';
import { MealShoppingReview } from '../components/MealShoppingReview';
import { Ic } from '../components/Ic';
import { SyncChip } from '../components/SyncChip';
import { TripEditPanel } from '../components/TripEditPanel';
import { T, F, ICONS } from '../tokens';
import { ts } from '../lib/textScale';
import { buildTripDraft, formatTripDateRange } from '../lib/tripEdit';
import { savePlanningLocally, savePlanningToCloud } from '../lib/planningSave';
import {
  getCurrentUserId,
  isTripOwner,
  isTripMember,
  addGearItem, updateGearItem, removeGearItem, claimGearItem, getGearAssigneeIds, confirmMyGearReady, confirmAllGearReady,
  addShoppingItem, updateShoppingItem, removeShoppingItem,
} from '../lib/storage';
import { SLOT_LABEL, mealDaysLabel } from '../lib/mealSlots';
import { ParticipantsTab } from '../components/ParticipantsTab';
import { TripExpenses } from '../components/TripExpenses';
import { OfflineMapsPanel } from '../components/OfflineMapsPanel';
import { useTripMembersSync } from '../hooks/useTripMembersSync';
import { buildTripParticipants, resolveUserDisplayName } from '../lib/expenses';
import { isGearFullyReady, isPersonReady } from '../lib/tripDashboard';
import { canonicalParticipantId } from '../lib/tripParticipants';
import { activeMealDays, mealItems, mealShoppingChanges } from '../lib/mealPlanning';
import { supabaseConfigured } from '../lib/supabase';
import { getSignedInUserId } from '../lib/authUser';
import {
  groupIngredientsByCategory,
  sortIngredients,
} from '../lib/mealLibrary';

const TABS = [
  { id: 'mine', label: 'My tasks' },
  { id: 'participants', label: 'Crew' },
  { id: 'gear', label: 'Gear' },
  { id: 'meals', label: 'Meals' },
  { id: 'shopping', label: 'Shopping' },
  { id: 'expenses', label: 'Money' },
  { id: 'maps', label: 'Maps' },
];

function planTab(tab) {
  if (!tab) return 'mine';
  if (tab === 'pack') return 'gear';
  return tab;
}

const GEAR_CATEGORIES = ['group', 'shelter', 'cooking', 'safety', 'personal'];
const GEAR_NEED_LABEL = 'To bring';
const GEAR_READY_LABEL = 'Ready';

function isGearComplete(item, trip) {
  return isGearFullyReady(item, trip);
}

function normalizeGearCategory(category) {
  const key = String(category || 'group').toLowerCase();
  return GEAR_CATEGORIES.includes(key) ? key : 'group';
}

function confirmRemoveItem(name, listLabel) {
  return window.confirm(`Remove "${name}" from your ${listLabel}?`);
}

export function TripPlan({
  trip,
  onNav,
  onFab,
  onBack,
  onTripUpdate,
  initialTab = null,
  newTripInviteCode = null,
  onDismissInvite,
}) {
  const [tab, setTab] = useState(() => planTab(initialTab));
  const [detailsReturn, setDetailsReturn] = useState('gear');
  const [seenInitialTab, setSeenInitialTab] = useState(initialTab);
  if (initialTab !== seenInitialTab) {
    setSeenInitialTab(initialTab);
    if (initialTab) setTab(planTab(initialTab));
  }
  const [tripDraft, setTripDraft] = useState(() => buildTripDraft(trip));
  const currentUserId = getCurrentUserId();
  const signedInUserId = getSignedInUserId();
  const canEditTrip = Boolean(trip && isTripMember(trip, signedInUserId || currentUserId));
  const canInvite = Boolean(supabaseConfigured && signedInUserId && trip && isTripOwner(trip, signedInUserId));
  const visibleTabs = useMemo(
    () => (canEditTrip ? TABS : TABS.filter((tb) => tb.id !== 'details')),
    [canEditTrip],
  );
  const participants = useMemo(() => buildTripParticipants(trip, currentUserId), [trip, currentUserId]);
  const tripSyncState = useMemo(() => {
    if (!trip) return 'synced';
    if (trip.syncState === 'pending') return 'pending';
    const planningPending = [
      ...(trip.gearItems || []),
      ...(trip.meals || []),
      ...(trip.expenses || []),
      ...(trip.shoppingItems || []),
    ].some((item) => item?.syncState === 'pending');
    return planningPending ? 'pending' : (trip.syncState || 'synced');
  }, [trip]);

  useTripMembersSync({
    tripId: trip?.id,
    enabled: Boolean(trip?.id),
    onSynced: onTripUpdate,
  });

  function selectTab(nextTab) {
    if (nextTab === 'details') {
      setDetailsReturn(tab === 'details' ? detailsReturn : (tab || 'gear'));
      setTripDraft(buildTripDraft(trip));
    }
    setTab(nextTab);
  }

  if (!trip) {
    return (
      <div style={{ height: '100%', background: T.bg, display: 'flex', flexDirection: 'column', fontFamily: F }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.textFaint }}>
          No active trip to plan
        </div>
        <BottomNav active="plan" onNav={onNav} onFab={onFab} trip={trip} />
      </div>
    );
  }

  return (
    <div style={{ height: '100%', background: T.bg, display: 'flex', flexDirection: 'column', fontFamily: F, overflow: 'hidden' }}>
      <div style={{ background: T.card, padding: '12px 16px 0', borderBottom: `1px solid ${T.border}`, flexShrink: 0, boxShadow: '0 2px 12px rgba(26, 25, 23, 0.03)' }}>
        <div className="screen-header-inner">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <button type="button" aria-label="Back" onClick={onBack} style={{ flexShrink: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderRadius: 10, background: T.bg, border: `1px solid ${T.border}` }}>
            <span style={{ display: 'flex', transform: 'rotate(180deg)' }}>
              <Ic d={ICONS.chevR} size={15} color={T.textSub} sw={2.2} />
            </span>
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: T.text, letterSpacing: -.4 }}>Plan</div>
            <div style={{ fontSize: ts(13), color: T.textSub }}>{trip.name}</div>
            <div style={{ fontSize: ts(12), color: T.textFaint, marginTop: 2 }}>
              {formatTripDateRange(trip.startDate, trip.endDate)}
            </div>
            {canEditTrip && tab !== 'details' && (
              <button type="button" onClick={() => selectTab('details')}
                style={{ marginTop: 4, border: 'none', background: 'transparent', color: '#2A5C8E', fontWeight: 800, fontSize: ts(12), cursor: 'pointer', fontFamily: F, padding: 0 }}>
                Edit trip details
              </button>
            )}
            <div style={{ marginTop: 8 }}><SyncChip state={tripSyncState} compact /></div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 2, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {visibleTabs.map((tb) => (
            <button key={tb.id} type="button" onClick={() => selectTab(tb.id)} aria-pressed={tab === tb.id}
                 style={{ flex: '1 0 auto', minHeight: 44, border: 'none', background: 'transparent', minWidth: 64, textAlign: 'center', padding: '10px 9px', cursor: 'pointer',
                          fontSize: ts(13), fontWeight: 700, fontFamily: F,
                          color: tab === tb.id ? T.accent : T.textSub,
                          borderBottom: `2px solid ${tab === tb.id ? T.accent : 'transparent'}` }}>
              {tb.label}
            </button>
          ))}
        </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        <div className="screen-content-inner">
        {tab === 'mine' && <MyResponsibilities trip={trip} onOpenPlan={selectTab} onTripUpdate={onTripUpdate} />}
        {tab === 'details' && canEditTrip && (
          <TripEditPanel
            trip={trip}
            draft={tripDraft}
            onCancel={() => setTab(detailsReturn)}
            onSaved={() => {
              onTripUpdate?.();
              setTab(detailsReturn);
            }}
            onDraftChange={setTripDraft}
          />
        )}
        {tab === 'participants' && (
          <ParticipantsTab
            trip={trip}
            canInvite={canInvite}
            onTripUpdate={onTripUpdate}
            newTripInviteCode={newTripInviteCode}
            onDismissInvite={onDismissInvite}
          />
        )}
        {tab === 'gear' && (
          <GearTab trip={trip} participants={participants} onTripUpdate={onTripUpdate} />
        )}
        {tab === 'meals' && (
          <MealsTab trip={trip} participants={participants} onTripUpdate={onTripUpdate} onOpenShopping={() => selectTab('shopping')} />
        )}
        {tab === 'shopping' && (
          <ShoppingTab trip={trip} onTripUpdate={onTripUpdate} />
        )}
        {tab === 'expenses' && (
          <TripExpenses trip={trip} onTripUpdate={onTripUpdate} showTitle />
        )}
        {tab === 'maps' && <OfflineMapsPanel trip={trip} onTripUpdate={onTripUpdate} />}
        <div style={{ height: 16 }} />
        </div>
      </div>

      <BottomNav active="plan" onNav={onNav} onFab={onFab} trip={trip} />
    </div>
  );
}

function GearTab({ trip, participants, onTripUpdate }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('group');
  const [assignedToIds, setAssignedToIds] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const gear = trip.gearItems || [];
  const currentUserId = getCurrentUserId();
  // Assignee ids as they are now (a roster id becomes the account it merged into).
  const assigneesOf = (item) => Array.from(new Set(getGearAssigneeIds(item).map((id) => canonicalParticipantId(trip, id))));

  function resolvePersonLabel(uid) {
    const found = participants.find((p) => p.id === uid);
    if (found?.label) return found.label;
    return resolveUserDisplayName(trip, uid, currentUserId);
  }

  function resetForm() {
    setEditingId(null);
    setName('');
    setCategory('group');
    setAssignedToIds([]);
  }

  function startEdit(item) {
    setEditingId(item.id);
    setName(item.name || '');
    setCategory(normalizeGearCategory(item.category));
    setAssignedToIds(assigneesOf(item));
  }

  function toggleFormAssignee(personId) {
    setAssignedToIds((prev) => (
      prev.includes(personId)
        ? prev.filter((id) => id !== personId)
        : [...prev, personId]
    ));
  }

  async function save() {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const cleanIds = assignedToIds.filter(Boolean);
      const labels = cleanIds.map((uid) => resolvePersonLabel(uid)).filter(Boolean);
      const cat = normalizeGearCategory(category);
      const payload = {
        name: name.trim(),
        category: cat,
        assignedTo: cleanIds[0] || null,
        assignedToIds: cleanIds,
        assignedToLabel: labels.length > 0 ? labels.join(', ') : null,
        shared: cat !== 'personal',
      };
      await savePlanningToCloud(trip.id, () => {
        if (editingId) {
          updateGearItem(trip.id, editingId, payload);
        } else {
          addGearItem(trip.id, payload);
        }
      });
      resetForm();
      onTripUpdate?.();
    } finally {
      setSaving(false);
    }
  }

  async function removeItem(item) {
    if (!confirmRemoveItem(item.name, 'gear list')) return;
    await savePlanningToCloud(trip.id, () => {
      removeGearItem(trip.id, item.id);
    });
    if (editingId === item.id) resetForm();
    onTripUpdate?.();
  }

  async function toggleMyGear(item) {
    const next = !isPersonReady(item, currentUserId, trip);
    await savePlanningToCloud(trip.id, () => {
      confirmMyGearReady(trip.id, item.id, next);
    });
    onTripUpdate?.();
  }

  async function toggleAllGear(item) {
    const next = !isGearFullyReady(item, trip);
    await savePlanningToCloud(trip.id, () => {
      confirmAllGearReady(trip.id, item.id, next);
    });
    onTripUpdate?.();
  }

  function setItemAssignees(item, nextIds) {
    const cleanIds = Array.from(new Set((nextIds || []).filter(Boolean)));
    const labels = cleanIds.map((uid) => resolvePersonLabel(uid)).filter(Boolean);
    void savePlanningToCloud(trip.id, () => {
      updateGearItem(trip.id, item.id, {
        assignedTo: cleanIds[0] || null,
        assignedToIds: cleanIds,
        assignedToLabel: labels.length > 0 ? labels.join(', ') : null,
      });
    }).then(() => onTripUpdate?.());
  }

  function addItemAssignee(item, personId) {
    if (!personId) return;
    if (personId === '__clear__') {
      setItemAssignees(item, []);
      return;
    }
    const current = assigneesOf(item);
    if (current.includes(personId)) return;
    setItemAssignees(item, [...current, personId]);
  }

  function removeItemAssignee(item, personId) {
    const current = assigneesOf(item);
    setItemAssignees(item, current.filter((id) => id !== personId));
  }

  const { toBring, ready } = useMemo(() => {
    const visible = editingId ? gear.filter((g) => g.id !== editingId) : gear;
    const need = [];
    const done = [];
    for (const item of visible) {
      (isGearComplete(item, trip) ? done : need).push(item);
    }
    return { toBring: need, ready: done };
  }, [gear, editingId, trip]);

  const groupedNeed = useMemo(
    () => groupBy(toBring, (g) => normalizeGearCategory(g.category)),
    [toBring],
  );
  const gearReady = ready.length;

  function renderGearItem(item) {
    const done = isGearComplete(item, trip);
    const itemAssigneeIds = assigneesOf(item);
    const availableParticipants = participants.filter((p) => !itemAssigneeIds.includes(p.id));
    const amAssigned = Boolean(currentUserId && itemAssigneeIds.includes(canonicalParticipantId(trip, currentUserId)));
    const myReady = amAssigned && isPersonReady(item, currentUserId, trip);
    const shared = itemAssigneeIds.length > 1;

    return (
      <div
        key={item.id}
        style={{
          ...cardStyle,
          borderColor: editingId === item.id ? T.accent : T.border,
          opacity: done ? 0.72 : 1,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: ts(13),
            fontWeight: 700,
            color: done ? T.textFaint : T.text,
            textDecoration: done ? 'line-through' : 'none',
          }}>
            {item.name}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 5, flexWrap: 'wrap' }}>
            {itemAssigneeIds.map((uid) => {
              const personReady = isPersonReady(item, uid, trip);
              return (
                <span
                  key={uid}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: ts(10.5),
                    fontWeight: 700,
                    color: personReady ? '#2A6A14' : T.accent,
                    background: personReady ? '#EBF5EB' : T.accentLight,
                    border: `1px solid ${personReady ? '#B8DFB8' : `${T.accent}40`}`,
                    borderRadius: 999,
                    padding: '2px 7px',
                    fontFamily: F,
                  }}
                >
                  {resolvePersonLabel(uid)}{personReady ? ' · ready' : ' · not yet'}
                  <button
                    type="button"
                    aria-label={`Remove ${resolvePersonLabel(uid)} from ${item.name}`}
                    onClick={() => removeItemAssignee(item, uid)}
                    style={{
                      border: 'none',
                      background: 'none',
                      color: 'inherit',
                      fontSize: ts(11),
                      fontWeight: 800,
                      padding: 0,
                      lineHeight: 1,
                      cursor: 'pointer',
                    }}
                  >
                    ×
                  </button>
                </span>
              );
            })}
            {(availableParticipants.length > 0 || itemAssigneeIds.length > 0) && (
              <select
                value=""
                onChange={(e) => addItemAssignee(item, e.target.value)}
                style={{
                  fontSize: ts(10.5),
                  color: T.textSub,
                  border: `1px solid ${T.border}`,
                  borderRadius: 7,
                  padding: '2px 5px',
                  background: T.bg,
                  fontFamily: F,
                }}
              >
                <option value="">{itemAssigneeIds.length === 0 ? 'Who brings it?' : '+ Add person'}</option>
                {availableParticipants.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
                {itemAssigneeIds.length > 0 && (
                  <option value="__clear__">Clear all</option>
                )}
              </select>
            )}
            {!amAssigned && (
              <button
                type="button"
                onClick={() => {
                  void savePlanningToCloud(trip.id, () => {
                    claimGearItem(trip.id, item.id, { asCoBringer: itemAssigneeIds.length > 0 });
                  }).then(() => onTripUpdate?.());
                }}
                style={{
                  border: `1px solid ${T.accent}50`,
                  borderRadius: 7,
                  padding: '2px 7px',
                  background: T.accentLight,
                  color: T.accent,
                  fontSize: ts(10.5),
                  fontWeight: 800,
                  fontFamily: F,
                  cursor: 'pointer',
                }}
              >
                {itemAssigneeIds.length === 0 ? "I'll bring this" : "+ I'll bring some too"}
              </button>
            )}
            {amAssigned && (
              <button
                type="button"
                aria-pressed={myReady}
                onClick={() => void toggleMyGear(item)}
                style={{
                  border: `1px solid ${myReady ? '#8ED08E' : T.accent}`,
                  borderRadius: 7,
                  padding: '2px 8px',
                  background: myReady ? '#E2F4E2' : T.accent,
                  color: myReady ? '#2A6A14' : 'white',
                  fontSize: ts(10.5),
                  fontWeight: 800,
                  fontFamily: F,
                  cursor: 'pointer',
                }}
              >
                {shared ? (myReady ? 'Undo my share' : 'My share') : (myReady ? 'Undo my ready' : 'I have this')}
              </button>
            )}
            {amAssigned && shared && (
              <button
                type="button"
                aria-pressed={done}
                onClick={() => void toggleAllGear(item)}
                style={{
                  border: `1px solid ${done ? '#8ED08E' : T.border}`,
                  borderRadius: 7,
                  padding: '2px 8px',
                  background: done ? '#E2F4E2' : T.bg,
                  color: done ? '#2A6A14' : T.text,
                  fontSize: ts(10.5),
                  fontWeight: 800,
                  fontFamily: F,
                  cursor: 'pointer',
                }}
              >
                {done ? 'Undo all' : 'All of it'}
              </button>
            )}
          </div>
        </div>
        <RowActions
          itemName={item.name}
          onEdit={() => startEdit(item)}
          onDelete={() => void removeItem(item)}
        />
      </div>
    );
  }

  return (
    <div>
      <Composer title={editingId ? 'Edit gear' : 'Add gear'} onCancel={editingId ? resetForm : null}>
        <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void save(); }}
               placeholder="Add gear (tent, firewood, stove, first-aid…)" style={inputStyle} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ ...selectStyle, width: '100%', flex: 'none' }}>
            {GEAR_CATEGORIES.map((c) => <option key={c} value={c}>{capitalize(c)}</option>)}
          </select>
          {participants.length > 0 && (
            <ChoiceRow label="Who is bringing it? (tap 1 or more)">
              <ChoiceChip
                selected={assignedToIds.length === 0}
                onClick={() => setAssignedToIds([])}
              >
                Unassigned
              </ChoiceChip>
              {participants.map((p) => (
                <ChoiceChip
                  key={p.id}
                  selected={assignedToIds.includes(p.id)}
                  onClick={() => toggleFormAssignee(p.id)}
                >
                  {p.label}
                </ChoiceChip>
              ))}
            </ChoiceRow>
          )}
          <div style={{ marginTop: 2 }}>
            <SaveButton onClick={() => void save()} busy={saving} wide label={editingId ? 'Update' : 'Save'} />
          </div>
        </div>
      </Composer>

      {gear.length === 0 && <Empty text="No gear yet. Assign who brings each item. Each person confirms only their own share." />}

      {gear.length > 0 && (
        <ListProgress done={gearReady} total={gear.length} label="ready" />
      )}

      {toBring.length > 0 && (
        <>
          <SectionLabel>{GEAR_NEED_LABEL}</SectionLabel>
          {Object.entries(groupedNeed).map(([cat, items]) => (
            <div key={cat} style={{ marginBottom: 14 }}>
              {Object.keys(groupedNeed).length > 1 && (
                <div style={{ fontSize: ts(10), fontWeight: 700, color: T.textFaint, marginBottom: 6, textTransform: 'capitalize' }}>
                  {capitalize(cat)}
                </div>
              )}
              {items.map(renderGearItem)}
            </div>
          ))}
        </>
      )}

      {toBring.length === 0 && ready.length > 0 && (
        <div style={{ fontSize: ts(11.5), color: T.textSub, marginBottom: 10, textAlign: 'center' }}>
          Everything is {GEAR_READY_LABEL.toLowerCase()}.
        </div>
      )}

      <CollapsibleSection title={GEAR_READY_LABEL} count={ready.length} defaultOpen={false}>
        {ready.map(renderGearItem)}
      </CollapsibleSection>
    </div>
  );
}

function ChoiceRow({ label, children }) {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: ts(10.5), fontWeight: 700, color: T.textSub, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{children}</div>
    </div>
  );
}

function ChoiceChip({ selected, onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      style={{
        minHeight: 32,
        padding: '4px 10px',
        borderRadius: 14,
        border: selected ? 'none' : `1px solid ${T.border}`,
        background: selected ? T.accent : T.bg,
        color: selected ? 'white' : T.text,
        fontSize: ts(12),
        fontWeight: 700,
        cursor: 'pointer',
        fontFamily: F,
      }}>
      {children}
    </button>
  );
}

function ShoppingTab({ trip, onTripUpdate }) {
  const [name, setName] = useState('');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState(null);
  const [sortMode, setSortMode] = useState('category'); // 'category' | 'meal' | 'alpha'
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const closeReview = useCallback(() => setReviewOpen(false), []);
  const shoppingReview = mealShoppingChanges(trip);
  const items = trip.shoppingItems || [];
  const meals = useMemo(() => mealItems(trip).filter(meal => activeMealDays(trip, meal).length), [trip]);

  function change(saveLocal) {
    setNote(null);
    try {
      savePlanningLocally(trip.id, saveLocal, { onSaved: onTripUpdate, onSynced: onTripUpdate,
        onError: error => setNote(`Saved on this device. ${error.message || 'Sync will retry.'}`) });
      return true;
    } catch (error) { setNote(error.message || 'Could not update shopping.'); return false; }
  }

  const mealNamesByIngredient = useMemo(() => {
    const map = new Map();
    for (const m of meals) {
      for (const ing of m.ingredients || []) {
        const key = String(ing?.name || '').trim().toLowerCase();
        if (!key) continue;
        if (!map.has(key)) map.set(key, []);
        const label = `${mealDaysLabel(m)} ${SLOT_LABEL[m.slot] || ''} (${m.name})`.trim();
        if (!map.get(key).includes(label)) map.get(key).push(label);
      }
    }
    return map;
  }, [meals]);

  function resetForm() {
    setEditingId(null);
    setName('');
    setQty('');
  }

  function startEdit(item) {
    setEditingId(item.id);
    setName(item.name || '');
    setQty(item.qty || '');
  }

  async function save() {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const payload = { name: name.trim(), qty };
      const saved = change(() => {
        if (editingId) {
          updateShoppingItem(trip.id, editingId, payload);
        } else {
          addShoppingItem(trip.id, payload);
        }
      });
      if (!saved) return;
      resetForm();
      onTripUpdate?.();
    } finally {
      setSaving(false);
    }
  }

  async function removeItem(item) {
    if (!confirmRemoveItem(item.name, 'shopping list')) return;
    const saved = change(() => {
      removeShoppingItem(trip.id, item.id);
    });
    if (!saved) return;
    if (editingId === item.id) resetForm();
    onTripUpdate?.();
  }

  async function toggle(item) {
    change(() => {
      updateShoppingItem(trip.id, item.id, { checked: !item.checked });
    });
    onTripUpdate?.();
  }

  const { toBuy, purchased } = useMemo(() => {
    const buy = [];
    const got = [];
    for (const item of items) {
      if (item.id === editingId) continue;
      (item.checked ? got : buy).push(item);
    }
    return {
      toBuy: sortIngredients(buy, sortMode === 'alpha' ? 'alpha' : 'category'),
      purchased: sortIngredients(got, 'alpha'),
    };
  }, [items, editingId, sortMode]);

  const groupedToBuy = useMemo(() => {
    if (sortMode === 'category') {
      return groupIngredientsByCategory(toBuy);
    }
    if (sortMode === 'meal') {
      const byMeal = new Map();
      for (const item of toBuy) {
        const usedIn = mealNamesByIngredient.get(String(item.name || '').trim().toLowerCase());
        const groupLabel = usedIn && usedIn.length > 0 ? usedIn[0] : 'General / Manual Items';
        if (!byMeal.has(groupLabel)) byMeal.set(groupLabel, []);
        byMeal.get(groupLabel).push(item);
      }
      return [...byMeal.entries()].map(([label, groupItems]) => ({
        id: label,
        label,
        icon: label === 'General / Manual Items' ? '🛒' : '🍳',
        items: groupItems,
      }));
    }
    return [{ id: 'all', label: 'All to buy', icon: '🛒', items: toBuy }];
  }, [toBuy, sortMode, mealNamesByIngredient]);

  const purchasedCount = purchased.length;

  function renderShoppingItem(item) {
    const done = Boolean(item.checked);
    const usedInMeals = mealNamesByIngredient.get(String(item.name || '').trim().toLowerCase());
    return (
      <div
        key={item.id}
        style={{
          ...cardStyle,
          borderColor: editingId === item.id ? T.accent : T.border,
          opacity: done ? 0.72 : 1,
        }}
      >
        <CompletionCheck
          checked={done}
          label={`Mark ${item.name} as ${done ? 'not purchased' : 'purchased'}`}
          onToggle={() => void toggle(item)}
        />
        <div
          style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
          onClick={() => void toggle(item)}
        >
          <div style={{
            fontSize: ts(13),
            fontWeight: 600,
            color: done ? T.textFaint : T.text,
            textDecoration: done ? 'line-through' : 'none',
          }}>
            {item.name}{item.qty ? ` · ${item.qty}` : ''}
          </div>
          {usedInMeals && usedInMeals.length > 0 ? (
            <div style={{ fontSize: ts(10), color: T.textSub, marginTop: 1 }}>
              For: {usedInMeals.join(' · ')}
            </div>
          ) : (
            item.source === 'meal' && <div style={{ fontSize: ts(9.5), color: T.textFaint }}>from meals</div>
          )}
        </div>
        <RowActions
          itemName={item.name}
          onEdit={() => startEdit(item)}
          onDelete={() => void removeItem(item)}
        />
      </div>
    );
  }

  return (
    <div>
      {(shoppingReview.changes.length>0 || shoppingReview.protectedItems.length>0) && <div className="meal-shopping-banner"><p>{shoppingReview.changes.length} meal-plan update{shoppingReview.changes.length===1?'':'s'} · {shoppingReview.protectedItems.length} quantities to check</p><button className="tr-mini-btn primary" type="button" onClick={()=>setReviewOpen(true)}>Review shopping updates</button></div>}
      {reviewOpen && <MealShoppingReview trip={trip} onChange={change} onClose={closeReview} error={note} />}
      <Composer title={editingId ? 'Edit item' : 'Add item'} onCancel={editingId ? resetForm : null}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void save(); }}
                 placeholder="Add item" style={inputStyle} />
          <input value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Qty" style={{ ...inputStyle, maxWidth: 70 }} />
          <SaveButton onClick={() => void save()} busy={saving} label={editingId ? 'Update' : 'Save'} />
        </div>
        {!editingId && (
          <button className="tr-text-btn" type="button" onClick={()=>setReviewOpen(true)}>Review meal ingredients</button>
        )}
        {note && <div style={{ fontSize: ts(10.5), color: T.textSub, marginTop: 6 }}>{note}</div>}
      </Composer>

      {items.length === 0 && <Empty text="Build a shared shopping list. Generate from meals or add items by hand." />}

      {items.length > 0 && (
        <ListProgress done={purchasedCount} total={items.length} label="in cart" />
      )}

      {toBuy.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
            <SectionLabel>To buy</SectionLabel>
            <div style={{ display: 'flex', gap: 4 }}>
              {[
                { id: 'category', label: 'By Aisle / Cooler' },
                { id: 'meal', label: 'By Meal' },
                { id: 'alpha', label: 'A–Z' },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSortMode(opt.id)}
                  style={{
                    border: `1px solid ${sortMode === opt.id ? T.accent : T.border}`,
                    background: sortMode === opt.id ? T.accentLight : T.card,
                    color: sortMode === opt.id ? T.accent : T.textSub,
                    borderRadius: 7,
                    padding: '2px 7px',
                    fontSize: ts(10),
                    fontWeight: 700,
                    cursor: 'pointer',
                    fontFamily: F,
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {groupedToBuy.map((group) => (
            <div key={group.id} style={{ marginBottom: 12 }}>
              {groupedToBuy.length > 1 && (
                <div style={{ fontSize: ts(10.5), fontWeight: 800, color: T.textSub, marginBottom: 5 }}>
                  {group.icon} {group.label} ({group.items.length})
                </div>
              )}
              {group.items.map(renderShoppingItem)}
            </div>
          ))}
        </>
      )}

      {purchased.length > 0 && (
        <CollapsibleSection title="Purchased" count={purchased.length} defaultOpen={false}>
          {purchased.map(renderShoppingItem)}
        </CollapsibleSection>
      )}
    </div>
  );
}

// ── Shared UI bits ──

function ListProgress({ done, total, label = 'done' }) {
  if (!total) return null;
  const pct = Math.round((done / total) * 100);
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ fontSize: ts(12), fontWeight: 700, color: T.text }}>{done} of {total} {label}</span>
        <span style={{ fontSize: ts(11), color: T.textFaint }}>{pct}%</span>
      </div>
      <div style={{ height: 5, borderRadius: 99, background: T.border, overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: `${pct}%`,
          background: done === total ? '#2A6A14' : T.accent,
          borderRadius: 99,
          transition: 'width 0.25s ease',
        }} />
      </div>
    </div>
  );
}

function CompletionCheck({ checked, onToggle, label }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      style={{
        flexShrink: 0,
        width: 44,
        height: 44,
        margin: -10,
        marginRight: 0,
        padding: 0,
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <span style={{
        width: 24,
        height: 24,
        borderRadius: '50%',
        border: `2px solid ${checked ? '#2A6A14' : T.border}`,
        background: checked ? '#2A6A14' : T.card,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: checked ? '0 0 0 3px #EBF5EB' : 'none',
        transition: 'background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease',
      }}>
        {checked && <Ic d="M20 6L9 17l-5-5" size={13} color="white" sw={3} />}
      </span>
    </button>
  );
}

function Composer({ title, onCancel, scrollToken, children }) {
  const ref = useRef(null);
  useEffect(() => {
    if (scrollToken) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [scrollToken]);
  return (
    <div ref={ref} style={{ background: T.card, borderRadius: 14, padding: '12px 14px', border: `1px solid ${T.border}`, marginBottom: 16, scrollMarginTop: 12 }}>
      {title && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontSize: ts(12), fontWeight: 800, color: T.text }}>{title}</div>
          {onCancel && (
            <button type="button" onClick={onCancel} style={ghostBtnStyle}>Cancel</button>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

function SectionLabel({ children }) {
  return <div style={{ fontSize: ts(10.5), fontWeight: 700, color: T.textSub, letterSpacing: .7, textTransform: 'uppercase', marginBottom: 8 }}>{children}</div>;
}

function CollapsibleSection({ title, count, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  if (!count) return null;

  return (
    <div style={{ marginTop: 16 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          width: '100%',
          border: `1px solid ${T.border}`,
          borderRadius: 12,
          background: T.card,
          padding: '10px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          fontFamily: F,
        }}
      >
        <span style={{ fontSize: ts(10.5), fontWeight: 800, color: T.textSub, letterSpacing: 0.6, textTransform: 'uppercase' }}>
          {title}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: ts(11), fontWeight: 700, color: T.textFaint }}>{count}</span>
          <span style={{
            display: 'flex',
            transform: open ? 'rotate(90deg)' : 'none',
            transition: 'transform 0.15s ease',
          }}>
            <Ic d={ICONS.chevR} size={14} color={T.textFaint} sw={2.2} />
          </span>
        </span>
      </button>
      {open && (
        <div style={{ marginTop: 8 }}>
          {children}
        </div>
      )}
    </div>
  );
}

function SaveButton({ onClick, busy = false, wide = false, label = 'Save' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={label}
      style={{
        flexShrink: 0,
        minWidth: wide ? '100%' : 72,
        height: 38,
        borderRadius: 10,
        border: 'none',
        background: busy ? '#7A9BB8' : T.accent,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: busy ? 'wait' : 'pointer',
        color: 'white',
        fontSize: ts(12),
        fontWeight: 800,
        fontFamily: F,
        padding: wide ? 0 : '0 12px',
      }}
    >
      {busy ? 'Saving…' : label}
    </button>
  );
}

function RowActions({ itemName, onEdit, onDelete }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
      <button
        type="button"
        onClick={onEdit}
        aria-label={itemName ? `Edit ${itemName}` : 'Edit'}
        style={iconActionBtnStyle}
      >
        <Ic d={ICONS.note} size={17} color={T.textSub} sw={2} />
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label={itemName ? `Remove ${itemName}` : 'Remove'}
        style={iconActionBtnStyle}
      >
        <Ic d={ICONS.close} size={17} color="#C05050" sw={2.5} />
      </button>
    </div>
  );
}

const ghostBtnStyle = {
  border: 'none',
  background: 'transparent',
  color: T.textSub,
  fontSize: ts(11),
  fontWeight: 700,
  fontFamily: F,
  cursor: 'pointer',
  padding: 0,
};

const iconActionBtnStyle = {
  border: 'none',
  background: 'transparent',
  width: 36,
  height: 36,
  borderRadius: 8,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  padding: 0,
  flexShrink: 0,
};

function Empty({ text }) {
  return <div style={{ textAlign: 'center', padding: '18px 10px', color: T.textFaint, fontSize: ts(11.5) }}>{text}</div>;
}

const inputStyle = {
  flex: 1, width: '100%', border: `1.5px solid ${T.border}`, borderRadius: 10, padding: '9px 11px',
  fontSize: ts(12.5), fontFamily: F, color: T.text, background: T.bg, outline: 'none', boxSizing: 'border-box',
};

const selectStyle = {
  flex: 1, border: `1.5px solid ${T.border}`, borderRadius: 10, padding: '9px 8px',
  fontSize: ts(11.5), fontFamily: F, color: T.text, background: T.bg, outline: 'none',
};

const cardStyle = {
  background: T.card, borderRadius: 12, padding: '10px 12px', marginBottom: 8,
  border: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', gap: 10,
};

// ── Helpers ──

function groupBy(list, keyFn) {
  const out = {};
  for (const item of list) {
    const key = keyFn(item);
    (out[key] = out[key] || []).push(item);
  }
  return out;
}

function capitalize(s) {
  return String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
}
