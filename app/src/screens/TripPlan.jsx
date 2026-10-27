import { useEffect, useMemo, useState } from 'react';
import { BottomNav } from '../components/BottomNav';
import { MyResponsibilities } from '../components/MyResponsibilities';
import { Ic } from '../components/Ic';
import { SyncChip } from '../components/SyncChip';
import { TripEditPanel } from '../components/TripEditPanel';
import { T, F, ICONS } from '../tokens';
import { ts } from '../lib/textScale';
import { buildTripDraft, formatTripDateRange } from '../lib/tripEdit';
import { savePlanningToCloud } from '../lib/planningSave';
import {
  getCurrentUserId,
  isTripOwner,
  isTripMember,
  addGearItem, updateGearItem, removeGearItem, claimGearItem, getGearAssigneeIds,
  addMeal, updateMeal, removeMeal, claimMeal, getTrips,
  addShoppingItem, updateShoppingItem, removeShoppingItem,
  generateShoppingList,
} from '../lib/storage';
import { ParticipantsTab } from '../components/ParticipantsTab';
import { TripExpenses } from '../components/TripExpenses';
import { OfflineMapsPanel } from '../components/OfflineMapsPanel';
import { TripMapDownloadPrompt } from '../components/TripMapDownloadPrompt';
import { useTripMembersSync } from '../hooks/useTripMembersSync';
import { buildTripParticipants, resolveUserDisplayName } from '../lib/expenses';
import { supabaseConfigured } from '../lib/supabase';
import { getSignedInUserId } from '../lib/authUser';
import {
  INGREDIENT_CATEGORIES,
  classifyIngredientCategory,
  getIngredientCategoryMeta,
  groupIngredientsByCategory,
  listSavedIngredients,
  listSavedMeals,
  publishSavedMeal,
  refreshSharedMeals,
  rememberMeal,
  removeSavedMeal,
  sortIngredients,
  updateSavedMeal,
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
const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];
const SLOT_LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };

