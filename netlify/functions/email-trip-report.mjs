import { gunzipSync } from 'node:zlib';
import { verifyAuth } from './shared/supabaseAuth.mjs';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

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
    return json(400, { error: 'Invalid JSON body — report may be too large to upload. Try Download .docx instead.' });
  }

  const { to, tripName, docxBase64, encoding = 'raw', fileName } = body;
  const recipient = to || user?.email;
  if (!recipient) {
    return json(400, { error: 'Your account needs an email address to receive reports.' });
  }
  if (!docxBase64 || typeof docxBase64 !== 'string') {
    return json(400, { error: 'Document missing — report may be too large. Try Download .docx instead.' });
  }

  if (user.email && recipient.toLowerCase() !== user.email.toLowerCase()) {
    return json(403, { error: 'You can only email reports to your own address.' });
  }

  let attachmentBase64;
  try {
    attachmentBase64 = decodeDocxAttachment(docxBase64, encoding);
  } catch (e) {
    return json(400, { error: e.message || 'Could not read document attachment.' });
  }

  const name = sanitizeFileName(fileName || 'trip-report.docx');
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
      html: '<p>Your trip report from TripReport is attached.</p><p>Open the <strong>.docx</strong> file on your computer in Microsoft Word, or upload it to Google Drive and open with Google Docs to edit.</p>',
      attachments: [{
        filename: name,
        content: attachmentBase64,
        content_type: DOCX_MIME,
      }],
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return json(res.status, { error: formatResendError(data) || 'Email provider error' });
  }

  return json(200, { ok: true, id: data.id });
}

function decodeDocxAttachment(docxBase64, encoding) {
  const raw = Buffer.from(String(docxBase64).trim(), 'base64');
  if (!raw.length) throw new Error('Document attachment is empty.');

  const bytes = encoding === 'gzip' ? gunzipSync(raw) : raw;
  if (!bytes.length) throw new Error('Document attachment is empty after decoding.');

  // Resend expects raw base64 without data-URI prefix.
  return bytes.toString('base64');
}

function formatResendError(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.message) return data.message;
  if (Array.isArray(data.errors)) {
    return data.errors.map((e) => e.message || e).filter(Boolean).join('; ');
  }
  if (data.error) return typeof data.error === 'string' ? data.error : data.error?.message;
  return null;
}

function sanitizeFileName(name) {
  const base = String(name || 'trip-report.docx').replace(/[^a-zA-Z0-9._-]+/g, '-');
  return base.toLowerCase().endsWith('.docx') ? base : `${base}.docx`;
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
