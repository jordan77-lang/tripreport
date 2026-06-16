import OpenAI from 'openai';
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

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return json(503, { error: 'OPENAI_API_KEY is not configured on the server.' });
  }

  try {
    await verifyAuth(event.headers.authorization || event.headers.Authorization);
  } catch (e) {
    return json(401, { error: e.message || 'Unauthorized' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  const { manifest, settings = {}, photos = [] } = body;
  if (!manifest?.name) {
    return json(400, { error: 'Trip manifest is required' });
  }

  const systemPrompt = buildSystemPrompt(settings);
  const userContent = buildUserContent(manifest, settings, photos);

  const openai = new OpenAI({ apiKey });
  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_REPORT_MODEL || 'gpt-4o',
    temperature: 0.65,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    max_tokens: settings.length === 'short' ? 1800 : settings.length === 'detailed' ? 4500 : 3000,
  });

  const raw = completion.choices?.[0]?.message?.content || '{}';
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json(502, { error: 'AI returned invalid JSON. Try again.' });
  }

  return json(200, {
    title: parsed.title || manifest.name,
    subtitle: parsed.subtitle || '',
    executiveSummary: parsed.executiveSummary || parsed.summary || '',
    sections: Array.isArray(parsed.sections) ? parsed.sections : [],
    closing: parsed.closing || '',
  });
}

function buildSystemPrompt(settings) {
  const toneMap = {
    family: 'warm, personal, suitable for family and friends',
    formal: 'professional field patrol / agency report tone',
    adventure: 'vivid outdoor adventure storytelling',
  };
  const focusMap = {
    balanced: 'balance river, camps, wildlife, and people',
    river: 'emphasize river conditions, rapids, and flow',
    wildlife: 'emphasize wildlife and natural observations',
    camps: 'emphasize camps, meals, and the crew',
  };

  return `You write trip recap reports for TripReport, an outdoor expedition logging app.
Return ONLY valid JSON with this shape:
{
  "title": string,
  "subtitle": string,
  "executiveSummary": string,
  "sections": [{ "heading": string, "body": string }],
  "closing": string
}

Rules:
- Tone: ${toneMap[settings.tone] || toneMap.family}
- Length: ${settings.length || 'standard'}
- Audience: ${settings.audience || 'family'}
- Focus: ${focusMap[settings.focus] || focusMap.balanced}
- Voice: ${settings.voice === 'third' ? 'third person' : 'first person plural (we)'}
- Use ONLY facts from the manifest and what you see in photos. Do not invent gauge readings, places, or events.
- Organize sections by day when possible (heading like "Day 1 — ...").
- Reference photo labels when they support the narrative.
- ${settings.includeStats === false ? 'Do not emphasize numeric stats.' : 'Weave in provided stats naturally.'}
- Write prose paragraphs in section body fields, not bullet lists unless appropriate for data.`;
}

function buildUserContent(manifest, settings, photos) {
  const parts = [
    {
      type: 'text',
      text: `Trip manifest JSON:\n${JSON.stringify(manifest, null, 2)}`,
    },
  ];

  for (const p of photos.slice(0, 30)) {
    if (!p?.base64) continue;
    parts.push({
      type: 'text',
      text: `Photo ${p.id}: ${p.label || 'Trip photo'}${p.day ? ` (${p.day})` : ''}${p.locationName ? ` at ${p.locationName}` : ''}`,
    });
    parts.push({
      type: 'image_url',
      image_url: {
        url: `data:${p.mime || 'image/jpeg'};base64,${p.base64}`,
        detail: settings.photoScope === 'all' ? 'low' : 'auto',
      },
    });
  }

  return parts;
}

async function verifyAuth(authHeader) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) return; // dev fallback if auth not configured on server
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Sign in required');
  }
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
