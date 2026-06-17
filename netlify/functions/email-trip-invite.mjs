import { Resend } from 'resend';
import { verifyAuth } from './shared/supabaseAuth.mjs';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export async function handler(event) {
  try {
    return await handleInviteEmail(event);
  } catch (err) {
    console.error('email-trip-invite failed:', err);
    return json(500, { error: err?.message || 'Unexpected email error' });
  }
}

async function handleInviteEmail(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.REPORT_EMAIL_FROM?.trim();
  if (!resendKey || !from) {
    return json(503, { error: 'Email is not configured (RESEND_API_KEY, REPORT_EMAIL_FROM).' });
  }

  let user;
  try {
    user = await verifyAuth(event.headers.authorization || event.headers.Authorization);
  } catch (e) {
    return json(401, { error: e.message || 'Unauthorized' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  const { tripId, tripName, to, inviteCode, inviteeName, appUrl } = body;
  const recipient = String(to || '').trim().toLowerCase();
  if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    return json(400, { error: 'A valid email address is required.' });
  }
  if (!tripId || !inviteCode) {
    return json(400, { error: 'Trip and invite code are required.' });
  }

  const isOwner = await verifyTripOwner(tripId, user.id, event.headers.authorization || event.headers.Authorization);
  if (!isOwner) {
    return json(403, { error: 'Only the trip owner can send invite emails.' });
  }

  const code = String(inviteCode).trim().toUpperCase();
  const name = tripName || 'your trip';
  const inviter = user.user_metadata?.display_name || user.email?.split('@')[0] || 'Your trip lead';
  const guest = inviteeName?.trim() || 'there';
  const base = (appUrl || '').replace(/\/$/, '') || 'https://tripreportapp.netlify.app';
  const joinUrl = `${base}/?join=${encodeURIComponent(code)}`;

  const html = `
    <p>Hi ${escapeHtml(guest)},</p>
    <p><strong>${escapeHtml(inviter)}</strong> invited you to join <strong>${escapeHtml(name)}</strong> on TripReport.</p>
    <ol>
      <li>Open <a href="${escapeHtml(joinUrl)}">TripReport</a></li>
      <li>Create an account or sign in</li>
      <li>Tap <strong>Join trip</strong> and enter invite code: <strong>${escapeHtml(code)}</strong></li>
    </ol>
    <p>Invite code: <strong style="letter-spacing:2px">${escapeHtml(code)}</strong></p>
    <p style="color:#666;font-size:13px">TripReport helps your crew plan gear, meals, and expenses — and log the trip together offline or online.</p>
  `;

  const resend = new Resend(resendKey);
  const { data, error } = await resend.emails.send({
    from,
    to: [recipient],
    subject: `You're invited to ${name} on TripReport`,
    html,
  });

  if (error) {
    console.error('Resend invite error:', error);
    const status = Number(error.statusCode) || 502;
    return json(status >= 400 && status < 600 ? status : 502, {
      error: error.message || 'Email provider error',
    });
  }

  return json(200, { ok: true, id: data?.id });
}

async function verifyTripOwner(tripId, userId, authHeader) {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon || !authHeader) return false;

  const res = await fetch(`${url}/rest/v1/trips?id=eq.${encodeURIComponent(tripId)}&select=owner_id`, {
    headers: {
      Authorization: authHeader,
      apikey: anon,
      Accept: 'application/json',
    },
  });

  if (!res.ok) return false;
  const rows = await res.json();
  return rows?.[0]?.owner_id === userId;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
