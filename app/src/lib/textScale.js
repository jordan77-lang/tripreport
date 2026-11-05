const KEY = 'tr_text_scale';
const SCALES = [1, 1.15, 1.3];

export function initTextScale() {
  document.documentElement.dataset.textScale = String(getTextScale());
}

export function getTextScale() {
  const stored = localStorage.getItem(KEY);
  if (stored == null) return 1.15;
  const n = Number(stored);
  return SCALES.includes(n) ? n : 1.15;
}

export function setTextScale(scale) {
  const n = SCALES.includes(scale) ? scale : 1.15;
  localStorage.setItem(KEY, String(n));
  document.documentElement.dataset.textScale = String(n);
  window.dispatchEvent(new Event('textscalechange'));
}

export function textScaleOptions() {
  return [
    { id: 1, label: 'A' },
    { id: 1.15, label: 'A+' },
    { id: 1.3, label: 'A++' },
  ];
}

/**
 * Readable font size for inline styles. `px` is the size at a 16px root.
 *
 * Returns a CSS length in rem, so it follows the root size that index.css sets for the
 * A / A+ / A++ setting and for phones (larger root under 768px), and updates the moment
 * the setting changes. `minFloor` keeps captions and badges from going below a legible
 * size on small screens.
 */
export function ts(px, minFloor = 12) {
  const rem = Math.round((px / 16) * 1000) / 1000;
  return `max(${minFloor}px, ${rem}rem)`;
}
