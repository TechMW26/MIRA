import { requestDesktopCodeAssist } from './desktopBridge.js';

function toolEvidenceText(toolResults = []) {
  return toolResults
    .slice(-20)
    .map(({ name, result }) => `=== ${String(name || 'workspace')} ===\n${String(result || '').slice(0, 24_000)}`)
    .join('\n\n')
    .slice(0, 90_000);
}

function parseJsonResult(toolResults, name) {
  const result = toolResults.findLast?.((entry) => entry.name === name)?.result
    ?? [...toolResults].reverse().find((entry) => entry.name === name)?.result;
  try { return JSON.parse(String(result || '')); } catch { return null; }
}

export async function requestWorkspaceSynthesis({ request, toolResults, fetchImpl = fetch, signal } = {}) {
  const body = {
    task: 'workspace-synthesis',
    request: String(request || '').slice(0, 4_000),
    evidence: toolEvidenceText(toolResults),
  };
  let desktopResult = null;
  try {
    desktopResult = await requestDesktopCodeAssist(body);
  } catch {
    // The hosted small-model route remains a secondary synthesis fallback.
  }
  if (desktopResult?.suggestion) return String(desktopResult.suggestion).trim();

  const response = await fetchImpl('/api/code-assist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.suggestion) throw new Error(payload?.error || 'Workspace synthesis is unavailable.');
  return String(payload.suggestion).trim();
}

export function buildLocalWorkspaceSummary(request, toolResults = []) {
  const index = parseJsonResult(toolResults, 'workspace.index');
  const search = parseJsonResult(toolResults, 'workspace.search');
  const listing = parseJsonResult(toolResults, 'filesystem.list');
  const project = index?.project || {};
  const lines = [];

  if (project.name) lines.push(`## ${project.name}`);
  lines.push('The workspace was inspected and indexed locally.');
  if (index?.indexedFiles) {
    lines.push(`It contains ${index.indexedFiles} indexed files across ${index.indexedChunks || 0} searchable code sections.`);
  }
  if (Array.isArray(project.scripts) && project.scripts.length) {
    lines.push(`**Available scripts:** ${project.scripts.slice(0, 12).map((value) => `\`${value}\``).join(', ')}`);
  }
  if (Array.isArray(project.dependencies) && project.dependencies.length) {
    lines.push(`**Core dependencies:** ${project.dependencies.slice(0, 16).map((value) => `\`${value}\``).join(', ')}`);
  }
  if (Array.isArray(index?.languages) && index.languages.length) {
    lines.push(`**Indexed file types:** ${index.languages.join(', ')}`);
  }
  const paths = (search?.results || []).map((result) => result.path).filter(Boolean);
  if (!paths.length && Array.isArray(listing)) paths.push(...listing.map((entry) => entry.path).filter(Boolean));
  if (paths.length) lines.push(`**Relevant areas:** ${[...new Set(paths)].slice(0, 12).map((value) => `\`${value}\``).join(', ')}`);
  if (/summari[sz]e|study|understand|inspect/i.test(String(request || ''))) {
    lines.push('The semantic index remains available for follow-up questions, so subsequent requests can retrieve the relevant files without rescanning the entire project.');
  }
  return lines.join('\n\n');
}

export { toolEvidenceText };
