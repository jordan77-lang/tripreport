import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, value),
  removeItem: (key) => store.delete(key),
};

const {
  rememberMeal,
  listSavedMeals,
  listSavedIngredients,
  savedMealByName,
  applySharedMeal,
  classifyIngredientCategory,
  sortIngredients,
  groupIngredientsByCategory,
  updateSavedMeal,
  removeSavedMeal,
} = await import('../src/lib/mealLibrary.js');

test('a saved meal keeps its ingredients for the next trip', () => {
  store.clear();
  rememberMeal({
    name: 'Chili',
    slot: 'dinner',
    ingredients: [{ name: 'Beans' }, { name: 'Chili powder' }, { name: 'beans' }],
  });
  const again = savedMealByName('chili', []);
  assert.equal(again.name, 'Chili');
  assert.deepEqual(again.ingredients.map((item) => item.name), ['Beans', 'Chili powder']);

  const otherTrip = listSavedMeals([{ id: 'new', meals: [] }]);
  assert.equal(otherTrip[0].name, 'Chili');
  assert.ok(listSavedIngredients([]).includes('Chili powder'));
});

test('meals already on a trip show up before they are saved again', () => {
  store.clear();
  const saved = listSavedMeals([{
    meals: [{ name: 'Oatmeal', slot: 'breakfast', ingredients: [{ name: 'Oats' }, { name: 'Raisins' }], updatedAt: 10 }],
  }]);
  assert.equal(savedMealByName('oatmeal', [{
    meals: [{ name: 'Oatmeal', slot: 'breakfast', ingredients: [{ name: 'Oats' }, { name: 'Raisins' }], updatedAt: 10 }],
  }]).ingredients[1].name, 'Raisins');
  assert.equal(saved[0].slot, 'breakfast');
});

test('a shared meal keeps ingredients from both people', () => {
  store.clear();
  rememberMeal({ name: 'Chili', slot: 'dinner', ingredients: [{ name: 'Beans' }] });
  applySharedMeal({ name: 'Chili', slot: 'dinner', ingredients: [{ name: 'Rice' }] });
  assert.deepEqual(savedMealByName('Chili', []).ingredients.map((item) => item.name), ['Beans', 'Rice']);
  assert.ok(listSavedIngredients([]).includes('Rice'));
});

test('logging a meal by name does not wipe ingredients saved earlier', () => {
  store.clear();
  rememberMeal({ name: 'Chili', slot: 'dinner', ingredients: [{ name: 'Beans' }] });
  rememberMeal({ name: 'Chili', slot: 'lunch', ingredients: [] }, { keepIngredientsIfEmpty: true });
  const meal = savedMealByName('Chili', []);
  assert.equal(meal.slot, 'lunch');
  assert.deepEqual(meal.ingredients.map((item) => item.name), ['Beans']);
});

test('ingredients classify and sort by grocery aisle / cooler zone and alphabetically', () => {
  assert.equal(classifyIngredientCategory('Yellow Onion'), 'produce');
  assert.equal(classifyIngredientCategory('Sharp Cheddar Cheese'), 'cooler');
  assert.equal(classifyIngredientCategory('Black Beans'), 'pantry');
  assert.equal(classifyIngredientCategory('Cumin'), 'spices');

  const raw = ['Cumin', 'Black Beans', 'Sharp Cheddar Cheese', 'Avocado'];
  const byCat = sortIngredients(raw, 'category');
  assert.deepEqual(byCat, ['Avocado', 'Sharp Cheddar Cheese', 'Black Beans', 'Cumin']);

  const grouped = groupIngredientsByCategory(raw);
  assert.deepEqual(grouped.map((g) => g.id), ['produce', 'cooler', 'pantry', 'spices']);
});

test('saved meals can be edited (renamed, slot changed, ingredients updated) and removed', () => {
  store.clear();
  rememberMeal({
    name: 'Camp Tacos',
    slot: 'dinner',
    ingredients: [{ name: 'Tortillas' }, { name: 'Ground Beef' }],
  });
  updateSavedMeal('camp tacos', {
    name: 'River Fajitas',
    slot: 'dinner',
    ingredients: [{ name: 'Tortillas' }, { name: 'Bell Pepper' }, { name: 'Steak' }],
  });
  assert.equal(savedMealByName('Camp Tacos', []), null);
  const updated = savedMealByName('River Fajitas', []);
  assert.equal(updated.name, 'River Fajitas');
  assert.deepEqual(updated.ingredients.map((i) => i.name), ['Tortillas', 'Bell Pepper', 'Steak']);

  removeSavedMeal('River Fajitas');
  assert.equal(savedMealByName('River Fajitas', []), null);
});
