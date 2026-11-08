import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

// Run the real data modules with in-memory browser services; no account or network.
async function fixture() {
  const values = new Map();
  const media = new Map();
  const context = vm.createContext({
    console, crypto: webcrypto, Blob, File, Date,
    queueMicrotask: () => {},
    localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
  });
  const modules = new Map();
  function synthetic(name, exports) {
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context, identifier: name });
  }
  modules.set('./authUser', synthetic('auth', { getSignedInUserId: () => null, getSignedInDisplayName: () => '', getPreferredDisplayName: () => '', setPreferredDisplayName: () => '' }));
  modules.set('./eventTypes', synthetic('types', { defaultEventName: type => type }));
  modules.set('./mediaStore', synthetic('media', { putMediaRecord: async record => media.set(record.id, record) }));
  async function load(name) {
    if (modules.has(name)) return modules.get(name);
    const source = await readFile(new URL('../src/lib/' + name + '.js', import.meta.url), 'utf8');
    const module = new vm.SourceTextModule(source, { context, identifier: name });
    modules.set(name, module);
    await module.link(specifier => load(specifier));
    await module.evaluate();
    return module;
  }
  return { storage: (await load('storage')).namespace, attachments: (await load('media')).namespace,
    refs: (await load('mediaRefs')).namespace, planning: (await load('mealPlanning')).namespace,
    sync: (await load('tripSync')).namespace, media, values };
}

test('a first observation saves without creating a location or event', async () => {
  const { storage } = await fixture();
  const trip = storage.createTrip({ name: 'Field test', types: ['Day Hike'] });
  const entry = storage.addEntry(trip.id, { type: 'note', notes: 'Trailhead', lat: 34, lng: -111, observedAt: '2026-07-20T10:00:00Z' });
  const saved = storage.getTrip(trip.id);
  assert.equal(saved.entries[0].id, entry.id);
  assert.equal(saved.entries[0].notes, 'Trailhead');
  assert.equal(saved.entries[0].lat, 34);
  assert.equal(saved.locations.length, 0);
  assert.equal(saved.events.length, 0);
  assert.equal(saved.syncState, 'pending');
});

test('an unlinked observation can be assigned a location later', async () => {
  const { storage } = await fixture();
  const trip = storage.createTrip({ name: 'Field test', types: [] });
  const entry = storage.addEntry(trip.id, { type: 'note', notes: 'Camp' });
  const location = storage.addLocation(trip.id, { name: 'Camp one', lat: 34, lng: -111 });
  const updated = storage.updateEntry(trip.id, entry.id, { locationId: location.id });
  assert.equal(updated.locationId, location.id);
  assert.ok(updated.eventId);
  assert.equal(updated.notes, 'Camp');
});

test('a later log at a place joins the current visit', async () => {
  const { storage } = await fixture();
  const trip = storage.createTrip({ name: 'Field test', types: [] });
  const location = storage.addLocation(trip.id, { name: 'Camp', lat: 34, lng: -111 });
  const event = storage.addEvent(trip.id, { locationId: location.id, type: 'campsite', name: 'Night 1' });
  const entry = storage.addEntry(trip.id, { type: 'note', notes: 'Stars', locationId: location.id });
  assert.equal(entry.eventId, event.id);
  assert.equal(entry.newVisit, undefined);
  assert.equal(storage.getTrip(trip.id).events.length, 1);
  const next = storage.addEntry(trip.id, { type: 'note', notes: 'Morning', locationId: location.id, newVisit: true });
  assert.notEqual(next.eventId, event.id);
  assert.equal(next.newVisit, undefined);
  assert.equal(storage.getTrip(trip.id).events.length, 2);
});

test('capture within an existing event retains that event', async () => {
  const { storage } = await fixture();
  const trip = storage.createTrip({ name: 'Field test', types: [] });
  const location = storage.addLocation(trip.id, { name: 'Lunch stop', lat: 34, lng: -111 });
  const event = storage.addEvent(trip.id, { locationId: location.id, type: 'food', name: 'Lunch' });
  const entry = storage.addEntry(trip.id, { type: 'photo', eventId: event.id, locationId: location.id });
  assert.equal(entry.eventId, event.id);
  assert.equal(storage.getTrip(trip.id).events.length, 1);
});

test('a meal and bear sighting stay linked to the selected campsite and its visit', async () => {
  const { storage } = await fixture();
  const trip = storage.createTrip({ name: 'Camping', types: ['River Camping'] });
  const camp = storage.addLocation(trip.id, { name: 'Pine campsite', type: 'campsite', lat: 34, lng: -111 });
  const visit = storage.addEvent(trip.id, { locationId: camp.id, type: 'campsite', name: 'Night at Pine' });
  for (const observation of [{ type: 'food', title: 'Camp chili' }, { type: 'wildlife', notes: 'Bear near camp' }]) {
    const saved = storage.addEntry(trip.id, { ...observation, locationId: camp.id });
    assert.equal(saved.locationId, camp.id);
    assert.equal(saved.locationName, camp.name);
    assert.equal(saved.eventId, visit.id);
    assert.equal(saved.lat, camp.lat);
  }
  assert.equal(storage.getTrip(trip.id).locations.length, 1);
  assert.equal(storage.getTrip(trip.id).entries.length, 2);
});

