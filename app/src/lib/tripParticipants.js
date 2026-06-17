import { getSignedInDisplayName, getSignedInUserId } from './authUser';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isJoinedMember(collaborator) {
  return Boolean(collaborator?.userId || collaborator?.joinedViaInvite);
}

export function mergeCollaboratorsFromMembers(trip, memberRows = []) {
  const ownerId = trip?.ownerId || null;
  const memberIds = new Set((memberRows || []).map((row) => row.user_id).filter(Boolean));

  const manual = (trip?.collaborators || []).filter((c) => {
    if (isJoinedMember(c)) return false;
    const id = c?.id || c?.handle;
    if (!id) return false;
    if (UUID_RE.test(String(id)) && memberIds.has(id)) return false;
    return true;
  });

  const fromCloud = (memberRows || [])
    .filter((row) => row.user_id && row.user_id !== ownerId)
    .map((row) => ({
      id: row.user_id,
      userId: row.user_id,
      handle: row.profiles?.display_name || 'Participant',
      name: row.profiles?.display_name || 'Participant',
      role: row.role || 'contributor',
      joinedViaInvite: true,
    }));

  return [...manual, ...fromCloud];
}

export function memberProfilesFromRows(memberRows = []) {
  const profiles = {};
  for (const row of memberRows || []) {
    if (!row?.user_id) continue;
    profiles[row.user_id] = row.profiles?.display_name || 'Participant';
  }
  return profiles;
}

export function collaboratorsChanged(before = [], after = []) {
  return JSON.stringify(before) !== JSON.stringify(after);
}

export function resolveUserDisplayName(trip, userId, currentUserId) {
  if (!userId) return 'Unknown';

  const cached = trip?.memberProfiles?.[userId];
  if (cached) return cached;

  const collaborator = (trip?.collaborators || []).find(
    (c) => c.userId === userId || c.id === userId,
  );
  if (collaborator?.handle || collaborator?.name) {
    return collaborator.handle || collaborator.name;
  }

  if (userId === currentUserId || userId === getSignedInUserId()) {
    return getSignedInDisplayName() || 'Me';
  }

  return 'Participant';
}

export function formatOwnerParticipantLabel(trip, ownerId, currentUserId) {
  const name = resolveUserDisplayName(trip, ownerId, currentUserId);
  return `${name} (owner)`;
}

export function buildTripParticipants(trip, currentUserId, { withOwnerMeta = false } = {}) {
  if (!trip) return [];
  const out = [];
  const seen = new Set();

  if (trip.ownerId) {
    const label = formatOwnerParticipantLabel(trip, trip.ownerId, currentUserId);
    out.push(withOwnerMeta
      ? { id: trip.ownerId, label, role: 'owner', isOwner: true }
      : { id: trip.ownerId, label });
    seen.add(trip.ownerId);
  }

  for (const c of trip.collaborators || []) {
    const id = c?.userId || c?.id || c?.handle;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const label = resolveUserDisplayName(trip, id, currentUserId);
    out.push(withOwnerMeta
      ? { id, label, role: c.role || 'contributor', isOwner: false, joinedViaInvite: isJoinedMember(c) }
      : { id, label });
  }

  return out;
}
