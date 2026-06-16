import { supabase } from './supabase';

const FN_BASE = '/.netlify/functions';

async function authHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (!supabase) return headers;
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (token) headers.Authorization = `Bearer ${token}`;
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

export async function emailTripReport({ to, tripName, docxBase64, fileName }) {
  const res = await fetch(`${FN_BASE}/email-trip-report`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ to, tripName, docxBase64, fileName }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || body.message || `Could not send email (${res.status})`);
  }
  return body;
}