test('moving an observation changes its place and visit without moving other contributions', async () => {
  const { storage } = await fixture();
  const trip = storage.createTrip({ name: 'Camping', types: [] });
  const camp = storage.addLocation(trip.id, { name: 'Campsite', lat: 34, lng: -111 });
  const river = storage.addLocation(trip.id, { name: 'Riverbank', lat: 35, lng: -112 });
  const campVisit = storage.addEvent(trip.id, { locationId: camp.id, name: 'Camp visit' });
  const riverVisit = storage.addEvent(trip.id, { locationId: river.id, name: 'River visit' });
  const meal = storage.addEntry(trip.id, { type: 'food', locationId: camp.id, title: 'Dinner' });
  const bear = storage.addEntry(trip.id, { type: 'wildlife', locationId: camp.id, notes: 'Bear near the water' });
  const moved = storage.updateEntry(trip.id, bear.id, { locationId: river.id });
  assert.equal(moved.locationId, river.id);
  assert.equal(moved.eventId, riverVisit.id);
  assert.equal(moved.locationName, river.name);
  assert.equal(moved.lat, river.lat);
  assert.equal(moved.notes, bear.notes);
  const saved = storage.getTrip(trip.id);
  assert.equal(saved.entries.find(entry => entry.id === meal.id).eventId, campVisit.id);
  assert.equal(saved.events.find(event => event.id === campVisit.id).locationId, camp.id);
});

test('new events at one location keep distinct titles and preserve earlier contributions', async () => {
  const { storage } = await fixture();
  const trip = storage.createTrip({ name: 'Camping', types: [] });
  const camp = storage.addLocation(trip.id, { name: 'Pine campsite', lat: 34, lng: -111 });
  const meal = storage.addEntry(trip.id, { type: 'food', title: 'Dinner', locationId: camp.id, newVisit: true });
  const custom = storage.addEntry(trip.id, { type: 'custom-event', title: 'Evening at camp', notes: 'A quiet evening', locationId: camp.id, newVisit: true });
  assert.notEqual(meal.eventId, custom.eventId);
  const saved = storage.getTrip(trip.id);
  assert.equal(saved.events.find(event => event.id === meal.eventId).name, 'Dinner');
  assert.equal(saved.events.find(event => event.id === custom.eventId).name, 'Evening at camp');
  assert.ok(saved.events.every(event => event.locationId === camp.id));
  assert.equal(saved.entries.find(entry => entry.id === custom.id).notes, 'A quiet evening');
});

test('removing a saved location clears its event and location labels', async () => {
  const { storage } = await fixture();
  const trip = storage.createTrip({ name: 'Camping', types: [] });
  const camp = storage.addLocation(trip.id, { name: 'Campsite', lat: 34, lng: -111 });
  const bear = storage.addEntry(trip.id, { type: 'wildlife', locationId: camp.id, notes: 'Bear' });
  const updated = storage.updateEntry(trip.id, bear.id, { locationId: null });
  assert.equal(updated.locationId, null);
  assert.equal(updated.eventId, undefined);
  assert.equal(updated.locationName, undefined);
  assert.equal(updated.eventName, undefined);
  assert.equal(updated.notes, 'Bear');
});

test('audio bytes survive capture and participate in media sync', async () => {
  const { attachments, media, refs } = await fixture();
  const file = new File(['recorded bytes'], 'voice.webm', { type: 'audio/webm' });
  const ref = await attachments.createAudioMediaFromFile(file, 'trip-1');
  const record = media.get(ref.id);
  assert.equal(await record.fullBlob.text(), 'recorded bytes');
  assert.equal(record.mime, 'audio/webm');
  assert.equal(record.tripId, 'trip-1');
  const trip = { entries: [{ voiceFiles: [ref] }] };
  assert.equal(refs.collectMediaRefsFromTrip(trip)[0].id, ref.id);
  assert.equal(refs.markMediaRefsSynced(trip, new Set([ref.id])).entries[0].voiceFiles[0].syncState, 'synced');
});

test('invalid audio is rejected before claiming it was saved', async () => {
  const { attachments, media } = await fixture();
  await assert.rejects(attachments.createAudioMediaFromFile(new File(['text'], 'note.txt', { type: 'text/plain' }), 'trip-1'), /audio file/);
  await assert.rejects(attachments.createAudioMediaFromFile(new File(['audio'], 'voice.webm', { type: 'audio/webm' }), null), /trip/);
  assert.equal(media.size, 0);
});


test('join accepts codes and links without visiting pasted addresses', async () => {
  const { parseInviteCode } = await import('../src/lib/inviteCode.js');
  assert.equal(parseInviteCode(' abc234xy '), 'ABC234XY');
  assert.equal(parseInviteCode('https://example.com/?join=abc234xy'), 'ABC234XY');
  assert.equal(parseInviteCode('https://example.com/?code=abc234xy'), 'ABC234XY');
  assert.equal(parseInviteCode('https://example.com/no-invitation'), '');
  assert.equal(parseInviteCode('not a code'), '');
});

test('pause, resume and finish persist controls and reject late GPS callbacks', async()=>{
 const {storage}=await fixture();
 const t=storage.createTrip({name:'GPS test',types:[]});
 const session=storage.startGpsSession(t.id);
 assert.equal(storage.startGpsSession(t.id).id,session.id);
 const point={sessionId:session.id,segmentId:'leg1',lat:34,lng:-111,ts:100};
 assert.equal(storage.appendTrackPoint(t.id,point),true);
 storage.pauseGpsSession(t.id);
 assert.equal(storage.appendTrackPoint(t.id,point),false);
 assert.equal(storage.getTrip(t.id).gpsSessionId,session.id);
 storage.resumeGpsSession(t.id);
 assert.equal(storage.appendTrackPoint(t.id,{...point,segmentId:'leg2',ts:200}),true);
 storage.stopGpsSession(t.id);
 const saved=storage.getTrip(t.id);
 assert.equal(saved.gpsTrackingEnabled,false);assert.equal(saved.gpsBackgroundTracking,false);
 assert.equal(saved.gpsSessionId,null);assert.equal(storage.appendTrackPoint(t.id,point),false);
 assert.equal(saved.track.length,2);assert.ok(saved.trackSessions[0].endedAt);
});
test('a second trip cannot steal the current recorder and completion closes it',async()=>{
 const {storage}=await fixture();
 const a=storage.createTrip({name:'A',types:[]}),b=storage.createTrip({name:'B',types:[]});
 storage.startGpsSession(a.id);
 assert.throws(()=>storage.startGpsSession(b.id),/Finish/);
 storage.finalizeTrip(a.id);assert.equal(storage.getTrip(a.id).gpsSessionId,null);
 assert.ok(storage.startGpsSession(b.id));
});

