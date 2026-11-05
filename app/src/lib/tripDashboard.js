import { buildParticipantAliasMap, buildTripParticipants, canonicalParticipantId, computeBalances, participantDisplayName, resolveUserDisplayName, roundMoney } from './expenses';
import { tripDayKey, tripTimeZone } from './tripTimeline';
import { mealDaysLabel, mealEndDay, mealSlotLabel, mealSlotOrder, mealStartDay } from './mealSlots';

export function isGearReady(item) {
  return ['have', 'claimed', 'packed'].includes(item?.status);
}

function uniqueIds(ids) {
  const seen = new Set();
  const out = [];
  for (const id of ids || []) {
    const trimmed = typeof id === 'string' ? id.trim() : '';
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      out.push(trimmed);
    }
  }
  return out;
}

function asCanonical(trip, id) {
  return trip ? (canonicalParticipantId(trip, id) || id) : id;
}

export function gearAssigneeIds(item, trip = null) {
  return uniqueIds(getGearAssigneeIds(item).map((id) => asCanonical(trip, id)));
}

export function mealCookIds(meal, trip = null) {
  const raw = [meal?.assignedTo, ...(Array.isArray(meal?.coCooks) ? meal.coCooks : [])];
  return uniqueIds(raw.map((id) => asCanonical(trip, id)));
}

/** People who have confirmed their own share. A legacy packed item counts every assignee. */
export function confirmedReadyIds(item, trip = null) {
  if (Array.isArray(item?.readyBy)) {
    return uniqueIds(item.readyBy.map((id) => asCanonical(trip, id)));
  }
  if (isGearReady(item)) return gearAssigneeIds(item, trip);
  return [];
}

export function isPersonReady(item, userId, trip = null) {
  if (!item || !userId) return false;
  const uid = asCanonical(trip, userId);
  return confirmedReadyIds(item, trip).some((id) => asCanonical(trip, id) === uid);
}

export function isGearFullyReady(item, trip = null) {
  const assignees = gearAssigneeIds(item, trip);
  if (!assignees.length) return isGearReady(item) && !Array.isArray(item?.readyBy);
  return assignees.every((id) => isPersonReady(item, id, trip));
}

export function isMealFullyReady(meal, trip = null) {
  const cooks = mealCookIds(meal, trip);
  if (!cooks.length) return false;
  return cooks.every((id) => isPersonReady(meal, id, trip));
}

export function getGearAssigneeIds(item) {
  if (!item || typeof item !== 'object') return [];
  const raw = Array.isArray(item.assignedToIds)
    ? item.assignedToIds
    : item.assignedTo
      ? [item.assignedTo]
      : [];
  const seen = new Set();
  const out = [];
  for (const id of raw) {
    const trimmed = typeof id === 'string' ? id.trim() : '';
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      out.push(trimmed);
    }
  }
  const primary = typeof item.assignedTo === 'string' ? item.assignedTo.trim() : '';
  if (primary && !seen.has(primary)) {
    out.unshift(primary);
  }
  return out;
}

