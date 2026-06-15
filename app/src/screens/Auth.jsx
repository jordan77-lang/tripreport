import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { T, F } from '../tokens';

export function AuthScreen() {
  const { signInWithEmail, signInWithPassword, signUpWithPassword } = useAuth();
  const [mode, setMode] = useState('signin'); // signin | signup | magic
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (mode === 'magic') {
        await signInWithEmail(email);
        setMessage('Check your email for a sign-in link. Open it on this phone.');
      } else if (mode === 'signup') {
        await signUpWithPassword(email, password);
        setMessage('Account created. Check email to confirm, or sign in if confirmation is off.');
      } else {
        await signInWithPassword(email, password);
      }
    } catch (err) {
      setError(err?.message || 'Could not sign in');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: '100%', background: T.bg, fontFamily: F, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, padding: '32px 20px 24px', maxWidth: 420, margin: '0 auto', width: '100%' }}>
        <div style={{ fontSize: 28, fontWeight: 900, color: T.text, letterSpacing: -0.6, marginBottom: 6 }}>TripReport</div>
        <div style={{ fontSize: 13, color: T.textSub, marginBottom: 28, lineHeight: 1.5 }}>
          Sign in to plan trips with your crew and sync when you have service.
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
          {[
            { id: 'signin', label: 'Sign in' },
            { id: 'signup', label: 'Create account' },
            { id: 'magic', label: 'Email link' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => { setMode(tab.id); setError(null); setMessage(null); }}
              style={{
                flex: 1,
                border: `1px solid ${mode === tab.id ? T.accent : T.border}`,
                background: mode === tab.id ? T.accentLight : T.card,
                color: mode === tab.id ? T.accent : T.textSub,
                borderRadius: 10,
                padding: '9px 8px',
                fontSize: 11.5,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: T.textSub, marginBottom: 6 }}>Email</label>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            style={inputStyle}
          />

          {mode !== 'magic' && (
            <>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: T.textSub, marginBottom: 6, marginTop: 14 }}>Password</label>
              <input
                type="password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                style={inputStyle}
              />
            </>
          )}

          {!!error && (
            <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 10, background: '#FBE4E4', color: '#8A1414', fontSize: 12, fontWeight: 600 }}>
              {error}
            </div>
          )}
          {!!message && (
            <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 10, background: T.accentLight, color: T.accent, fontSize: 12, fontWeight: 600 }}>
              {message}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            style={{
              width: '100%',
              marginTop: 20,
              border: 'none',
              borderRadius: 12,
              padding: '14px 16px',
              background: T.accent,
              color: 'white',
              fontSize: 14,
              fontWeight: 800,
              cursor: busy ? 'wait' : 'pointer',
              opacity: busy ? 0.7 : 1,
              boxShadow: `0 4px 16px ${T.accent}35`,
            }}
          >
            {busy ? 'Working…' : mode === 'magic' ? 'Send sign-in link' : mode === 'signup' ? 'Create account' : 'Sign in'}
          </button>
        </form>

        {mode === 'magic' && (
          <div style={{ marginTop: 16, fontSize: 11, color: T.textFaint, lineHeight: 1.5 }}>
            Email links work best with service. For the river, create an account with password while you still have Wi‑Fi.
          </div>
        )}
      </div>
    </div>
  );
}

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  border: `1px solid ${T.border}`,
  borderRadius: 10,
  padding: '12px 13px',
  fontSize: 14,
  background: T.card,
  color: T.text,
};
