// Bridge between Supabase auth and the local storage layer.
// AuthContext sets the signed-in user id; storage falls back to anonymous local id.

const PREFERRED_NAME_KEY = 'tr_preferred_display_name';

let signedInUserId = null;
let signedInDisplayName = null;

function getStoredPreferredName() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const val = localStorage.getItem(PREFERRED_NAME_KEY);
    return val && val.trim() ? val.trim() : null;
  } catch {
    return null;
  }
}

export function setPreferredDisplayName(displayName) {
  const trimmed = (displayName || '').trim();
  if (trimmed) signedInDisplayName = trimmed;
  try {
    if (typeof localStorage !== 'undefined') {
      if (trimmed) localStorage.setItem(PREFERRED_NAME_KEY, trimmed);
      else localStorage.removeItem(PREFERRED_NAME_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export function setSignedInUser(id, displayName = null) {
  signedInUserId = id || null;
  const trimmed = (displayName || '').trim();
  signedInDisplayName = trimmed || getStoredPreferredName() || null;
  if (trimmed) setPreferredDisplayName(trimmed);
}

export function getSignedInUserId() {
  return signedInUserId;
}

export function getSignedInDisplayName() {
  return signedInDisplayName || getStoredPreferredName();
}
