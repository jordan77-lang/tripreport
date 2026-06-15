import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { T, F } from '../tokens';

export function ProfileSetup() {
  const { upsertProfile, user } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await upsertProfile(displayName);
    } catch (err) {
      setError(err?.message || 'Could not save profile');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: '100%', background: T.bg, fontFamily: F, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, padding: '32px 20px 24px', maxWidth: 420, margin: '0 auto', width: '100%' }}>
        <div style={{ fontSize: 24, fontWeight: 900, color: T.text, marginBottom: 8 }}>What should we call you?</div>
        <div style={{ fontSize: 13, color: T.textSub, marginBottom: 24, lineHeight: 1.5 }}>
          This name shows on journal entries, expenses, and trip invites for your crew.
        </div>

        <form onSubmit={handleSubmit}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: T.textSub, marginBottom: 6 }}>Display name</label>
          <input
            type="text"
            required
            autoFocus
            maxLength={40}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Jordan"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              border: `1px solid ${T.border}`,
              borderRadius: 10,
              padding: '12px 13px',
              fontSize: 14,
              background: T.card,
            }}
          />

          {!!error && (
            <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 10, background: '#FBE4E4', color: '#8A1414', fontSize: 12, fontWeight: 600 }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy || !displayName.trim()}
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
              opacity: busy || !displayName.trim() ? 0.7 : 1,
            }}
          >
            {busy ? 'Saving…' : 'Continue'}
          </button>
        </form>

        {user?.email && (
          <div style={{ marginTop: 18, fontSize: 11, color: T.textFaint }}>
            Signed in as {user.email}
          </div>
        )}
      </div>
    </div>
  );
}
