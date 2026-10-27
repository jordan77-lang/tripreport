import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

// Load the real helpers with the same extensionless imports used by Vite.
const values = new Map();
const context = vm.createContext({ console, Date, Intl, localStorage: { getItem: key => values.get(key) ?? null } });
const modules = new Map();
async function load(name) {
  if (modules.has(name)) return modules.get(name);
  const source = await readFile(new URL(`../src/lib/${name.replace(/^\.\//, '')}.js`, import.meta.url), 'utf8');
  const module = new vm.SourceTextModule(source, { context, identifier: name });
  modules.set(name, module);
  await module.link(load);
  await module.evaluate();
  return module;
}
const { buildCrewActivityFeed, gearResponsibilityLabel, getMyResponsibilities, getTripStage, mealResponsibilityLabel } = (await load('./tripDashboard')).namespace;
const ids = list => Array.from(list, item => item.id);

test('responsibilities use IDs and aliases without confusing people who share a name', () => {
  values.clear();
  const trip = { ownerId: 'leader', collaborators: [
    { id: 'roster-id', userId: 'member', name: 'Alex' }, { id: 'other', userId: 'other', name: 'Alex' },
  ], gearItems: [
    { id: 'mine', assignedTo: 'roster-id', status: 'needed' },
    { id: 'ready', assignedTo: 'member', status: 'packed' },
    { id: 'theirs', assignedTo: 'other', assignedToLabel: 'Alex' },
    { id: 'unassigned' }, { id: 'shared-ready', status: 'have' },
  ], meals: [{ id: 'later', assignedTo: 'member', dayIndex: 2 }, { id: 'first', assignedTo: 'roster-id', dayIndex: 1 }, { id: 'other-meal', assignedTo: 'other' }],
  shoppingItems: [{ id: 'buy', addedBy: 'roster-id' }, { id: 'bought', addedBy: 'member', checked: true }, { id: 'other-buy', addedBy: 'other' }],
  expenses: [{ amount: 90, paidBy: 'leader', splitAmong: 'all' }],
  };
  const result = getMyResponsibilities(trip, 'member');
  assert.deepEqual(ids(result.gear), ['mine', 'ready']);
  assert.deepEqual(ids(result.gearToBring), ['mine']);
  assert.deepEqual(ids(result.meals), ['first', 'later']);
  assert.deepEqual(ids(result.shoppingToBuy), ['buy']);
  assert.equal(result.balance, -30);
  assert.equal(result.unassignedGear, 1);
  assert.equal(getMyResponsibilities(trip, 'leader').balance, 60);
  assert.equal(getMyResponsibilities(trip, 'outsider').gear.length, 0);
});

test('claimed anonymous owner assignments remain personal after sign-in', () => {
  values.set('tr_user_id', 'anonymous-owner');
  const trip = { ownerId: 'signed-in-owner', collaborators: [{ id: 'member', userId: 'member', name: 'Crew' }],
    gearItems: [{ id: 'old-owner-gear', assignedTo: 'anonymous-owner' }],
  };
  assert.deepEqual(ids(getMyResponsibilities(trip, 'signed-in-owner').gear), ['old-owner-gear']);
  assert.equal(getMyResponsibilities(trip, 'member').gear.length, 0);
  values.clear();
});

test('trip countdown and active day use the trip time zone across midnight and DST', () => {
  const trip = { status: 'planning', startDate: '2026-10-25', timeZone: 'America/Phoenix' };
  const now = new Date('2026-10-24T01:00:00Z'); // Still Oct 23 in Arizona.
  assert.equal(getTripStage(trip, now).label, 'Starts in 2 days');
  assert.equal(getTripStage({ ...trip, startDate: '2026-10-24' }, now).label, 'Starts in 1 day');
  assert.equal(getTripStage({ ...trip, startDate: '2026-10-23' }, now).label, 'Starts today');
  assert.equal(getTripStage({ ...trip, status: 'active', startDate: '2026-10-22' }, now).label, 'Day 2 of your adventure');
  assert.equal(getTripStage({ status: 'active', startDate: '2026-10-31', timeZone: 'America/New_York' }, new Date('2026-11-02T12:00:00Z')).label, 'Day 3 of your adventure');
});

