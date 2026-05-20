import { createContext, useContext, useEffect, useState } from 'react';
import { db } from '../config/firebase';
import { ref, get, set } from 'firebase/database';

const AuthContext = createContext(null);

const TOKEN_KEY = 'mira_token';
const JWT_SECRET = 'mira_jwt_secret_2024_v2';
const TOKEN_EXPIRY_DAYS = 30;

// ── JWT helpers (HMAC-SHA256 via Web Crypto) ───────────────────
function base64UrlEncode(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return atob(str);
}

async function getSigningKey() {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    enc.encode(JWT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

async function createJWT(payload) {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const data = `${header}.${body}`;

  const key = await getSigningKey();
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  const sigStr = base64UrlEncode(String.fromCharCode(...new Uint8Array(sig)));

  return `${data}.${sigStr}`;
}

async function verifyJWT(token) {
  try {
    const [header, body, sig] = token.split('.');
    if (!header || !body || !sig) return null;

    const key = await getSigningKey();
    const data = `${header}.${body}`;
    const sigBytes = Uint8Array.from(base64UrlDecode(sig), (c) => c.charCodeAt(0));

    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(data));
    if (!valid) return null;

    const payload = JSON.parse(base64UrlDecode(body));

    // Check expiry
    if (payload.exp && Date.now() > payload.exp) return null;

    return payload;
  } catch {
    return null;
  }
}

// ── Password hashing ───────────────────────────────────────────
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + 'mira_salt_2024');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function generateUID() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);
  const [error, setError] = useState(null);

  // Restore session from JWT on mount
  useEffect(() => {
    (async () => {
      try {
        const token = localStorage.getItem(TOKEN_KEY);
        if (token) {
          const payload = await verifyJWT(token);
          if (payload) {
            setUser({ uid: payload.uid, email: payload.email, displayName: payload.displayName, photoURL: payload.photoURL || '' });
          } else {
            localStorage.removeItem(TOKEN_KEY);
          }
        } else {
          // Migrate from legacy plain-JSON session if present
          const legacy = localStorage.getItem('mira_user');
          if (legacy) {
            try {
              const u = JSON.parse(legacy);
              if (u && u.uid) {
                await persistUser(u);
                setUser(u);
              }
            } catch {}
            localStorage.removeItem('mira_user');
          }
        }
      } catch {}
      setLoading(false);
    })();
  }, []);

  async function persistUser(u) {
    if (u) {
      const token = await createJWT({
        uid: u.uid,
        email: u.email,
        displayName: u.displayName,
        photoURL: u.photoURL || '',
        iat: Date.now(),
        exp: Date.now() + TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
      });
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
    setUser(u);
  }

  function friendlyError(err) {
    const code = err?.code || '';
    if (code === 'auth/user-not-found' || code === 'auth/invalid-credential') return 'Invalid email or password.';
    if (code === 'auth/email-already-in-use') return 'An account with this email already exists.';
    if (code === 'auth/weak-password') return 'Password must be at least 6 characters.';
    return err?.message || 'Something went wrong. Please try again.';
  }

  async function login(email, password) {
    setError(null);
    setAuthLoading(true);
    try {
      const hashedPw = await hashPassword(password);
      const usersRef = ref(db, 'users');
      const snap = await get(usersRef);

      if (!snap.exists()) {
        setError('Invalid email or password.');
        return null;
      }

      let foundUser = null;
      snap.forEach((child) => {
        const val = child.val();
        if (val.email === email.toLowerCase().trim() && val.password === hashedPw) {
          foundUser = { uid: child.key, email: val.email, displayName: val.displayName, photoURL: val.photoURL || '' };
        }
      });

      if (!foundUser) {
        setError('Invalid email or password.');
        return null;
      }

      await persistUser(foundUser);
      return foundUser;
    } catch (err) {
      console.error('Login error:', err);
      setError(friendlyError(err));
      return null;
    } finally {
      setAuthLoading(false);
    }
  }

  async function register(email, password, displayName) {
    setError(null);
    setAuthLoading(true);
    try {
      const normalizedEmail = email.toLowerCase().trim();

      if (password.length < 6) {
        setError('Password must be at least 6 characters.');
        return null;
      }

      // Check if email already exists
      const usersRef = ref(db, 'users');
      const snap = await get(usersRef);
      if (snap.exists()) {
        let exists = false;
        snap.forEach((child) => {
          if (child.val().email === normalizedEmail) exists = true;
        });
        if (exists) {
          setError('An account with this email already exists.');
          return null;
        }
      }

      const uid = generateUID();
      const hashedPw = await hashPassword(password);

      await set(ref(db, `users/${uid}`), {
        email: normalizedEmail,
        displayName: displayName || '',
        password: hashedPw,
        createdAt: Date.now(),
      });

      const newUser = { uid, email: normalizedEmail, displayName, photoURL: '' };
      await persistUser(newUser);
      return newUser;
    } catch (err) {
      console.error('Register error:', err);
      setError(friendlyError(err));
      return null;
    } finally {
      setAuthLoading(false);
    }
  }

  async function logout() {
    await persistUser(null);
    localStorage.removeItem('mira_user'); // clean up legacy session key
  }

  const value = { user, loading, authLoading, error, login, register, logout };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
