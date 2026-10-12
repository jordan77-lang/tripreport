/** Accept a shared invite URL or a code, without navigating to pasted URLs. */
export function parseInviteCode(value) {
  const input = String(value || '').trim();
  if (!input) return '';
  let code = input;
  if (input.toLowerCase().startsWith('https://') || input.toLowerCase().startsWith('http://')) {
    try {
      const url = new URL(input);
      code = url.searchParams.get('join') || url.searchParams.get('code') || '';
    } catch { return ''; }
  }
  code = code.trim().toUpperCase();
  return /^[A-Z0-9]{1,12}$/.test(code) ? code : '';
}
