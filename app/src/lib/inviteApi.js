import { supabase } from './supabase';

const FN_BASE = '/.netlify/functions';

async function accessToken() {
  if (!supabase) return null;

  let { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    const { data: refreshed } = await supabase.auth.refreshSession();
    session = refreshed?.session ?? null;
  }
  if (!session?.access_token) return null;

  const expiresAtMs = (session.expires_at ?? 0) * 1000;
  if (expiresAtMs && Date.now() >= expiresAtMs - 60_000) {
    const { data: refreshed, error } = await supabase.auth.refreshSession();
    if (error || !refreshed.session?.access_token) return null;
    session = refreshed.session;
  }

  return session.access_token;
}

async function authHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const token = await accessToken();
  if (!token) {
    throw new Error('Sign in to send trip invites.');
  }
  headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function emailTripInvite({
  tripId,
  tripName,
  to,
  inviteCode,
  inviteeName,
}) {
  const appUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const res = await fetch(`${FN_BASE}/email-trip-invite`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({
      tripId,
      tripName,
      to,
      inviteCode,
      inviteeName,
      appUrl,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || body.message || `Could not send invite email (${res.status})`);
  }
  return body;
}