test('social planning: planned locations, hype votes, check-ins, comments, gear/meal claiming, craft badges, and shared trip counts', async () => {
  const { storage } = await fixture();
  const trip = storage.createTrip({ name: 'Middle Fork', types: ['Rafting'], status: 'planning' });
  const loc = storage.addLocation(trip.id, { name: 'Sunflower Hot Springs', lat: 44.5, lng: -115.2 });
  assert.equal(loc.visitStatus, 'planned');

  storage.toggleLocationVote(trip.id, loc.id, 'user-1');
  storage.toggleLocationVote(trip.id, loc.id, 'user-2');
  assert.deepEqual([...storage.getTrip(trip.id).locations[0].votes], ['user-1', 'user-2']);
  storage.toggleLocationVote(trip.id, loc.id, 'user-1');
  assert.deepEqual([...storage.getTrip(trip.id).locations[0].votes], ['user-2']);

  storage.addLocationComment(trip.id, loc.id, 'Soak here before lunch!', { authorId: 'user-2', authorName: 'Sam' });
  assert.equal(storage.getTrip(trip.id).locations[0].comments[0].text, 'Soak here before lunch!');
  assert.equal(storage.getTrip(trip.id).locations[0].comments[0].authorName, 'Sam');

  storage.markLocationVisited(trip.id, loc.id);
  assert.equal(storage.getTrip(trip.id).locations[0].visitStatus, 'visited');

  const gear = storage.addGearItem(trip.id, { name: 'Firewood', category: 'group' });
  storage.claimGearItem(trip.id, gear.id, { userId: 'user-2', label: 'Sam' });
  assert.equal(storage.getTrip(trip.id).gearItems[0].assignedTo, 'user-2');
  assert.equal(storage.getTrip(trip.id).gearItems[0].assignedToLabel, 'Sam');
  storage.claimGearItem(trip.id, gear.id, { userId: 'user-3', label: 'Alex', asCoBringer: true });
  assert.deepEqual([...storage.getTrip(trip.id).gearItems[0].assignedToIds], ['user-2', 'user-3']);
  assert.equal(storage.getTrip(trip.id).gearItems[0].assignedToLabel, 'Sam, Alex');

  const meal = storage.addMeal(trip.id, { name: 'Fajitas', dayIndex: 1, slot: 'dinner' });
  storage.claimMeal(trip.id, meal.id, { userId: 'user-1', label: 'Jordan' });
  storage.claimMeal(trip.id, meal.id, { asCoCook: true, userId: 'user-2' });
  const updatedMeal = storage.getTrip(trip.id).meals[0];
  assert.equal(updatedMeal.assignedTo, 'user-1');
  assert.deepEqual([...updatedMeal.coCooks], ['user-2']);

  const collab = storage.addTripCollaborator(trip.id, { name: 'Sam', craft: 'Oar Rig' });
  assert.equal(collab.craft, 'Oar Rig');
  storage.updateCollaboratorCraft(trip.id, collab.id, 'Kayak');
  assert.equal(storage.getTrip(trip.id).collaborators[0].craft, 'Kayak');

  const trip2 = storage.createTrip({ name: 'Rogue River', types: ['Rafting'], status: 'planning' });
  storage.addTripCollaborator(trip2.id, { name: 'Sam' });
  const sharedCounts = storage.getSharedTripCountsByPerson();
  assert.equal(sharedCounts.byName.sam, 2);
});

test('on-trip and post-trip: reactions, highlights, crew memories, and fork trip as template', async () => {
  const { storage } = await fixture();
  const trip = storage.createTrip({ name: 'Desolation Canyon', types: ['Rafting'], location: 'Green River' });
  const camp = storage.addLocation(trip.id, { name: 'Rock Creek Ranch', lat: 39.5, lng: -110.0 });
  const entry = storage.addEntry(trip.id, { type: 'wildlife', title: 'Bighorn herd', notes: 'Seven rams on the talus', locationId: camp.id });

  storage.toggleEntryReaction(trip.id, entry.id, '🔥', { kind: 'entry', userId: 'user-1' });
  storage.toggleEntryReaction(trip.id, entry.id, '🐻', { kind: 'entry', userId: 'user-2' });
  storage.toggleEntryHighlight(trip.id, entry.id, { kind: 'entry' });

  const afterReact = storage.getTrip(trip.id).entries[0];
  assert.equal(afterReact.highlighted, true);
  assert.deepEqual([...afterReact.reactions['🔥']], ['user-1']);
  assert.deepEqual([...afterReact.reactions['🐻']], ['user-2']);

  storage.addMeal(trip.id, { name: 'River Tacos', dayIndex: 2, slot: 'dinner', assignedTo: 'user-1', assignedToLabel: 'Jordan' });
  storage.addGearItem(trip.id, { name: 'First Aid Kit', category: 'safety', shared: true, assignedTo: 'user-1' });
  storage.addGearItem(trip.id, { name: 'My Drysuit', category: 'personal', shared: false, assignedTo: 'user-1' });
  storage.addExpense(trip.id, { description: 'Shuttle', amount: 250 });

  storage.finalizeTrip(trip.id);
  storage.addTripMemory(trip.id, 'Watching the canyon walls glow at sunset.', { authorId: 'user-2', authorName: 'Sam' });
  assert.equal(storage.getTrip(trip.id).recap.memories.length, 1);
  assert.equal(storage.getTrip(trip.id).recap.memories[0].authorName, 'Sam');

  const forked = storage.forkTripAsTemplate(trip.id, { name: 'Desolation 2027' });
  assert.equal(forked.status, 'planning');
  assert.equal(forked.name, 'Desolation 2027');
  assert.equal(forked.locations.length, 1);
  assert.equal(forked.locations[0].name, 'Rock Creek Ranch');
  assert.equal(forked.locations[0].visitStatus, 'planned');
  assert.equal(forked.meals.length, 1);
  assert.equal(forked.meals[0].name, 'River Tacos');
  assert.equal(forked.meals[0].assignedTo, null);
  assert.equal(forked.gearItems.length, 1);
  assert.equal(forked.gearItems[0].name, 'First Aid Kit');
  assert.equal(forked.entries.length, 0);
  assert.equal(forked.events.length, 0);
  assert.equal(forked.expenses.length, 0);
});

