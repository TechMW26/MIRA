export function decideRetrievalPolicy({
  manualSearch = false,
  engineNeedsSearch = false,
  websiteInspection = false,
  simpleGreeting = false,
  mediaRequested = false,
  visualSearch = false,
  contextualSearch = false,
  contextualMedia = false,
  hasAuthoritativeContext = false,
} = {}) {
  if (websiteInspection || simpleGreeting) {
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
  return 'WEB SEARCH POLICY: Answer from the supplied context and reliable knowledge when sufficient. Call web.search only when the answer materially depends on current, changing, high-stakes, niche, unfamiliar, or externally verifiable facts. Never search for greetings, casual conversation, creative work, rewriting, translation, summarization, or analysis of content already provided.';
}
