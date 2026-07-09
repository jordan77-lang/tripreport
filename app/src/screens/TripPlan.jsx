import { useEffect, useMemo, useState } from 'react';
import { BottomNav } from '../components/BottomNav';
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
  addGearItem, updateGearItem, removeGearItem,
  addMeal, updateMeal, removeMeal,
  addShoppingItem, updateShoppingItem, removeShoppingItem,
  generateShoppingList,
} from '../lib/storage';
import { ParticipantsTab } from '../components/ParticipantsTab';
import { TripExpenses } from '../components/TripExpenses';
import { OfflineMapsPanel } from '../components/OfflineMapsPanel';
import { useTripMembersSync } from '../hooks/useTripMembersSync';
import { buildTripParticipants } from '../lib/expenses';
import { supabaseConfigured } from '../lib/supabase';
import { getSignedInUserId } from '../lib/authUser';

const TABS = [
  { id: 'details', label: 'Details' },
  { id: 'participants', label: 'Crew' },
  { id: 'gear', label: 'Gear' },
  { id: 'meals', label: 'Meals' },
  { id: 'shopping', label: 'Shopping' },
  { id: 'expenses', label: 'Expenses' },
  { id: 'maps', label: 'Maps' },
];

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
  const [tab, setTab] = useState(initialTab || 'gear');
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

  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  function selectTab(nextTab) {
    if (nextTab === 'details') setTripDraft(buildTripDraft(trip));
    setTab(nextTab);
  }

  if (!trip) {
    return (
      <div style={{ height: '100%', background: T.bg, display: 'flex', flexDirection: 'column', fontFamily: F }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.textFaint }}>
          No active trip to plan
        </div>
        <BottomNav active="trip" onNav={onNav} onFab={onFab} trip={trip} />
      </div>
    );
  }

  return (
    <div style={{ height: '100%', background: T.bg, display: 'flex', flexDirection: 'column', fontFamily: F, overflow: 'hidden' }}>
      <div style={{ background: T.card, padding: '12px 16px 0', borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <div onClick={onBack} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 8, background: T.bg, border: `1px solid ${T.border}` }}>
            <span style={{ display: 'flex', transform: 'rotate(180deg)' }}>
              <Ic d={ICONS.chevR} size={15} color={T.textSub} sw={2.2} />
            </span>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: T.text, letterSpacing: -.4 }}>Trip Planning</div>
            <div style={{ fontSize: ts(13), color: T.textSub }}>{trip.name}</div>
            <div style={{ fontSize: ts(12), color: T.textFaint, marginTop: 2 }}>
              {formatTripDateRange(trip.startDate, trip.endDate)}
            </div>
          </div>
          <SyncChip state={tripSyncState} compact />
        </div>
        <div style={{ display: 'flex', gap: 2, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {visibleTabs.map((tb) => (
            <div key={tb.id} onClick={() => selectTab(tb.id)}
                 style={{ flex: '1 0 auto', minWidth: 52, textAlign: 'center', padding: '10px 6px', cursor: 'pointer',
                          fontSize: 11.5, fontWeight: 700,
                          color: tab === tb.id ? T.accent : T.textFaint,
                          borderBottom: `2px solid ${tab === tb.id ? T.accent : 'transparent'}` }}>
              {tb.label}
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
        {tab === 'details' && canEditTrip && (
          <TripEditPanel
            trip={trip}
            draft={tripDraft}
            onCancel={() => setTab('gear')}
            onSaved={() => {
              onTripUpdate?.();
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
        {tab === 'gear' && <GearTab trip={trip} participants={participants} onTripUpdate={onTripUpdate} />}
        {tab === 'meals' && <MealsTab trip={trip} participants={participants} onTripUpdate={onTripUpdate} />}
        {tab === 'shopping' && <ShoppingTab trip={trip} onTripUpdate={onTripUpdate} />}
        {tab === 'expenses' && (
          <TripExpenses trip={trip} onTripUpdate={onTripUpdate} scope="all" showTitle layout="full" />
        )}
        {tab === 'maps' && <OfflineMapsPanel trip={trip} onTripUpdate={onTripUpdate} />}
        <div style={{ height: 16 }} />
      </div>

      <BottomNav active="trip" onNav={onNav} onFab={onFab} trip={trip} />
    </div>
  );
}

function GearTab({ trip, participants, onTripUpdate }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('group');
  const [assignedTo, setAssignedTo] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const gear = trip.gearItems || [];

  function resetForm() {
    setEditingId(null);
    setName('');
    setCategory('group');
    setAssignedTo('');
  }

  function startEdit(item) {
    setEditingId(item.id);
    setName(item.name || '');
    setCategory(normalizeGearCategory(item.category));
    setAssignedTo(item.assignedTo || '');
  }

  async function save() {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const who = participants.find((p) => p.id === assignedTo);
      const cat = normalizeGearCategory(category);
      const payload = {
        name: name.trim(),
        category: cat,
        assignedTo: assignedTo || null,
        assignedToLabel: who?.label || null,
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

  function reassign(item, value) {
    const who = participants.find((p) => p.id === value);
    updateGearItem(trip.id, item.id, { assignedTo: value || null, assignedToLabel: who?.label || null });
    onTripUpdate?.();
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
            <select
              value={item.assignedTo || ''}
              onChange={(e) => reassign(item, e.target.value)}
              onClick={(e) => e.stopPropagation()}
              style={{
                marginTop: 4,
                fontSize: 10.5,
                color: T.textSub,
                border: `1px solid ${T.border}`,
                borderRadius: 7,
                padding: '2px 5px',
                background: T.bg,
                fontFamily: F,
              }}
            >
              <option value="">Who brings it?</option>
              {participants.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          ) : (
            item.assignedToLabel && (
              <div style={{ fontSize: 10.5, color: T.textFaint, marginTop: 2 }}>
                {item.assignedToLabel}
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
               placeholder="Add gear (tent, stove, first-aid…)" style={inputStyle} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ ...selectStyle, width: '100%', flex: 'none' }}>
            {GEAR_CATEGORIES.map((c) => <option key={c} value={c}>{capitalize(c)}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 8 }}>
            <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} style={{ ...selectStyle, flex: 1, minWidth: 0 }}>
              <option value="">Unassigned</option>
              {participants.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <SaveButton onClick={() => void save()} busy={saving} label={editingId ? 'Update' : 'Save'} />
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

function MealsTab({ trip, participants, onTripUpdate }) {
  const [name, setName] = useState('');
  const [dayIndex, setDayIndex] = useState(1);
  const [slot, setSlot] = useState('dinner');
  const [assignedTo, setAssignedTo] = useState('');
  const [ingredients, setIngredients] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const meals = trip.meals || [];

  function resetForm() {
    setEditingId(null);
    setName('');
    setDayIndex(1);
    setSlot('dinner');
    setAssignedTo('');
    setIngredients('');
  }

  function startEdit(meal) {
    setEditingId(meal.id);
    setName(meal.name || '');
    setDayIndex(meal.dayIndex || 1);
    setSlot(meal.slot || 'dinner');
    setAssignedTo(meal.assignedTo || '');
    setIngredients((meal.ingredients || []).map((i) => i.name).join(', '));
  }

  async function save() {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const who = participants.find((p) => p.id === assignedTo);
      const ingList = ingredients.split(',').map((s) => s.trim()).filter(Boolean).map((n) => ({ name: n, qty: '' }));
      const payload = {
        name: name.trim(),
        dayIndex: Number(dayIndex) || 1,
        slot,
        assignedTo: assignedTo || null,
        assignedToLabel: who?.label || null,
        ingredients: ingList,
      };
      await savePlanningToCloud(trip.id, () => {
        if (editingId) {
          updateMeal(trip.id, editingId, payload);
        } else {
          addMeal(trip.id, payload);
        }
      });
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
    const visible = editingId ? meals.filter((m) => m.id !== editingId) : meals;
    const map = groupBy(visible, (m) => String(m.dayIndex || 1));
    return Object.entries(map).sort((a, b) => Number(a[0]) - Number(b[0]));
  }, [meals, editingId]);

  return (
    <div>
      <Composer title={editingId ? 'Edit meal' : 'Add meal'} onCancel={editingId ? resetForm : null}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Meal name (chili, oatmeal…)" style={inputStyle} />
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <select value={dayIndex} onChange={(e) => setDayIndex(e.target.value)} style={selectStyle}>
            {[1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>Day {d}</option>)}
          </select>
          <select value={slot} onChange={(e) => setSlot(e.target.value)} style={selectStyle}>
            {MEAL_SLOTS.map((s) => <option key={s} value={s}>{SLOT_LABEL[s]}</option>)}
          </select>
          <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} style={selectStyle}>
            <option value="">Cook?</option>
            {participants.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
        <input value={ingredients} onChange={(e) => setIngredients(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void save(); }}
               placeholder="Ingredients, comma separated" style={{ ...inputStyle, marginTop: 8 }} />
        <div style={{ marginTop: 8 }}><SaveButton onClick={() => void save()} busy={saving} wide label={editingId ? 'Update meal' : 'Save'} /></div>
      </Composer>

      {meals.length === 0 && <Empty text="Plan meals by day. Ingredients flow into the shopping list." />}

      {byDay.map(([day, dayMeals]) => (
        <div key={day} style={{ marginBottom: 14 }}>
          <SectionLabel>Day {day}</SectionLabel>
          {dayMeals.sort((a, b) => MEAL_SLOTS.indexOf(a.slot) - MEAL_SLOTS.indexOf(b.slot)).map((m) => (
            <div key={m.id} style={{ ...cardStyle, alignItems: 'flex-start', borderColor: editingId === m.id ? T.accent : T.border }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>
                  <span style={{ color: T.accent, fontSize: 10.5, fontWeight: 800 }}>{SLOT_LABEL[m.slot]} · </span>{m.name}
                </div>
                {m.assignedToLabel && <div style={{ fontSize: 10.5, color: T.textSub, marginTop: 2 }}>Cook: {m.assignedToLabel}</div>}
                {(m.ingredients || []).length > 0 && (
                  <div style={{ fontSize: 10.5, color: T.textFaint, marginTop: 3 }}>
                    {m.ingredients.map((i) => i.name).join(', ')}
                  </div>
                )}
              </div>
              <RowActions
                itemName={m.name}
                onEdit={() => startEdit(m)}
                onDelete={() => void removeItem(m)}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function ShoppingTab({ trip, onTripUpdate }) {
  const [name, setName] = useState('');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const items = trip.shoppingItems || [];

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
    return { toBuy: buy, purchased: got };
  }, [items, editingId]);

  const purchasedCount = purchased.length;

  function renderShoppingItem(item) {
    const done = Boolean(item.checked);
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
            {item.name}{item.qty ? ` · ${item.qty}` : ''}
          </div>
          {item.source === 'meal' && <div style={{ fontSize: 9.5, color: T.textFaint }}>from meals</div>}
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
          <SectionLabel>To buy</SectionLabel>
          {toBuy.map(renderShoppingItem)}
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