test('dates never advance a planning trip or reopen a completed trip', () => {
  const now = new Date('2026-10-23T12:00:00Z');
  assert.equal(getTripStage({ status: 'planning', startDate: '2020-01-01' }, now).id, 'planning');
  assert.equal(getTripStage({ status: 'completed', startDate: '2030-01-01' }, now).id, 'completed');
  assert.equal(getTripStage({ status: 'planning', startDate: 'invalid' }, now).label, 'Getting ready');
  assert.equal(getTripStage({ status: 'planning', startDate: '2026-02-31' }, now).label, 'Getting ready');
  assert.equal(getTripStage({ status: 'active' }, now).label, 'On the trip');
});

test('meal duties cross month boundaries without shifting dates to the phone time zone', () => {
  assert.match(mealResponsibilityLabel({ slot: 'dinner', dayIndex: 2 }, '2026-10-31'), /Dinner.*Nov 1/);
  assert.equal(mealResponsibilityLabel({ slot: 'breakfast', dayIndex: 3 }, null), 'Breakfast · Day 3');
});

test('empty trips and missing identity do not invent personal assignments or balances', () => {
  const result = getMyResponsibilities({}, null);
  assert.equal(result.gear.length, 0); assert.equal(result.meals.length, 0);
  assert.equal(result.shopping.length, 0); assert.equal(result.balance, 0);
  assert.equal(result.hasExpenses, false);
});

test('co-cooks, planned locations, and crew activity feed work across social planning and trip moments', () => {
  const trip = {
    ownerId: 'leader',
    memberProfiles: { leader: 'Jordan', member: 'Sam' },
    collaborators: [{ id: 'member', userId: 'member', name: 'Sam' }],
    locations: [
      { id: 'loc-1', name: 'Granite Rapid', visitStatus: 'planned', votes: ['leader', 'member'], createdBy: 'leader', updatedAt: 100, comments: [{ id: 'c1', authorName: 'Sam', text: 'Scout river left', createdAt: 300 }] },
      { id: 'loc-2', name: 'Pine Camp', visitStatus: 'visited', createdBy: 'member', updatedAt: 200 },
    ],
    meals: [
      { id: 'm1', name: 'Dutch Oven Lasagna', dayIndex: 1, slot: 'dinner', assignedTo: 'leader', assignedToLabel: 'Jordan', coCooks: ['member'], updatedAt: 250 },
    ],
    entries: [
      { id: 'e1', title: 'Osprey dive', locationId: 'loc-2', locationName: 'Pine Camp', authorId: 'member', highlighted: true, updatedAt: 400 },
    ],
  };
  const samTasks = getMyResponsibilities(trip, 'member');
  assert.deepEqual(ids(samTasks.meals), ['m1']);
  assert.equal(samTasks.plannedLocations, 1);

  const feed = buildCrewActivityFeed(trip, 'leader', 5);
  assert.equal(feed.length, 5);
  assert.match(feed[0].text, /Sam shared "Osprey dive" at Pine Camp ⭐/);
  assert.match(feed[1].text, /Sam commented on "Granite Rapid"/);
  assert.match(feed[2].text, /Jordan signed up to cook Dutch Oven Lasagna/);
});

test('multiple people can be assigned to bring the same gear item (like firewood)', () => {
  const trip = {
    ownerId: 'leader',
    memberProfiles: { leader: 'Jordan', u2: 'Sam', u3: 'Alex' },
    collaborators: [
      { id: 'u2', userId: 'u2', name: 'Sam' },
      { id: 'u3', userId: 'u3', name: 'Alex' },
    ],
    gearItems: [
      {
        id: 'firewood',
        name: 'Firewood',
        assignedTo: 'leader',
        assignedToIds: ['leader', 'u2', 'u3'],
        assignedToLabel: 'Jordan, Sam, Alex',
        status: 'needed',
        updatedAt: 500,
      },
    ],
  };

  for (const uid of ['leader', 'u2', 'u3']) {
    const tasks = getMyResponsibilities(trip, uid);
    assert.deepEqual(ids(tasks.gear), ['firewood']);
    assert.deepEqual(ids(tasks.gearToBring), ['firewood']);
    assert.equal(tasks.unassignedGear, 0);
  }

  assert.equal(
    gearResponsibilityLabel(trip.gearItems[0], trip, 'u2'),
    'With Jordan, Alex · To bring',
  );

  const feed = buildCrewActivityFeed(trip, 'leader', 5);
  assert.match(feed[0].text, /Jordan, Sam, Alex are bringing Firewood/);
});