// Resolve saved participant IDs, never display names: two people can share a name.
export function getMyResponsibilities(trip, userId) {
  const participants = buildTripParticipants(trip, userId);
  const aliases = buildParticipantAliasMap(trip, participants);
  const participantId = participants.find(p => p.id === userId)?.id
    || (trip?.collaborators || []).find(p => p.id === userId && p.userId)?.userId;
  const mine = id => Boolean(userId && id && (id === userId || (participantId && aliases.get(id) === participantId)));
  const gear = (trip?.gearItems || []).filter(item => getGearAssigneeIds(item).some(mine));
  const meals = (trip?.meals || []).filter(item => mine(item.assignedTo) || (Array.isArray(item.coCooks) && item.coCooks.some(mine)))
    .slice().sort((a, b) => (a.dayIndex || 1) - (b.dayIndex || 1)
      || mealSlotOrder(a.slot) - mealSlotOrder(b.slot));
  // Shopping has no assignee field. Keep authorship explicit in the UI.
  const shopping = (trip?.shoppingItems || []).filter(item => mine(item.addedBy));
  const balances = computeBalances(trip?.expenses || [], participants, { trip });
  return {
    gear, meals, shopping,
    gearToBring: gear.filter(item => !isPersonReady(item, userId, trip)),
    mealsToPrep: meals.filter(item => !isPersonReady(item, userId, trip)),
    shoppingToBuy: shopping.filter(item => !item.checked),
    balance: participantId ? roundMoney(balances[participantId] || 0) : 0,
    hasExpenses: (trip?.expenses || []).length > 0,
    unassignedGear: (trip?.gearItems || []).filter(item => getGearAssigneeIds(item).length === 0 && !isGearReady(item)).length,
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
    const cook = participantDisplayName(trip, meal.assignedTo, currentUserId, meal.assignedToLabel) || 'Crew';
    const coCount = Array.isArray(meal.coCooks) ? meal.coCooks.length : 0;
    const coText = coCount ? ` + ${coCount} co-cook${coCount === 1 ? '' : 's'}` : '';
    const assigner = meal.assignedBy && meal.assignedBy !== meal.assignedTo ? who(meal.assignedBy, null) : null;
    items.push({
      id: `meal-${meal.id}`,
      at,
      actor: assigner || cook,
      text: assigner
        ? `${cook} was assigned to cook ${meal.name} (${mealDaysLabel(meal)}) by ${assigner}${coText}`
        : `${cook} signed up to cook ${meal.name} (${mealDaysLabel(meal)})${coText}`,
      icon: '🍳',
      screen: 'plan',
      params: { tab: 'meals' },
    });
  }

  for (const gear of trip.gearItems || []) {
    const assigneeIds = getGearAssigneeIds(gear);
    if (assigneeIds.length === 0) continue;
    const at = Number(gear.updatedAt || gear.createdAt) || 0;
    const names = assigneeIds.map((uid) => participantDisplayName(trip, uid, currentUserId, null)).filter((n) => n && n !== 'Participant' && n !== 'Unknown');
    const holder = (names.length === assigneeIds.length ? names.join(', ') : null)
      || gear.assignedToLabel
      || names.join(', ')
      || 'Crew';
    const verb = assigneeIds.length > 1 ? 'are bringing' : 'is bringing';
    const assigner = gear.assignedBy && !assigneeIds.includes(gear.assignedBy) ? who(gear.assignedBy, null) : null;
    const readyIds = assigneeIds.filter((id) => isPersonReady(gear, id, trip));
    const readyText = assigneeIds.length && readyIds.length === assigneeIds.length
      ? ' (Ready)'
      : readyIds.length
        ? ` (${readyIds.map((id) => participantDisplayName(trip, id, currentUserId, null)).filter(Boolean).join(', ')} ready)`
        : '';
    items.push({
      id: `gear-${gear.id}`,
      at,
      actor: assigner || holder,
      text: assigner
        ? `${holder} ${assigneeIds.length > 1 ? 'were' : 'was'} assigned ${gear.name} by ${assigner}${readyText}`
        : `${holder} ${verb} ${gear.name}${readyText}`,
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
  const slot = meal.slot ? mealSlotLabel(meal.slot) : 'Meal';
  const day = mealStartDay(meal);
  const lastDay = mealEndDay(meal);
  const start = dateNumber(startDate);
  if (start == null) return `${slot} · ${mealDaysLabel(meal)}`;
  const fmt = (n) => new Date((start + n - 1) * 86400000)
    .toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${slot} · ${lastDay > day ? `${fmt(day)} – ${fmt(lastDay)}` : fmt(day)}`;
}

export function gearResponsibilityLabel(gear, trip = null, currentUserId = null) {
  const assignees = trip ? gearAssigneeIds(gear, trip) : getGearAssigneeIds(gear);
  const myId = trip && currentUserId ? asCanonical(trip, currentUserId) : currentUserId;
  const mineReady = myId ? isPersonReady(gear, myId, trip) : false;
  const statusText = mineReady ? 'You ready' : 'To bring';
  if (assignees.length <= 1 || !trip) return mineReady ? 'Ready' : 'To bring';
  const others = assignees
    .filter((uid) => uid !== myId)
    .map((uid) => {
      const name = resolveUserDisplayName(trip, uid, currentUserId);
      if (!name || name === 'Unknown') return null;
      return isPersonReady(gear, uid, trip) ? `${name} ready` : name;
    })
    .filter(Boolean);
  if (others.length === 0) return statusText;
  return `With ${others.join(', ')} · ${statusText}`;
}
