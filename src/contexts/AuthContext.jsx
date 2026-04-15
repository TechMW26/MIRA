import { createContext, useContext, useEffect, useState } from 'react';
import { db } from '../config/firebase';
import { ref, get, set, query, orderByChild, equalTo } from 'firebase/database';

const AuthContext = createContext(null);

const SESSION_KEY = 'mira_user';

// Simple hash for passwords (not cryptographic — suitable for a demo/internal tool)
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
  const [loading, setLoading] = useState(true); // initial session restore
  const [authLoading, setAuthLoading] = useState(false); // login/register operations
  const [error, setError] = useState(null);

  // Restore session on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SESSION_KEY);
      if (saved) {
        setUser(JSON.parse(saved));
      }
    } catch {}
    setLoading(false);
  }, []);

  function persistUser(u) {
    setUser(u);
    if (u) {
      localStorage.setItem(SESSION_KEY, JSON.stringify(u));
    } else {
      localStorage.removeItem(SESSION_KEY);
    }
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
          foundUser = { uid: child.key, email: val.email, displayName: val.displayName };
        }
      });

      if (!foundUser) {
        setError('Invalid email or password.');
        return null;
      }

      persistUser(foundUser);
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

      const newUser = { uid, email: normalizedEmail, displayName };
      persistUser(newUser);
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
    persistUser(null);
  }

  const value = { user, loading, authLoading, error, login, register, logout };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
