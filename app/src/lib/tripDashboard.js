import { buildParticipantAliasMap, buildTripParticipants, computeBalances, resolveUserDisplayName, roundMoney } from './expenses';
import { tripDayKey, tripTimeZone } from './tripTimeline';

export function isGearReady(item) {
  return ['have', 'claimed', 'packed'].includes(item.status);
}

// Resolve saved participant IDs, never display names: two people can share a name.
export function getMyResponsibilities(trip, userId) {
  const participants = buildTripParticipants(trip, userId);
  const aliases = buildParticipantAliasMap(trip, participants);
  const participantId = participants.find(p => p.id === userId)?.id
    || (trip?.collaborators || []).find(p => p.id === userId && p.userId)?.userId;
  const mine = id => Boolean(userId && id && (id === userId || (participantId && aliases.get(id) === participantId)));
  const gear = (trip?.gearItems || []).filter(item => mine(item.assignedTo));
  const meals = (trip?.meals || []).filter(item => mine(item.assignedTo) || (Array.isArray(item.coCooks) && item.coCooks.some(mine)))
    .slice().sort((a, b) => (a.dayIndex || 1) - (b.dayIndex || 1)
      || ['breakfast', 'lunch', 'dinner', 'snack'].indexOf(a.slot) - ['breakfast', 'lunch', 'dinner', 'snack'].indexOf(b.slot));
  // Shopping has no assignee field. Keep authorship explicit in the UI.
  const shopping = (trip?.shoppingItems || []).filter(item => mine(item.addedBy));
  const balances = computeBalances(trip?.expenses || [], participants, { trip });
  return {
    gear, meals, shopping,
    gearToBring: gear.filter(item => !isGearReady(item)),
    shoppingToBuy: shopping.filter(item => !item.checked),
    balance: participantId ? roundMoney(balances[participantId] || 0) : 0,
    hasExpenses: (trip?.expenses || []).length > 0,
    unassignedGear: (trip?.gearItems || []).filter(item => !item.assignedTo && !isGearReady(item)).length,
    unassignedMeals: (trip?.meals || []).filter(item => !item.assignedTo).length,
    plannedLocations: (trip?.locations || []).filter(loc => loc.visitStatus === 'planned').length,
  };
}

export function buildCrewActivityFeed(trip, currentUserId = null, limit = 5) {
  if (!trip) return [];
  const items = [];
  const who = (uid, fallback = 'Crew') => {
    if (!uid) return fallback;
    const name = resolveUserDisplayName(trip, uid, currentUserId);
    return name === 'Unknown' ? fallback : name;
  };

  for (const loc of trip.locations || []) {
    const at = Number(loc.updatedAt || loc.createdAt) || 0;
    const actor = who(loc.createdBy);
    const voteCount = Array.isArray(loc.votes) ? loc.votes.length : 0;
    const label = loc.visitStatus === 'planned'
      ? `pinned planned stop "${loc.name || 'Location'}"${voteCount > 0 ? ` (🔥 ${voteCount})` : ''}`
      : `anchored "${loc.name || 'Location'}"`;
    items.push({
      id: `loc-${loc.id}`,
      at,
      actor,
      text: `${actor} ${label}`,
      icon: loc.icon || '📍',
      screen: 'location',
      params: { locationId: loc.id },
    });
    for (const c of loc.comments || []) {
      items.push({
        id: `comment-${c.id || c.createdAt}`,
        at: Number(c.createdAt) || at,
        actor: c.authorName || who(c.authorId),
        text: `${c.authorName || who(c.authorId)} commented on "${loc.name}": "${c.text}"`,
        icon: '💬',
        screen: 'location',
        params: { locationId: loc.id },
      });
    }
  }

  for (const meal of trip.meals || []) {
    if (!meal.assignedTo) continue;
    const at = Number(meal.updatedAt || meal.createdAt) || 0;
    const cook = meal.assignedToLabel || who(meal.assignedTo);
    const coCount = Array.isArray(meal.coCooks) ? meal.coCooks.length : 0;
    items.push({
      id: `meal-${meal.id}`,
      at,
      actor: cook,
      text: `${cook} signed up to cook ${meal.name} (Day ${meal.dayIndex || 1})${coCount ? ` + ${coCount} co-cook${coCount === 1 ? '' : 's'}` : ''}`,
      icon: '🍳',
      screen: 'plan',
      params: { tab: 'meals' },
    });
  }

  for (const gear of trip.gearItems || []) {
    if (!gear.assignedTo) continue;
    const at = Number(gear.updatedAt || gear.createdAt) || 0;
    const holder = gear.assignedToLabel || who(gear.assignedTo);
    items.push({
      id: `gear-${gear.id}`,
      at,
      actor: holder,
      text: `${holder} is bringing ${gear.name}${isGearReady(gear) ? ' (Ready)' : ''}`,
      icon: '🎒',
      screen: 'plan',
      params: { tab: 'gear' },
    });
  }

  for (const entry of trip.entries || []) {
    const at = Number(entry.updatedAt || entry.createdAt) || 0;
    const actor = who(entry.authorId);
    const place = entry.locationName ? ` at ${entry.locationName}` : '';
    const summary = entry.title || entry.caption || (entry.text ? entry.text.slice(0, 36) : entry.type || 'moment');
    items.push({
      id: `entry-${entry.id}`,
      at,
      actor,
      text: `${actor} shared "${summary}"${place}${entry.highlighted ? ' ⭐' : ''}`,
      icon: entry.highlighted ? '⭐' : '✨',
      screen: entry.eventId ? 'event' : 'trip',
      params: entry.eventId ? { locationId: entry.locationId, eventId: entry.eventId } : {},
    });
  }

  return items
    .sort((a, b) => b.at - a.at)
    .slice(0, Math.max(1, limit));
}

function dateNumber(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key || '')) return null;
  const date = new Date(`${key}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === key ? date.getTime() / 86400000 : null;
}

export function getTripStage(trip, now = new Date()) {
  if (trip?.status === 'completed') return { id: 'completed', label: 'Back home', headline: 'Bring the story home.', description: 'Review your crew’s memories and make a recap to keep.' };
  const today = dateNumber(tripDayKey(now, tripTimeZone(trip)));
  const start = dateNumber(trip?.startDate);
  const days = start == null || today == null ? null : start - today;
  if (trip?.status === 'planning') {
    const label = days === 0 ? 'Starts today' : days > 0 ? `Starts in ${days} day${days === 1 ? '' : 's'}` : 'Getting ready';
    return { id: 'planning', label, headline: 'A great trip starts together.', description: 'Share the load. Get your gear, meals, and crew ready.' };
  }
  return { id: 'active', label: days != null && days <= 0 ? `Day ${1 - days} of your adventure` : 'On the trip', headline: 'Build your trip, one place at a time.', description: 'Add a location, then collect its photos, meals, sightings, notes, and other trip entries.' };
}

export function mealResponsibilityLabel(meal, startDate) {
  const slot = meal.slot ? meal.slot.charAt(0).toUpperCase() + meal.slot.slice(1) : 'Meal';
  const day = Math.max(1, Number(meal.dayIndex) || 1);
  const start = dateNumber(startDate);
  if (start == null) return `${slot} · Day ${day}`;
  const date = new Date((start + day - 1) * 86400000);
  return `${slot} · ${date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
}
