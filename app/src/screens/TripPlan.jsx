import { useMemo, useState } from 'react';
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
  addGearItem, updateGearItem, removeGearItem,
  addMeal, updateMeal, removeMeal,
  addShoppingItem, updateShoppingItem, removeShoppingItem,
  generateShoppingList,
} from '../lib/storage';
import { TripExpenses } from '../components/TripExpenses';
import { OfflineMapsPanel } from '../components/OfflineMapsPanel';
import { useTripMembersSync } from '../hooks/useTripMembersSync';
import { buildTripParticipants } from '../lib/expenses';

const TABS = [
  { id: 'gear', label: 'Gear' },
  { id: 'meals', label: 'Meals' },
  { id: 'shopping', label: 'Shopping' },
  { id: 'expenses', label: 'Expenses' },
  { id: 'maps', label: 'Maps' },
];

const GEAR_CATEGORIES = ['group', 'shelter', 'cooking', 'safety', 'personal'];
const GEAR_STATUS = ['needed', 'claimed', 'packed'];
const GEAR_STATUS_STYLE = {
  needed: { bg: '#FBF0E4', color: '#8A5526', label: 'Needed' },
  claimed: { bg: '#E4EFF8', color: '#2A5C8E', label: 'Claimed' },
  packed: { bg: '#EBF5EB', color: '#2A6A14', label: 'Packed' },
};
const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];
const SLOT_LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };

