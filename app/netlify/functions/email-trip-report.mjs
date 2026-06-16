import { createClient } from '@supabase/supabase-js';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.REPORT_EMAIL_FROM;
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

  const { to, tripName, docxBase64, fileName } = body;
  const recipient = to || user.email;
  if (!recipient || !docxBase64) {
    return json(400, { error: 'Email address and document are required' });
  }

  if (user.email && recipient.toLowerCase() !== user.email.toLowerCase()) {
    return json(403, { error: 'You can only email reports to your own address.' });
  }

  const name = fileName || 'trip-report.docx';
  const subject = tripName ? `TripReport: ${tripName}` : 'Your TripReport';

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [recipient],
      subject,
      html: `<p>Your trip report from TripReport is attached.</p><p>Open the <strong>.docx</strong> file on your computer in Microsoft Word, or upload it to Google Drive and open with Google Docs to edit.</p>`,
      attachments: [{ filename: name, content: docxBase64 }],
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return json(res.status, { error: data.message || 'Email provider error' });
  }

  return json(200, { ok: true, id: data.id });
}

async function verifyAuth(authHeader) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error('Sign in required');
  if (!authHeader?.startsWith('Bearer ')) throw new Error('Sign in required');
  const jwt = authHeader.slice(7);
  const supabase = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data, error } = await supabase.auth.getUser(jwt);
  if (error || !data?.user) throw new Error('Invalid session');
  return data.user;
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
