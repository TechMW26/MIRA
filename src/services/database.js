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

const PROJECT_RUN_LEASE_MS = 6 * 60 * 1000;

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

export async function updateConversationTitle(uid, convId, title) {
  await update(ref(db, `conversations/${uid}/${convId}`), {
    title,
    titleUpdatedAt: Date.now(),
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
    timestamp: Number.isFinite(message?.timestamp) ? message.timestamp : Date.now(),
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

// ── Shared project context ─────────────────────────────
export async function getProjectContext(projectId) {
  if (!projectId) return null;
  const snap = await get(ref(db, `projectContexts/${projectId}`));
  return snap.exists() ? snap.val() : null;
}

export async function saveProjectContextTurn(projectId, convId, turnId, turn) {
  if (!projectId || !convId || !turnId || !turn) return;
  const conversationRef = ref(db, `projectContexts/${projectId}/conversations/${convId}`);
  await runTransaction(conversationRef, (current) => {
    const turns = {
      ...(current?.turns || {}),
      [turnId]: turn,
    };
    const retainedTurns = Object.entries(turns)
      .sort(([, left], [, right]) => Number(right?.timestamp || 0) - Number(left?.timestamp || 0))
      .slice(0, 16)
      .reduce((result, [id, value]) => ({ ...result, [id]: value }), {});
    return {
      turns: retainedTurns,
      updatedAt: Number(turn.timestamp || Date.now()),
    };
  }, { applyLocally: false });
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
    callback([...projects.values()].sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)));
  };

  onValue(projRef, (snap) => {
    const projects = [];
    snap.forEach((child) => {
      projects.push({ id: child.key, ...child.val() });
    });
    owned = projects;
    emit();
  });

  onValue(accessRef, (snap) => {
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
      const unsubscribe = onValue(sharedRef, (projectSnap) => {
        if (projectSnap.exists()) shared.set(projectId, projectSnap.val());
        else shared.delete(projectId);
        emit();
      });
      sharedUnsubs.set(projectId, unsubscribe);
    });
    emit();
  });

  return () => {
    off(projRef);
    off(accessRef);
    sharedUnsubs.forEach((unsubscribe) => unsubscribe());
  };
}

async function ensureSharedProject(ownerUid, projectId) {
  const sharedRef = ref(db, `sharedProjects/${projectId}`);
  const existing = await get(sharedRef);
  if (existing.exists()) return existing.val();

  const legacy = await get(ref(db, `projects/${ownerUid}/${projectId}`));
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
  await update(ref(db), {
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
  if (project.ownerUid !== ownerUid) throw new Error('Only the project owner can invite collaborators.');
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
  onValue(chatsRef, (snap) => {
    const conversations = [];
    snap.forEach((child) => conversations.push({ id: child.key, ...child.val(), projectId }));
    callback(conversations.reverse());
  });
  return () => off(chatsRef);
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
  const access = await get(ref(db, `userProjectAccess/${uid}/${projectId}`));
  const ownerUid = access.val()?.ownerUid || uid;
  const project = await ensureSharedProject(ownerUid, projectId);
  if (!project.members?.[uid] && project.ownerUid !== uid) throw new Error('You do not have access to this project.');
  const convSnap = await get(ref(db, `conversations/${uid}/${convId}`));
  const conversation = convSnap.exists() ? convSnap.val() : { title: 'New Chat', createdAt: Date.now(), updatedAt: Date.now() };
  await Promise.all([
    project.ownerUid === uid
      ? set(ref(db, `projects/${uid}/${projectId}/conversations/${convId}`), true)
      : Promise.resolve(),
    set(ref(db, `sharedProjects/${projectId}/conversations/${convId}`), true),
    set(ref(db, `projectChats/${projectId}/${convId}`), { ...conversation, projectId, ownerUid: uid }),
    update(ref(db, `conversations/${uid}/${convId}`), { projectId, updatedAt: Date.now() }),
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

export async function updateProjectConversation(projectId, convId, data) {
  if (!projectId || !convId) return;
  const chatRef = ref(db, `projectChats/${projectId}/${convId}`);
  const chat = await get(chatRef);
  if (!chat.exists()) return;
  const next = { ...data, updatedAt: Date.now() };
  await Promise.all([
    update(chatRef, next),
    update(ref(db, `conversations/${chat.val().ownerUid}/${convId}`), next),
  ]);
}

export async function enqueueConversationPrompt(convId, prompt, author) {
  const queueRef = push(ref(db, `conversationQueues/${convId}`));
  await set(queueRef, {
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
  onValue(queueRef, (snap) => {
    const prompts = [];
    snap.forEach((child) => prompts.push({ ...child.val(), id: child.key }));
    callback(prompts);
  });
  return () => off(queueRef);
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
  onValue(runRef, (snap) => {
    if (expiryTimer) clearTimeout(expiryTimer);
    const run = snap.exists() ? snap.val() : null;
    const remaining = Number(run?.leaseUntil || 0) - Date.now();
    callback(run && remaining > 0 ? run : null);
    if (run && remaining > 0) {
      expiryTimer = setTimeout(() => callback(null), remaining + 50);
    }
  });
  return () => {
    if (expiryTimer) clearTimeout(expiryTimer);
    off(runRef);
  };
}

export async function acquireConversationRun(convId, runId, author) {
  const now = Date.now();
  const result = await runTransaction(ref(db, `conversationRuns/${convId}`), (current) => {
    if (current && current.leaseUntil > now && current.author?.uid !== author?.uid) return;
    return {
      runId,
      author: publicUserProfile(author?.uid, author || {}),
      startedAt: now,
      leaseUntil: now + PROJECT_RUN_LEASE_MS,
    };
  }, { applyLocally: false });
  return result.committed;
}

export async function releaseConversationRun(convId, runId) {
  if (!convId || !runId) return;
  await runTransaction(ref(db, `conversationRuns/${convId}`), (current) => (
    current?.runId === runId ? null : current
  ), { applyLocally: false });
}

// ── User Profile ───────────────────────────────────────
export async function updateUserProfile(uid, data) {
  await update(ref(db, `users/${uid}`), {
    ...data,
    updatedAt: Date.now(),
  });
}
