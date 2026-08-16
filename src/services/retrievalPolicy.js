export function decideRetrievalPolicy({
  manualSearch = false,
  engineNeedsSearch = false,
  websiteInspection = false,
  simpleGreeting = false,
  mediaRequested = false,
  visualSearch = false,
  contextualSearch = false,
  contextualMedia = false,
} = {}) {
  if (websiteInspection || simpleGreeting) {
    return { search: false, includeMedia: false };
  }

  const search = Boolean(
    manualSearch
    || engineNeedsSearch
    || mediaRequested
    || visualSearch
    || contextualSearch
  );
  // Every real web-search turn returns a complete evidence package so the UI
  // can render related articles, images, and videos without another request.
  const includeMedia = search;

  return { search, includeMedia };
}
