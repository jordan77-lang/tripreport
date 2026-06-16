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

/** Scale a base pixel font size for readability (default bases assume 14px body). */
export function ts(px) {
  return Math.round(px * getTextScale());
}
