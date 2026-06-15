import { db } from '../config/firebase';
import {
  ref,
  push,
  set,
  get,
  update,
  remove,
  query,
  orderByChild,
  onValue,
  off,
  serverTimestamp,
} from 'firebase/database';

// ── Users ──────────────────────────────────────────────
export async function createUserProfile(uid, data) {
  await set(ref(db, `users/${uid}`), {
    displayName: data.displayName || '',
    email: data.email,
    photoURL: data.photoURL || '',
    createdAt: Date.now(),
  });
}

export async function getUserProfile(uid) {
  const snap = await get(ref(db, `users/${uid}`));
  return snap.exists() ? snap.val() : null;
}

export function subscribeUserProfile(uid, callback) {
  const profileRef = ref(db, `users/${uid}`);
  onValue(profileRef, (snap) => {
    callback(snap.exists() ? snap.val() : null);
  });
  return () => off(profileRef);
}

// ── Conversations ──────────────────────────────────────
export async function createConversation(uid, title = 'New Chat') {
  const convRef = push(ref(db, `conversations/${uid}`));
  const conv = {
    title,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    model: 'llama3.2-vision',
  };
  await set(convRef, conv);
  return { id: convRef.key, ...conv };
}

export function subscribeConversations(uid, callback) {
  const convRef = query(ref(db, `conversations/${uid}`), orderByChild('updatedAt'));
  onValue(convRef, (snap) => {
    const convs = [];
    snap.forEach((child) => {
      convs.push({ id: child.key, ...child.val() });
    });
    callback(convs.reverse());
  });
  return () => off(convRef);
}

export async function updateConversation(uid, convId, data) {
  await update(ref(db, `conversations/${uid}/${convId}`), {
    ...data,
    updatedAt: Date.now(),
  });
}

export async function deleteConversation(uid, convId) {
  try {
    const messagesSnap = await get(ref(db, `messages/${convId}`));
    const pathnames = [];
    if (messagesSnap.exists()) {
      messagesSnap.forEach((child) => {
        const message = child.val() || {};
        const images = Array.isArray(message?.generatedMedia?.images) ? message.generatedMedia.images : [];
        for (const image of images) {
          const pathname = String(image?.pathname || '').trim();
          if (pathname) pathnames.push(pathname);
        }
      });
    }

    if (pathnames.length > 0) {
      await fetch('/api/media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete',
          userId: uid,
          pathnames: [...new Set(pathnames)],
        }),
      });
    }
  } catch (error) {
    console.warn('Conversation media cleanup failed:', error?.message || error);
  }

  await Promise.all([
    remove(ref(db, `conversations/${uid}/${convId}`)),
    remove(ref(db, `messages/${convId}`)),
  ]);
}

// ── Messages ───────────────────────────────────────────
export async function addMessage(convId, message) {
  const msgRef = push(ref(db, `messages/${convId}`));
  await set(msgRef, {
    ...message,
    timestamp: Date.now(),
  });
  return msgRef.key;
}

export async function updateMessage(convId, msgId, data) {
  await update(ref(db, `messages/${convId}/${msgId}`), data);
}

export async function deleteMessage(convId, msgId) {
  await remove(ref(db, `messages/${convId}/${msgId}`));
}

export function subscribeMessages(convId, callback) {
  const msgRef = query(ref(db, `messages/${convId}`), orderByChild('timestamp'));
  onValue(msgRef, (snap) => {
    const msgs = [];
    snap.forEach((child) => {
      msgs.push({ id: child.key, ...child.val() });
    });
    callback(msgs);
  });
  return () => off(msgRef);
}

// ── Projects ───────────────────────────────────────────
export async function createProject(uid, name, description = '') {
  const projRef = push(ref(db, `projects/${uid}`));
  const project = {
    name,
    description,
    createdAt: Date.now(),
    conversations: {},
  };
  await set(projRef, project);
  return { id: projRef.key, ...project };
}

export function subscribeProjects(uid, callback) {
  const projRef = ref(db, `projects/${uid}`);
  onValue(projRef, (snap) => {
    const projects = [];
    snap.forEach((child) => {
      projects.push({ id: child.key, ...child.val() });
    });
    callback(projects);
  });
  return () => off(projRef);
}

export async function deleteProject(uid, projectId) {
  // Also remove projectId from all conversations in this project
  const projSnap = await get(ref(db, `projects/${uid}/${projectId}/conversations`));
  if (projSnap.exists()) {
    const updates = {};
    projSnap.forEach((child) => {
      updates[`conversations/${uid}/${child.key}/projectId`] = null;
    });
    if (Object.keys(updates).length > 0) await update(ref(db), updates);
  }
  await remove(ref(db, `projects/${uid}/${projectId}`));
}

export async function addConversationToProject(uid, projectId, convId) {
  await Promise.all([
    set(ref(db, `projects/${uid}/${projectId}/conversations/${convId}`), true),
    update(ref(db, `conversations/${uid}/${convId}`), { projectId, updatedAt: Date.now() }),
  ]);
}

export async function removeConversationFromProject(uid, projectId, convId) {
  await Promise.all([
    remove(ref(db, `projects/${uid}/${projectId}/conversations/${convId}`)),
    update(ref(db, `conversations/${uid}/${convId}`), { projectId: null, updatedAt: Date.now() }),
  ]);
}

export async function updateProject(uid, projectId, data) {
  await update(ref(db, `projects/${uid}/${projectId}`), {
    ...data,
    updatedAt: Date.now(),
  });
}

// ── User Profile ───────────────────────────────────────
export async function updateUserProfile(uid, data) {
  await update(ref(db, `users/${uid}`), {
    ...data,
    updatedAt: Date.now(),
  });
}

