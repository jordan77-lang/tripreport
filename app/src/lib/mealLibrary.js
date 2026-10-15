const LIBRARY_KEY = 'tr_meal_library';
const INGREDIENTS_KEY = 'tr_ingredient_library';

export function mealNameKey(name) {
  return String(name || '').trim().toLowerCase();
}

function ingredientKey(name) {
  return String(name || '').trim().toLowerCase();
}

export function cleanIngredients(list) {
  const seen = new Set();
  const out = [];
  for (const item of list || []) {
    const name = String(item?.name || item || '').trim();
    const key = ingredientKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ name, qty: String(item?.qty || '').trim() });
  }
  return out;
}

function readLibrary() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LIBRARY_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLibrary(meals) {
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(meals));
}

function readIngredientNames() {
  try {
    const parsed = JSON.parse(localStorage.getItem(INGREDIENTS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.map((name) => String(name || '').trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function rememberIngredientNames(names) {
  const seen = new Set(readIngredientNames().map(ingredientKey));
  const next = readIngredientNames();
  for (const name of names || []) {
    const trimmed = String(name || '').trim();
    const key = ingredientKey(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    next.push(trimmed);
  }
  localStorage.setItem(INGREDIENTS_KEY, JSON.stringify(next));
  return next;
}

function unionIngredients(current, incoming) {
  return cleanIngredients([...(current || []), ...(incoming || [])]);
}

/** Fold a shared meal into the local catalog without dropping ingredients already saved. */
export function applySharedMeal(meal) {
  const name = String(meal?.name || '').trim();
  const key = mealNameKey(name);
  if (!key) return null;
  const existing = readLibrary().find((item) => (item.nameKey || mealNameKey(item.name)) === key);
  const ingredients = unionIngredients(existing?.ingredients, meal?.ingredients);
  rememberIngredientNames(ingredients.map((item) => item.name));
  return rememberMeal({
    name,
    slot: meal?.slot || existing?.slot || 'dinner',
    ingredients,
  });
}

async function cloudClient() {
  try {
    const mod = await import('./supabase.js');
    if (!mod.supabaseConfigured || !mod.supabase) return null;
    const { getSignedInUserId } = await import('./authUser.js');
    if (!getSignedInUserId()) return null;
    return mod.supabase;
  } catch {
    return null;
  }
}

/** Save this meal for every signed-in user. Local choices stay if the cloud is unreachable. */
export async function publishSavedMeal(meal) {
  const client = await cloudClient();
  if (!client) return null;
  const ingredients = cleanIngredients(meal?.ingredients);
  const { data, error } = await client.rpc('upsert_saved_meal', {
    p_name: String(meal?.name || '').trim(),
    p_slot: meal?.slot || 'dinner',
    p_ingredients: ingredients,
  });
  if (error || !data) return null;
  applySharedMeal({
    name: data.name,
    slot: data.slot,
    ingredients: data.ingredients,
  });
  return data;
}

/** Pull the shared catalog onto this phone. */
export async function refreshSharedMeals() {
  const client = await cloudClient();
  if (!client) return listSavedMeals();
  const [mealsResult, ingredientsResult] = await Promise.all([
    client.from('saved_meals').select('name,name_key,slot,ingredients,updated_at'),
    client.from('saved_ingredients').select('name,name_key'),
  ]);
  if (!mealsResult.error) {
    for (const row of mealsResult.data || []) applySharedMeal(row);
  }
  if (!ingredientsResult.error) {
    rememberIngredientNames((ingredientsResult.data || []).map((row) => row.name));
  }
  return listSavedMeals();
}

/** Remember a meal and its ingredients on this phone, across trips. */
export function rememberMeal(meal, { keepIngredientsIfEmpty = false } = {}) {
  const name = String(meal?.name || '').trim();
  const key = mealNameKey(name);
  if (!key) return null;
  const library = readLibrary();
  const idx = library.findIndex((item) => (item.nameKey || mealNameKey(item.name)) === key);
  const previous = idx >= 0 ? library[idx] : null;
  const cleaned = cleanIngredients(meal?.ingredients);
  const ingredients = cleaned.length || !keepIngredientsIfEmpty
    ? cleaned
    : cleanIngredients(previous?.ingredients);
  const next = {
    id: previous?.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `meal-${Date.now()}`),
    name,
    nameKey: key,
    slot: meal?.slot || previous?.slot || 'dinner',
    ingredients,
    updatedAt: Date.now(),
  };
  if (idx >= 0) library[idx] = next;
  else library.unshift(next);
  writeLibrary(library);
  rememberIngredientNames(next.ingredients.map((item) => item.name));
  return next;
}

function mealsFromTrips(trips) {
  const byKey = new Map();
  for (const trip of trips || []) {
    for (const meal of trip?.meals || []) {
      const name = String(meal?.name || '').trim();
      const key = mealNameKey(name);
      if (!key || key === 'untitled meal') continue;
      const ingredients = cleanIngredients(meal.ingredients);
      const updatedAt = meal.updatedAt || meal.createdAt || 0;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, { name, nameKey: key, slot: meal.slot || 'dinner', ingredients, updatedAt });
        continue;
      }
      const newer = updatedAt >= (existing.updatedAt || 0);
      byKey.set(key, {
        name: newer ? name : existing.name,
        nameKey: key,
        slot: newer && meal.slot ? meal.slot : existing.slot,
        ingredients: ingredients.length && (newer || !existing.ingredients.length) ? ingredients : existing.ingredients,
        updatedAt: Math.max(updatedAt, existing.updatedAt || 0),
      });
    }
  }
  return [...byKey.values()];
}

/** Saved meals plus meals already on any trip on this phone. */
export function listSavedMeals(trips = []) {
  const byKey = new Map();
  for (const meal of [...readLibrary(), ...mealsFromTrips(trips)]) {
    const key = meal.nameKey || mealNameKey(meal.name);
    if (!key) continue;
    const ingredients = cleanIngredients(meal.ingredients);
    const existing = byKey.get(key);
    if (!existing || (meal.updatedAt || 0) >= (existing.updatedAt || 0)) {
      byKey.set(key, {
        ...meal,
        name: String(meal.name || '').trim(),
        nameKey: key,
        ingredients: ingredients.length ? ingredients : (existing?.ingredients || []),
      });
    } else if (!existing.ingredients.length && ingredients.length) {
      byKey.set(key, { ...existing, ingredients });
    }
  }
  return [...byKey.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0) || a.name.localeCompare(b.name));
}

export function listSavedIngredients(trips = []) {
  const seen = new Set();
  const names = [];
  const sources = [
    ...listSavedMeals(trips).flatMap((meal) => (meal.ingredients || []).map((item) => item.name)),
    ...readIngredientNames(),
  ];
  for (const name of sources) {
    const key = ingredientKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    names.push(String(name).trim());
  }
  return names.sort((a, b) => a.localeCompare(b));
}

export function savedMealByName(name, trips = []) {
  const key = mealNameKey(name);
  if (!key) return null;
  return listSavedMeals(trips).find((meal) => meal.nameKey === key) || null;
}
