import { createContext, useContext, useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from 'firebase/auth';
import { ref, set } from 'firebase/database';
import { auth, db, firebaseAuthConfigured } from '../config/firebase';
import { isPermanentSessionError, restoreSessionWithRetry } from '../services/authSessionPolicy';
import { createServerAuthRequest } from '../services/authTransport';

const AuthContext = createContext(null);
const SERVER_SESSION_KEY = 'mira_auth_token';
const SERVER_USER_KEY = 'mira_auth_user';
const SERVER_VALIDATED_KEY = 'mira_auth_validated_at';
const SESSION_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
const SESSION_RESTORE_ATTEMPTS = 3;

function publicUser(value) {
  if (!value?.uid) return null;
  return {
    uid: value.uid,
    email: value.email || '',
    displayName: value.displayName || '',
    photoURL: value.photoURL || '',
  };
}

async function serverAuth(action, payload = {}, token = '') {
  let response;
  try {
    response = await fetch('/api/auth', createServerAuthRequest(
      action,
      payload,
      token,
      AbortSignal.timeout(12_000),
    ));
  } catch (cause) {
    throw Object.assign(new Error('Authentication is temporarily unavailable.'), {
      code: 'auth/network-request-failed',
      retryable: true,
      cause,
    });
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(
      new Error(data.error || 'Authentication is temporarily unavailable.'),
      {
        code: data.code || `auth/http-${response.status}`,
        status: response.status,
        retryable: response.status === 408
          || response.status === 429
          || response.status === 494
          || response.status >= 500,
      },
    );
  }
  return data;
}

function readCachedServerUser() {
  try {
    return publicUser(JSON.parse(localStorage.getItem(SERVER_USER_KEY) || 'null'));
  } catch {
    return null;
  }
}

function saveServerSession({ token, user: nextUser }) {
  const current = publicUser(nextUser);
  if (current) localStorage.setItem(SERVER_USER_KEY, JSON.stringify(current));
  if (token) localStorage.setItem(SERVER_SESSION_KEY, token);
  localStorage.setItem(SERVER_VALIDATED_KEY, String(Date.now()));
  return current;
}

function clearServerSession() {
  localStorage.removeItem(SERVER_SESSION_KEY);
  localStorage.removeItem(SERVER_USER_KEY);
  localStorage.removeItem(SERVER_VALIDATED_KEY);
}

async function restoreServerSession(token) {
  return restoreSessionWithRetry(
    () => serverAuth('session', {}, token),
    { attempts: SESSION_RESTORE_ATTEMPTS },
  );
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
    let active = true;
    let refreshPromise = null;
    let refreshFailures = 0;
    let nextRefreshAllowedAt = 0;
    const cachedUser = readCachedServerUser();
    const initialToken = localStorage.getItem(SERVER_SESSION_KEY) || '';
    if (initialToken && cachedUser) {
      setUser(cachedUser);
      setLoading(false);
    } else if (!initialToken) {
      setLoading(false);
    }

    const refreshSession = async ({ force = false } = {}) => {
      if (!force && Date.now() < nextRefreshAllowedAt) return null;
      const token = localStorage.getItem(SERVER_SESSION_KEY) || '';
      if (!token) {
        if (active) {
          setUser(null);
          setLoading(false);
        }
        return null;
      }
      const lastValidatedAt = Number(localStorage.getItem(SERVER_VALIDATED_KEY) || 0);
      if (!force && readCachedServerUser() && Date.now() - lastValidatedAt < 60_000) return null;
      if (refreshPromise) return refreshPromise;
      refreshPromise = restoreServerSession(token)
        .then((result) => {
          refreshFailures = 0;
          nextRefreshAllowedAt = 0;
          const restoredUser = saveServerSession(result);
          if (active) setUser(restoredUser);
          return restoredUser;
        })
        .catch((sessionError) => {
          if (isPermanentSessionError(sessionError)) {
            clearServerSession();
            if (active) setUser(null);
          } else {
            refreshFailures += 1;
            nextRefreshAllowedAt = Date.now() + Math.min(
              5 * 60_000,
              15_000 * (2 ** Math.min(4, refreshFailures - 1)),
            );
            // A temporary API, network, or Firebase outage must never turn into
            // a local logout. Keep the last verified identity and retry later.
            const retainedUser = readCachedServerUser();
            if (active && retainedUser) setUser(retainedUser);
          }
          return null;
        })
        .finally(() => {
          refreshPromise = null;
          if (active) setLoading(false);
        });
      return refreshPromise;
    };

    refreshSession({ force: true });
    const refreshOnResume = () => refreshSession();
    const refreshOnVisibility = () => {
      if (document.visibilityState === 'visible') refreshSession();
    };
    const syncAcrossTabs = (event) => {
      if (event.key === SERVER_USER_KEY && event.newValue) {
        const syncedUser = readCachedServerUser();
        if (active && syncedUser) setUser(syncedUser);
        return;
      }
      if (event.key === SERVER_SESSION_KEY && !event.newValue) {
        if (active) setUser(null);
      }
    };
    const interval = window.setInterval(() => refreshSession(), SESSION_REFRESH_INTERVAL_MS);
    window.addEventListener('focus', refreshOnResume);
    window.addEventListener('online', refreshOnResume);
    window.addEventListener('storage', syncAcrossTabs);
    document.addEventListener('visibilitychange', refreshOnVisibility);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshOnResume);
      window.removeEventListener('online', refreshOnResume);
      window.removeEventListener('storage', syncAcrossTabs);
      document.removeEventListener('visibilitychange', refreshOnVisibility);
    };
  }, []);

  function friendlyError(authError) {
    const code = authError?.code || '';
    if (/invalid-credential|user-not-found|wrong-password/.test(code)) return 'Invalid email or password.';
    if (code.includes('email-already-in-use')) return 'An account with this email already exists.';
    if (code.includes('weak-password')) return 'Password must be at least 8 characters.';
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
      const result = await serverAuth('login', { email: email.trim(), password });
      const current = saveServerSession(result);
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
      if (password.length < 8) throw new Error('Password must be at least 8 characters.');
      if (firebaseAuthConfigured && auth) {
        const credential = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
        await updateProfile(credential.user, { displayName: String(displayName || '').trim() });
        const current = publicUser(credential.user);
        await set(ref(db, `users/${current.uid}`), { ...current, createdAt: Date.now() });
        setUser(current);
        return current;
      }
      const result = await serverAuth('register', { email: normalizedEmail, password, displayName });
      const current = saveServerSession(result);
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
    clearServerSession();
    localStorage.removeItem('mira_legacy_session');
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
    secureAuth: true,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