test('daily meal coverage includes empty periods and on-your-own preserves existing food and cooks', async () => {
  const { storage, planning } = await fixture();
  const trip = storage.createTrip({ name: 'Meal trip', types: [], startDate: '2026-07-20', endDate: '2026-07-22' });
  const meal = storage.addMeal(trip.id, { name: 'Oats', slot: 'breakfast', dayIndex: 1, assignedTo: storage.getCurrentUserId(), ingredients: [{ name: 'Oats', qty: '1 bag' }] });
  let schedule = planning.buildMealSchedule(storage.getTrip(trip.id));
  assert.equal(schedule.length, 15);
  assert.equal(schedule.filter(p => p.status === 'open').length, 14);
  storage.setMealPeriods(trip.id, [1], ['breakfast', 'lunch', 'happy-hour'], { mode: 'on-your-own', reason: 'Evening arrival' });
  const saved = storage.getTrip(trip.id);
  schedule = planning.buildMealSchedule(saved);
  assert.equal(schedule.filter(p => p.status === 'on-your-own').length, 3);
  assert.equal(planning.mealItems(saved)[0].id, meal.id);
  assert.equal(planning.mealShoppingItems(saved).length, 0);
  storage.setMealPeriods(trip.id, [1], ['breakfast'], { mode: 'shared' });
  assert.equal(planning.buildMealSchedule(storage.getTrip(trip.id))[0].status, 'claimed');
  assert.equal(planning.mealShoppingItems(storage.getTrip(trip.id))[0].qty, '1 bag');
});

test('an unnamed meal can be claimed and group preparation stays personal when a cook leaves', async () => {
  const { storage, planning } = await fixture();
  const trip = storage.createTrip({ name: 'Group cooks', types: [], startDate: '2026-07-20', endDate: '2026-07-20' });
  const uid = storage.getCurrentUserId();
  const pending = storage.claimMealSlot(trip.id, 1, 'dinner');
  assert.equal(pending.menuPending, true);
  assert.equal(planning.buildMealSchedule(storage.getTrip(trip.id)).find(p => p.slot === 'dinner').status, 'claimed');
  storage.claimMeal(trip.id, pending.id, { asCoCook: true, userId: 'helper' });
  storage.confirmMealPrep(trip.id, pending.id, 'purchasedBy', true);
  storage.confirmMealPrep(trip.id, pending.id, 'readyBy', true);
  let meal = planning.mealItems(storage.getTrip(trip.id))[0];
  assert.deepEqual(Array.from(planning.mealCooks(meal)), [uid, 'helper']);
  assert.deepEqual(Array.from(meal.purchasedBy), [uid]);
  assert.deepEqual(Array.from(meal.readyBy), [uid]);
  storage.updateMeal(trip.id, pending.id, { assignedTo: 'helper', coCooks: [] });
  meal = planning.mealItems(storage.getTrip(trip.id))[0];
  assert.equal(meal.readyBy.length, 0);
  assert.equal(meal.purchasedBy.length, 0);
});

test('multi-day quantities distinguish a shared batch from food needed each day and skip personal meals', async () => {
  const { storage, planning } = await fixture();
  const trip = storage.createTrip({ name: 'Food quantities', types: [], startDate: '2026-07-20', endDate: '2026-07-22' });
  storage.addMeal(trip.id, { name: 'Brownies', dayIndex: 1, endDayIndex: 3, slot: 'dessert', quantityMode: 'batch', ingredients: [{ name: 'Mix', qty: '1 box' }] });
  storage.addMeal(trip.id, { name: 'Breakfast', dayIndex: 1, endDayIndex: 3, slot: 'breakfast', quantityMode: 'daily', ingredients: [{ name: 'Oats', qty: '1/2 cup' }] });
  storage.addMeal(trip.id, { name: 'Extra oats', dayIndex: 2, slot: 'lunch', ingredients: [{ name: 'Oats', qty: '1 cup' }] });
  storage.setMealPeriods(trip.id, [1], ['breakfast'], { mode: 'on-your-own' });
  const shopping = planning.mealShoppingItems(storage.getTrip(trip.id));
  assert.equal(shopping.find(i => i.name === 'Mix').qty, '1 box');
  assert.equal(shopping.find(i => i.name === 'Oats').qty, '2 cup');
  assert.equal(shopping.find(i => i.name === 'Oats').sourceMealIds.length, 2);
  storage.generateShoppingList(trip.id);
  storage.generateShoppingList(trip.id);
  assert.equal(storage.getTrip(trip.id).shoppingItems.length, 2);
  storage.setMealPeriods(trip.id, [2], ['breakfast'], { mode: 'on-your-own' });
  storage.generateShoppingList(trip.id);
  assert.equal(storage.getTrip(trip.id).shoppingItems.find(i => i.name === 'Oats').qty, '1.5 cup');
});

