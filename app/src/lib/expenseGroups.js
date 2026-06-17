import { labelFor, resolveParticipantId } from './expenses';

export const SPLIT_ALL = 'all';
export const SPLIT_EVENT_CREW = 'event-crew';

export function getExpenseGroups(trip) {
  return trip?.expenseGroups || [];
}

/** Resolve stored member ids to current participant ids. */
export function normalizeMemberIds(memberIds, participantIds, aliasMap = null) {
  if (!Array.isArray(memberIds)) return [];
  const resolved = memberIds
    .map((id) => (aliasMap ? resolveParticipantId(id, aliasMap, participantIds) : id))
    .filter((id) => participantIds.includes(id));
  return [...new Set(resolved)];
}

export function getEventCrewIds(event, participantIds, aliasMap = null) {
  return normalizeMemberIds(event?.memberIds || [], participantIds, aliasMap);
}

export function resolveGroupMembers(group, participantIds, aliasMap = null) {
  if (!group) return [];
  return normalizeMemberIds(group.memberIds || [], participantIds, aliasMap);
}

export function memberSetsMatch(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

export function formatCustomSplitLabel(splitIds, participants, maxNames = 3) {
  if (!splitIds?.length) return 'No one';
  if (splitIds.length === participants.length) return 'Whole trip';
  const names = splitIds.map((id) => labelFor(participants, id));
  if (names.length <= maxNames) return names.join(', ');
  return `${names.slice(0, maxNames).join(', ')} +${names.length - maxNames}`;
}

export function inferSplitPreset(expense, { participantIds, groups = [], event = null, aliasMap = null }) {
  if (expense?.splitAmong === 'all') {
    return { preset: SPLIT_ALL, groupId: null, splitIds: participantIds };
  }

  const split = normalizeMemberIds(
    Array.isArray(expense?.splitAmong) ? expense.splitAmong : [],
    participantIds,
    aliasMap,
  );

  if (memberSetsMatch(split, participantIds)) {
    return { preset: SPLIT_ALL, groupId: null, splitIds: participantIds };
  }

  if (expense?.splitGroupId === SPLIT_EVENT_CREW) {
    const crew = getEventCrewIds(event, participantIds, aliasMap);
    if (memberSetsMatch(split, crew)) {
      return { preset: SPLIT_EVENT_CREW, groupId: SPLIT_EVENT_CREW, splitIds: crew };
    }
  }

  if (expense?.splitGroupId) {
    const group = groups.find((g) => g.id === expense.splitGroupId);
    const members = resolveGroupMembers(group, participantIds, aliasMap);
    if (memberSetsMatch(split, members)) {
      return { preset: 'group', groupId: group.id, splitIds: members };
    }
  }

  for (const group of groups) {
    const members = resolveGroupMembers(group, participantIds, aliasMap);
    if (memberSetsMatch(split, members)) {
      return { preset: 'group', groupId: group.id, splitIds: members };
    }
  }

  return { preset: 'custom', groupId: null, splitIds: split.length ? split : participantIds };
}

export function buildSplitPayload({
  preset,
  groupId,
  splitIds,
  participants,
  groups,
  event,
  aliasMap,
}) {
  const participantIds = participants.map((p) => p.id);

  if (preset === SPLIT_ALL) {
    return {
      splitAmong: 'all',
      splitGroupId: null,
      splitGroupName: 'Whole trip',
    };
  }

  if (preset === SPLIT_EVENT_CREW) {
    const ids = getEventCrewIds(event, participantIds, aliasMap);
    return {
      splitAmong: ids,
      splitGroupId: SPLIT_EVENT_CREW,
      splitGroupName: event?.name ? `${event.name} crew` : 'Event crew',
    };
  }

  if (preset === 'group' && groupId) {
    const group = groups.find((g) => g.id === groupId);
    const ids = resolveGroupMembers(group, participantIds, aliasMap);
    return {
      splitAmong: ids,
      splitGroupId: group?.id || groupId,
      splitGroupName: group?.name || 'Group',
    };
  }

  const ids = normalizeMemberIds(splitIds, participantIds, aliasMap);
  return {
    splitAmong: ids,
    splitGroupId: null,
    splitGroupName: formatCustomSplitLabel(ids, participants),
  };
}
