import { useState } from 'react';
import { T, F } from '../tokens';
import { ts } from '../lib/textScale';

export function InviteShareCard({ code, title = 'Invite your crew', onDismiss }) {
  const [copied, setCopied] = useState(false);

  if (!code) return null;

  async function copyCode() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  async function shareCode() {
    const text = `Join my trip on TripReport. Invite code: ${code}`;
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

  function emailInvite() {
    const subject = encodeURIComponent('TripReport trip invite');
    const body = encodeURIComponent(
      `You're invited to join our trip on TripReport.\n\nInvite code: ${code}\n\nOpen TripReport, sign in, tap Join trip, and enter the code.`,
    );
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  }

  return (
    <div style={{
      background: '#E4EFF8',
      border: '1px solid #C7DDEF',
      borderRadius: 12,
      padding: '14px 16px',
      marginBottom: 12,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: ts(14), fontWeight: 800, color: '#2A5C8E' }}>{title}</div>
          <div style={{ fontSize: ts(12), color: T.textSub, marginTop: 4, lineHeight: 1.4 }}>
            Share this code so crew can join after they create an account.
          </div>
        </div>
        {onDismiss && (
          <button type="button" onClick={onDismiss} style={{ border: 'none', background: 'transparent', color: T.textFaint, cursor: 'pointer', fontSize: 18 }}>×</button>
        )}
      </div>
      <div
        onClick={() => void copyCode()}
        style={{
          textAlign: 'center',
          fontSize: ts(24),
          fontWeight: 900,
          letterSpacing: 4,
          color: T.accent,
          padding: '12px 8px',
          background: T.card,
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
          <button type="button" onClick={() => void shareCode()} style={btnStyle}>
            Share
          </button>
        )}
        <button type="button" onClick={emailInvite} style={btnStyle}>
          Email invite
        </button>
      </div>
    </div>
  );
}

const btnStyle = {
  flex: 1,
  border: `1px solid ${T.border}`,
  borderRadius: 10,
  padding: '10px 12px',
  background: T.card,
  color: T.text,
  fontSize: ts(13),
  fontWeight: 700,
  fontFamily: F,
  cursor: 'pointer',
};