function isGearComplete(item) {
  const s = item?.status;
  return s === 'have' || s === 'claimed' || s === 'packed';
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
        {tab !== 'maps' && (
          <TripMapDownloadPrompt trip={trip} onOpenMaps={() => selectTab('maps')} />
        )}
        {tab === 'mine' && <MyResponsibilities trip={trip} onOpenPlan={selectTab} />}
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
          <MealsTab trip={trip} participants={participants} onTripUpdate={onTripUpdate} />
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
    setAssignedToIds(getGearAssigneeIds(item));
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

  async function toggleGearComplete(item) {
    const next = isGearComplete(item) ? 'needed' : 'have';
    await savePlanningToCloud(trip.id, () => {
      updateGearItem(trip.id, item.id, { status: next });
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
    const current = getGearAssigneeIds(item);
    if (current.includes(personId)) return;
    setItemAssignees(item, [...current, personId]);
  }

  function removeItemAssignee(item, personId) {
    const current = getGearAssigneeIds(item);
    setItemAssignees(item, current.filter((id) => id !== personId));
  }

  const { toBring, ready } = useMemo(() => {
    const visible = editingId ? gear.filter((g) => g.id !== editingId) : gear;
    const need = [];
    const done = [];
    for (const item of visible) {
      (isGearComplete(item) ? done : need).push(item);
    }
    return { toBring: need, ready: done };
  }, [gear, editingId]);

  const groupedNeed = useMemo(
    () => groupBy(toBring, (g) => normalizeGearCategory(g.category)),
    [toBring],
  );
  const gearReady = ready.length;

  function renderGearItem(item) {
    const done = isGearComplete(item);
    const itemAssigneeIds = getGearAssigneeIds(item);
    const availableParticipants = participants.filter((p) => !itemAssigneeIds.includes(p.id));
    const amAssigned = Boolean(currentUserId && itemAssigneeIds.includes(currentUserId));
    const assignedDisplayLabel = itemAssigneeIds.length > 0
      ? itemAssigneeIds.map((uid) => resolvePersonLabel(uid)).filter(Boolean).join(', ')
      : item.assignedToLabel;

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
          label={done ? `Move ${item.name} back to ${GEAR_NEED_LABEL}` : `Mark ${item.name} as ${GEAR_READY_LABEL.toLowerCase()}`}
          onToggle={() => void toggleGearComplete(item)}
        />
        <div
          style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
          onClick={() => void toggleGearComplete(item)}
        >
          <div style={{
            fontSize: 13,
            fontWeight: 700,
            color: done ? T.textFaint : T.text,
            textDecoration: done ? 'line-through' : 'none',
          }}>
            {item.name}
          </div>
          {!done ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 5, flexWrap: 'wrap' }}>
              {itemAssigneeIds.map((uid) => (
                <span
                  key={uid}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 10.5,
                    fontWeight: 700,
                    color: T.accent,
                    background: T.accentLight,
                    border: `1px solid ${T.accent}40`,
                    borderRadius: 999,
                    padding: '2px 7px',
                    fontFamily: F,
                  }}
                >
                  {resolvePersonLabel(uid)}
                  <button
                    type="button"
                    aria-label={`Remove ${resolvePersonLabel(uid)} from ${item.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeItemAssignee(item, uid);
                    }}
                    style={{
                      border: 'none',
                      background: 'none',
                      color: T.accent,
                      fontSize: 11,
                      fontWeight: 800,
                      padding: 0,
                      lineHeight: 1,
                      cursor: 'pointer',
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
              {(availableParticipants.length > 0 || itemAssigneeIds.length > 0) && (
                <select
                  value=""
                  onChange={(e) => addItemAssignee(item, e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    fontSize: 10.5,
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
                  onClick={(e) => {
                    e.stopPropagation();
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
                    fontSize: 10.5,
                    fontWeight: 800,
                    fontFamily: F,
                    cursor: 'pointer',
                  }}
                >
                  {itemAssigneeIds.length === 0 ? "I'll bring this" : "+ I'll bring some too"}
                </button>
              )}
            </div>
          ) : (
            assignedDisplayLabel && (
              <div style={{ fontSize: 10.5, color: T.textFaint, marginTop: 2 }}>
                {assignedDisplayLabel}
              </div>
            )
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

      {gear.length === 0 && <Empty text="No gear yet. Add items to your list, then check them off as you pack or obtain each one." />}

      {gear.length > 0 && (
        <ListProgress done={gearReady} total={gear.length} label="ready" />
      )}

      {toBring.length > 0 && (
        <>
          <SectionLabel>{GEAR_NEED_LABEL}</SectionLabel>
          {Object.entries(groupedNeed).map(([cat, items]) => (
            <div key={cat} style={{ marginBottom: 14 }}>
              {Object.keys(groupedNeed).length > 1 && (
                <div style={{ fontSize: 10, fontWeight: 700, color: T.textFaint, marginBottom: 6, textTransform: 'capitalize' }}>
                  {capitalize(cat)}
                </div>
              )}
              {items.map(renderGearItem)}
            </div>
          ))}
        </>
      )}

      {toBring.length === 0 && ready.length > 0 && (
        <div style={{ fontSize: 11.5, color: T.textSub, marginBottom: 10, textAlign: 'center' }}>
          Everything is {GEAR_READY_LABEL.toLowerCase()}.
        </div>
      )}

      <CollapsibleSection title={GEAR_READY_LABEL} count={ready.length} defaultOpen={false}>
        {ready.map(renderGearItem)}
      </CollapsibleSection>
    </div>
  );
}

function toggleIngredient(current, ingredient) {
  const parts = current.split(',').map((part) => part.trim()).filter(Boolean);
  const key = ingredient.toLowerCase();
  const index = parts.findIndex((part) => part.toLowerCase() === key);
  if (index >= 0) parts.splice(index, 1);
  else parts.push(ingredient);
  return parts.join(', ');
}

function ChoiceRow({ label, children }) {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: T.textSub, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
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
        fontSize: 12,
        fontWeight: 700,
        cursor: 'pointer',
        fontFamily: F,
      }}>
      {children}
    </button>
  );
}

function parseIngredientString(raw) {
  const seen = new Set();
  const out = [];
  for (const part of String(raw || '').split(',')) {
    const trimmed = part.trim();
    const key = trimmed.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function MealsTab({ trip, participants, onTripUpdate }) {
  const [name, setName] = useState('');
  const [dayIndex, setDayIndex] = useState(1);
  const [slot, setSlot] = useState('dinner');
  const [assignedTo, setAssignedTo] = useState('');
  const [coCookIds, setCoCookIds] = useState([]);
  const [servings, setServings] = useState('');
  const [notes, setNotes] = useState('');
  const [ingredients, setIngredients] = useState('');
  const [ingredientDraft, setIngredientDraft] = useState('');
  const [ingredientSortMode, setIngredientSortMode] = useState('category'); // 'category' | 'alpha'
  const [ingredientCatFilter, setIngredientCatFilter] = useState('all');
  const [ingredientSearch, setIngredientSearch] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [managingSaved, setManagingSaved] = useState(false);
  const [editingSavedKey, setEditingSavedKey] = useState(null);
  const [savedEditName, setSavedEditName] = useState('');
  const [savedEditSlot, setSavedEditSlot] = useState('dinner');
  const [savedEditIngredients, setSavedEditIngredients] = useState('');
  const [saving, setSaving] = useState(false);
  const [sharedTick, setSharedTick] = useState(0);

  const meals = trip.meals || [];
  const savedMeals = useMemo(() => {
    const others = getTrips().filter((item) => item.id !== trip.id);
    return listSavedMeals([...others, { meals }]);
  }, [meals, trip.id, sharedTick]);

  const savedMealsBySlot = useMemo(() => {
    const grouped = new Map(MEAL_SLOTS.map((s) => [s, []]));
    for (const m of savedMeals) {
      const s = MEAL_SLOTS.includes(m.slot) ? m.slot : 'dinner';
      grouped.get(s).push(m);
    }
    return MEAL_SLOTS
      .map((s) => ({ slot: s, label: SLOT_LABEL[s], items: grouped.get(s) || [] }))
      .filter((g) => g.items.length > 0);
  }, [savedMeals]);

  const savedIngredients = useMemo(() => {
    const others = getTrips().filter((item) => item.id !== trip.id);
    return listSavedIngredients([...others, { meals }]);
  }, [meals, trip.id, sharedTick]);

  const currentIngredientNames = useMemo(
    () => parseIngredientString(ingredients),
    [ingredients],
  );

  const sortedCurrentIngredients = useMemo(
    () => sortIngredients(currentIngredientNames, ingredientSortMode),
    [currentIngredientNames, ingredientSortMode],
  );

  const filteredSavedIngredients = useMemo(() => {
    const q = ingredientSearch.trim().toLowerCase();
    const filtered = savedIngredients.filter((ing) => {
      if (q && !ing.toLowerCase().includes(q)) return false;
      if (ingredientCatFilter !== 'all' && classifyIngredientCategory(ing) !== ingredientCatFilter) return false;
      return true;
    });
    return sortIngredients(filtered, ingredientSortMode);
  }, [savedIngredients, ingredientSearch, ingredientCatFilter, ingredientSortMode]);

  const groupedSavedIngredients = useMemo(
    () => groupIngredientsByCategory(filteredSavedIngredients),
    [filteredSavedIngredients],
  );

  useEffect(() => {
    let cancelled = false;
    refreshSharedMeals().then(() => {
      if (!cancelled) setSharedTick((tick) => tick + 1);
    });
    return () => { cancelled = true; };
  }, []);

  function resetForm() {
    setEditingId(null);
    setName('');
    setDayIndex(1);
    setSlot('dinner');
    setAssignedTo('');
    setCoCookIds([]);
    setServings('');
    setNotes('');
    setIngredients('');
    setIngredientDraft('');
  }

  function startEdit(meal) {
    setEditingId(meal.id);
    setName(meal.name || '');
    setDayIndex(meal.dayIndex || 1);
    setSlot(meal.slot || 'dinner');
    setAssignedTo(meal.assignedTo || '');
    setCoCookIds(Array.isArray(meal.coCooks) ? meal.coCooks : []);
    setServings(meal.servings ? String(meal.servings) : '');
    setNotes(meal.notes || '');
    setIngredients((meal.ingredients || []).map((i) => i.name).join(', '));
    setIngredientDraft('');
  }

  function handleSelectSavedMeal(mealKey) {
    if (!mealKey) return;
    const picked = savedMeals.find((m) => m.nameKey === mealKey);
    if (!picked) return;
    setName(picked.name);
    if (picked.slot) setSlot(picked.slot);
    setIngredients((picked.ingredients || []).map((item) => item.name).join(', '));
  }

  function addDraftIngredients() {
    const toAdd = parseIngredientString(ingredientDraft);
    if (toAdd.length === 0) return;
    let next = ingredients;
    for (const item of toAdd) {
      const exists = parseIngredientString(next).some((p) => p.toLowerCase() === item.toLowerCase());
      if (!exists) {
        next = next.trim() ? `${next}, ${item}` : item;
      }
    }
    setIngredients(next);
    setIngredientDraft('');
  }

  function startEditSavedRecipe(savedMeal) {
    setEditingSavedKey(savedMeal.nameKey);
    setSavedEditName(savedMeal.name || '');
    setSavedEditSlot(savedMeal.slot || 'dinner');
    setSavedEditIngredients((savedMeal.ingredients || []).map((i) => i.name).join(', '));
  }

  function saveEditedRecipe() {
    if (!editingSavedKey || !savedEditName.trim()) return;
    const ingList = parseIngredientString(savedEditIngredients).map((n) => ({ name: n, qty: '' }));
    const updated = updateSavedMeal(editingSavedKey, {
      name: savedEditName.trim(),
      slot: savedEditSlot,
      ingredients: ingList,
    });
    if (updated) {
      void publishSavedMeal(updated).then(() => setSharedTick((t) => t + 1));
    }
    setEditingSavedKey(null);
    setSharedTick((t) => t + 1);
  }

  function handleDeleteSavedRecipe(savedMeal) {
    if (!confirmRemoveItem(savedMeal.name, 'saved meals library')) return;
    removeSavedMeal(savedMeal.nameKey);
    if (editingSavedKey === savedMeal.nameKey) setEditingSavedKey(null);
    setSharedTick((t) => t + 1);
  }

  async function save() {
    const pendingDraft = ingredientDraft.trim();
    const combinedIngredients = pendingDraft
      ? (ingredients.trim() ? `${ingredients}, ${pendingDraft}` : pendingDraft)
      : ingredients;
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const who = participants.find((p) => p.id === assignedTo);
      const cleanCoCooks = coCookIds.filter((id) => id && id !== assignedTo);
      const ingList = sortIngredients(parseIngredientString(combinedIngredients), 'category')
        .map((n) => ({ name: n, qty: '' }));
      const parsedServings = Number(servings);
      const payload = {
        name: name.trim(),
        dayIndex: Number(dayIndex) || 1,
        slot,
        assignedTo: assignedTo || null,
        assignedToLabel: who?.label || null,
        coCooks: cleanCoCooks,
        servings: Number.isFinite(parsedServings) && parsedServings > 0 ? parsedServings : null,
        notes: notes.trim(),
        ingredients: ingList,
      };
      await savePlanningToCloud(trip.id, () => {
        if (editingId) {
          updateMeal(trip.id, editingId, payload);
        } else {
          addMeal(trip.id, payload);
        }
      });
      rememberMeal(payload);
      void publishSavedMeal(payload).then(() => setSharedTick((tick) => tick + 1));
      resetForm();
      onTripUpdate?.();
    } finally {
      setSaving(false);
    }
  }

  async function removeItem(meal) {
    if (!confirmRemoveItem(meal.name, 'meal plan')) return;
    await savePlanningToCloud(trip.id, () => {
      removeMeal(trip.id, meal.id);
    });
    if (editingId === meal.id) resetForm();
    onTripUpdate?.();
  }

  const byDay = useMemo(() => {
    const map = groupBy(meals, (m) => String(m.dayIndex || 1));
    return Object.entries(map).sort((a, b) => Number(a[0]) - Number(b[0]));
  }, [meals]);

  const selectedSavedKey = savedMeals.find((m) => m.nameKey === name.trim().toLowerCase())?.nameKey || '';

  return (
    <div>
      <Composer title={editingId ? `Edit meal · ${name || 'Meal'}` : 'Add meal'} onCancel={editingId ? resetForm : null}>
        {savedMeals.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: T.textSub, letterSpacing: 0.4, textTransform: 'uppercase' }}>
                Saved meals ({savedMeals.length})
              </span>
              <button
                type="button"
                onClick={() => {
                  setManagingSaved((v) => !v);
                  setEditingSavedKey(null);
                }}
                style={{
                  border: 'none',
                  background: 'none',
                  color: T.accent,
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                  padding: 0,
                  fontFamily: F,
                }}
              >
                {managingSaved ? 'Done managing' : 'Edit saved meals'}
              </button>
            </div>
            <select
              aria-label="Saved meals"
              value={selectedSavedKey}
              onChange={(e) => handleSelectSavedMeal(e.target.value)}
              style={{ ...selectStyle, width: '100%' }}
            >
              <option value="">Choose a saved meal template…</option>
              {savedMealsBySlot.map((group) => (
                <optgroup key={group.slot} label={group.label}>
                  {group.items.map((meal) => (
                    <option key={meal.nameKey} value={meal.nameKey}>
                      {meal.name}{meal.ingredients?.length ? ` (${meal.ingredients.length} ingredients)` : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>

            {managingSaved && (
              <div style={{
                marginTop: 8,
                padding: 10,
                borderRadius: 10,
                background: T.bg,
                border: `1px solid ${T.border}`,
              }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: T.text, marginBottom: 6 }}>
                  Saved Meal Library (shared across trips)
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 240, overflowY: 'auto' }}>
                  {savedMeals.map((sm) => {
                    const isEditingThis = editingSavedKey === sm.nameKey;
                    if (isEditingThis) {
                      return (
                        <div key={sm.nameKey} style={{ padding: 8, borderRadius: 8, background: T.card, border: `1px solid ${T.accent}` }}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <input
                              value={savedEditName}
                              onChange={(e) => setSavedEditName(e.target.value)}
                              placeholder="Recipe name"
                              style={{ ...inputStyle, height: 32, fontSize: 12 }}
                            />
                            <select
                              value={savedEditSlot}
                              onChange={(e) => setSavedEditSlot(e.target.value)}
                              style={{ ...selectStyle, height: 32, fontSize: 11.5, flex: '0 0 105px' }}
                            >
                              {MEAL_SLOTS.map((s) => <option key={s} value={s}>{SLOT_LABEL[s]}</option>)}
                            </select>
                          </div>
                          <input
                            value={savedEditIngredients}
                            onChange={(e) => setSavedEditIngredients(e.target.value)}
                            placeholder="Ingredients, comma separated"
                            style={{ ...inputStyle, height: 32, fontSize: 11.5, marginTop: 6 }}
                          />
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 6 }}>
                            <button
                              type="button"
                              onClick={() => setEditingSavedKey(null)}
                              style={{
                                border: `1px solid ${T.border}`,
                                background: T.bg,
                                color: T.textSub,
                                borderRadius: 7,
                                padding: '3px 8px',
                                fontSize: 11,
                                fontWeight: 700,
                                cursor: 'pointer',
                              }}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={saveEditedRecipe}
                              style={{
                                border: 'none',
                                background: T.accent,
                                color: 'white',
                                borderRadius: 7,
                                padding: '3px 10px',
                                fontSize: 11,
                                fontWeight: 800,
                                cursor: 'pointer',
                              }}
                            >
                              Save recipe
                            </button>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div
                        key={sm.nameKey}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 8,
                          padding: '6px 8px',
                          borderRadius: 8,
                          background: T.card,
                          border: `1px solid ${T.border}`,
                        }}
                      >
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: T.text }}>
                            {sm.name} <span style={{ fontSize: 10.5, fontWeight: 600, color: T.textFaint }}>· {SLOT_LABEL[sm.slot] || 'Dinner'}</span>
                          </div>
                          {(sm.ingredients || []).length > 0 && (
                            <div style={{ fontSize: 10.5, color: T.textSub, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {sm.ingredients.map((i) => i.name).join(', ')}
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                          <button
                            type="button"
                            onClick={() => startEditSavedRecipe(sm)}
                            style={{
                              border: `1px solid ${T.border}`,
                              background: T.bg,
                              color: T.text,
                              borderRadius: 6,
                              padding: '2px 7px',
                              fontSize: 10.5,
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteSavedRecipe(sm)}
                            style={{
                              border: `1px solid ${T.red}35`,
                              background: T.redLight,
                              color: T.red,
                              borderRadius: 6,
                              padding: '2px 7px',
                              fontSize: 10.5,
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Meal name (chili, fajitas, oatmeal…)"
          style={inputStyle}
        />

        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <select value={dayIndex} onChange={(e) => setDayIndex(e.target.value)} style={selectStyle}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map((d) => <option key={d} value={d}>Day {d}</option>)}
          </select>
          <select value={slot} onChange={(e) => setSlot(e.target.value)} style={selectStyle}>
            {MEAL_SLOTS.map((s) => <option key={s} value={s}>{SLOT_LABEL[s]}</option>)}
          </select>
          <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} style={selectStyle}>
            <option value="">Lead cook?</option>
            {participants.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <input
            type="number"
            min="1"
            value={servings}
            onChange={(e) => setServings(e.target.value)}
            placeholder="Servings"
            style={{ ...inputStyle, flex: '0 0 84px' }}
          />
        </div>

        {participants.length > 1 && (
          <ChoiceRow label="Co-cooks (optional)">
            {participants
              .filter((p) => p.id !== assignedTo)
              .map((p) => {
                const selected = coCookIds.includes(p.id);
                return (
                  <ChoiceChip
                    key={p.id}
                    selected={selected}
                    onClick={() => setCoCookIds((prev) => (
                      prev.includes(p.id) ? prev.filter((id) => id !== p.id) : [...prev, p.id]
                    ))}
                  >
                    {p.label}
                  </ChoiceChip>
                );
              })}
          </ChoiceRow>
        )}

        {/* Active Meal Ingredients Section */}
        <div style={{
          marginTop: 10,
          padding: 10,
          borderRadius: 10,
          background: T.bg,
          border: `1px solid ${T.border}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 6 }}>
            <span style={{ fontSize: 10.5, fontWeight: 800, color: T.textSub, letterSpacing: 0.4, textTransform: 'uppercase' }}>
              Meal Ingredients ({sortedCurrentIngredients.length})
            </span>
            <div style={{ display: 'flex', gap: 4 }}>
              {[
                { id: 'category', label: 'Sort: By Aisle' },
                { id: 'alpha', label: 'A–Z' },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setIngredientSortMode(opt.id)}
                  style={{
                    border: `1px solid ${ingredientSortMode === opt.id ? T.accent : T.border}`,
                    background: ingredientSortMode === opt.id ? T.accentLight : T.card,
                    color: ingredientSortMode === opt.id ? T.accent : T.textSub,
                    borderRadius: 6,
                    padding: '2px 6px',
                    fontSize: 10,
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

          {sortedCurrentIngredients.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
              {sortedCurrentIngredients.map((ing) => {
                const catMeta = getIngredientCategoryMeta(classifyIngredientCategory(ing));
                return (
                  <span
                    key={ing.toLowerCase()}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '3px 8px',
                      borderRadius: 999,
                      background: T.card,
                      border: `1px solid ${T.accent}45`,
                      fontSize: 11.5,
                      fontWeight: 700,
                      color: T.text,
                    }}
                  >
                    <span aria-hidden="true">{catMeta.icon}</span>
                    {ing}
                    <button
                      type="button"
                      aria-label={`Remove ${ing}`}
                      onClick={() => setIngredients(toggleIngredient(ingredients, ing))}
                      style={{
                        border: 'none',
                        background: 'none',
                        color: T.textSub,
                        fontSize: 12,
                        fontWeight: 800,
                        cursor: 'pointer',
                        padding: 0,
                        lineHeight: 1,
                      }}
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: T.textFaint, marginBottom: 8 }}>
              No ingredients added yet. Type below or tap from your sorted ingredient library.
            </div>
          )}

          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={ingredientDraft}
              onChange={(e) => setIngredientDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addDraftIngredients();
                }
              }}
              placeholder="Add ingredient(s), comma separated…"
              style={{ ...inputStyle, height: 34, fontSize: 12 }}
            />
            <button
              type="button"
              onClick={addDraftIngredients}
              style={{
                border: `1px solid ${T.accent}`,
                background: T.accentLight,
                color: T.accent,
                borderRadius: 9,
                padding: '0 11px',
                fontSize: 11.5,
                fontWeight: 800,
                cursor: 'pointer',
                fontFamily: F,
                flexShrink: 0,
              }}
            >
              + Add
            </button>
          </div>

          {savedIngredients.length > 0 && (
            <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${T.border}` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: T.textSub, letterSpacing: 0.4, textTransform: 'uppercase' }}>
                  Saved Ingredients ({filteredSavedIngredients.length})
                </span>
                {savedIngredients.length > 6 && (
                  <input
                    value={ingredientSearch}
                    onChange={(e) => setIngredientSearch(e.target.value)}
                    placeholder="Filter ingredients…"
                    style={{ ...inputStyle, height: 26, fontSize: 11, maxWidth: 150, padding: '0 8px' }}
                  />
                )}
              </div>

              {/* Category Filter Bar */}
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                {[
                  { id: 'all', label: 'All' },
                  ...INGREDIENT_CATEGORIES.map((c) => ({ id: c.id, label: `${c.icon} ${c.shortLabel}` })),
                ].map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setIngredientCatFilter(cat.id)}
                    style={{
                      border: `1px solid ${ingredientCatFilter === cat.id ? T.accent : T.border}`,
                      background: ingredientCatFilter === cat.id ? T.accent : T.card,
                      color: ingredientCatFilter === cat.id ? 'white' : T.textSub,
                      borderRadius: 999,
                      padding: '2px 8px',
                      fontSize: 10.5,
                      fontWeight: 700,
                      cursor: 'pointer',
                      fontFamily: F,
                    }}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>

              {ingredientSortMode === 'category' && ingredientCatFilter === 'all' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {groupedSavedIngredients.map((group) => (
                    <div key={group.id}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: T.textFaint, marginBottom: 4 }}>
                        {group.icon} {group.label}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {group.items.map((ingredient) => {
                          const selected = currentIngredientNames.some((part) => part.toLowerCase() === ingredient.toLowerCase());
                          return (
                            <ChoiceChip
                              key={ingredient.toLowerCase()}
                              selected={selected}
                              onClick={() => setIngredients(toggleIngredient(ingredients, ingredient))}
                            >
                              {ingredient}
                            </ChoiceChip>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {filteredSavedIngredients.map((ingredient) => {
                    const selected = currentIngredientNames.some((part) => part.toLowerCase() === ingredient.toLowerCase());
                    return (
                      <ChoiceChip
                        key={ingredient.toLowerCase()}
                        selected={selected}
                        onClick={() => setIngredients(toggleIngredient(ingredients, ingredient))}
                      >
                        {ingredient}
                      </ChoiceChip>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Prep notes or dietary info (optional)"
          style={{ ...inputStyle, marginTop: 8 }}
        />

        <div style={{ marginTop: 8 }}>
          <SaveButton onClick={() => void save()} busy={saving} wide label={editingId ? 'Update meal' : 'Save'} />
        </div>
      </Composer>

      {meals.length === 0 && <Empty text="Plan meals by day. Ingredients flow into the shopping list." />}

      {byDay.map(([day, dayMeals]) => (
        <div key={day} style={{ marginBottom: 14 }}>
          <SectionLabel>Day {day}</SectionLabel>
          {dayMeals.sort((a, b) => MEAL_SLOTS.indexOf(a.slot) - MEAL_SLOTS.indexOf(b.slot)).map((m) => {
            const currentUserId = getCurrentUserId();
            const coCooks = Array.isArray(m.coCooks) ? m.coCooks : [];
            const amCoCook = coCooks.includes(currentUserId);
            const amLeadCook = m.assignedTo === currentUserId;
            const isEditing = editingId === m.id;
            const sortedMealIngs = sortIngredients(m.ingredients || [], 'category');
            return (
              <div
                key={m.id}
                style={{
                  ...cardStyle,
                  alignItems: 'flex-start',
                  borderColor: isEditing ? T.accent : T.border,
                  background: isEditing ? T.accentLight : T.card,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>
                    <span style={{ color: T.accent, fontSize: 10.5, fontWeight: 800 }}>{SLOT_LABEL[m.slot]} · </span>
                    {m.name}
                    {m.servings ? (
                      <span style={{ fontSize: 10.5, fontWeight: 600, color: T.textFaint }}> · {m.servings} servings</span>
                    ) : null}
                  </div>
                  {m.assignedToLabel && <div style={{ fontSize: 10.5, color: T.textSub, marginTop: 2 }}>Cook: {m.assignedToLabel}</div>}
                  {coCooks.length > 0 && (
                    <div style={{ fontSize: 10.5, color: '#2A5C8E', marginTop: 2 }}>
                      Co-cook{coCooks.length === 1 ? '' : 's'}: {coCooks.map((uid) => resolveUserDisplayName(trip, uid, currentUserId)).join(', ')}
                    </div>
                  )}
                  {sortedMealIngs.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
                      {sortedMealIngs.map((i) => {
                        const catMeta = getIngredientCategoryMeta(classifyIngredientCategory(i.name));
                        return (
                          <span
                            key={i.name}
                            style={{
                              fontSize: 10,
                              fontWeight: 600,
                              color: T.textSub,
                              background: T.bg,
                              border: `1px solid ${T.border}`,
                              borderRadius: 999,
                              padding: '1px 6px',
                            }}
                          >
                            {catMeta.icon} {i.name}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {m.notes && (
                    <div style={{ fontSize: 10.5, color: T.textSub, fontStyle: 'italic', marginTop: 4 }}>
                      {m.notes}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                    {!m.assignedTo && (
                      <button
                        type="button"
                        onClick={() => {
                          void savePlanningToCloud(trip.id, () => {
                            claimMeal(trip.id, m.id, { asCoCook: false });
                          }).then(() => onTripUpdate?.());
                        }}
                        style={{
                          border: `1px solid ${T.accent}50`,
                          borderRadius: 7,
                          padding: '2px 8px',
                          background: T.accentLight,
                          color: T.accent,
                          fontSize: 10.5,
                          fontWeight: 800,
                          fontFamily: F,
                          cursor: 'pointer',
                        }}
                      >
                        I'll cook this
                      </button>
                    )}
                    {m.assignedTo && !amLeadCook && (
                      <button
                        type="button"
                        onClick={() => {
                          void savePlanningToCloud(trip.id, () => {
                            claimMeal(trip.id, m.id, { asCoCook: true });
                          }).then(() => onTripUpdate?.());
                        }}
                        style={{
                          border: `1px solid ${amCoCook ? '#2A5C8E' : T.border}`,
                          borderRadius: 7,
                          padding: '2px 8px',
                          background: amCoCook ? '#E4EFF8' : T.bg,
                          color: amCoCook ? '#2A5C8E' : T.textSub,
                          fontSize: 10.5,
                          fontWeight: 700,
                          fontFamily: F,
                          cursor: 'pointer',
                        }}
                      >
                        {amCoCook ? '✓ Co-cook' : '+ Co-cook'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => startEdit(m)}
                      style={{
                        border: `1px solid ${T.border}`,
                        borderRadius: 7,
                        padding: '2px 8px',
                        background: T.bg,
                        color: T.textSub,
                        fontSize: 10.5,
                        fontWeight: 700,
                        fontFamily: F,
                        cursor: 'pointer',
                      }}
                    >
                      {isEditing ? 'Editing…' : 'Edit meal'}
                    </button>
                  </div>
                </div>
                <RowActions
                  itemName={m.name}
                  onEdit={() => startEdit(m)}
                  onDelete={() => void removeItem(m)}
                />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function ShoppingTab({ trip, onTripUpdate }) {
  const [name, setName] = useState('');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState(null);
  const [sortMode, setSortMode] = useState('category'); // 'category' | 'meal' | 'alpha'
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const items = trip.shoppingItems || [];
  const meals = trip.meals || [];

  const mealNamesByIngredient = useMemo(() => {
    const map = new Map();
    for (const m of meals) {
      for (const ing of m.ingredients || []) {
        const key = String(ing?.name || '').trim().toLowerCase();
        if (!key) continue;
        if (!map.has(key)) map.set(key, []);
        const label = `Day ${m.dayIndex || 1} ${SLOT_LABEL[m.slot] || ''} (${m.name})`.trim();
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
      await savePlanningToCloud(trip.id, () => {
        if (editingId) {
          updateShoppingItem(trip.id, editingId, payload);
        } else {
          addShoppingItem(trip.id, payload);
        }
      });
      resetForm();
      onTripUpdate?.();
    } finally {
      setSaving(false);
    }
  }

  async function removeItem(item) {
    if (!confirmRemoveItem(item.name, 'shopping list')) return;
    await savePlanningToCloud(trip.id, () => {
      removeShoppingItem(trip.id, item.id);
    });
    if (editingId === item.id) resetForm();
    onTripUpdate?.();
  }

  async function generate() {
    if (saving) return;
    setSaving(true);
    try {
      let added = 0;
      await savePlanningToCloud(trip.id, () => {
        added = generateShoppingList(trip.id);
      });
      setNote(added > 0 ? `Added ${added} item${added === 1 ? '' : 's'} from meals.` : 'No new ingredients found in meals.');
      onTripUpdate?.();
    } finally {
      setSaving(false);
    }
  }

  async function toggle(item) {
    await savePlanningToCloud(trip.id, () => {
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
    const catMeta = getIngredientCategoryMeta(classifyIngredientCategory(item.name));
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
            fontSize: 13,
            fontWeight: 600,
            color: done ? T.textFaint : T.text,
            textDecoration: done ? 'line-through' : 'none',
          }}>
            <span aria-hidden="true" style={{ marginRight: 5 }}>{catMeta.icon}</span>
            {item.name}{item.qty ? ` · ${item.qty}` : ''}
          </div>
          {usedInMeals && usedInMeals.length > 0 ? (
            <div style={{ fontSize: 10, color: T.textSub, marginTop: 1 }}>
              For: {usedInMeals.join(' · ')}
            </div>
          ) : (
            item.source === 'meal' && <div style={{ fontSize: 9.5, color: T.textFaint }}>from meals</div>
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
      <Composer title={editingId ? 'Edit item' : 'Add item'} onCancel={editingId ? resetForm : null}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void save(); }}
                 placeholder="Add item" style={inputStyle} />
          <input value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Qty" style={{ ...inputStyle, maxWidth: 70 }} />
          <SaveButton onClick={() => void save()} busy={saving} label={editingId ? 'Update' : 'Save'} />
        </div>
        {!editingId && (
          <div onClick={() => { if (!saving) void generate(); }}
               style={{ marginTop: 8, height: 36, borderRadius: 10, border: `1px dashed ${T.accent}80`, background: T.accentLight,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                        fontSize: 11.5, fontWeight: 700, color: T.accent, gap: 6 }}>
            <Ic d={ICONS.plus} size={14} color={T.accent} sw={2.2} /> Generate from meal ingredients
          </div>
        )}
        {note && <div style={{ fontSize: 10.5, color: T.textSub, marginTop: 6 }}>{note}</div>}
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
                    fontSize: 10,
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
                <div style={{ fontSize: 10.5, fontWeight: 800, color: T.textSub, marginBottom: 5 }}>
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
        <span style={{ fontSize: 12, fontWeight: 700, color: T.text }}>{done} of {total} {label}</span>
        <span style={{ fontSize: 11, color: T.textFaint }}>{pct}%</span>
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

function Composer({ title, onCancel, children }) {
  return (
    <div style={{ background: T.card, borderRadius: 14, padding: '12px 14px', border: `1px solid ${T.border}`, marginBottom: 16 }}>
      {title && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: T.text }}>{title}</div>
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
  return <div style={{ fontSize: 10.5, fontWeight: 700, color: T.textSub, letterSpacing: .7, textTransform: 'uppercase', marginBottom: 8 }}>{children}</div>;
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
        <span style={{ fontSize: 10.5, fontWeight: 800, color: T.textSub, letterSpacing: 0.6, textTransform: 'uppercase' }}>
          {title}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: T.textFaint }}>{count}</span>
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
        fontSize: 12,
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
  fontSize: 11,
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
