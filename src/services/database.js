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
  runTransaction,
} from 'firebase/database';
import { buildProjectContextTurn } from './projectContext.js';
import { fetchFirebaseSnapshot, writeFirebaseValue } from './firebaseRest.js';

const PROJECT_RUN_LEASE_MS = 6 * 60 * 1000;
const DATABASE_URL = import.meta.env.VITE_FIREBASE_DATABASE_URL
  || 'https://mira-3ffa4-default-rtdb.asia-southeast1.firebasedatabase.app';

const restSnapshot = (path) => fetchFirebaseSnapshot(DATABASE_URL, path);
const restPut = (path, value) => writeFirebaseValue(DATABASE_URL, path, value, { method: 'PUT' });
const restPatch = (path, value) => writeFirebaseValue(DATABASE_URL, path, value, { method: 'PATCH' });
const restDelete = (path) => writeFirebaseValue(DATABASE_URL, path, null, { method: 'DELETE' });

function readSubscriptionCache(key) {
  try {
    const value = JSON.parse(globalThis.localStorage?.getItem(key) || 'null');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeSubscriptionCache(key, value) {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // Storage is an optional resilience layer; live data remains authoritative.
  }
}

function resilientOnValue(reference, onSnapshot, label, fallbackPath = '') {
  let active = true;
  let received = false;
  let recoveryPromise = null;
  const recover = () => {
    if (!active || received || recoveryPromise) return;
    recoveryPromise = (fallbackPath
      ? fetchFirebaseSnapshot(DATABASE_URL, fallbackPath)
      : get(reference))
      .then((snapshot) => {
        if (active && !received) {
          received = true;
          clearTimeout(fallbackTimer);
          onSnapshot(snapshot);
        }
      })
      .catch((error) => console.warn(`${label} recovery failed:`, error?.message || error))
      .finally(() => { recoveryPromise = null; });
  };
  const fallbackTimer = setTimeout(recover, 2_500);
  const unsubscribe = onValue(
    reference,
    (snapshot) => {
      received = true;
      clearTimeout(fallbackTimer);
      if (active) onSnapshot(snapshot);
    },
    (error) => {
      console.warn(`${label} subscription failed:`, error?.message || error);
      recover();
    },
  );
  return () => {
    active = false;
    clearTimeout(fallbackTimer);
    unsubscribe();
  };
}

function publicUserProfile(uid, profile = {}) {
  return {
    uid: String(uid || ''),
    email: String(profile.email || '').trim().toLowerCase(),
    displayName: String(profile.displayName || '').trim(),
    photoURL: String(profile.photoURL || '').trim(),
  };
}

// ── Users ──────────────────────────────────────────────
export async function createUserProfile(uid, data) {
  await restPut(`users/${uid}`, {
    displayName: data.displayName || '',
    email: data.email,
    photoURL: data.photoURL || '',
    createdAt: Date.now(),
  });
}

export async function getUserProfile(uid) {
  const snap = await restSnapshot(`users/${uid}`);
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
  };
  await restPut(`conversations/${uid}/${convRef.key}`, conv);
  return { id: convRef.key, ...conv };
}

export function subscribeConversations(uid, callback) {
  const cacheKey = `mira-conversations-${uid}`;
  const cached = readSubscriptionCache(cacheKey);
  if (cached.length) callback(cached);
  const convRef = ref(db, `conversations/${uid}`);
  return resilientOnValue(convRef, (snap) => {
    const convs = [];
    snap.forEach((child) => {
      convs.push({ id: child.key, ...child.val() });
    });
    convs.sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0));
    writeSubscriptionCache(cacheKey, convs);
    callback(convs);
  }, 'Conversation', `conversations/${uid}`);
}

export async function updateConversation(uid, convId, data) {
  await restPatch(`conversations/${uid}/${convId}`, {
    ...data,
    updatedAt: Date.now(),
  });
}

export async function updateConversationTitle(uid, convId, title) {
  await restPatch(`conversations/${uid}/${convId}`, {
    title,
    titleUpdatedAt: Date.now(),
  });
}

