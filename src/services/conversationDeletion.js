export function conversationDeletionUpdates(uid, convId, {projectId, projectOwnerUid = uid} = {}) {
  for (const id of [uid, convId, ...(projectId ? [projectId, projectOwnerUid] : [])]) {
    if (typeof id !== 'string' || !id || /[.#$\[\]/]/.test(id)) throw new Error('Invalid conversation deletion target.');
  }
  const updates = {
    [`conversations/${uid}/${convId}`]: null,
    [`messages/${convId}`]: null,
  };
  if (projectId) for (const path of [
    `projects/${projectOwnerUid}/${projectId}/conversations/${convId}`,
    `sharedProjects/${projectId}/conversations/${convId}`,
    `projectChats/${projectId}/${convId}`,
    `projectContexts/${projectId}/conversations/${convId}`,
  ]) updates[path] = null;
  return updates;
}

export function evictDeletedConversation(storage, uid, convId) {
  try {
    storage?.removeItem(`mira-messages-${convId}`);
    const key = `mira-conversations-${uid}`;
    const cached = JSON.parse(storage?.getItem(key) || '[]');
    if (Array.isArray(cached)) storage?.setItem(key, JSON.stringify(cached.filter(chat => chat.id !== convId)));
  } catch { /* Storage is optional; the database deletion is authoritative. */ }
}
