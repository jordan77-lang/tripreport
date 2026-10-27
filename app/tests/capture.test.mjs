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
  modules.set('./authUser', synthetic('auth', { getSignedInUserId: () => null, getSignedInDisplayName: () => '' }));
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
    refs: (await load('mediaRefs')).namespace, media, values };
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

  const gear = storage.addGearItem(trip.id, { name: 'Groover', category: 'group' });
  storage.claimGearItem(trip.id, gear.id, { userId: 'user-2', label: 'Sam' });
  assert.equal(storage.getTrip(trip.id).gearItems[0].assignedTo, 'user-2');
  assert.equal(storage.getTrip(trip.id).gearItems[0].assignedToLabel, 'Sam');

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
