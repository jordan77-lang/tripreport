const LIBRARY_KEY = 'tr_meal_library';
const INGREDIENTS_KEY = 'tr_ingredient_library';
const DELETED_MEALS_KEY = 'tr_deleted_saved_meals';

export const INGREDIENT_CATEGORIES = [
  { id: 'produce', label: 'Produce & Fresh', shortLabel: 'Produce', icon: '🥬' },
  { id: 'cooler', label: 'Meat, Dairy & Cooler', shortLabel: 'Cooler', icon: '🧀' },
  { id: 'pantry', label: 'Pantry & Dry Goods', shortLabel: 'Pantry', icon: '🥫' },
  { id: 'spices', label: 'Spices & Condiments', shortLabel: 'Spices', icon: '🧂' },
  { id: 'other', label: 'Other Items', shortLabel: 'Other', icon: '🧺' },
];

const CATEGORY_KEYWORDS = {
  spices: [
    'salt', 'pepper', 'chili powder', 'cumin', 'paprika', 'garlic powder', 'onion powder',
    'oregano', 'basil', 'thyme', 'rosemary', 'cinnamon', 'nutmeg', 'cayenne', 'curry',
    'taco seasoning', 'seasoning', 'spice', 'hot sauce', 'sriracha', 'tabasco', 'soy sauce',
    'ketchup', 'mustard', 'mayo', 'mayonnaise', 'relish', 'vinegar', 'syrup', 'maple syrup',
    'honey', 'sugar', 'brown sugar', 'vanilla', 'dress', 'dressing',
  ],
  cooler: [
    'beef', 'steak', 'ground beef', 'burger', 'chicken', 'pork', 'sausage', 'chorizo',
    'bacon', 'ham', 'turkey', 'brats', 'bratwurst', 'hot dog', 'fish', 'salmon', 'trout',
    'shrimp', 'tofu', 'tempeh', 'egg', 'eggs', 'cheese', 'cheddar', 'mozzarella', 'parmesan',
    'feta', 'cotija', 'queso', 'butter', 'milk', 'cream', 'half and half', 'sour cream',
    'yogurt', 'cream cheese', 'guacamole', 'hummus',
  ],
  produce: [
    'onion', 'garlic', 'Shallot', 'scallion', 'green onion', 'bell pepper', 'jalapeno',
    'poblano', 'habanero', 'serrano', 'tomato', 'tomatoes', 'avocado', 'lime', 'lemon',
    'orange', 'apple', 'banana', 'berry', 'berries', 'strawberry', 'blueberry', 'cilantro',
    'parsley', 'lettuce', 'spinach', 'kale', 'arugula', 'cabbage', 'slaw', 'potato',
    'sweet potato', 'carrot', 'celery', 'cucumber', 'zucchini', 'squash', 'mushroom',
    'corn', 'broccoli', 'cauliflower', 'asparagus', 'green bean', 'fruit', 'salad', 'greens',
  ],
  pantry: [
    'bean', 'beans', 'black beans', 'pinto beans', 'kidney beans', 'chickpea', 'lentil',
    'rice', 'quinoa', 'couscous', 'pasta', 'spaghetti', 'macaroni', 'penne', 'lasagna',
    'noodle', 'ramen', 'oat', 'oats', 'oatmeal', 'granola', 'cereal', 'grits', 'polenta',
    'tortilla', 'bread', 'bun', 'bagel', 'english muffin', 'pita', 'naan', 'cracker',
    'pancake', 'waffle', 'bisquick', 'flour', 'cornmeal', 'chip', 'chips', 'tortilla chips',
    'salsa', 'marinara', 'pasta sauce', 'enchilada sauce', 'tomato paste', 'tomato sauce',
    'diced tomatoes', 'crushed tomatoes', 'soup', 'broth', 'stock', 'oil', 'olive oil',
    'coconut milk', 'peanut butter', 'almond butter', 'jelly', 'jam', 'nut', 'almonds',
    'peanuts', 'walnuts', 'pecans', 'raisins', 'dried fruit', 'trail mix', 'chocolate',
    'cocoa', 'coffee', 'tea',
  ],
};

export function classifyIngredientCategory(name) {
  const lower = String(name || '').trim().toLowerCase();
  if (!lower) return 'other';
  for (const [cat, words] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const word of words) {
      if (lower === word || lower.includes(word)) {
        return cat;
      }
    }
  }
  return 'other';
}