test('editing a single occurrence preserves the other days and does not repeat the batch', async () => {
  const { storage, planning, values } = await fixture();
  const trip = storage.createTrip({ name: 'Repeating food', types: [], startDate: '2026-07-20', endDate: '2026-07-22' });
  const meal = storage.addMeal(trip.id, { name: 'Brownies', dayIndex: 1, endDayIndex: 3, slot: 'dessert', ingredients: [{ name: 'Brownies', qty: '1 batch' }] });
  storage.saveMealOccurrence(trip.id, meal.id, 2, { name: 'Cookies', ingredients: [{ name: 'Cookies', qty: '1 bag' }] }, 'day');
  const saved = storage.getTrip(trip.id);
  const desserts = planning.buildMealSchedule(saved).filter(p => p.slot === 'dessert');
  assert.deepEqual(Array.from(desserts, p => p.meals[0].name), ['Brownies', 'Cookies', 'Brownies']);
  assert.equal(planning.mealShoppingItems(saved).find(i => i.name === 'Brownies').qty, '1 batch');
  const before = values.get('tr_trips');
  const originalSet = values.set;
  values.set = () => { const error = new Error('full'); error.name = 'QuotaExceededError'; throw error; };
  assert.throws(() => storage.saveMealOccurrence(trip.id, meal.id, 3, { name: 'Failed edit' }, 'day'), /storage is full/);
  values.set = originalSet;
  assert.equal(values.get('tr_trips'), before, 'a failed split preserves both the original range and all existing occurrences');
});

test('on-your-own decisions on different devices merge without erasing each other', async () => {
  const { storage, planning, sync, values } = await fixture();
  const trip = storage.createTrip({ name: 'Shared planning', types: [], startDate: '2026-07-20', endDate: '2026-07-21' });
  const before = values.get('tr_trips');
  storage.setMealPeriods(trip.id, [1], ['breakfast'], { mode: 'on-your-own', reason: 'Arriving later' });
  const phoneA = storage.getTrip(trip.id);
  values.set('tr_trips', before);
  storage.setMealPeriods(trip.id, [2], ['lunch'], { mode: 'on-your-own', reason: 'Lunch on the road' });
  const phoneB = storage.getTrip(trip.id);
  const merged = sync.mergeSync(phoneA, phoneB);
  assert.equal(planning.buildMealSchedule(merged).filter(p => p.status === 'on-your-own').length, 2);
  assert.equal(planning.mealItems(merged).length, 0);
  assert.equal(sync.mergeSync(merged, phoneA)._sync.ops.length, merged._sync.ops.length);
});

test('bulk assignments affect exact selected periods and save a reusable cooking group', async () => {
  const {storage,planning}=await fixture();
  const trip=storage.createTrip({name:'Bulk meals',types:[],startDate:'2026-07-20',endDate:'2026-07-21'});
  storage.assignMealPeriods(trip.id,[{day:1,slot:'dinner'},{day:2,slot:'breakfast'}],[storage.getCurrentUserId(),'helper'],{teamName:'Camp cooks'});
  const saved=storage.getTrip(trip.id), schedule=planning.buildMealSchedule(saved);
  assert.equal(schedule.filter(p=>p.status==='claimed').length,2);
  assert.equal(schedule.find(p=>p.day===1&&p.slot==='breakfast').status,'open');
  assert.equal(schedule.find(p=>p.day===2&&p.slot==='dinner').status,'open');
  assert.equal(planning.mealItems(saved).length,2);
  assert.equal(planning.mealTeams(saved)[0].name,'Camp cooks');
  assert.equal(planning.mealTeams(saved)[0].cookIds.length,2);
});

test('bulk cook changes cannot silently change unselected days of a repeating meal', async () => {
  const {storage,planning,values}=await fixture();
  const trip=storage.createTrip({name:'Repeated cooks',types:[],startDate:'2026-07-20',endDate:'2026-07-22'});
  storage.addMeal(trip.id,{name:'Oats',dayIndex:1,endDayIndex:3,slot:'breakfast',assignedTo:storage.getCurrentUserId(),readyBy:[storage.getCurrentUserId()]});
  const before=values.get('tr_trips');
  assert.throws(()=>storage.assignMealPeriods(trip.id,[{day:2,slot:'breakfast'}],['helper']),/every covered day/);
  assert.equal(values.get('tr_trips'),before);
  storage.assignMealPeriods(trip.id,[1,2,3].map(day=>({day,slot:'breakfast'})),['helper']);
  const meal=planning.mealItems(storage.getTrip(trip.id))[0];
  assert.equal(meal.assignedTo,'helper');
  assert.equal(meal.readyBy.length,0);
});

test('repeating onto separated days keeps one batch and excludes the days between', async () => {
  const {storage,planning}=await fixture();
  const trip=storage.createTrip({name:'Repeated batch',types:[],startDate:'2026-07-20',endDate:'2026-07-22'});
  const source=storage.addMeal(trip.id,{name:'Brownies',dayIndex:2,slot:'dessert',assignedTo:storage.getCurrentUserId(),ingredients:[{name:'Mix',qty:'1 box'}],readyBy:[storage.getCurrentUserId()]});
  storage.repeatMealToPeriods(trip.id,source.id,[{day:1,slot:'dessert'},{day:3,slot:'dessert'}],{useCooks:true,quantityMode:'batch'});
  const saved=storage.getTrip(trip.id), repeated=planning.mealItems(saved).find(m=>m.id!==source.id);
  assert.deepEqual(Array.from(planning.activeMealDays(saved,repeated)),[1,3]);
  assert.equal(repeated.readyBy.length,0);
  assert.equal(planning.mealShoppingItems(saved)[0].qty,'2 box');
  assert.throws(()=>storage.repeatMealToPeriods(trip.id,source.id,[{day:2,slot:'dessert'}]),/empty meal periods/);
});

