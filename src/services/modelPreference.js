const STORAGE_KEY = 'mira-model';
let selectedModel = 'mira-fast';

export function normalizeModel(value) {
  return value === 'mira-pro' ? 'mira-pro' : 'mira-fast';
}

export function getSelectedModel() {
  try { return normalizeModel(globalThis.localStorage?.getItem(STORAGE_KEY) || selectedModel); }
  catch { return selectedModel; }
}

export function setSelectedModel(value) {
  const model = normalizeModel(value);
  selectedModel = model;
  try { globalThis.localStorage?.setItem(STORAGE_KEY, model); } catch { /* Storage may be unavailable. */ }
  return model;
}
