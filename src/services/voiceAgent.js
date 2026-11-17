import { SERVER_SESSION_KEY, readRememberedUser } from './authSessionStore.js';

export async function getVoiceSession(signal) {
  const uid = readRememberedUser()?.uid;
  const { auth } = await import('../config/firebase.js');
  if (auth) await auth.authStateReady();
  const token = auth?.currentUser ? await auth.currentUser.getIdToken() : localStorage.getItem(SERVER_SESSION_KEY);
  if (!uid || !token || readRememberedUser()?.uid !== uid) throw Error('Please sign in to start voice.');
  const response = await fetch('/api/voice-agent', {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionToken: token }), signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
  });
  const data = await response.json();
  if (readRememberedUser()?.uid !== uid) throw Error('Your account changed. Please start voice again.');
  if (!response.ok) throw Error(data.error || 'Could not start voice.');
  return data;
}