export function TripPlan({ trip, onNav, onFab, onBack, onTripUpdate }) {
  const [tab, setTab] = useState('gear');
  const [editingTrip, setEditingTrip] = useState(false);
  const [tripDraft, setTripDraft] = useState(() => buildTripDraft(trip));
  const currentUserId = getCurrentUserId();
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

  function openTripEdit() {
    setTripDraft(buildTripDraft(trip));
    setEditingTrip(true);
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
            <button
              type="button"
              onClick={openTripEdit}
              style={{
                marginTop: 4,
                border: 'none',
                background: 'none',
                padding: 0,
                fontSize: ts(13),
                color: T.accent,
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: F,
              }}
            >
              {formatTripDateRange(trip.startDate, trip.endDate)} · Edit trip details
            </button>
          </div>
          <button
            type="button"
            onClick={openTripEdit}
            aria-label="Edit trip details"
            style={{
              height: 36,
              padding: '0 12px',
              borderRadius: 9,
              border: `1px solid ${T.border}`,
              background: editingTrip ? '#E4EFF8' : T.bg,
              fontSize: ts(13),
              fontWeight: 700,
              color: '#2A5C8E',
              cursor: 'pointer',
              fontFamily: F,
              flexShrink: 0,
            }}
          >
            Edit trip details
          </button>
          <SyncChip state={tripSyncState} compact />
        </div>
        <div style={{ display: 'flex', gap: 2 }}>
          {TABS.map((tb) => (
            <div key={tb.id} onClick={() => setTab(tb.id)}
                 style={{ flex: 1, textAlign: 'center', padding: '10px 4px', cursor: 'pointer',
                          fontSize: 12, fontWeight: 700,
                          color: tab === tb.id ? T.accent : T.textFaint,
                          borderBottom: `2px solid ${tab === tb.id ? T.accent : 'transparent'}` }}>
              {tb.label}
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
        {editingTrip && (
          <TripEditPanel
            trip={trip}
            draft={tripDraft}
            onCancel={() => setEditingTrip(false)}
            onSaved={() => {
              setEditingTrip(false);
              onTripUpdate?.();
            }}
            onDraftChange={setTripDraft}
          />
        )}
        {!editingTrip && tab === 'gear' && <GearTab trip={trip} participants={participants} onTripUpdate={onTripUpdate} />}
        {!editingTrip && tab === 'meals' && <MealsTab trip={trip} participants={participants} onTripUpdate={onTripUpdate} />}
        {!editingTrip && tab === 'shopping' && <ShoppingTab trip={trip} onTripUpdate={onTripUpdate} />}
        {!editingTrip && tab === 'expenses' && (
          <TripExpenses trip={trip} onTripUpdate={onTripUpdate} scope="all" showTitle layout="full" />
        )}
        {!editingTrip && tab === 'maps' && <OfflineMapsPanel trip={trip} onTripUpdate={onTripUpdate} />}
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
  const [saving, setSaving] = useState(false);
  const gear = trip.gearItems || [];

  async function save() {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const who = participants.find((p) => p.id === assignedTo);
      await savePlanningToCloud(trip.id, () => {
        addGearItem(trip.id, {
          name,
          category,
          assignedTo: assignedTo || null,
          assignedToLabel: who?.label || null,
          shared: category !== 'personal',
        });
      });
      setName('');
      setAssignedTo('');
      onTripUpdate?.();
    } finally {
      setSaving(false);
    }
  }

  function cycleStatus(item) {
    const next = GEAR_STATUS[(GEAR_STATUS.indexOf(item.status) + 1) % GEAR_STATUS.length];
    updateGearItem(trip.id, item.id, { status: next });
    onTripUpdate?.();
  }

  function reassign(item, value) {
    const who = participants.find((p) => p.id === value);
    updateGearItem(trip.id, item.id, { assignedTo: value || null, assignedToLabel: who?.label || null });
    onTripUpdate?.();
  }

  const grouped = useMemo(() => groupBy(gear, (g) => g.category), [gear]);

  return (
    <div>
      <Composer>
        <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void save(); }}
               placeholder="Add gear (tent, stove, first-aid…)" style={inputStyle} />
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <select value={category} onChange={(e) => setCategory(e.target.value)} style={selectStyle}>
            {GEAR_CATEGORIES.map((c) => <option key={c} value={c}>{capitalize(c)}</option>)}
          </select>
          <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} style={selectStyle}>
            <option value="">Unassigned</option>
            {participants.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <SaveButton onClick={() => void save()} busy={saving} />
        </div>
      </Composer>

      {gear.length === 0 && <Empty text="No gear yet. Add shared and personal items, then assign who brings what." />}

      {Object.entries(grouped).map(([cat, items]) => (
        <div key={cat} style={{ marginBottom: 14 }}>
          <SectionLabel>{capitalize(cat)}</SectionLabel>
          {items.map((item) => {
            const st = GEAR_STATUS_STYLE[item.status] || GEAR_STATUS_STYLE.needed;
            return (
              <div key={item.id} style={cardStyle}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{item.name}</div>
                  <select value={item.assignedTo || ''} onChange={(e) => reassign(item, e.target.value)}
                          style={{ marginTop: 4, fontSize: 10.5, color: T.textSub, border: `1px solid ${T.border}`, borderRadius: 7, padding: '2px 5px', background: T.bg, fontFamily: F }}>
                    <option value="">Unassigned</option>
                    {participants.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                </div>
                <div onClick={() => cycleStatus(item)}
                     style={{ flexShrink: 0, background: st.bg, color: st.color, borderRadius: 8, padding: '4px 9px', fontSize: 10, fontWeight: 800, cursor: 'pointer' }}>
                  {st.label}
                </div>
                <DeleteX onClick={() => { removeGearItem(trip.id, item.id); onTripUpdate?.(); }} />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function MealsTab({ trip, participants, onTripUpdate }) {
  const [name, setName] = useState('');
  const [dayIndex, setDayIndex] = useState(1);
  const [slot, setSlot] = useState('dinner');
  const [assignedTo, setAssignedTo] = useState('');
  const [ingredients, setIngredients] = useState('');
  const [saving, setSaving] = useState(false);
  const meals = trip.meals || [];

  async function save() {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const who = participants.find((p) => p.id === assignedTo);
      const ingList = ingredients.split(',').map((s) => s.trim()).filter(Boolean).map((n) => ({ name: n, qty: '' }));
      await savePlanningToCloud(trip.id, () => {
        addMeal(trip.id, {
          name, dayIndex: Number(dayIndex) || 1, slot,
          assignedTo: assignedTo || null, assignedToLabel: who?.label || null,
          ingredients: ingList,
        });
      });
      setName('');
      setIngredients('');
      setAssignedTo('');
      onTripUpdate?.();
    } finally {
      setSaving(false);
    }
  }

  const byDay = useMemo(() => {
    const map = groupBy(meals, (m) => String(m.dayIndex || 1));
    return Object.entries(map).sort((a, b) => Number(a[0]) - Number(b[0]));
  }, [meals]);

  return (
    <div>
      <Composer>
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
        <div style={{ marginTop: 8 }}><SaveButton onClick={() => void save()} busy={saving} wide /></div>
      </Composer>

      {meals.length === 0 && <Empty text="Plan meals by day. Ingredients flow into the shopping list." />}

      {byDay.map(([day, dayMeals]) => (
        <div key={day} style={{ marginBottom: 14 }}>
          <SectionLabel>Day {day}</SectionLabel>
          {dayMeals.sort((a, b) => MEAL_SLOTS.indexOf(a.slot) - MEAL_SLOTS.indexOf(b.slot)).map((m) => (
            <div key={m.id} style={{ ...cardStyle, alignItems: 'flex-start' }}>
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
              <DeleteX onClick={() => { removeMeal(trip.id, m.id); onTripUpdate?.(); }} />
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
  const [saving, setSaving] = useState(false);
  const items = trip.shoppingItems || [];

  async function save() {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      await savePlanningToCloud(trip.id, () => {
        addShoppingItem(trip.id, { name, qty });
      });
      setName('');
      setQty('');
      onTripUpdate?.();
    } finally {
      setSaving(false);
    }
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

  function toggle(item) {
    updateShoppingItem(trip.id, item.id, { checked: !item.checked });
    onTripUpdate?.();
  }

  const remaining = items.filter((i) => !i.checked).length;

  return (
    <div>
      <Composer>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void save(); }}
                 placeholder="Add item" style={inputStyle} />
          <input value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Qty" style={{ ...inputStyle, maxWidth: 70 }} />
          <SaveButton onClick={() => void save()} busy={saving} />
        </div>
        <div onClick={() => { if (!saving) void generate(); }}
             style={{ marginTop: 8, height: 36, borderRadius: 10, border: `1px dashed ${T.accent}80`, background: T.accentLight,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                      fontSize: 11.5, fontWeight: 700, color: T.accent, gap: 6 }}>
          <Ic d={ICONS.plus} size={14} color={T.accent} sw={2.2} /> Generate from meal ingredients
        </div>
        {note && <div style={{ fontSize: 10.5, color: T.textSub, marginTop: 6 }}>{note}</div>}
      </Composer>

      {items.length === 0 && <Empty text="Build a shared shopping list. Generate from meals or add items by hand." />}

      {items.length > 0 && (
        <div style={{ fontSize: 10.5, color: T.textFaint, marginBottom: 8 }}>{remaining} of {items.length} remaining</div>
      )}

      {items.map((item) => (
        <div key={item.id} style={cardStyle}>
          <div onClick={() => toggle(item)} style={{ width: 20, height: 20, borderRadius: 6, flexShrink: 0, cursor: 'pointer',
                       border: `2px solid ${item.checked ? T.accent : T.border}`, background: item.checked ? T.accent : 'transparent',
                       display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {item.checked && <Ic d="M20 6L9 17l-5-5" size={12} color="white" sw={3} />}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: item.checked ? T.textFaint : T.text, textDecoration: item.checked ? 'line-through' : 'none' }}>
              {item.name}{item.qty ? ` · ${item.qty}` : ''}
            </div>
            {item.source === 'meal' && <div style={{ fontSize: 9.5, color: T.textFaint }}>from meals</div>}
          </div>
          <DeleteX onClick={() => { removeShoppingItem(trip.id, item.id); onTripUpdate?.(); }} />
        </div>
      ))}
    </div>
  );
}

// ── Shared UI bits ──

function Composer({ children }) {
  return <div style={{ background: T.card, borderRadius: 14, padding: '12px 14px', border: `1px solid ${T.border}`, marginBottom: 16 }}>{children}</div>;
}

function SectionLabel({ children }) {
  return <div style={{ fontSize: 10.5, fontWeight: 700, color: T.textSub, letterSpacing: .7, textTransform: 'uppercase', marginBottom: 8 }}>{children}</div>;
}

function SaveButton({ onClick, busy = false, wide = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label="Save"
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
      {busy ? 'Saving…' : 'Save'}
    </button>
  );
}

function DeleteX({ onClick }) {
  return <div onClick={onClick} style={{ flexShrink: 0, color: T.textFaint, cursor: 'pointer', fontSize: 14, padding: '0 2px' }}>✕</div>;
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
