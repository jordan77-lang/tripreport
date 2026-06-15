export function buildTripParticipants(trip, currentUserId) {
  if (!trip) return [];
  const out = [];
  const seen = new Set();
  if (trip.ownerId) {
    out.push({ id: trip.ownerId, label: trip.ownerId === currentUserId ? 'You' : 'Owner' });
    seen.add(trip.ownerId);
  }
  for (const c of trip.collaborators || []) {
    const id = c?.id || c?.handle;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: c.handle || c.name || 'Participant' });
  }
  return out;
}

export function resolveSplitIds(expense, participantIds) {
  if (!expense) return [];
  if (expense.splitAmong === 'all' || !Array.isArray(expense.splitAmong) || !expense.splitAmong.length) {
    return participantIds;
  }
  return expense.splitAmong.filter((id) => participantIds.includes(id));
}

export function computeBalances(expenses, participants) {
  const ids = participants.map((p) => p.id);
  if (!ids.length) return {};
  const balance = {};
  ids.forEach((id) => { balance[id] = 0; });

  for (const e of expenses || []) {
    const amount = e.amount || 0;
    const split = resolveSplitIds(e, ids);
    if (!split.length) continue;
    const share = amount / split.length;
    if (balance[e.paidBy] != null) balance[e.paidBy] += amount;
    split.forEach((id) => { if (balance[id] != null) balance[id] -= share; });
  }
  return balance;
}

export function computeSettlements(balances) {
  const debtors = [];
  const creditors = [];
  for (const [id, value] of Object.entries(balances || {})) {
    if (value < -0.01) debtors.push({ id, amount: -value });
    else if (value > 0.01) creditors.push({ id, amount: value });
  }
  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const out = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amount, creditors[j].amount);
    out.push({ from: debtors[i].id, to: creditors[j].id, amount: pay });
    debtors[i].amount -= pay;
    creditors[j].amount -= pay;
    if (debtors[i].amount < 0.01) i += 1;
    if (creditors[j].amount < 0.01) j += 1;
  }
  return out;
}

export function labelFor(participants, id) {
  return participants.find((p) => p.id === id)?.label || 'Someone';
}

export function formatSplitLabel(expense, participants) {
  const ids = participants.map((p) => p.id);
  const split = resolveSplitIds(expense, ids);
  if (expense.splitAmong === 'all' || !Array.isArray(expense.splitAmong)) {
    return 'Whole group';
  }
  if (split.length === ids.length) return 'Whole group';
  if (split.length === 1) return labelFor(participants, split[0]);
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
  return `$${(value || 0).toFixed(2)}`;
}
