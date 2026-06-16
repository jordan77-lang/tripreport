import { TextSizeControl } from '../components/TextSizeControl';
import { Ic } from '../components/Ic';
import { T, F } from '../tokens';
import { ts } from '../lib/textScale';

export function Settings({ onBack, auth }) {
  const profileName = auth?.profile?.display_name || auth?.user?.email || 'Signed in';

  return (
    <div style={{ height: '100%', background: T.bg, display: 'flex', flexDirection: 'column', fontFamily: F, overflow: 'hidden' }}>
      <div style={{ background: T.card, padding: '12px 16px 14px', borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button type="button" onClick={onBack}
            style={{ width: 40, height: 40, borderRadius: 10, border: `1px solid ${T.border}`, background: T.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <Ic d="M19 12H5 M12 5l-7 7 7 7" size={18} color={T.text} sw={2} />
          </button>
          <div>
            <div style={{ fontSize: ts(20), fontWeight: 800, color: T.text, letterSpacing: -.4 }}>Settings</div>
            <div style={{ fontSize: ts(13), color: T.textSub, marginTop: 2 }}>Display & account</div>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        <section style={{ background: T.card, borderRadius: 14, border: `1px solid ${T.border}`, padding: '14px 16px', marginBottom: 12 }}>
          <div style={{ fontSize: ts(12), fontWeight: 700, color: T.textFaint, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 10 }}>
            Display
          </div>
          <div style={{ fontSize: ts(14), color: T.textSub, marginBottom: 12, lineHeight: 1.45 }}>
            Adjust text size for easier reading outdoors and on small screens.
          </div>
          <TextSizeControl />
        </section>

        {auth?.configured && auth?.isSignedIn && (
          <section style={{ background: T.card, borderRadius: 14, border: `1px solid ${T.border}`, padding: '14px 16px', marginBottom: 12 }}>
            <div style={{ fontSize: ts(12), fontWeight: 700, color: T.textFaint, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 10 }}>
              Account
            </div>
            <div style={{ fontSize: ts(15), fontWeight: 700, color: T.text, marginBottom: 4 }}>{profileName}</div>
            {auth?.user?.email && (
              <div style={{ fontSize: ts(13), color: T.textSub, marginBottom: 12 }}>{auth.user.email}</div>
            )}
            <button type="button" onClick={() => auth.signOut()}
              style={{ width: '100%', border: `1px solid ${T.border}`, borderRadius: 10, padding: '11px 14px', fontSize: ts(14), fontWeight: 700, color: T.textSub, background: T.bg, cursor: 'pointer' }}>
              Sign out
            </button>
          </section>
        )}

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
  );
}