export function getIngredientCategoryMeta(categoryId) {
  return INGREDIENT_CATEGORIES.find((c) => c.id === categoryId) || INGREDIENT_CATEGORIES[INGREDIENT_CATEGORIES.length - 1];
}

export function sortIngredients(list, mode = 'category') {
  const items = Array.isArray(list) ? [...list] : [];
  const getName = (item) => String(typeof item === 'string' ? item : item?.name || '').trim();
  const catOrder = new Map(INGREDIENT_CATEGORIES.map((c, idx) => [c.id, idx]));

  if (mode === 'alpha') {
    return items.sort((a, b) => getName(a).localeCompare(getName(b)));
  }
  if (mode === 'category') {
    return items.sort((a, b) => {
      const catA = catOrder.get(classifyIngredientCategory(getName(a))) ?? 99;
      const catB = catOrder.get(classifyIngredientCategory(getName(b))) ?? 99;
      if (catA !== catB) return catA - catB;
      return getName(a).localeCompare(getName(b));
    });
  }
  return items;
}

export function groupIngredientsByCategory(list) {
  const groups = new Map(INGREDIENT_CATEGORIES.map((c) => [c.id, []]));
  for (const item of sortIngredients(list, 'category')) {
    const name = typeof item === 'string' ? item : item?.name;
    const cat = classifyIngredientCategory(name);
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(item);
  }
  return INGREDIENT_CATEGORIES
    .map((meta) => ({ ...meta, items: groups.get(meta.id) || [] }))
    .filter((group) => group.items.length > 0);
}

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

function readDeletedMeals() {
  try {
    const parsed = JSON.parse(localStorage.getItem(DELETED_MEALS_KEY) || '[]');
    return new Set(Array.isArray(parsed) ? parsed.map(mealNameKey).filter(Boolean) : []);
  } catch {
    return new Set();
  }
}

function writeDeletedMeals(set) {
  localStorage.setItem(DELETED_MEALS_KEY, JSON.stringify([...set]));
}

/** Remember a meal and its ingredients on this phone, across trips. */
export function rememberMeal(meal, { keepIngredientsIfEmpty = false } = {}) {
  const name = String(meal?.name || '').trim();
  const key = mealNameKey(name);
  if (!key) return null;
  const deleted = readDeletedMeals();
  if (deleted.has(key)) {
    deleted.delete(key);
    writeDeletedMeals(deleted);
  }
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

/** Edit an existing saved meal (including renaming it, changing its default slot, or updating ingredients). */
export function updateSavedMeal(originalNameOrKey, patch = {}) {
  const origKey = mealNameKey(originalNameOrKey);
  if (!origKey) return null;
  const library = readLibrary();
  const idx = library.findIndex((item) => (item.nameKey || mealNameKey(item.name)) === origKey);
  const existing = idx >= 0 ? library[idx] : null;
  const nextName = String(patch.name ?? existing?.name ?? originalNameOrKey).trim();
  const nextKey = mealNameKey(nextName);
  if (!nextKey) return null;

  if (nextKey !== origKey) {
    const filtered = library.filter((item) => (item.nameKey || mealNameKey(item.name)) !== origKey);
    writeLibrary(filtered);
    const deleted = readDeletedMeals();
    deleted.add(origKey);
    deleted.delete(nextKey);
    writeDeletedMeals(deleted);
  }

  return rememberMeal({
    name: nextName,
    slot: patch.slot || existing?.slot || 'dinner',
    ingredients: patch.ingredients !== undefined ? patch.ingredients : (existing?.ingredients || []),
  });
}

/** Remove a saved meal from the catalog. */
export function removeSavedMeal(nameOrKey) {
  const key = mealNameKey(nameOrKey);
  if (!key) return false;
  const library = readLibrary().filter((item) => (item.nameKey || mealNameKey(item.name)) !== key);
  writeLibrary(library);
  const deleted = readDeletedMeals();
  deleted.add(key);
  writeDeletedMeals(deleted);
  return true;
}

/** Remove an ingredient from the saved ingredient list. */
export function removeSavedIngredient(name) {
  const key = ingredientKey(name);
  if (!key) return false;
  const next = readIngredientNames().filter((n) => ingredientKey(n) !== key);
  localStorage.setItem(INGREDIENTS_KEY, JSON.stringify(next));
  return true;
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
  const deleted = readDeletedMeals();
  const byKey = new Map();
  for (const meal of [...readLibrary(), ...mealsFromTrips(trips)]) {
    const key = meal.nameKey || mealNameKey(meal.name);
    if (!key || deleted.has(key)) continue;
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
