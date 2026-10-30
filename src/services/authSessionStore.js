export const SERVER_SESSION_KEY = 'mira_auth_token';
export const SERVER_USER_KEY = 'mira_auth_user';
export const SERVER_VALIDATED_KEY = 'mira_auth_validated_at';
export const REMEMBERED_USER_KEY = 'mira_auth_remembered_user';

export function publicAuthUser(value) {
  if (!value?.uid) return null;
  return {
    uid: String(value.uid),
    email: String(value.email || ''),
    displayName: String(value.displayName || ''),
    photoURL: String(value.photoURL || ''),
  };
}

function availableStorage(storage) {
  if (storage) return storage;
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function readUser(key, storage) {
  const target = availableStorage(storage);
  if (!target) return null;
  try {
    return publicAuthUser(JSON.parse(target.getItem(key) || 'null'));
  } catch {
    return null;
  }
}

export function readRememberedUser(storage) {
  const target = availableStorage(storage);
  const remembered = readUser(REMEMBERED_USER_KEY, target);
  if (remembered) return remembered;
  const legacyUser = readUser(SERVER_USER_KEY, target);
  if (target && legacyUser) {
    target.setItem(REMEMBERED_USER_KEY, JSON.stringify(legacyUser));
  }
  return legacyUser;
}

export function rememberAuthUser(value, storage) {
  const target = availableStorage(storage);
  const user = publicAuthUser(value);
  if (!target || !user) return user;
  target.setItem(REMEMBERED_USER_KEY, JSON.stringify(user));
  target.setItem(SERVER_USER_KEY, JSON.stringify(user));
  return user;
}

export function saveServerSession({ token, user }, storage) {
  const target = availableStorage(storage);
  const remembered = rememberAuthUser(user, target);
  if (!target) return remembered;
  if (token) target.setItem(SERVER_SESSION_KEY, String(token));
  target.setItem(SERVER_VALIDATED_KEY, String(Date.now()));
  return remembered;
}

// Invalid or expired server credentials should stop background validation, but
// they must never erase the signed-in identity. Only explicit logout does that.
export function discardServerToken(storage) {
  const target = availableStorage(storage);
  if (!target) return;
  target.removeItem(SERVER_SESSION_KEY);
  target.removeItem(SERVER_VALIDATED_KEY);
}

export function clearRememberedSession(storage) {
  const target = availableStorage(storage);
  if (!target) return;
  target.removeItem(SERVER_SESSION_KEY);
  target.removeItem(SERVER_USER_KEY);
  target.removeItem(SERVER_VALIDATED_KEY);
  target.removeItem(REMEMBERED_USER_KEY);
}
