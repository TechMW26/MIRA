import { SERVER_SESSION_KEY, readRememberedUser } from './authSessionStore.js';

const signInRequired = () => Object.assign(new Error('Your sign-in needs to be renewed before starting voice.'), { code: 'voice/sign-in-required' });

export async function getVoiceSession(signal, dependencies = {}) {
  const getAuth = dependencies.getAuth || (async () => (await import('../config/firebase.js')).auth);
  const readUser = dependencies.readUser || readRememberedUser;
  const readToken = dependencies.readToken || (() => localStorage.getItem(SERVER_SESSION_KEY));
  const fetchImpl = dependencies.fetchImpl || fetch;
  const before = readUser()?.uid;
  const auth = await getAuth();
  if (auth) await auth.authStateReady();
  const uid = readUser()?.uid || auth?.currentUser?.uid;
  if (!uid || (before && before !== uid)) throw signInRequired();
  const unchanged = () => (readUser()?.uid || auth?.currentUser?.uid) === uid
    && (!auth?.currentUser || auth.currentUser.uid === uid);
  const requestSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(20000)]);
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = auth?.currentUser ? await auth.currentUser.getIdToken(attempt > 0) : readToken();
    if (!token || !unchanged()) throw signInRequired();
    const response = await fetchImpl('/api/voice-agent', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionToken: token }), signal: requestSignal,
    });
    const data = await response.json().catch(() => ({}));
    if (!unchanged()) throw signInRequired();
    if (response.status === 401) {
      if (attempt === 0 && auth?.currentUser) continue;
      throw signInRequired();
    }
    if (!response.ok) throw Error(data.error || 'Could not start voice. Please try again.');
    if (typeof data.conversationToken !== 'string' || !data.conversationToken) throw Error('Could not start voice. Please try again.');
    return data;
  }
}
