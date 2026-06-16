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
    throw new Error('Sign in to use AI report and email.');
  }
  headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function generateTripReport({ manifest, settings, photos }) {
  const res = await fetch(`${FN_BASE}/generate-trip-report`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ manifest, settings, photos }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || body.message || `Report generation failed (${res.status})`);
  }
  return body;
}

export async function emailTripReport({ to, tripName, docxBase64, encoding, fileName }) {
  const res = await fetch(`${FN_BASE}/email-trip-report`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ to, tripName, docxBase64, encoding, fileName }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || body.message || `Could not send email (${res.status})`);
  }
  return body;
}
