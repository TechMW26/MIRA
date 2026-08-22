import { createContext, useContext, useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from 'firebase/auth';
import { get, ref, set, update } from 'firebase/database';
import { auth, db, firebaseAuthConfigured } from '../config/firebase';

const AuthContext = createContext(null);
const LEGACY_SESSION_KEY = 'mira_legacy_session';
const LEGACY_ITERATIONS = 210_000;
const allowLegacyAuth = import.meta.env.DEV || import.meta.env.VITE_ENABLE_LEGACY_AUTH === 'true';

function publicUser(value) {
  if (!value) return null;
  return {
    uid: value.uid,
    email: value.email || '',
    displayName: value.displayName || '',
    photoURL: value.photoURL || '',
  };
}

function bytesToHex(bytes) {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function randomHex(length = 16) {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(length)));
}

async function pbkdf2(password, salt, iterations = LEGACY_ITERATIONS) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt: new TextEncoder().encode(salt),
    iterations,
  }, material, 256);
  return bytesToHex(new Uint8Array(bits));
}

async function createLegacyPassword(password) {
  const salt = randomHex();
  return `pbkdf2$${LEGACY_ITERATIONS}$${salt}$${await pbkdf2(password, salt)}`;
}

async function verifyLegacyPassword(password, stored = '') {
  const parts = String(stored).split('$');
  if (parts[0] === 'pbkdf2' && parts.length === 4) {
    const iterations = Math.max(100_000, Number(parts[1]) || LEGACY_ITERATIONS);
    return await pbkdf2(password, parts[2], iterations) === parts[3];
  }
  // One-time migration path for the previous fixed-salt SHA-256 format.
  const legacy = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${password}mira_salt_2024`),
  );
  return bytesToHex(new Uint8Array(legacy)) === stored;
}

async function emailKey(email) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(String(email || '').trim().toLowerCase()),
  );
  return bytesToHex(new Uint8Array(digest));
}

function saveLegacySession(user) {
  if (!user) {
    localStorage.removeItem(LEGACY_SESSION_KEY);
    return;
  }
  localStorage.setItem(LEGACY_SESSION_KEY, JSON.stringify({
    ...publicUser(user),
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
  }));
}

async function findLegacyUser(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const index = await get(ref(db, `userEmailIndex/${await emailKey(normalizedEmail)}`));
  if (index.exists()) {
    const profile = await get(ref(db, `users/${index.val()}`));
    if (profile.exists()) return { uid: index.val(), ...profile.val() };
  }
  // Transitional lookup for accounts created before the index existed.
  const users = await get(ref(db, 'users'));
  let match = null;
  users.forEach((child) => {
    if (!match && String(child.val()?.email || '').trim().toLowerCase() === normalizedEmail) {
      match = { uid: child.key, ...child.val() };
    }
  });
  return match;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (firebaseAuthConfigured && auth) {
      return onAuthStateChanged(auth, (account) => {
        setUser(publicUser(account));
        setLoading(false);
      });
    }
    if (allowLegacyAuth) {
      try {
        const session = JSON.parse(localStorage.getItem(LEGACY_SESSION_KEY) || 'null');
        if (session?.uid && session.expiresAt > Date.now()) setUser(publicUser(session));
        else localStorage.removeItem(LEGACY_SESSION_KEY);
      } catch { localStorage.removeItem(LEGACY_SESSION_KEY); }
    }
    setLoading(false);
    return undefined;
  }, []);

  function friendlyError(authError) {
    const code = authError?.code || '';
    if (/invalid-credential|user-not-found|wrong-password/.test(code)) return 'Invalid email or password.';
    if (code.includes('email-already-in-use')) return 'An account with this email already exists.';
    if (code.includes('weak-password')) return 'Password must be at least 6 characters.';
    if (code.includes('operation-not-allowed')) return 'Email/password sign-in is not enabled for this Firebase project.';
    return authError?.message || 'Something went wrong. Please try again.';
  }

  async function login(email, password) {
    setError(null);
    setAuthLoading(true);
    try {
      if (firebaseAuthConfigured && auth) {
        const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
        const current = publicUser(credential.user);
        setUser(current);
        return current;
      }
      if (!allowLegacyAuth) throw new Error('Secure authentication is not configured. Add VITE_FIREBASE_API_KEY.');
      const found = await findLegacyUser(email);
      if (!found || !await verifyLegacyPassword(password, found.password)) {
        setError('Invalid email or password.');
        return null;
      }
      if (!String(found.password).startsWith('pbkdf2$')) {
        await update(ref(db, `users/${found.uid}`), {
          password: await createLegacyPassword(password),
          passwordMigratedAt: Date.now(),
        });
      }
      const current = publicUser(found);
      saveLegacySession(current);
      setUser(current);
      return current;
    } catch (authError) {
      setError(friendlyError(authError));
      return null;
    } finally {
      setAuthLoading(false);
    }
  }

  async function register(email, password, displayName) {
    setError(null);
    setAuthLoading(true);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      if (password.length < 6) throw new Error('Password must be at least 6 characters.');
      if (firebaseAuthConfigured && auth) {
        const credential = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
        await updateProfile(credential.user, { displayName: String(displayName || '').trim() });
        const current = publicUser(credential.user);
        await set(ref(db, `users/${current.uid}`), { ...current, createdAt: Date.now() });
        setUser(current);
        return current;
      }
      if (!allowLegacyAuth) throw new Error('Secure authentication is not configured. Add VITE_FIREBASE_API_KEY.');
      if (await findLegacyUser(normalizedEmail)) {
        throw Object.assign(new Error('Account exists.'), { code: 'auth/email-already-in-use' });
      }
      const uid = crypto.randomUUID();
      const profile = {
        email: normalizedEmail,
        displayName: String(displayName || '').trim(),
        photoURL: '',
        password: await createLegacyPassword(password),
        createdAt: Date.now(),
      };
      await update(ref(db), {
        [`users/${uid}`]: profile,
        [`userEmailIndex/${await emailKey(normalizedEmail)}`]: uid,
      });
      const current = publicUser({ uid, ...profile });
      saveLegacySession(current);
      setUser(current);
      return current;
    } catch (authError) {
      setError(friendlyError(authError));
      return null;
    } finally {
      setAuthLoading(false);
    }
  }

  async function logout() {
    if (firebaseAuthConfigured && auth) await signOut(auth);
    saveLegacySession(null);
    localStorage.removeItem('mira_token');
    localStorage.removeItem('mira_user');
    setUser(null);
  }

  const value = {
    user,
    loading,
    authLoading,
    error,
    login,
    register,
    logout,
    secureAuth: firebaseAuthConfigured,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
