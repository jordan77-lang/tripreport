// Ordered by when they typically happen in a day.
export const MEAL_SLOTS = ['breakfast', 'lunch', 'happy-hour', 'dinner', 'dessert', 'snack'];
export const SLOT_LABEL = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  'happy-hour': 'Happy hour',
  dinner: 'Dinner',
  dessert: 'Dessert',
  snack: 'Snack',
};

export const MAX_MEAL_DAYS = 14;

function dateMs(key) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(key || '')) return null;
  const ms = Date.parse(`${String(key).slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

/** Number of trip days from the start/end dates; falls back to a default when dates are missing. */
export function tripDayCount(trip) {
  const start = dateMs(trip?.startDate);
  const end = dateMs(trip?.endDate);
  if (start == null || end == null || end < start) return MAX_MEAL_DAYS;
  return Math.min(366, Math.round((end - start) / 86400000) + 1);
}

/** "Day 2 · Fri, Jun 6" when the trip has a start date, otherwise "Day 2". */
export function mealDayOptionLabel(trip, day) {
  const start = dateMs(trip?.startDate);
  if (start == null) return `Day ${day}`;
  const date = new Date(start + (day - 1) * 86400000)
    .toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `Day ${day} · ${date}`;
}

export function mealSlotLabel(slot) {
  return SLOT_LABEL[slot] || 'Meal';
}

export function mealSlotOrder(slot) {
  const index = MEAL_SLOTS.indexOf(slot);
  return index === -1 ? MEAL_SLOTS.length : index;
}

export function mealStartDay(meal) {
  return Math.max(1, Number(meal?.dayIndex) || 1);
}

/** Last day a meal covers; a single-day meal ends on its start day. */
export function mealEndDay(meal) {
  const start = mealStartDay(meal);
  const end = Number(meal?.endDayIndex);
  return Number.isFinite(end) && end > start ? Math.floor(end) : start;
}

export function mealDaysLabel(meal) {
  const start = mealStartDay(meal);
  const end = mealEndDay(meal);
  return end > start ? `Days ${start}–${end}` : `Day ${start}`;
}

export function mealCoversDay(meal, day) {
  return day >= mealStartDay(meal) && day <= mealEndDay(meal);
}
