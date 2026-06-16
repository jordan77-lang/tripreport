import ws from 'ws';
import { createClient } from '@supabase/supabase-js';

/** Verify Supabase JWT from Authorization header (serverless-safe client). */
export async function verifyAuth(authHeader, { optional = false } = {}) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    if (optional) return null;
    throw new Error('Sign in required');
  }
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Sign in required');
  }
  const jwt = authHeader.slice(7);
  const supabase = createClient(url, anon, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    realtime: { transport: ws },
  });
  const { data, error } = await supabase.auth.getUser(jwt);
  if (error || !data?.user) throw new Error('Invalid session');
  return data.user;
}
