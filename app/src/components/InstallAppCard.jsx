import { T, F } from '../tokens';
import { ts } from '../lib/textScale';
import { usePwaInstall } from '../hooks/usePwaInstall';

export function InstallAppCard() {
  const {
    installed,
    canPromptInstall,
    showIosInstructions,
    showManualHint,
    install,
  } = usePwaInstall();

  if (installed) return null;

  return (
    <div style={{
      marginTop: 24,
      padding: '14px 14px 16px',
      borderRadius: 14,
      background: T.card,
      border: `1px solid ${T.border}`,
      boxShadow: '0 2px 10px rgba(0,0,0,.04)',
    }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
        <img
          src="/splash-logo.png"
          alt=""
          width={52}
          height={52}
          style={{ borderRadius: 12, flexShrink: 0, boxShadow: '0 2px 8px rgba(0,0,0,.1)' }}
        />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: ts(14), fontWeight: 800, color: T.text }}>Install TripReport</div>
          <div style={{ fontSize: ts(12), color: T.textSub, lineHeight: 1.45, marginTop: 2 }}>
            Add to your home screen for offline access on the river.
          </div>
        </div>
      </div>

      {canPromptInstall && (
        <button
          type="button"
          onClick={() => void install()}
          style={{
            width: '100%',
            border: 'none',
            borderRadius: 11,
            padding: '12px 14px',
            background: T.accent,
            color: 'white',
            fontSize: ts(13),
            fontWeight: 800,
            fontFamily: F,
            cursor: 'pointer',
          }}
        >
          Install app
        </button>
      )}

      {showIosInstructions && (
        <div style={{ fontSize: ts(12), color: T.textSub, lineHeight: 1.55 }}>
          <div style={{ fontWeight: 700, color: T.text, marginBottom: 6 }}>iPhone / iPad</div>
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            <li>Open this page in <b>Safari</b></li>
            <li>Tap <b>Share</b> → <b>Add to Home Screen</b></li>
            <li>Open TripReport from your home screen</li>
          </ol>
        </div>
      )}

      {showManualHint && !canPromptInstall && (
        <div style={{ fontSize: ts(12), color: T.textSub, lineHeight: 1.55 }}>
          <div style={{ fontWeight: 700, color: T.text, marginBottom: 6 }}>Android / Chrome</div>
          <p style={{ margin: 0 }}>
            Tap the browser menu (⋮) and choose <b>Install app</b> or <b>Add to Home screen</b>.
          </p>
        </div>
      )}
    </div>
  );
}
