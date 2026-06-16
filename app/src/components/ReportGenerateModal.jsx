import { useState } from 'react';
import { T, F } from '../tokens';
import { ts } from '../lib/textScale';
import { DEFAULT_REPORT_SETTINGS, REPORT_SETTING_OPTIONS } from '../lib/recapSettings';

export function ReportGenerateModal({ open, onClose, onGenerate, busy = false }) {
  const [settings, setSettings] = useState({ ...DEFAULT_REPORT_SETTINGS });

  if (!open) return null;

  function set(key, value) {
    setSettings((s) => ({ ...s, [key]: value }));
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1500, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', fontFamily: F }}
         onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
           style={{ width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto', background: T.card, borderRadius: '16px 16px 0 0', padding: '18px 16px 24px' }}>
        <div style={{ fontSize: ts(18), fontWeight: 800, color: T.text, marginBottom: 4 }}>Generate trip report</div>
        <div style={{ fontSize: ts(13), color: T.textSub, marginBottom: 16, lineHeight: 1.45 }}>
          AI will read your journal entries and selected photos, then draft an editable report.
        </div>

        <SettingGroup label="Tone" options={REPORT_SETTING_OPTIONS.tone} value={settings.tone} onChange={(v) => set('tone', v)} />
        <SettingGroup label="Length" options={REPORT_SETTING_OPTIONS.length} value={settings.length} onChange={(v) => set('length', v)} />
        <SettingGroup label="Audience" options={REPORT_SETTING_OPTIONS.audience} value={settings.audience} onChange={(v) => set('audience', v)} />
        <SettingGroup label="Focus" options={REPORT_SETTING_OPTIONS.focus} value={settings.focus} onChange={(v) => set('focus', v)} />
        <SettingGroup label="Voice" options={REPORT_SETTING_OPTIONS.voice} value={settings.voice} onChange={(v) => set('voice', v)} />
        <SettingGroup label="Photos sent to AI" options={REPORT_SETTING_OPTIONS.photoScope} value={settings.photoScope} onChange={(v) => set('photoScope', v)} />

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 14, marginBottom: 16, cursor: 'pointer' }}>
          <input type="checkbox" checked={settings.includeStats} onChange={(e) => set('includeStats', e.target.checked)} style={{ marginTop: 4 }} />
          <span style={{ fontSize: ts(13), color: T.textSub, lineHeight: 1.45 }}>Include trip stats (distance, flow, weather ranges) in the narrative</span>
        </label>

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 18, cursor: 'pointer', background: '#FFF8E8', border: '1px solid #E8D4A8', borderRadius: 10, padding: '10px 12px' }}>
          <input type="checkbox" checked={settings.aiConsent} onChange={(e) => set('aiConsent', e.target.checked)} style={{ marginTop: 4 }} />
          <span style={{ fontSize: ts(13), color: '#6B5520', lineHeight: 1.45 }}>
            I agree to send trip notes and selected photos to OpenAI to generate this draft. I can edit everything before sharing.
          </span>
        </label>

        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={onClose} disabled={busy}
            style={{ flex: 1, border: `1px solid ${T.border}`, borderRadius: 10, padding: '12px', fontSize: ts(14), fontWeight: 700, background: T.bg, color: T.textSub, cursor: 'pointer' }}>
            Cancel
          </button>
          <button type="button" disabled={busy || !settings.aiConsent} onClick={() => onGenerate(settings)}
            style={{ flex: 1, border: 'none', borderRadius: 10, padding: '12px', fontSize: ts(14), fontWeight: 800, background: settings.aiConsent ? T.accent : T.border, color: 'white', cursor: settings.aiConsent && !busy ? 'pointer' : 'not-allowed', opacity: busy ? 0.7 : 1 }}>
            {busy ? 'Generating…' : 'Generate draft'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingGroup({ label, options, value, onChange }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: ts(12), fontWeight: 700, color: T.textFaint, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>{label}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {options.map((opt) => (
          <button key={opt.id} type="button" onClick={() => onChange(opt.id)}
            style={{
              border: `1px solid ${value === opt.id ? T.accent : T.border}`,
              borderRadius: 20,
              padding: '7px 11px',
              fontSize: ts(12),
              fontWeight: 700,
              cursor: 'pointer',
              background: value === opt.id ? T.accentLight : T.bg,
              color: value === opt.id ? T.accent : T.textSub,
            }}>
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
