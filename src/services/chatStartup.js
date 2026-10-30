function defaultSchedule() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });
}

export function createChatSendGate() {
  let activeRunId = null;

  return {
    acquire(runId, { interrupt = false } = {}) {
      if (activeRunId !== null && !interrupt) return false;
      activeRunId = runId;
      return true;
    },
    release(runId) {
      if (activeRunId === runId) activeRunId = null;
    },
    reset() {
      activeRunId = null;
    },
    isActive() {
      return activeRunId !== null;
    },
  };
}

export async function waitForConversationRoute(readRoute, expectedRoute, options = {}) {
  const schedule = options.schedule || defaultSchedule;
  const maxAttempts = Math.max(1, Number(options.maxAttempts || 12));
  const expectedConversationId = String(expectedRoute?.conversationId || '');
  const expectedProjectId = String(expectedRoute?.projectId || '');

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    // Always yield at least once. This lets React Router commit the URL and
    // gives the browser a paint opportunity before generation begins.
    await schedule();
    const route = readRoute?.() || {};
    if (
      String(route.conversationId || '') === expectedConversationId
      && String(route.projectId || '') === expectedProjectId
    ) {
      return route;
    }
  }

  throw new Error('The chat URL could not be prepared. Please try again.');
}