test('copying a trip retains multiple dishes and fills only the available shared days', async () => {
  const {storage,planning}=await fixture();
  const source=storage.createTrip({name:'Old menu',types:[],startDate:'2026-07-20',endDate:'2026-07-22'});
  for(const name of ['Tacos','Rice'])storage.addMeal(source.id,{name,dayIndex:1,slot:'dinner',assignedTo:storage.getCurrentUserId()});
  storage.addMeal(source.id,{name:'Brownies',dayIndex:1,endDayIndex:3,slot:'dessert',assignedTo:storage.getCurrentUserId()});
  const target=storage.createTrip({name:'New menu',types:[],startDate:'2026-08-20',endDate:'2026-08-22'});
  storage.setMealPeriods(target.id,[1],['dessert'],{mode:'on-your-own'});
  assert.equal(storage.copyMealPlan(target.id,source.id),3);
  const saved=storage.getTrip(target.id);
  assert.equal(planning.buildMealSchedule(saved).find(p=>p.day===1&&p.slot==='dinner').meals.length,2);
  assert.deepEqual(Array.from(planning.activeMealDays(saved,planning.mealItems(saved).find(m=>m.name==='Brownies'))),[2,3]);
  assert.ok(planning.mealItems(saved).every(m=>m.assignedTo===null));
  assert.equal(storage.copyMealPlan(target.id,source.id),0);
});

test('shared meal boundaries preview and preserve personal choices when the window expands', async () => {
  const {storage,planning,values}=await fixture();
  const trip=storage.createTrip({name:'Arrival meals',types:[],startDate:'2026-07-20',endDate:'2026-07-22'});
  storage.setMealPeriods(trip.id,[2],['lunch'],{mode:'on-your-own',reason:'Lunch separately'});
  const first={day:1,slot:'dinner'},last={day:3,slot:'breakfast'};
  assert.equal(planning.mealWindowChanges(storage.getTrip(trip.id),first,last).length,7);
  storage.setSharedMealWindow(trip.id,first,last);
  assert.equal(planning.buildMealSchedule(storage.getTrip(trip.id)).filter(p=>p.status==='on-your-own').length,8);
  storage.setSharedMealWindow(trip.id,{day:1,slot:'breakfast'},{day:3,slot:'dessert'});
  assert.equal(planning.buildMealSchedule(storage.getTrip(trip.id)).filter(p=>p.status==='on-your-own').length,1);
  const before=values.get('tr_trips');
  assert.throws(()=>storage.setSharedMealWindow(trip.id,{day:3,slot:'dinner'},{day:1,slot:'breakfast'}),/after the first/);
  assert.equal(values.get('tr_trips'),before);
});

test('shopping review preserves purchased and manual quantities and rejects stale previews', async () => {
  const {storage,planning,values}=await fixture();
  const trip=storage.createTrip({name:'Shopping review',types:[],startDate:'2026-07-20',endDate:'2026-07-20'});
  const meal=storage.addMeal(trip.id,{name:'Dinner',slot:'dinner',ingredients:[{name:'Rice',qty:'2 bags'},{name:'Beans',qty:'3 cans'},{name:'Onion',qty:'2'}]});
  storage.generateShoppingList(trip.id);
  let saved=storage.getTrip(trip.id);
  storage.updateShoppingItem(trip.id,saved.shoppingItems.find(i=>i.name==='Rice').id,{qty:'1 bag'});
  storage.updateShoppingItem(trip.id,saved.shoppingItems.find(i=>i.name==='Beans').id,{checked:true});
  storage.addShoppingItem(trip.id,{name:'Salt',qty:'1 jar'});
  storage.updateMeal(trip.id,meal.id,{ingredients:[{name:'Rice',qty:'4 bags'},{name:'Beans',qty:'4 cans'},{name:'Onion',qty:'4'},{name:'Salt',qty:'2 jars'},{name:'Peppers',qty:'1'}]});
  const review=planning.mealShoppingChanges(storage.getTrip(trip.id));
  assert.equal(review.changes.length,2);
  assert.equal(review.protectedItems.length,3);
  storage.updateShoppingItem(trip.id,storage.getTrip(trip.id).shoppingItems.find(i=>i.name==='Onion').id,{checked:true});
  const before=values.get('tr_trips');
  assert.throws(()=>storage.generateShoppingList(trip.id,review.revision),/changed/);
  assert.equal(values.get('tr_trips'),before);
  storage.generateShoppingList(trip.id,planning.mealShoppingChanges(storage.getTrip(trip.id)).revision);
  saved=storage.getTrip(trip.id);
  assert.equal(saved.shoppingItems.find(i=>i.name==='Rice').qty,'1 bag');
  assert.equal(saved.shoppingItems.find(i=>i.name==='Beans').qty,'3 cans');
  assert.equal(saved.shoppingItems.find(i=>i.name==='Salt').qty,'1 jar');
  assert.equal(saved.shoppingItems.find(i=>i.name==='Onion').qty,'2');
  assert.equal(saved.shoppingItems.find(i=>i.name==='Peppers').qty,'1');
});

