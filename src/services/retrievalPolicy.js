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
  const includeMedia = search && Boolean(mediaRequested || visualSearch || contextualMedia);

  return { search, includeMedia };
}
