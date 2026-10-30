import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'mira-3ffa4.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'mira-3ffa4',
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || 'https://mira-3ffa4-default-rtdb.asia-southeast1.firebasedatabase.app',
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const firebaseAuthConfigured = Boolean(firebaseConfig.apiKey);
export const auth = firebaseAuthConfigured ? getAuth(app) : null;
export default app;
