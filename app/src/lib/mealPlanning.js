import { DAILY_MEAL_SLOTS, mealCoversDay, mealEndDay, mealStartDay, tripDayCount, normalizeMealSlot, sameMealSlot } from './mealSlots';

// Period settings travel through the existing meals change history, separately from recipes.
export const mealPeriodId = (day, slot) => `meal-period:${day}:${normalizeMealSlot(slot)}`;
export const isMealPeriod = (meal) => meal?.kind === 'meal-period';
export const mealItems = (trip) => (trip?.meals || []).filter((meal) => !meal.kind || meal.kind === 'dish');
export const mealTeams = (trip) => (trip?.meals || []).filter(m => m.kind === 'meal-team');
export const mealComments = (trip, mealId) => (trip?.meals || []).filter(m => m.kind === 'meal-comment' && m.mealId === mealId).sort((a,b) => a.createdAt - b.createdAt);
export const mealReminders = (trip, userId, now = Date.now()) => (trip?.meals || []).filter(m => m.kind === 'meal-reminder' && m.userId === userId && !m.dismissedAt && m.remindAt <= now && mealItems(trip).some(meal => meal.id === m.mealId && activeMealDays(trip,meal).length));
export const mealPeriodKey = (period) => `${period.day}:${normalizeMealSlot(period.slot)}`;
export function mealDraftChanges(initial, draft, scope = 'all') {
  return Object.fromEntries(Object.entries(draft).filter(([field,value]) => !(scope === 'day' && ['dayIndex','endDayIndex'].includes(field)) && JSON.stringify(value) !== JSON.stringify(initial[field])));
}
export const mealCooks = (meal) => [...new Set([meal.assignedTo, ...(meal.coCooks || [])].filter(Boolean))];
export function mealPeriod(trip, day, slot) {
  const periods = (trip?.meals || []).filter(m => isMealPeriod(m) && m.dayIndex === day);
  return periods.find(m => m.slot === normalizeMealSlot(slot)) || periods.find(m => sameMealSlot(m.slot, slot));
}
export function activeMealDays(trip, meal) {
  const days = [];
  for (let day = mealStartDay(meal); day <= Math.min(366, mealEndDay(meal)); day++) {
    if (mealCoversDay(meal, day) && mealPeriod(trip, day, meal.slot)?.mode !== 'on-your-own') days.push(day);
  }
  return days;
}
export function buildMealSchedule(trip) {
  const items = mealItems(trip);
  const lastDay = Math.min(366, Math.max(tripDayCount(trip), ...(trip?.meals || []).map(mealEndDay)));
  const result = [];
  for (let day = 1; day <= lastDay; day++) {
    for (const slot of DAILY_MEAL_SLOTS) {
      const meals = items.filter(m => sameMealSlot(m.slot, slot) && mealCoversDay(m, day));
      const settings = mealPeriod(trip, day, slot);
      const status = settings?.mode === 'on-your-own' ? 'on-your-own'
        : meals.length && meals.every(m => mealCooks(m).length) ? 'claimed' : 'open';
      result.push({ day, slot, meals, settings, status });
    }
  }
  return result;
}

export function mealWindowChanges(trip, first, last) {
  const schedule = buildMealSchedule(trip).filter(p => DAILY_MEAL_SLOTS.includes(p.slot));
  const firstIndex = schedule.findIndex(p => p.day === Number(first.day) && sameMealSlot(p.slot, first.slot));
  const lastIndex = schedule.findIndex(p => p.day === Number(last.day) && sameMealSlot(p.slot, last.slot));
  if (firstIndex < 0 || lastIndex < firstIndex) throw new Error('Choose a last shared meal after the first shared meal.');
  return schedule.flatMap((period, index) => {
    const outside = index < firstIndex || index > lastIndex;
    if (outside) return [{ day: period.day, slot: period.slot, mode: 'on-your-own', reason: '', windowManaged: true }];
    return period.settings?.windowManaged ? [{ day: period.day, slot: period.slot, mode: 'shared', reason: '', windowManaged: false }] : [];
  });
}

function scaledQuantity(raw, multiplier) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const match = text.match(/^(\d+(?:\.\d+)?|\.\d+)(?:\s*\/\s*(\d+))?\s*(.*)$/);
  if (!match) return { text: multiplier > 1 ? `${text} × ${multiplier}` : text };
  const amount = Number(match[1]) / (match[2] ? Number(match[2]) : 1);
  if (!Number.isFinite(amount)) return { text };
  return { amount: amount * multiplier, unit: match[3].trim() };
}
export function mealShoppingItems(trip) {
  const grouped = new Map();
  for (const meal of mealItems(trip)) {
    const days = activeMealDays(trip, meal);
    if (!days.length) continue;
    const multiplier = meal.quantityMode === 'daily' ? days.length : 1;
    for (const ingredient of meal.ingredients || []) {
      const name = String(ingredient.name || '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (!grouped.has(key)) grouped.set(key, { name, sourceMealIds: [], quantities: [], missingQuantity: false });
      const row = grouped.get(key);
      if (!row.sourceMealIds.includes(meal.id)) row.sourceMealIds.push(meal.id);
      const qty = scaledQuantity(ingredient.qty, multiplier);
      if (qty) row.quantities.push(qty);
      else row.missingQuantity = true;
    }
  }
  return [...grouped.values()].map(({ quantities, ...row }) => {
    const units = new Map(), descriptions = [];
    for (const qty of quantities) {
      if (qty.text) descriptions.push(qty.text);
      else {
        const key = qty.unit.toLowerCase();
        const previous = units.get(key) || { amount: 0, unit: qty.unit };
        units.set(key, { ...previous, amount: previous.amount + qty.amount });
      }
    }
    for (const { amount, unit } of units.values()) descriptions.push(`${Number(amount.toFixed(3))}${unit ? ` ${unit}` : ''}`);
    if (row.missingQuantity && descriptions.length) descriptions.push('plus quantity to confirm');
    return { ...row, qty: descriptions.join(' + ') };
  });
}

export function mealShoppingChanges(trip) {
  const planned = mealShoppingItems(trip);
  const items = trip.shoppingItems || [];
  const changes = [], protectedItems = [];
  for (const row of planned) {
    const existing = items.find(item => item.name.trim().toLowerCase() === row.name.toLowerCase());
    if (!existing) changes.push({ type: 'add', row });
    else if (existing.source !== 'meal' || existing.checked || existing.manuallyEdited) {
      if (existing.qty !== row.qty) protectedItems.push({ id: existing.id, name: row.name, currentQty: existing.qty, plannedQty: row.qty });
    } else if (existing.qty !== row.qty || JSON.stringify([...(existing.sourceMealIds || [])].sort()) !== JSON.stringify([...row.sourceMealIds].sort())) {
      changes.push({ type: 'update', id: existing.id, previousQty: existing.qty, row });
    }
  }
  const keys = new Set(planned.map(row => row.name.toLowerCase()));
  for (const item of items) {
    if (item.source === 'meal' && !item.checked && !item.manuallyEdited && !keys.has(item.name.trim().toLowerCase())) changes.push({ type: 'remove', id: item.id, row: item });
  }
  return { changes, protectedItems, revision: JSON.stringify({ changes, protectedItems }) };
}
