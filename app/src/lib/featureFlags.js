/** Re-enable video capture/upload after field test (off to save bandwidth). */
export const VIDEO_ENABLED = false;

export const VIDEO_DISABLED_HINT = 'Video disabled for field test';

export function mediaCaptureLabel(label) {
  if (VIDEO_ENABLED) return label;
  return label
    .replace(/\s*\/\s*Video/gi, '')
    .replace(/^Videos?$/i, 'Photos')
    .trim();
}

export function disabledMediaStyle() {
  if (VIDEO_ENABLED) return {};
  return { opacity: 0.42, cursor: 'not-allowed' };
}
