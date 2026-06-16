/** Verify Supabase JWT via Auth REST API (no Realtime / WebSocket). */
export async function verifyAuth(authHeader, { optional = false } = {}) {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    if (optional) return null;
    throw new Error('Sign in required');
  }
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Sign in required');
  }

  const res = await fetch(`${url}/auth/v1/user`, {
    headers: {
      Authorization: authHeader,
      apikey: anon,
    },
  });

  if (!res.ok) {
    throw new Error(res.status === 401 ? 'Invalid session — sign in again' : 'Sign in required');
  }

  return res.json();
}