export async function deleteConversation(uid, convId) {
  try {
    const messagesSnap = await restSnapshot(`messages/${convId}`);
    const mediaItems = [];
    if (messagesSnap.exists()) {
      messagesSnap.forEach((child) => {
        const message = child.val() || {};
        const images = Array.isArray(message?.generatedMedia?.images) ? message.generatedMedia.images : [];
        for (const image of images) {
          const pathname = String(image?.pathname || '').trim();
          if (pathname) mediaItems.push({ pathname, deleteToken: String(image?.deleteToken || '') });
        }
      });
    }

    if (mediaItems.length > 0) {
      await fetch('/api/media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete',
          userId: uid,
          items: Array.from(new Map(mediaItems.map((item) => [item.pathname, item])).values()),
        }),
      });
    }
  } catch (error) {
    console.warn('Conversation media cleanup failed:', error?.message || error);
  }

  await Promise.all([
    restDelete(`conversations/${uid}/${convId}`),
    restDelete(`messages/${convId}`),
  ]);
}

// ── Messages ───────────────────────────────────────────
export async function addMessage(convId, message) {
  const msgRef = push(ref(db, `messages/${convId}`));
  await restPut(`messages/${convId}/${msgRef.key}`, {
    ...message,
    timestamp: Number.isFinite(message?.timestamp) ? message.timestamp : Date.now(),
  });
  return msgRef.key;
}

export async function updateMessage(convId, msgId, data) {
  await restPatch(`messages/${convId}/${msgId}`, data);
}

export async function deleteMessage(convId, msgId) {
  await restDelete(`messages/${convId}/${msgId}`);
}

export function subscribeMessages(convId, callback) {
  const msgRef = query(ref(db, `messages/${convId}`), orderByChild('timestamp'));
  return resilientOnValue(msgRef, (snap) => {
    const msgs = [];
    snap.forEach((child) => {
      msgs.push({ id: child.key, ...child.val() });
    });
    callback(msgs);
  }, 'Message', `messages/${convId}`);
}

// ── Shared project context ─────────────────────────────
export async function getProjectContext(projectId) {
  if (!projectId) return null;
  const snap = await restSnapshot(`projectContexts/${projectId}`);
  const existingContext = snap.exists() ? snap.val() : null;
  if (existingContext?.bootstrappedAt) return existingContext;

  // Projects created before shared memory existed are bootstrapped once from
  // their most recent chats. This keeps historical documents useful without
  // copying raw image bytes into the context store.
  const chatsSnap = await restSnapshot(`projectChats/${projectId}`);
  const chats = [];
  chatsSnap.forEach((child) => chats.push({ id: child.key, ...child.val() }));
  const recentChats = chats
    .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
    .slice(0, 8);
  if (!recentChats.length) return existingContext;

  const conversations = {};
  await Promise.all(recentChats.map(async (chat) => {
    const messagesSnap = await restSnapshot(`messages/${chat.id}`);
    const messages = [];
    messagesSnap.forEach((child) => messages.push({ id: child.key, ...child.val() }));
    const sortedMessages = messages
      .sort((left, right) => Number(left.timestamp || 0) - Number(right.timestamp || 0));
    const recentMessages = sortedMessages.slice(-24);
    const turns = {};
    const projectFiles = [];
    const projectImageAnalyses = [];
    const seenFiles = new Set();
    [...sortedMessages].reverse().forEach((message) => {
      if (message.role !== 'user') return;
      (Array.isArray(message.attachments) ? message.attachments : []).forEach((attachment) => {
        const key = `${String(attachment?.name || '').toLowerCase()}|${String(attachment?.type || '').toLowerCase()}`;
        if (!attachment || seenFiles.has(key) || seenFiles.size >= 16) return;
        seenFiles.add(key);
        if (attachment.isImage) {
          projectImageAnalyses.push({
            name: attachment.name || 'Attached image',
            summary: `This image was supplied with the project request: ${String(message.content || '').slice(0, 600)}`,
          });
        } else {
          projectFiles.push(attachment);
        }
      });
    });
    if (projectFiles.length || projectImageAnalyses.length) {
      turns.projectReferences = buildProjectContextTurn({
        userText: 'Project reference files and images shared across conversations.',
        assistantText: 'Use these first-party project sources when they are relevant to later requests.',
        attachments: projectFiles,
        imageAnalyses: projectImageAnalyses,
        author: {},
        conversationTitle: chat.title || 'Project references',
        timestamp: Number(chat.updatedAt || Date.now()),
      });
    }
    for (let index = 0; index < recentMessages.length; index += 1) {
      const userMessage = recentMessages[index];
      if (userMessage.role !== 'user') continue;
      let assistantMessage = null;
      for (let next = index + 1; next < recentMessages.length; next += 1) {
        if (recentMessages[next].role === 'user') break;
        if (recentMessages[next].role === 'assistant' && String(recentMessages[next].content || '').trim()) {
          assistantMessage = recentMessages[next];
          break;
        }
      }
      if (!assistantMessage) continue;
      const attachments = Array.isArray(userMessage.attachments) ? userMessage.attachments : [];
      const imageAnalyses = attachments
        .filter((attachment) => attachment?.isImage)
        .map((attachment) => ({
          name: attachment.name || 'Attached image',
          summary: `An image was attached for this request: ${String(userMessage.content || '').slice(0, 600)}`,
        }));
      turns[assistantMessage.id || userMessage.id] = buildProjectContextTurn({
        userText: userMessage.promptContent || userMessage.content,
        assistantText: assistantMessage.content,
        attachments,
        imageAnalyses,
        author: userMessage.author,
        conversationTitle: chat.title || 'Project chat',
        timestamp: Number(assistantMessage.timestamp || userMessage.timestamp || Date.now()),
      });
    }
    if (Object.keys(turns).length) {
      conversations[chat.id] = { turns, updatedAt: Number(chat.updatedAt || Date.now()) };
    }
  }));
  if (!Object.keys(conversations).length) return existingContext;

  const mergedConversations = { ...conversations };
  Object.entries(existingContext?.conversations || {}).forEach(([conversationId, conversation]) => {
    mergedConversations[conversationId] = {
      ...(mergedConversations[conversationId] || {}),
      ...conversation,
      turns: {
        ...(mergedConversations[conversationId]?.turns || {}),
        ...(conversation?.turns || {}),
      },
    };
  });
  const result = {
    ...(existingContext || {}),
    conversations: mergedConversations,
    bootstrappedAt: Date.now(),
  };
  await restPut(`projectContexts/${projectId}`, result);
  return result;
}

