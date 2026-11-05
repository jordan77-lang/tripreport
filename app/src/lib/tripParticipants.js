import { getSignedInDisplayName, getSignedInUserId } from './authUser';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isJoinedMember(collaborator) {
  return Boolean(collaborator?.userId || collaborator?.joinedViaInvite);
}

export function normalizeParticipantName(name) {
  return (name || '').trim().toLowerCase();
}

function aliasIdsOf(collaborator) {
  return Array.isArray(collaborator?.aliasIds) ? collaborator.aliasIds.filter(Boolean) : [];
}

function withAliases(collaborator, ids) {
  const own = new Set([collaborator.id, collaborator.userId].filter(Boolean));
  const next = [...new Set([...aliasIdsOf(collaborator), ...ids.filter((id) => id && !own.has(id))])];
  if (next.length === aliasIdsOf(collaborator).length) return collaborator;
  return { ...collaborator, aliasIds: next };
}

/**
 * Prefer joined/account entries over roster-only duplicates (same person, two rows).
 * A dropped roster row's id is kept in the surviving row's aliasIds so meals and
 * gear assigned to the roster name before that person joined still reach them.
 */
export function dedupeCollaborators(collaborators, { memberProfiles = {} } = {}) {
  const profileUidsByName = new Map();
  for (const [uid, name] of Object.entries(memberProfiles || {})) {
    const key = normalizeParticipantName(name);
    if (!key) continue;
    if (!profileUidsByName.has(key)) profileUidsByName.set(key, []);
    profileUidsByName.get(key).push(uid);
  }
  const seenUids = new Set();
  const out = [];
  const indexOfUid = (uid) => out.findIndex((x) => x.userId === uid);
  const absorb = (index, from) => {
    out[index] = withAliases(out[index], [from.id, from.userId, ...aliasIdsOf(from)]);
  };

  const list = [...(collaborators || [])].sort((a, b) => {
    const score = (c) => (isJoinedMember(c) ? 2 : 0) + (c.userId ? 1 : 0);
    return score(b) - score(a);
  });

  for (const c of list) {
    const uid = c.userId || null;
    const nameKey = normalizeParticipantName(c.handle || c.name);

    if (uid) {
      if (seenUids.has(uid)) {
        absorb(indexOfUid(uid), c);
        continue;
      }
      seenUids.add(uid);
      out.push(c);
      continue;
    }

    if (!nameKey) continue;

    // Same name as an account holder: link only when exactly one account matches.
    const accountMatches = new Set([
      ...out.filter((x) => x.userId && normalizeParticipantName(x.handle || x.name) === nameKey).map((x) => x.userId),
      ...(profileUidsByName.get(nameKey) || []),
    ]);
    if (accountMatches.size === 1) {
      const [targetUid] = accountMatches;
      let index = indexOfUid(targetUid);
      if (index < 0) {
        out.push({
          id: targetUid,
          userId: targetUid,
          handle: memberProfiles[targetUid] || c.handle || c.name,
          name: memberProfiles[targetUid] || c.name || c.handle,
          role: 'contributor',
        });
        seenUids.add(targetUid);
        index = out.length - 1;
      }
      absorb(index, c);
      continue;
    }
    if (accountMatches.size > 1) {
      // Ambiguous: keep the roster row so its assignments are not orphaned.
      out.push(c);
      continue;
    }

    const rosterIndex = out.findIndex((x) => !x.userId && normalizeParticipantName(x.handle || x.name) === nameKey);
    if (rosterIndex >= 0) {
      absorb(rosterIndex, c);
      continue;
    }
    out.push(c);
  }

  return out;
}

/** Map a saved assignee id (roster id, alias, or account id) to the id used for that person now. */
export function canonicalParticipantId(trip, rawId) {
  if (!rawId) return rawId;
  if (trip?.ownerId === rawId) return rawId;
  const merged = dedupeCollaborators(trip?.collaborators || [], { memberProfiles: trip?.memberProfiles || {} });
  const holder = merged.find((c) => c.userId === rawId || c.id === rawId || aliasIdsOf(c).includes(rawId));
  return holder ? (holder.userId || holder.id) : rawId;
}

