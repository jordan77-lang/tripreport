/** Flip to true after Resend is configured on Netlify (RESEND_API_KEY, REPORT_EMAIL_FROM). */
export const RECAP_EMAIL_ENABLED = true;

export const DEFAULT_REPORT_SETTINGS = {
  tone: 'family',
  length: 'standard',
  audience: 'family',
  focus: 'balanced',
  voice: 'we',
  includeStats: true,
  photoScope: 'best',
  aiConsent: false,
};

export const REPORT_SETTING_OPTIONS = {
  tone: [
    { id: 'family', label: 'Warm & family-friendly' },
    { id: 'formal', label: 'Formal patrol report' },
    { id: 'adventure', label: 'Adventure story' },
  ],
  length: [
    { id: 'short', label: 'Short (1–2 pages)' },
    { id: 'standard', label: 'Standard' },
    { id: 'detailed', label: 'Detailed' },
  ],
  audience: [
    { id: 'family', label: 'Family & friends' },
    { id: 'personal', label: 'Personal journal' },
  ],
  focus: [
    { id: 'balanced', label: 'Balanced' },
    { id: 'river', label: 'River & flow' },
    { id: 'wildlife', label: 'Wildlife & nature' },
    { id: 'camps', label: 'Camps & crew' },
  ],
  voice: [
    { id: 'we', label: 'We / our group' },
    { id: 'third', label: 'Third person' },
  ],
  photoScope: [
    { id: 'best', label: 'Best photos per day' },
    { id: 'all', label: 'More photos (higher API cost)' },
  ],
};

export function narrativeFromReportResult(result) {
  if (!result) return '';
  const lines = [];
  if (result.title) lines.push(result.title, '');
  if (result.subtitle) lines.push(result.subtitle, '');
  if (result.executiveSummary) {
    lines.push('Summary', result.executiveSummary, '');
  }
  for (const section of result.sections || []) {
    if (section.heading) lines.push(section.heading);
    if (section.body) lines.push(section.body, '');
  }
  if (result.closing) {
    lines.push('Closing', result.closing);
  }
  return lines.join('\n').trim();
}
