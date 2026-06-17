import { getSignedInDisplayName, getSignedInUserId } from './authUser';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isJoinedMember(collaborator) {
  return Boolean(collaborator?.userId || collaborator?.joinedViaInvite);
}

export function normalizeParticipantName(name) {
  return (name || '').trim().toLowerCase();
}

/** Prefer joined/account entries over roster-only duplicates (same person, two rows). */
export function dedupeCollaborators(collaborators, { memberProfiles = {} } = {}) {
  const profileNames = new Set(
    Object.values(memberProfiles).map(normalizeParticipantName).filter(Boolean),
  );
  const seenUids = new Set();
  const seenNames = new Set();
  const out = [];

  const list = [...(collaborators || [])].sort((a, b) => {
    const score = (c) => (isJoinedMember(c) ? 2 : 0) + (c.userId ? 1 : 0);
    return score(b) - score(a);
  });

  for (const c of list) {
    const uid = c.userId || null;
    const nameKey = normalizeParticipantName(c.handle || c.name);

    if (uid) {
      if (seenUids.has(uid)) continue;
      seenUids.add(uid);
      if (nameKey) seenNames.add(nameKey);
      out.push(c);
      continue;
    }

    if (!nameKey) continue;
    if (seenNames.has(nameKey) || profileNames.has(nameKey)) continue;
    if (out.some((x) => !x.userId && normalizeParticipantName(x.handle || x.name) === nameKey)) continue;

    seenNames.add(nameKey);
    out.push(c);
  }

  return out;
}

export function mergeCollaboratorsFromMembers(trip, memberRows = []) {
  const ownerId = trip?.ownerId || null;
  const memberIds = new Set((memberRows || []).map((row) => row.user_id).filter(Boolean));
  const memberNameKeys = new Set(
    (memberRows || [])
      .map((row) => normalizeParticipantName(row.profiles?.display_name))
      .filter(Boolean),
  );

  const manual = (trip?.collaborators || []).filter((c) => {
    if (isJoinedMember(c)) return false;
    if (c?.userId && memberIds.has(c.userId)) return false;
    const id = c?.id || c?.handle;
    if (!id) return false;
    if (UUID_RE.test(String(id)) && memberIds.has(id)) return false;
    const nameKey = normalizeParticipantName(c.handle || c.name);
    if (nameKey && memberNameKeys.has(nameKey)) return false;
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

  const nextProfiles = memberProfilesFromRows(memberRows);
  return dedupeCollaborators([...manual, ...fromCloud], { memberProfiles: nextProfiles });
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
  const seenUids = new Set();
  const seenNames = new Set();

  if (trip.ownerId) {
    const label = formatOwnerParticipantLabel(trip, trip.ownerId, currentUserId);
    const nameKey = normalizeParticipantName(label.replace(/\s*\(owner\)\s*$/i, ''));
    out.push(withOwnerMeta
      ? { id: trip.ownerId, label, role: 'owner', isOwner: true }
      : { id: trip.ownerId, label });
    seenUids.add(trip.ownerId);
    if (nameKey) seenNames.add(nameKey);
  }

  const collaborators = dedupeCollaborators(trip.collaborators, { memberProfiles: trip.memberProfiles });

  for (const c of collaborators) {
    const uid = c?.userId || null;
    const id = uid || c?.id || c?.handle;
    if (!id) continue;

    const label = resolveUserDisplayName(trip, uid || id, currentUserId);
    const nameKey = normalizeParticipantName(label);

    if (uid) {
      if (seenUids.has(uid)) continue;
      seenUids.add(uid);
      if (nameKey) seenNames.add(nameKey);
    } else {
      if (nameKey && seenNames.has(nameKey)) continue;
      if (seenUids.has(id)) continue;
      if (nameKey) seenNames.add(nameKey);
    }

    out.push(withOwnerMeta
      ? { id, label, role: c.role || 'contributor', isOwner: false, joinedViaInvite: isJoinedMember(c) }
      : { id, label });
  }

  return out;
}