test('meal discussions merge additive messages and in-app reminders belong to the current person', async () => {
  const {storage,planning,sync,values}=await fixture();
  const trip=storage.createTrip({name:'Meal discussion',types:[],startDate:'2026-07-20',endDate:'2026-07-20'});
  const meal=storage.addMeal(trip.id,{name:'Tacos',slot:'dinner'});
  const before=values.get('tr_trips');
  storage.addMealComment(trip.id,meal.id,'I can bring tortillas.');
  const phoneA=storage.getTrip(trip.id);
  values.set('tr_trips',before);
  storage.addMealComment(trip.id,meal.id,'I will bring salsa.');
  storage.saveTrip(sync.mergeSync(phoneA,storage.getTrip(trip.id)),{capture:false});
  assert.equal(planning.mealComments(storage.getTrip(trip.id),meal.id).length,2);
  assert.equal(planning.mealItems(storage.getTrip(trip.id)).length,1);
  const reminder=storage.setMealReminder(trip.id,meal.id,Date.now()+3600000);
  assert.equal(planning.mealReminders(storage.getTrip(trip.id),storage.getCurrentUserId(),Date.now()+7200000).length,1);
  assert.equal(planning.mealReminders(storage.getTrip(trip.id),'another-person',Date.now()+7200000).length,0);
  storage.setMealPeriods(trip.id,[1],['dinner'],{mode:'on-your-own'});
  assert.equal(planning.mealReminders(storage.getTrip(trip.id),storage.getCurrentUserId(),Date.now()+7200000).length,0);
  storage.setMealPeriods(trip.id,[1],['dinner'],{mode:'shared'});
  storage.dismissMealReminder(trip.id,reminder.id);
  assert.equal(planning.mealReminders(storage.getTrip(trip.id),storage.getCurrentUserId(),Date.now()+7200000).length,0);
});

test('meal saves render immediately while cloud sync is still waiting and local failures do not sync', async () => {
  const context=vm.createContext({console});
  let release,requests=0;
  const network=new Promise(resolve=>{release=resolve;});
  const exportsByName={
    './authUser':{getSignedInUserId:()=> 'member'},
    './supabase':{supabaseConfigured:true},
    './tripAutoSync':{flushTripCloudSync:()=>{requests++;return network;},getCloudSyncStatus:()=>({offline:false})},
  };
  const source=await readFile(new URL('../src/lib/planningSave.js',import.meta.url),'utf8');
  const module=new vm.SourceTextModule(source,{context});
  await module.link(name=>new vm.SyntheticModule(Object.keys(exportsByName[name]),function(){for(const[key,value]of Object.entries(exportsByName[name]))this.setExport(key,value);},{context}));
  await module.evaluate();
  const order=[];
  const result=module.namespace.savePlanningLocally('trip',()=>{order.push('local');return 42;},{onSaved:()=>order.push('render'),onSynced:()=>order.push('cloud')});
  assert.equal(result,42);
  assert.deepEqual(order,['local','render']);
  assert.equal(requests,1);
  assert.throws(()=>module.namespace.savePlanningLocally('trip',()=>{throw new Error('Storage full');}),/Storage full/);
  assert.equal(requests,1);
  release({synced:true});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(order,['local','render','cloud']);
});

test('an open meal editor submits only changed fields and preserves newer cook and ingredient updates', async () => {
  const {storage,planning}=await fixture();
  const trip=storage.createTrip({name:'Concurrent meal edits',types:[],startDate:'2026-07-20',endDate:'2026-07-20'});
  const meal=storage.addMeal(trip.id,{name:'Dinner',slot:'dinner',assignedTo:storage.getCurrentUserId(),ingredients:[{name:'Beans',qty:'1 can'}]});
  const original={name:meal.name,assignedTo:meal.assignedTo,ingredients:meal.ingredients};
  const patch=planning.mealDraftChanges(original,{...original,name:'Camp chili'});
  assert.deepEqual(Object.keys(patch),['name']);
  storage.updateMeal(trip.id,meal.id,{assignedTo:'helper',ingredients:[{name:'Beans',qty:'2 cans'}]});
  storage.saveMealOccurrence(trip.id,meal.id,1,patch);
  const latest=planning.mealItems(storage.getTrip(trip.id))[0];
  assert.equal(latest.name,'Camp chili');
  assert.equal(latest.assignedTo,'helper');
  assert.equal(latest.ingredients[0].qty,'2 cans');
  assert.equal(Object.keys(planning.mealDraftChanges({dayIndex:1,endDayIndex:3},{dayIndex:2,endDayIndex:2},'day')).length,0);
});

test('editing an on-your-own note preserves a newer shared-meal choice', async () => {
  const {storage,planning}=await fixture();
  const trip=storage.createTrip({name:'Personal meal note',types:[],startDate:'2026-07-20',endDate:'2026-07-20'});
  storage.setMealPeriods(trip.id,[1],['breakfast'],{mode:'on-your-own',reason:'Arriving later'});
  storage.setMealPeriods(trip.id,[1],['breakfast'],{mode:'shared'});
  storage.changeMealPeriods(trip.id,[{day:1,slot:'breakfast',reason:'Arrival time updated'}]);
  const period=planning.mealPeriod(storage.getTrip(trip.id),1,'breakfast');
  assert.equal(period.mode,'shared');
  assert.equal(period.reason,'Arrival time updated');
});

test('legacy snack items belong beneath happy hour and keep their names, cooks, and ingredients', async () => {
  const {storage,planning}=await fixture();
  const trip=storage.createTrip({name:'Happy hour menu',types:[],startDate:'2026-07-20',endDate:'2026-07-20'});
  storage.saveTrip({...storage.getTrip(trip.id),meals:[
    {id:'old-snack',name:'Guacamole',slot:'snack',dayIndex:1,ingredients:[{name:'Avocados',qty:'3'}]},
    {id:'happy-drinks',name:'Lime spritzers',slot:'happy-hour',dayIndex:1,ingredients:[{name:'Limes',qty:'4'}]},
  ]});
  let saved=storage.getTrip(trip.id),schedule=planning.buildMealSchedule(saved);
  assert.equal(schedule.length,5);
  assert.ok(!schedule.some(p=>p.slot==='snack'));
  assert.deepEqual(Array.from(schedule.find(p=>p.slot==='happy-hour').meals,m=>m.name).sort(),['Guacamole','Lime spritzers']);
  storage.assignMealPeriods(trip.id,[{day:1,slot:'happy-hour'}],[storage.getCurrentUserId()]);
  saved=storage.getTrip(trip.id);
  assert.ok(planning.mealItems(saved).every(m=>m.assignedTo===storage.getCurrentUserId()));
  assert.equal(planning.mealItems(saved).find(m=>m.id==='old-snack').slot,'snack','reading a legacy item does not rewrite its history');
  assert.equal(planning.mealShoppingItems(saved).length,2);
  storage.setMealPeriods(trip.id,[1],['happy-hour'],{mode:'on-your-own'});
  assert.equal(planning.mealShoppingItems(storage.getTrip(trip.id)).length,0);
  storage.setMealPeriods(trip.id,[1],['happy-hour'],{mode:'shared'});
  assert.equal(planning.mealShoppingItems(storage.getTrip(trip.id)).find(i=>i.name==='Avocados').qty,'3');
});

