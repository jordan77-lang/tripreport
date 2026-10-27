import { useState } from 'react';
import { TextSizeControl } from '../components/TextSizeControl';
import { Ic } from '../components/Ic';
import { T, F } from '../tokens';
import { ts } from '../lib/textScale';
import { getSignedInDisplayName } from '../lib/authUser';
import { getCurrentUserId, updateUserDefaultDisplayName } from '../lib/storage';

export function Settings({ onBack, onProfileUpdated, auth }) {
  const initialName = auth?.profile?.display_name || getSignedInDisplayName() || '';
  const [displayName, setDisplayName] = useState(initialName);
  const [savingName, setSavingName] = useState(false);
  const [nameNotice, setNameNotice] = useState(null);
  const [nameError, setNameError] = useState(null);

  async function handleSaveName(e) {
    e.preventDefault();
    const trimmed = displayName.trim();
    if (!trimmed || savingName) return;
    setSavingName(true);
    setNameNotice(null);
    setNameError(null);
    try {
      if (auth?.configured && auth?.isSignedIn && auth?.upsertProfile) {
        await auth.upsertProfile(trimmed);
      } else {
        updateUserDefaultDisplayName(getCurrentUserId(), trimmed);
      }
      onProfileUpdated?.();
      setNameNotice(`Saved! Your crew will see you as “${trimmed}” on trips.`);
    } catch (err) {
      setNameError(err?.message || 'Could not update your name.');
    } finally {
      setSavingName(false);
    }
  }

  return (
    <div style={{ height: '100%', background: T.bg, display: 'flex', flexDirection: 'column', fontFamily: F, overflow: 'hidden' }}>
      <div style={{ background: T.card, padding: '12px 16px 14px', borderBottom: `1px solid ${T.border}`, flexShrink: 0, boxShadow: '0 2px 12px rgba(26, 25, 23, 0.03)' }}>
        <div className="screen-header-inner" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button type="button" onClick={onBack}
            style={{ width: 40, height: 40, borderRadius: 10, border: `1px solid ${T.border}`, background: T.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <Ic d="M19 12H5 M12 5l-7 7 7 7" size={18} color={T.text} sw={2} />
          </button>
          <div>
            <div style={{ fontSize: ts(20), fontWeight: 800, color: T.text, letterSpacing: -.4 }}>Settings</div>
            <div style={{ fontSize: ts(13), color: T.textSub, marginTop: 2 }}>Display &amp; account</div>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        <div className="screen-content-inner">
          <section style={{ background: T.card, borderRadius: 14, border: `1px solid ${T.border}`, padding: '14px 16px', marginBottom: 12 }}>
            <div style={{ fontSize: ts(12), fontWeight: 700, color: T.textFaint, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 8 }}>
              Account &amp; Trip Name
            </div>
            <div style={{ fontSize: ts(13), color: T.textSub, marginBottom: 12, lineHeight: 1.45 }}>
              Choose the name or trail name you want people to call you and select when mentioning you on trips, gear, meals, and stories.
            </div>
            {auth?.user?.email && (
              <div style={{ fontSize: ts(12), color: T.textSub, marginBottom: 10 }}>
                Account login: <strong style={{ color: T.text }}>{auth.user.email}</strong>
              </div>
            )}
            <form onSubmit={handleSaveName}>
              <label htmlFor="settings-display-name" style={{ display: 'block', fontSize: ts(12), fontWeight: 700, color: T.textSub, marginBottom: 6 }}>
                Name people call you on trips
              </label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input
                  id="settings-display-name"
                  type="text"
                  maxLength={40}
                  value={displayName}
                  onChange={(e) => { setDisplayName(e.target.value); setNameNotice(null); setNameError(null); }}
                  placeholder="e.g. Jordan, River Rat, Captain Dan"
                  style={{
                    flex: '1 1 200px',
                    minHeight: 44,
                    border: `1px solid ${T.border}`,
                    borderRadius: 10,
                    padding: '10px 12px',
                    fontSize: ts(14),
                    fontFamily: F,
                    background: T.bg,
                    color: T.text,
                  }}
                />
                <button
                  type="submit"
                  disabled={savingName || !displayName.trim()}
                  style={{
                    minHeight: 44,
                    padding: '0 16px',
                    border: 'none',
                    borderRadius: 10,
                    background: T.accent,
                    color: 'white',
                    fontSize: ts(13),
                    fontWeight: 800,
                    fontFamily: F,
                    cursor: savingName || !displayName.trim() ? 'default' : 'pointer',
                    opacity: savingName || !displayName.trim() ? 0.65 : 1,
                  }}
                >
                  {savingName ? 'Saving…' : 'Save name'}
                </button>
              </div>
            </form>
            {nameNotice && (
              <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 9, background: T.accentLight, color: T.accent, fontSize: ts(12), fontWeight: 700 }}>
                {nameNotice}
              </div>
            )}
            {nameError && (
              <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 9, background: '#FBE4E4', color: '#8A1414', fontSize: ts(12), fontWeight: 700 }}>
                {nameError}
              </div>
            )}
            {auth?.configured && auth?.isSignedIn && (
              <button type="button" onClick={() => auth.signOut()}
                style={{ width: '100%', marginTop: 14, border: `1px solid ${T.border}`, borderRadius: 10, padding: '11px 14px', fontSize: ts(14), fontWeight: 700, color: T.textSub, background: T.bg, cursor: 'pointer' }}>
                Sign out
              </button>
            )}
          </section>

          <section style={{ background: T.card, borderRadius: 14, border: `1px solid ${T.border}`, padding: '14px 16px', marginBottom: 12 }}>
            <div style={{ fontSize: ts(12), fontWeight: 700, color: T.textFaint, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 10 }}>
              Display
            </div>
            <div style={{ fontSize: ts(14), color: T.textSub, marginBottom: 12, lineHeight: 1.45 }}>
              Adjust text size for easier reading outdoors and on small screens.
            </div>
            <TextSizeControl />
          </section>

          <section style={{ background: T.card, borderRadius: 14, border: `1px solid ${T.border}`, padding: '14px 16px' }}>
            <div style={{ fontSize: ts(12), fontWeight: 700, color: T.textFaint, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 8 }}>
              About
            </div>
            <div style={{ fontSize: ts(14), color: T.textSub, lineHeight: 1.5 }}>
              TripReport — offline-first trip logging for the field. Your data is stored on this device and syncs when signed in.
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