export async function saveProjectContextTurn(projectId, convId, turnId, turn) {
  if (!projectId || !convId || !turnId || !turn) return;
  const path = `projectContexts/${projectId}/conversations/${convId}`;
  const currentSnapshot = await restSnapshot(path);
  const current = currentSnapshot.exists() ? currentSnapshot.val() : null;
  const turns = {
    ...(current?.turns || {}),
    [turnId]: turn,
  };
  const retainedTurns = Object.entries(turns)
    .sort(([, left], [, right]) => Number(right?.timestamp || 0) - Number(left?.timestamp || 0))
    .slice(0, 16)
    .reduce((result, [id, value]) => ({ ...result, [id]: value }), {});
  await restPut(path, {
    turns: retainedTurns,
    updatedAt: Number(turn.timestamp || Date.now()),
  });
}

// ── Projects ───────────────────────────────────────────
export async function createProject(uid, name, description = '') {
  const projRef = push(ref(db, `projects/${uid}`));
  const owner = publicUserProfile(uid, await getUserProfile(uid) || {});
  const project = {
    name,
    description,
    ownerUid: uid,
    members: {
      [uid]: { ...owner, role: 'owner', joinedAt: Date.now() },
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    conversations: {},
  };
  const projectId = projRef.key;
  await update(ref(db), {
    [`projects/${uid}/${projectId}`]: project,
    [`sharedProjects/${projectId}`]: project,
    [`userProjectAccess/${uid}/${projectId}`]: { ownerUid: uid, role: 'owner', addedAt: Date.now() },
  });
  return { id: projectId, ...project, role: 'owner', isOwner: true };
}

export function subscribeProjects(uid, callback) {
  const cacheKey = `mira-projects-${uid}`;
  const cached = readSubscriptionCache(cacheKey);
  if (cached.length) callback(cached);
  const projRef = ref(db, `projects/${uid}`);
  const accessRef = ref(db, `userProjectAccess/${uid}`);
  let owned = [];
  const shared = new Map();
  const sharedUnsubs = new Map();

  const emit = () => {
    const projects = new Map();
    owned.forEach((project) => projects.set(project.id, {
      ...project,
      ownerUid: project.ownerUid || uid,
      role: 'owner',
      isOwner: true,
    }));
    shared.forEach((project, projectId) => {
      projects.set(projectId, {
        ...projects.get(projectId),
        ...project,
        id: projectId,
        role: project.members?.[uid]?.role || 'member',
        isOwner: project.ownerUid === uid,
      });
    });
    const next = [...projects.values()].sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
    writeSubscriptionCache(cacheKey, next);
    callback(next);
  };

  const unsubscribeOwned = resilientOnValue(projRef, (snap) => {
    const projects = [];
    snap.forEach((child) => {
      projects.push({ id: child.key, ...child.val() });
    });
    owned = projects;
    emit();
  }, 'Project', `projects/${uid}`);

  const unsubscribeAccess = resilientOnValue(accessRef, (snap) => {
    const nextIds = new Set();
    snap.forEach((child) => nextIds.add(child.key));
    sharedUnsubs.forEach((unsubscribe, projectId) => {
      if (!nextIds.has(projectId)) {
        unsubscribe();
        sharedUnsubs.delete(projectId);
        shared.delete(projectId);
      }
    });
    nextIds.forEach((projectId) => {
      if (sharedUnsubs.has(projectId)) return;
      const sharedRef = ref(db, `sharedProjects/${projectId}`);
      const unsubscribe = resilientOnValue(sharedRef, (projectSnap) => {
        if (projectSnap.exists()) shared.set(projectId, projectSnap.val());
        else shared.delete(projectId);
        emit();
      }, 'Shared project', `sharedProjects/${projectId}`);
      sharedUnsubs.set(projectId, unsubscribe);
    });
    emit();
  }, 'Project access', `userProjectAccess/${uid}`);

  return () => {
    unsubscribeOwned();
    unsubscribeAccess();
    sharedUnsubs.forEach((unsubscribe) => unsubscribe());
  };
}

async function ensureSharedProject(ownerUid, projectId) {
  const existing = await restSnapshot(`sharedProjects/${projectId}`);
  if (existing.exists()) return existing.val();

  const legacy = await restSnapshot(`projects/${ownerUid}/${projectId}`);
  if (!legacy.exists()) throw new Error('Project not found.');
  const owner = publicUserProfile(ownerUid, await getUserProfile(ownerUid) || {});
  const value = {
    ...legacy.val(),
    ownerUid,
    members: {
      ...(legacy.val()?.members || {}),
      [ownerUid]: { ...owner, role: 'owner', joinedAt: Date.now() },
    },
    updatedAt: Date.now(),
  };
  await restPatch('', {
    [`sharedProjects/${projectId}`]: value,
    [`userProjectAccess/${ownerUid}/${projectId}`]: { ownerUid, role: 'owner', addedAt: Date.now() },
  });
  return value;
}

export async function inviteProjectMember(ownerUid, projectId, email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) throw new Error('Enter an email address.');
  // Read once and match locally. Realtime Database rejects an orderByChild
  // query unless the deployed rules explicitly index that child.
  const usersSnap = await get(ref(db, 'users'));
  let invited = null;
  usersSnap.forEach((child) => {
    if (!invited && String(child.val()?.email || '').trim().toLowerCase() === normalizedEmail) {
      invited = publicUserProfile(child.key, child.val());
    }
  });
  if (!invited) throw new Error('No existing MIRA account uses that email.');

  const project = await ensureSharedProject(ownerUid, projectId);
  if (project.ownerUid !== ownerUid) throw new Error('Only the project owner can Invite.');
  if (invited.uid === ownerUid) throw new Error('You already own this project.');
  if (project.members?.[invited.uid]) throw new Error('That account already has access.');

  const now = Date.now();
  const owner = project.members?.[ownerUid]
    || publicUserProfile(ownerUid, await getUserProfile(ownerUid) || {});
  const invitation = {
    projectId,
    projectName: String(project.name || 'Untitled project'),
    ownerUid,
    invitedUid: invited.uid,
    invitedBy: publicUserProfile(ownerUid, owner),
    invitee: invited,
    status: 'pending',
    createdAt: now,
  };
  const existing = await get(ref(db, `projectInvitations/${invited.uid}/${projectId}`));
  if (existing.exists()) throw new Error('An invitation is already pending for that account.');
  await update(ref(db), {
    [`projectInvitations/${invited.uid}/${projectId}`]: invitation,
    [`projectInvitationsByProject/${projectId}/${invited.uid}`]: invitation,
  });
  return { ...invited, invitation };
}

