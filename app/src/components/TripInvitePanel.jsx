import { useMemo, useState, useEffect } from 'react';
import { T, F } from '../tokens';
import { ts } from '../lib/textScale';
import { getPastTripParticipants } from '../lib/storage';
import {
  fetchUserEmailForInvite,
  getOrCreateTripInviteCode,
  sendTripInviteByEmail,
} from '../lib/tripCloud';
import { supabaseConfigured } from '../lib/supabase';

const MODES = [
  { id: 'past', label: 'Past crew' },
  { id: 'email', label: 'Email' },
  { id: 'code', label: 'Join code' },
];

export function TripInvitePanel({ trip, onTripUpdate, onClose, compact = false, initialCode = null, onDismissInitial }) {
  const [mode, setMode] = useState(initialCode ? 'code' : 'past');
  const [code, setCode] = useState(initialCode || null);
  const [codeBusy, setCodeBusy] = useState(false);
  const [pastId, setPastId] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [copied, setCopied] = useState(false);

  const pastCrew = useMemo(
    () => getPastTripParticipants({ excludeTripId: trip?.id }),
    [trip?.id],
  );

  const selectedPast = pastCrew.find((p) => p.id === pastId) || null;

  useEffect(() => {
    if (initialCode) {
      setCode(initialCode);
      setMode('code');
    }
  }, [initialCode]);

  async function ensureCode() {
    if (code) return code;
    setCodeBusy(true);
    try {
      const next = await getOrCreateTripInviteCode(trip.id);
      setCode(next);
      return next;
    } finally {
      setCodeBusy(false);
    }
  }

  async function invitePastCrew() {
    if (!selectedPast || busy) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      let to = email.trim().toLowerCase();
      if (selectedPast.userId) {
        const lookedUp = await fetchUserEmailForInvite(selectedPast.userId);
        if (lookedUp) to = lookedUp.toLowerCase();
      }
      if (!to) {
        setError(`${selectedPast.name} has no email on file. Switch to the Email tab and enter their address.`);
        setMode('email');
        return;
      }
      await sendTripInviteByEmail(trip.id, {
        email: to,
        inviteeName: selectedPast.name,
        invitedUserId: selectedPast.userId || null,
      });
      setCode(await getOrCreateTripInviteCode(trip.id));
      setSuccess(`Invite emailed to ${to}`);
      setPastId('');
      onTripUpdate?.();
    } catch (e) {
      setError(e?.message || 'Could not send invite');
    } finally {
      setBusy(false);
    }
  }

  async function inviteByEmail() {
    const to = email.trim().toLowerCase();
    if (!to || busy) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const inviteCode = await sendTripInviteByEmail(trip.id, { email: to });
      setCode(inviteCode);
      setSuccess(`Invite emailed to ${to}`);
      setEmail('');
      onTripUpdate?.();
    } catch (e) {
      setError(e?.message || 'Could not send invite');
    } finally {
      setBusy(false);
    }
  }

  async function loadCode() {
    setError(null);
    try {
      await ensureCode();
    } catch (e) {
      setError(e?.message || 'Could not create invite code');
    }
  }

  async function copyCode() {
    if (!code) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy — select the code and copy manually.');
    }
  }

  async function shareCode() {
    if (!code) return;
    const text = `Join ${trip?.name || 'our trip'} on TripReport. Invite code: ${code}\n${window.location.origin}/?join=${code}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'TripReport invite', text });
        return;
      }
    } catch {
      // cancelled
    }
    void copyCode();
  }

  if (!trip?.id) return null;

  if (!supabaseConfigured) {
    return (
      <div style={panelStyle}>
        <div style={{ fontSize: ts(13), color: T.textSub }}>
          Cloud invites need Supabase configured. Add crew names locally from New Trip for now.
        </div>
      </div>
    );
  }

  return (
    <div style={panelStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: ts(compact ? 13 : 14), fontWeight: 800, color: T.text }}>
            {initialCode ? 'Trip created — invite your crew' : 'Invite participants'}
          </div>
          <div style={{ fontSize: ts(12), color: T.textSub, marginTop: 4, lineHeight: 1.45 }}>
            Email past crew, invite someone new, or share a join code.
          </div>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} style={{ border: 'none', background: 'transparent', color: T.textFaint, cursor: 'pointer', fontSize: 18 }}>×</button>
        )}
        {!onClose && onDismissInitial && initialCode && (
          <button type="button" onClick={onDismissInitial} style={{ border: 'none', background: 'transparent', color: T.textFaint, cursor: 'pointer', fontSize: 18 }}>×</button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => { setMode(m.id); setError(null); setSuccess(null); }}
            style={{
              flex: 1,
              padding: '8px 6px',
              borderRadius: 9,
              border: `1px solid ${mode === m.id ? T.accent : T.border}`,
              background: mode === m.id ? '#E4EFF8' : T.bg,
              color: mode === m.id ? '#2A5C8E' : T.textSub,
              fontSize: ts(11),
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: F,
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === 'past' && (
        <div>
          {pastCrew.length === 0 ? (
            <div style={{ fontSize: ts(12), color: T.textFaint, lineHeight: 1.45 }}>
              No past crew yet. After someone joins a trip they will appear here for quick re-invites.
            </div>
          ) : (
            <>
              <label style={labelStyle}>Past participant</label>
              <select
                value={pastId}
                onChange={(e) => setPastId(e.target.value)}
                style={selectStyle}
              >
                <option value="">Choose someone…</option>
                {pastCrew.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.hasAccount ? '' : ' (name only)'}
                  </option>
                ))}
              </select>
              {selectedPast && !selectedPast.hasAccount && (
                <div style={{ fontSize: ts(11), color: '#8A5526', marginTop: 8, lineHeight: 1.4 }}>
                  This person was added by name only. Use the Email tab to enter their address.
                </div>
              )}
              <button
                type="button"
                disabled={!pastId || busy || (selectedPast && !selectedPast.hasAccount)}
                onClick={() => void invitePastCrew()}
                style={primaryBtn(!pastId || busy || (selectedPast && !selectedPast.hasAccount))}
              >
                {busy ? 'Sending…' : 'Email invite'}
              </button>
            </>
          )}
        </div>
      )}

      {mode === 'email' && (
        <div>
          <label style={labelStyle}>Email address</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="friend@example.com"
            style={inputStyle}
          />
          <div style={{ fontSize: ts(11), color: T.textFaint, marginTop: 8, lineHeight: 1.45 }}>
            They will get instructions to create an account and join with your trip&apos;s invite code.
          </div>
          <button
            type="button"
            disabled={!email.trim() || busy}
            onClick={() => void inviteByEmail()}
            style={primaryBtn(!email.trim() || busy)}
          >
            {busy ? 'Sending…' : 'Email invite'}
          </button>
        </div>
      )}

      {mode === 'code' && (
        <div>
          {code ? (
            <>
              <div
                onClick={() => void copyCode()}
                style={{
                  textAlign: 'center',
                  fontSize: ts(24),
                  fontWeight: 900,
                  letterSpacing: 4,
                  color: T.accent,
                  padding: '12px 8px',
                  background: T.accentLight,
                  borderRadius: 10,
                  cursor: 'pointer',
                }}
              >
                {code}
              </div>
              <div style={{ fontSize: ts(11), color: T.textFaint, textAlign: 'center', marginTop: 6 }}>
                {copied ? 'Copied!' : 'Tap code to copy'}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                {typeof navigator !== 'undefined' && navigator.share && (
                  <button type="button" onClick={() => void shareCode()} style={secondaryBtn}>
                    Share
                  </button>
                )}
                <button type="button" onClick={() => void copyCode()} style={secondaryBtn}>
                  Copy code
                </button>
              </div>
            </>
          ) : (
            <button type="button" onClick={() => void loadCode()} disabled={codeBusy} style={primaryBtn(codeBusy)}>
              {codeBusy ? 'Creating…' : 'Show join code'}
            </button>
          )}
          <div style={{ fontSize: ts(11), color: T.textFaint, marginTop: 10, lineHeight: 1.45 }}>
            Share the code in person or over text. Crew taps Join trip and enters it after signing in.
          </div>
        </div>
      )}

      {!!success && (
        <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 10, background: '#EBF5EB', color: '#2A6A14', fontSize: ts(12), fontWeight: 600 }}>
          {success}
        </div>
      )}
      {!!error && (
        <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 10, background: '#FBE4E4', color: '#8A1414', fontSize: ts(12), fontWeight: 600 }}>
          {error}
        </div>
      )}
    </div>
  );
}

const panelStyle = {
  background: T.card,
  border: `1px solid ${T.border}`,
  borderRadius: 12,
  padding: '14px 16px',
  marginBottom: 12,
  fontFamily: F,
};

const labelStyle = {
  display: 'block',
  fontSize: ts(11),
  fontWeight: 700,
  color: T.textSub,
  marginBottom: 6,
};

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  border: `1.5px solid ${T.border}`,
  borderRadius: 10,
  padding: '10px 12px',
  fontSize: ts(14),
  fontFamily: F,
  background: T.bg,
  outline: 'none',
};

const selectStyle = {
  ...inputStyle,
  marginBottom: 10,
};

function primaryBtn(disabled) {
  return {
    width: '100%',
    marginTop: 10,
    border: 'none',
    borderRadius: 10,
    padding: '11px 14px',
    background: T.accent,
    color: 'white',
    fontSize: ts(13),
    fontWeight: 800,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.65 : 1,
    fontFamily: F,
  };
}

const secondaryBtn = {
  flex: 1,
  border: `1px solid ${T.border}`,
  borderRadius: 10,
  padding: '10px 12px',
  background: T.bg,
  color: T.text,
  fontSize: ts(13),
  fontWeight: 700,
  fontFamily: F,
  cursor: 'pointer',
};
