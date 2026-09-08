function decodeSegment(value = '') {
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
}

function cleanId(value = '') {
  return String(value || '').trim().slice(0, 240);
}

export function buildChatPath({ projectId = null, conversationId = null } = {}) {
  const project = cleanId(projectId);
  const conversation = cleanId(conversationId);

  if (project && conversation) {
    return `/project/${encodeURIComponent(project)}/chat/${encodeURIComponent(conversation)}`;
  }
  if (project) return `/project/${encodeURIComponent(project)}`;
  if (conversation) return `/chat/${encodeURIComponent(conversation)}`;
  return '/';
}

export function parseChatRoute(pathname = '/', search = '') {
  const path = String(pathname || '/').replace(/\/+$/, '') || '/';
  const projectChat = path.match(/^\/project\/([^/]+)\/chat\/([^/]+)$/);
  if (projectChat) {
    return {
      managed: true,
      projectId: cleanId(decodeSegment(projectChat[1])) || null,
      conversationId: cleanId(decodeSegment(projectChat[2])) || null,
      legacy: false,
    };
  }

  const project = path.match(/^\/project\/([^/]+)$/);
  if (project) {
    return {
      managed: true,
      projectId: cleanId(decodeSegment(project[1])) || null,
      conversationId: null,
      legacy: false,
    };
  }

  const chat = path.match(/^\/chat\/([^/]+)$/);
  if (chat) {
    return {
      managed: true,
      projectId: null,
      conversationId: cleanId(decodeSegment(chat[1])) || null,
      legacy: false,
    };
  }

  if (path === '/') {
    const params = new URLSearchParams(search);
    const projectId = cleanId(params.get('p')) || null;
    const conversationId = cleanId(params.get('c')) || null;
    return {
      managed: true,
      projectId,
      conversationId,
      legacy: Boolean(projectId || conversationId),
    };
  }

  return {
    managed: false,
    projectId: null,
    conversationId: null,
    legacy: false,
  };
}