export function mergeCollaboratorsFromMembers(trip, memberRows = []) {
  const ownerId = trip?.ownerId || null;
  const memberIds = new Set((memberRows || []).map((row) => row.user_id).filter(Boolean));

  // Roster rows whose name matches a member are kept here; dedupeCollaborators
  // folds them into that member (as an alias) instead of discarding them.
  const manual = (trip?.collaborators || []).filter((c) => {
    if (isJoinedMember(c)) return false;
    if (c?.userId && memberIds.has(c.userId)) return false;
    const id = c?.id || c?.handle;
    if (!id) return false;
    if (UUID_RE.test(String(id)) && memberIds.has(id)) return false;
    return true;
  });

  const fromCloud = (memberRows || [])
    .filter((row) => row.user_id && row.user_id !== ownerId)
    .map((row) => {
      const existing = (trip?.collaborators || []).find(
        (c) => c.userId === row.user_id || c.id === row.user_id,
      );
      return {
        ...(existing?.craft ? { craft: existing.craft } : {}),
        ...(existing?.tripNickname ? { tripNickname: existing.tripNickname } : {}),
        ...(aliasIdsOf(existing).length ? { aliasIds: aliasIdsOf(existing) } : {}),
        id: row.user_id,
        userId: row.user_id,
        handle: row.profiles?.display_name || existing?.handle || 'Participant',
        name: row.profiles?.display_name || existing?.name || 'Participant',
        role: row.role || existing?.role || 'contributor',
        joinedViaInvite: true,
      };
    });

  const ownerMetaEntry = ownerId
    ? (trip?.collaborators || []).find((c) => (c.userId === ownerId || c.id === ownerId)
      && (c.craft || c.tripNickname || aliasIdsOf(c).length))
    : null;

  const nextProfiles = memberProfilesFromRows(memberRows);
  const merged = dedupeCollaborators(
    [...(ownerMetaEntry ? [ownerMetaEntry] : []), ...manual, ...fromCloud],
    { memberProfiles: nextProfiles },
  );
  const ownerEntry = merged.find((c) => c.userId === ownerId || c.id === ownerId);
  return ownerEntry ? [ownerEntry, ...merged.filter((c) => c !== ownerEntry)] : merged;
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

  const collaborator = (trip?.collaborators || []).find(
    (c) => c.userId === userId || c.id === userId,
  );
  if (collaborator?.tripNickname?.trim()) {
    return collaborator.tripNickname.trim();
  }

  const cached = trip?.memberProfiles?.[userId];
  if (cached) return cached;

  if (collaborator?.handle || collaborator?.name) {
    return collaborator.handle || collaborator.name;
  }

  if (userId === currentUserId || userId === getSignedInUserId()) {
    return getSignedInDisplayName() || 'Me';
  }

  const canonical = canonicalParticipantId(trip, userId);
  if (canonical && canonical !== userId) {
    return resolveUserDisplayName(trip, canonical, currentUserId);
  }

  return 'Participant';
}

/**
 * Current display name for an assignee. Saved labels (assignedToLabel) are a
 * snapshot from assignment time, so they are only a fallback for unknown ids;
 * otherwise renaming someone would never show up on their meals and gear.
 */
export function participantDisplayName(trip, userId, currentUserId, fallbackLabel = null) {
  if (!userId) return fallbackLabel || null;
  const name = resolveUserDisplayName(trip, userId, currentUserId);
  if (name === 'Participant' || name === 'Unknown') return fallbackLabel || name;
  return name;
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
    const ownerCollab = (trip.collaborators || []).find(
      (c) => c.userId === trip.ownerId || c.id === trip.ownerId,
    );
    out.push(withOwnerMeta
      ? { id: trip.ownerId, label, role: 'owner', isOwner: true, craft: ownerCollab?.craft || null, tripNickname: ownerCollab?.tripNickname || null }
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
      ? { id, label, role: c.role || 'contributor', isOwner: false, joinedViaInvite: isJoinedMember(c), craft: c.craft || null, tripNickname: c.tripNickname || null }
      : { id, label });
  }

  return out;
}