async function buildProjectConversationAccessUpdates(project, projectId, invited, now) {
  const updates = {};
  const ownerUid = project.ownerUid;

  const conversations = project.conversations || {};
  await Promise.all(Object.keys(conversations).map(async (convId) => {
    const [convSnap, messagesSnap] = await Promise.all([
      get(ref(db, `conversations/${ownerUid}/${convId}`)),
      get(ref(db, `messages/${convId}`)),
    ]);
    if (convSnap.exists()) {
      updates[`projectChats/${projectId}/${convId}`] = { ...convSnap.val(), ownerUid, projectId };
    }
    messagesSnap.forEach((messageSnap) => {
      const message = messageSnap.val();
      if (message?.role === 'user' && !message.author?.uid) {
        updates[`messages/${convId}/${messageSnap.key}/author`] = project.members?.[ownerUid]
          || publicUserProfile(ownerUid, {});
      }
    });
  }));
  updates[`sharedProjects/${projectId}/members/${invited.uid}`] = {
    ...invited,
    role: 'member',
    joinedAt: now,
    invitedBy: ownerUid,
  };
  updates[`sharedProjects/${projectId}/updatedAt`] = now;
  updates[`userProjectAccess/${invited.uid}/${projectId}`] = {
    ownerUid,
    role: 'member',
    addedAt: now,
  };
  return updates;
}

