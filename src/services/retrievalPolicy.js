export function decideRetrievalPolicy({
  manualSearch = false,
  engineNeedsSearch = false,
  websiteInspection = false,
  simpleGreeting = false,
  directConversation = false,
  mediaRequested = false,
  visualSearch = false,
  contextualSearch = false,
  contextualMedia = false,
  hasAuthoritativeContext = false,
} = {}) {
  if (websiteInspection || simpleGreeting || directConversation) {
    return {
      search: false,
      includeMedia: false,
      allowSearchTool: false,
      searchPriority: false,
    };
  }

  if (hasAuthoritativeContext) {
    return {
      search: false,
      includeMedia: false,
      allowSearchTool: false,
      searchPriority: false,
    };
  }

  const searchPriority = Boolean(
    manualSearch
    || engineNeedsSearch
    || mediaRequested
    || visualSearch
    || contextualSearch
  );

  // A priority decision is deterministic truth-validation, not speculative
  // browsing. Prefetch evidence so a model cannot skip the required tool call;
  // ordinary conversation and self-contained uploads remain offline.
  return {
    search: searchPriority,
    includeMedia: Boolean(searchPriority && (mediaRequested || visualSearch || contextualMedia)),
    allowSearchTool: true,
    searchPriority,
  };
}

export function buildSearchToolGuidance({ allowSearchTool = true, searchPriority = false } = {}) {
  if (!allowSearchTool) {
    return 'WEB SEARCH POLICY: Do not search the internet for this turn. The user supplied authoritative context or an attachment; answer only from that material unless they explicitly request external verification.';
  }
  if (searchPriority) {
    return 'WEB SEARCH POLICY: This request needs live or externally verifiable information, so the host will retrieve it before generation. When REAL-TIME WEB SEARCH DATA or a web-search status is present in the current request, synthesize that evidence directly and do not request web.search again. Only call web.search when no retrieval data or status is supplied. Never expose the tool call.';
  }
  return 'WEB SEARCH POLICY: Validate fact-based questions with web evidence before answering. Also call web.search whenever the answer depends on current, changing, high-stakes, niche, unfamiliar, location-specific, or otherwise externally verifiable facts. Let the latest user turn and recent conversation determine a precise contextual query; never search a follow-up literally when its subject is available in context. Do not search for greetings, casual conversation, creative work, rewriting, translation, calculations, or analysis of content already provided.';
}
