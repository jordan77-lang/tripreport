export { buildTripParticipants, isJoinedMember, resolveUserDisplayName, formatOwnerParticipantLabel } from './tripParticipants';

const ANON_USER_KEY = 'tr_user_id';

export function roundMoney(value) {
  const n = Number(value) || 0;
  return Math.round(n * 100) / 100;
}

/** Map legacy / alternate ids (anon owner, collaborator id vs userId) to current participant ids. */
export function buildParticipantAliasMap(trip, participants) {
  const map = new Map();
  for (const p of participants) {
    map.set(p.id, p.id);
  }
  for (const c of trip?.collaborators || []) {
    const pid = participants.find((p) => p.id === c.userId || p.id === c.id)?.id;
    if (!pid) continue;
    if (c.id) map.set(c.id, pid);
    if (c.userId && c.userId !== c.id) map.set(c.userId, pid);
  }
  if (trip?.ownerId && map.has(trip.ownerId)) {
    try {
      const anonId = typeof localStorage !== 'undefined' ? localStorage.getItem(ANON_USER_KEY) : null;
      if (anonId) map.set(anonId, trip.ownerId);
    } catch {
      // ignore
    }
  }
  return map;
}

export function resolveParticipantId(rawId, aliasMap, participantIds) {
  if (!rawId) return null;
  if (participantIds.includes(rawId)) return rawId;
  return aliasMap?.get(rawId) || null;
}

export function resolveSplitIds(expense, participantIds, aliasMap = null) {
  if (!expense) return [];

  let raw;
  if (expense.splitAmong === 'all' || !Array.isArray(expense.splitAmong) || !expense.splitAmong.length) {
    raw = participantIds;
  } else if (aliasMap) {
    raw = expense.splitAmong;
  } else {
    return expense.splitAmong.filter((id) => participantIds.includes(id));
  }

  if (!aliasMap) return raw;

  const resolved = [...new Set(
    raw
      .map((id) => resolveParticipantId(id, aliasMap, participantIds))
      .filter(Boolean),
  )];

  if (resolved.length) return resolved;
  if (Array.isArray(expense.splitAmong) && expense.splitAmong.length) return [];
  return participantIds;
}

export function expenseShareAmount(expense, splitIds) {
  const count = splitIds?.length || 0;
  if (!count) return 0;
  return roundMoney((expense?.amount || 0) / count);
}

export function computeBalances(expenses, participants, { trip } = {}) {
  const ids = participants.map((p) => p.id);
  if (!ids.length) return {};
  const aliasMap = trip ? buildParticipantAliasMap(trip, participants) : null;
  const balance = {};
  ids.forEach((id) => { balance[id] = 0; });

  for (const e of expenses || []) {
    const amount = Number(e.amount) || 0;
    if (amount <= 0) continue;
    const split = resolveSplitIds(e, ids, aliasMap);
    if (!split.length) continue;
    const share = amount / split.length;
    const payer = aliasMap
      ? resolveParticipantId(e.paidBy, aliasMap, ids)
      : e.paidBy;
    if (payer && balance[payer] != null) balance[payer] += amount;
    split.forEach((id) => {
      if (balance[id] != null) balance[id] -= share;
    });
  }
  return balance;
}

export function computeSettlements(balances) {
  const debtors = [];
  const creditors = [];
  for (const [id, value] of Object.entries(balances || {})) {
    const rounded = roundMoney(value);
    if (rounded < -0.01) debtors.push({ id, amount: -rounded });
    else if (rounded > 0.01) creditors.push({ id, amount: rounded });
  }
  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const out = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = roundMoney(Math.min(debtors[i].amount, creditors[j].amount));
    if (pay > 0) out.push({ from: debtors[i].id, to: creditors[j].id, amount: pay });
    debtors[i].amount = roundMoney(debtors[i].amount - pay);
    creditors[j].amount = roundMoney(creditors[j].amount - pay);
    if (debtors[i].amount < 0.01) i += 1;
    if (creditors[j].amount < 0.01) j += 1;
  }
  return out;
}

export function labelFor(participants, id) {
  return participants.find((p) => p.id === id)?.label || 'Someone';
}

export function formatSplitLabel(expense, participants, trip = null) {
  if (expense?.splitGroupName) return expense.splitGroupName;

  const ids = participants.map((p) => p.id);
  const aliasMap = trip ? buildParticipantAliasMap(trip, participants) : null;
  const split = resolveSplitIds(expense, ids, aliasMap);
  if (expense.splitAmong === 'all' || !Array.isArray(expense.splitAmong)) {
    return split.length === ids.length ? 'Whole trip' : `${split.length} people`;
  }
  if (split.length === ids.length) return 'Whole trip';
  if (split.length === 1) return labelFor(participants, split[0]);
  if (split.length === 0) return 'No one (update split)';
  return split.map((id) => labelFor(participants, id)).join(', ');
}

export function formatExpenseContext(expense) {
  if (expense?.eventName) {
    return expense.locationName ? `${expense.locationName} · ${expense.eventName}` : expense.eventName;
  }
  if (expense?.locationName) return expense.locationName;
  return 'Trip';
}

export function filterExpenses(expenses, scope, { locationId, eventId } = {}) {
  const list = expenses || [];
  if (scope === 'event' && eventId) return list.filter((e) => e.eventId === eventId);
  if (scope === 'location' && locationId) return list.filter((e) => e.locationId === locationId);
  if (scope === 'trip') return list.filter((e) => !e.eventId && !e.locationId);
  return list;
}

export function money(value) {
  return `$${roundMoney(value).toFixed(2)}`;
}

export function computeParticipantBreakdown(expenses, participants, { trip } = {}) {
  const ids = participants.map((p) => p.id);
  if (!ids.length) return [];

  const aliasMap = trip ? buildParticipantAliasMap(trip, participants) : null;
  const paid = {};
  const share = {};
  ids.forEach((id) => {
    paid[id] = 0;
    share[id] = 0;
  });

  for (const e of expenses || []) {
    const amount = Number(e.amount) || 0;
    if (amount <= 0) continue;
    const split = resolveSplitIds(e, ids, aliasMap);
    if (!split.length) continue;
    const portion = amount / split.length;
    const payer = aliasMap
      ? resolveParticipantId(e.paidBy, aliasMap, ids)
      : e.paidBy;
    if (payer && paid[payer] != null) paid[payer] += amount;
    split.forEach((id) => {
      if (share[id] != null) share[id] += portion;
    });
  }

  return participants.map((p) => ({
    id: p.id,
    label: p.label,
    paid: roundMoney(paid[p.id] || 0),
    share: roundMoney(share[p.id] || 0),
    net: roundMoney((paid[p.id] || 0) - (share[p.id] || 0)),
  }));
}
