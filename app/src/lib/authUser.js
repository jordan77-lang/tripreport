// Bridge between Supabase auth and the local storage layer.
// AuthContext sets the signed-in user id; storage falls back to anonymous local id.

let signedInUserId = null;
let signedInDisplayName = null;

export function setSignedInUser(id, displayName = null) {
  signedInUserId = id || null;
  signedInDisplayName = displayName || null;
}

export function getSignedInUserId() {
  return signedInUserId;
}

export function getSignedInDisplayName() {
  return signedInDisplayName;
}