export function subscribeProjectInvitations(uid, callback) {
  if (!uid) {
    callback([]);
    return () => {};
  }
  const invitationsRef = ref(db, `projectInvitations/${uid}`);
  onValue(invitationsRef, (snap) => {
    const invitations = [];
    snap.forEach((child) => {
      const invitation = child.val() || {};
      if (invitation.status === 'pending') invitations.push({ id: child.key, ...invitation });
    });
    callback(invitations.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
  });
  return () => off(invitationsRef);
}

export function subscribeOutgoingProjectInvitations(projectId, callback) {
  if (!projectId) {
    callback([]);
    return () => {};
  }
  const invitationsRef = ref(db, `projectInvitationsByProject/${projectId}`);
  onValue(invitationsRef, (snap) => {
    const invitations = [];
    snap.forEach((child) => {
      const invitation = child.val() || {};
      if (invitation.status === 'pending') invitations.push({ id: child.key, ...invitation });
    });
    callback(invitations.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
  });
  return () => off(invitationsRef);
}

export async function acceptProjectInvitation(uid, projectId) {
  const invitationRef = ref(db, `projectInvitations/${uid}/${projectId}`);
  const invitationSnap = await get(invitationRef);
  if (!invitationSnap.exists()) throw new Error('This invitation is no longer available.');
  const invitation = invitationSnap.val() || {};
  if (invitation.status !== 'pending' || invitation.invitedUid !== uid) {
    throw new Error('This invitation is no longer available.');
  }
  const project = await ensureSharedProject(invitation.ownerUid, projectId);
  const invited = invitation.invitee || publicUserProfile(uid, await getUserProfile(uid) || {});
  const updates = await buildProjectConversationAccessUpdates(project, projectId, invited, Date.now());
  updates[`projectInvitations/${uid}/${projectId}`] = null;
  updates[`projectInvitationsByProject/${projectId}/${uid}`] = null;
  await update(ref(db), updates);
  return { id: projectId, ...project, members: { ...(project.members || {}), [uid]: invited } };
}

export async function declineProjectInvitation(uid, projectId) {
  const invitationSnap = await get(ref(db, `projectInvitations/${uid}/${projectId}`));
  if (!invitationSnap.exists()) return;
  const invitation = invitationSnap.val() || {};
  if (invitation.invitedUid !== uid) throw new Error('You cannot decline this invitation.');
  await update(ref(db), {
    [`projectInvitations/${uid}/${projectId}`]: null,
    [`projectInvitationsByProject/${projectId}/${uid}`]: null,
  });
}

export async function cancelProjectInvitation(ownerUid, projectId, invitedUid) {
  const invitationSnap = await get(ref(db, `projectInvitationsByProject/${projectId}/${invitedUid}`));
  if (!invitationSnap.exists()) return;
  const invitation = invitationSnap.val() || {};
  if (invitation.ownerUid !== ownerUid) throw new Error('Only the project owner can cancel this invitation.');
  await update(ref(db), {
    [`projectInvitations/${invitedUid}/${projectId}`]: null,
    [`projectInvitationsByProject/${projectId}/${invitedUid}`]: null,
  });
}

export async function removeProjectMember(ownerUid, projectId, memberUid) {
  const project = await ensureSharedProject(ownerUid, projectId);
  if (project.ownerUid !== ownerUid) throw new Error('Only the project owner can remove collaborators.');
  if (memberUid === ownerUid) throw new Error('The project owner cannot be removed.');
  await update(ref(db), {
    [`sharedProjects/${projectId}/members/${memberUid}`]: null,
    [`sharedProjects/${projectId}/updatedAt`]: Date.now(),
    [`userProjectAccess/${memberUid}/${projectId}`]: null,
  });
}

export function subscribeProjectConversations(projectId, callback) {
  if (!projectId) {
    callback([]);
    return () => {};
  }
  const chatsRef = query(ref(db, `projectChats/${projectId}`), orderByChild('updatedAt'));
  return resilientOnValue(chatsRef, (snap) => {
    const conversations = [];
    snap.forEach((child) => conversations.push({ id: child.key, ...child.val(), projectId }));
    callback(conversations.reverse());
  }, 'Project conversation', `projectChats/${projectId}`);
}

export async function getProjectConversation(projectId, convId) {
  if (!projectId || !convId) return null;
  const snapshot = await restSnapshot(`projectChats/${projectId}/${convId}`);
  return snapshot.exists() ? { id: convId, ...snapshot.val(), projectId } : null;
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
  const [shared, pendingInvitations] = await Promise.all([
    get(ref(db, `sharedProjects/${projectId}`)),
    get(ref(db, `projectInvitationsByProject/${projectId}`)),
  ]);
  const project = shared.exists() ? shared.val() : null;
  if (project?.ownerUid && project.ownerUid !== uid) throw new Error('Only the project owner can delete this project.');
  const updates = {
    [`projects/${uid}/${projectId}`]: null,
    [`sharedProjects/${projectId}`]: null,
    [`projectChats/${projectId}`]: null,
    [`projectContexts/${projectId}`]: null,
  };
  const chats = await get(ref(db, `projectChats/${projectId}`));
  chats.forEach((chatSnap) => {
    const chat = chatSnap.val() || {};
    if (chat.ownerUid) updates[`conversations/${chat.ownerUid}/${chatSnap.key}/projectId`] = null;
    updates[`conversationQueues/${chatSnap.key}`] = null;
    updates[`conversationRuns/${chatSnap.key}`] = null;
  });
  Object.keys(project?.members || { [uid]: true }).forEach((memberUid) => {
    updates[`userProjectAccess/${memberUid}/${projectId}`] = null;
  });
  pendingInvitations.forEach((invitationSnap) => {
    updates[`projectInvitations/${invitationSnap.key}/${projectId}`] = null;
  });
  updates[`projectInvitationsByProject/${projectId}`] = null;
  await update(ref(db), updates);
}

export async function addConversationToProject(uid, projectId, convId) {
  const access = await restSnapshot(`userProjectAccess/${uid}/${projectId}`);
  const ownerUid = access.val()?.ownerUid || uid;
  const project = await ensureSharedProject(ownerUid, projectId);
  if (!project.members?.[uid] && project.ownerUid !== uid) throw new Error('You do not have access to this project.');
  const convSnap = await restSnapshot(`conversations/${uid}/${convId}`);
  const conversation = convSnap.exists() ? convSnap.val() : { title: 'New Chat', createdAt: Date.now(), updatedAt: Date.now() };
  await Promise.all([
    project.ownerUid === uid
      ? restPut(`projects/${uid}/${projectId}/conversations/${convId}`, true)
      : Promise.resolve(),
    restPut(`sharedProjects/${projectId}/conversations/${convId}`, true),
    restPut(`projectChats/${projectId}/${convId}`, { ...conversation, projectId, ownerUid: uid }),
    restPatch(`conversations/${uid}/${convId}`, { projectId, updatedAt: Date.now() }),
  ]);
}

export async function removeConversationFromProject(uid, projectId, convId) {
  const chatSnap = await get(ref(db, `projectChats/${projectId}/${convId}`));
  const conversationOwnerUid = chatSnap.val()?.ownerUid || uid;
  await Promise.all([
    remove(ref(db, `projects/${uid}/${projectId}/conversations/${convId}`)),
    remove(ref(db, `sharedProjects/${projectId}/conversations/${convId}`)),
    remove(ref(db, `projectChats/${projectId}/${convId}`)),
    remove(ref(db, `projectContexts/${projectId}/conversations/${convId}`)),
    update(ref(db, `conversations/${conversationOwnerUid}/${convId}`), { projectId: null, updatedAt: Date.now() }),
  ]);
}

export async function updateProject(uid, projectId, data) {
  const shared = await get(ref(db, `sharedProjects/${projectId}`));
  const ownerUid = shared.val()?.ownerUid || uid;
  if (ownerUid !== uid) throw new Error('Only the project owner can change project settings.');
  const next = { ...data, updatedAt: Date.now() };
  await Promise.all([
    update(ref(db, `projects/${ownerUid}/${projectId}`), next),
    update(ref(db, `sharedProjects/${projectId}`), next),
  ]);
}

async function requireProjectAccess(uid, projectId) {
  const access = await get(ref(db, `userProjectAccess/${uid}/${projectId}`));
  const ownerUid = access.val()?.ownerUid || uid;
  const project = await ensureSharedProject(ownerUid, projectId);
  if (project.ownerUid !== uid && !project.members?.[uid]) {
    throw new Error('You do not have access to this project.');
  }
  return project;
}

export async function updateProjectInstructions(uid, projectId, instructions) {
  const project = await requireProjectAccess(uid, projectId);
  if (project.ownerUid !== uid) throw new Error('Only the project owner can change project instructions.');
  const value = String(instructions || '').replace(/\u0000/g, '').trim().slice(0, 12000);
  const now = Date.now();
  await update(ref(db), {
    [`projects/${project.ownerUid}/${projectId}/instructions`]: value || null,
    [`projects/${project.ownerUid}/${projectId}/updatedAt`]: now,
    [`sharedProjects/${projectId}/instructions`]: value || null,
    [`sharedProjects/${projectId}/updatedAt`]: now,
    [`projectContexts/${projectId}/projectProfile/instructions`]: value || null,
    [`projectContexts/${projectId}/projectProfile/updatedAt`]: now,
  });
}

export async function addProjectReferenceDocument(uid, projectId, document) {
  const project = await requireProjectAccess(uid, projectId);
  const documentId = push(ref(db, `projectContexts/${projectId}/projectProfile/documents`)).key;
  const name = String(document?.name || 'Untitled document').trim().slice(0, 240);
  const type = String(document?.type || '').trim().slice(0, 160);
  const summary = String(document?.text || '')
    .replace(/\u0000/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16000);
  if (!summary) throw new Error(`No readable text was found in ${name}.`);
  const now = Date.now();
  const uploadedBy = publicUserProfile(uid, await getUserProfile(uid) || {});
  const metadata = { id: documentId, name, type, size: Number(document?.size || 0), uploadedAt: now, uploadedBy };
  await update(ref(db), {
    [`projects/${project.ownerUid}/${projectId}/referenceDocuments/${documentId}`]: metadata,
    [`projects/${project.ownerUid}/${projectId}/updatedAt`]: now,
    [`sharedProjects/${projectId}/referenceDocuments/${documentId}`]: metadata,
    [`sharedProjects/${projectId}/updatedAt`]: now,
    [`projectContexts/${projectId}/projectProfile/documents/${documentId}`]: { ...metadata, summary },
    [`projectContexts/${projectId}/projectProfile/updatedAt`]: now,
  });
  return metadata;
}

export async function removeProjectReferenceDocument(uid, projectId, documentId) {
  const project = await requireProjectAccess(uid, projectId);
  const documentSnap = await get(ref(db, `sharedProjects/${projectId}/referenceDocuments/${documentId}`));
  if (!documentSnap.exists()) return;
  const uploaderUid = documentSnap.val()?.uploadedBy?.uid;
  if (project.ownerUid !== uid && uploaderUid !== uid) {
    throw new Error('Only the project owner or uploader can remove this document.');
  }
  const now = Date.now();
  await update(ref(db), {
    [`projects/${project.ownerUid}/${projectId}/referenceDocuments/${documentId}`]: null,
    [`projects/${project.ownerUid}/${projectId}/updatedAt`]: now,
    [`sharedProjects/${projectId}/referenceDocuments/${documentId}`]: null,
    [`sharedProjects/${projectId}/updatedAt`]: now,
    [`projectContexts/${projectId}/projectProfile/documents/${documentId}`]: null,
    [`projectContexts/${projectId}/projectProfile/updatedAt`]: now,
  });
}

export async function updateProjectConversation(projectId, convId, data) {
  if (!projectId || !convId) return;
  const chat = await restSnapshot(`projectChats/${projectId}/${convId}`);
  if (!chat.exists()) return;
  const next = { ...data, updatedAt: Date.now() };
  await Promise.all([
    restPatch(`projectChats/${projectId}/${convId}`, next),
    restPatch(`conversations/${chat.val().ownerUid}/${convId}`, next),
  ]);
}

export async function enqueueConversationPrompt(convId, prompt, author) {
  const queueRef = push(ref(db, `conversationQueues/${convId}`));
  await restPut(`conversationQueues/${convId}/${queueRef.key}`, {
    ...prompt,
    id: queueRef.key,
    author: publicUserProfile(author?.uid, author || {}),
    queuedAt: Date.now(),
  });
  return queueRef.key;
}

export function subscribeConversationQueue(convId, callback) {
  if (!convId) {
    callback([]);
    return () => {};
  }
  const queueRef = query(ref(db, `conversationQueues/${convId}`), orderByChild('queuedAt'));
  return resilientOnValue(queueRef, (snap) => {
    const prompts = [];
    snap.forEach((child) => prompts.push({ ...child.val(), id: child.key }));
    callback(prompts);
  }, 'Conversation queue', `conversationQueues/${convId}`);
}

export async function updateConversationPrompt(convId, promptId, authorUid, data) {
  const promptRef = ref(db, `conversationQueues/${convId}/${promptId}`);
  const snap = await get(promptRef);
  if (!snap.exists() || snap.val()?.author?.uid !== authorUid) throw new Error('You can only edit your own queued prompts.');
  await update(promptRef, data);
}

export async function removeConversationPrompt(convId, promptId, authorUid) {
  const promptRef = ref(db, `conversationQueues/${convId}/${promptId}`);
  const snap = await get(promptRef);
  if (!snap.exists()) return;
  if (snap.val()?.author?.uid !== authorUid) throw new Error('You can only cancel your own queued prompts.');
  await remove(promptRef);
}

export function subscribeConversationRun(convId, callback) {
  if (!convId) {
    callback(null);
    return () => {};
  }
  const runRef = ref(db, `conversationRuns/${convId}`);
  let expiryTimer = null;
  const unsubscribe = resilientOnValue(runRef, (snap) => {
    if (expiryTimer) clearTimeout(expiryTimer);
    const run = snap.exists() ? snap.val() : null;
    const remaining = Number(run?.leaseUntil || 0) - Date.now();
    callback(run && remaining > 0 ? run : null);
    if (run && remaining > 0) {
      expiryTimer = setTimeout(() => callback(null), remaining + 50);
    }
  }, 'Conversation run', `conversationRuns/${convId}`);
  return () => {
    if (expiryTimer) clearTimeout(expiryTimer);
    unsubscribe();
  };
}

export async function acquireConversationRun(convId, runId, author) {
  const now = Date.now();
  const path = `conversationRuns/${convId}`;
  const currentSnapshot = await restSnapshot(path);
  const current = currentSnapshot.exists() ? currentSnapshot.val() : null;
  if (current && current.leaseUntil > now && current.author?.uid !== author?.uid) return false;
  await restPut(path, {
    runId,
    author: publicUserProfile(author?.uid, author || {}),
    startedAt: now,
    leaseUntil: now + PROJECT_RUN_LEASE_MS,
  });
  return true;
}

export async function releaseConversationRun(convId, runId) {
  if (!convId || !runId) return;
  const path = `conversationRuns/${convId}`;
  const current = await restSnapshot(path);
  if (current.val()?.runId === runId) await restDelete(path);
}

// ── User Profile ───────────────────────────────────────
export async function updateUserProfile(uid, data) {
  await update(ref(db, `users/${uid}`), {
    ...data,
    updatedAt: Date.now(),
  });
}