test('legacy snack period settings apply to happy hour until a new happy-hour choice is made', async () => {
  const {storage,planning}=await fixture();
  const trip=storage.createTrip({name:'Legacy happy hour',types:[],startDate:'2026-07-20',endDate:'2026-07-20'});
  storage.saveTrip({...storage.getTrip(trip.id),meals:[
    {id:'old-period',kind:'meal-period',slot:'snack',dayIndex:1,mode:'on-your-own',reason:'Late arrival'},
    {id:'dip',name:'Bean dip',slot:'snack',dayIndex:1,ingredients:[{name:'Beans',qty:'1 can'}]},
  ]});
  assert.equal(planning.buildMealSchedule(storage.getTrip(trip.id)).find(p=>p.slot==='happy-hour').status,'on-your-own');
  storage.setMealPeriods(trip.id,[1],['happy-hour'],{mode:'shared'});
  const saved=storage.getTrip(trip.id);
  assert.equal(planning.buildMealSchedule(saved).find(p=>p.slot==='happy-hour').status,'open');
  assert.equal(planning.mealShoppingItems(saved)[0].qty,'1 can');
  const created=storage.addMeal(trip.id,{name:'Olives',slot:'snack'});
  assert.equal(created.slot,'happy-hour','new writes use the happy-hour period');
});

test('planning a claimed meal fills its existing record and keeps its cooking group', async () => {
  const {storage,planning}=await fixture();
  const trip=storage.createTrip({name:'Claim then plan',types:[],startDate:'2026-07-20',endDate:'2026-07-20'});
  const claimed=storage.claimMealSlot(trip.id,1,'dinner');
  storage.claimMeal(trip.id,claimed.id,{asCoCook:true,userId:'helper'});
  const saved=storage.planMeal(trip.id,{name:'Camp chili',dayIndex:1,slot:'dinner',assignedTo:null,coCooks:[],ingredients:[{name:'Beans',qty:'2 cans'}]});
  assert.equal(saved.id,claimed.id);
  assert.equal(saved.menuPending,false);
  assert.deepEqual(Array.from(planning.mealCooks(saved)),[storage.getCurrentUserId(),'helper']);
  assert.equal(planning.mealItems(storage.getTrip(trip.id)).length,1);
  assert.equal(saved.ingredients[0].qty,'2 cans');
  storage.planMeal(trip.id,{name:'Cornbread',dayIndex:1,slot:'dinner'},{newDish:true});
  assert.equal(planning.mealItems(storage.getTrip(trip.id)).length,2,'explicitly adding a dish still creates a separate item');
});

test('an unwanted claimed placeholder can be deleted without deleting another dish or reappearing after sync', async () => {
  const {storage,planning,sync,values}=await fixture();
  const trip=storage.createTrip({name:'Remove duplicate claim',types:[],startDate:'2026-07-20',endDate:'2026-07-20'});
  const pending=storage.claimMealSlot(trip.id,1,'dinner');
  const dish=storage.addMeal(trip.id,{name:'Tacos',dayIndex:1,slot:'dinner'});
  const oldPhone=storage.getTrip(trip.id);
  storage.removeMealOccurrence(trip.id,pending.id,1,'all');
  const merged=sync.mergeSync(storage.getTrip(trip.id),oldPhone);
  assert.deepEqual(Array.from(planning.mealItems(merged),m=>m.id),[dish.id]);
  const before=values.get('tr_trips');
  values.set('tr_user_id','outsider');
  assert.throws(()=>storage.removeMealOccurrence(trip.id,dish.id,1,'all'),/Join this trip/);
  assert.equal(values.get('tr_trips'),before);
});

test('deleting a repeated meal for one day preserves the other days and removing its last occurrence updates shopping', async () => {
  const {storage,planning}=await fixture();
  const trip=storage.createTrip({name:'Delete repeating dish',types:[],startDate:'2026-07-20',endDate:'2026-07-22'});
  const meal=storage.addMeal(trip.id,{name:'Brownies',dayIndex:1,endDayIndex:3,slot:'dessert',ingredients:[{name:'Mix',qty:'1 box'}]});
  storage.generateShoppingList(trip.id);
  storage.removeMealOccurrence(trip.id,meal.id,2,'day');
  let saved=storage.getTrip(trip.id);
  assert.deepEqual(Array.from(planning.activeMealDays(saved,planning.mealItems(saved)[0])),[1,3]);
  assert.equal(planning.mealShoppingItems(saved)[0].qty,'1 box');
  storage.removeMealOccurrence(trip.id,meal.id,1,'day');
  storage.removeMealOccurrence(trip.id,meal.id,3,'day');
  saved=storage.getTrip(trip.id);
  assert.equal(planning.mealItems(saved).length,0);
  assert.equal(planning.mealShoppingChanges(saved).changes[0].type,'remove');
});
