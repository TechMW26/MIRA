import { diagnosticLog, diagnosticWarn } from './diagnostics.js';

const RESPONSE_EVENT = 'mira:mcp-browser-response';
const REQUEST_EVENT = 'mira:mcp-browser-request';
const DEFAULT_TIMEOUT_MS = 120000;

function createRequestId() {
  return `mira-browser-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeDocumentation(payload = {}, request = {}) {
  const page = payload.documentation || payload.page || payload;
  return {
    url: String(page.url || request.url || ''),
    title: String(page.title || ''),
    summary: String(page.summary || page.description || ''),
    structure: page.structure || page.outline || page.dom || '',
    sourceCode: String(page.sourceCode || page.source || page.html || ''),
    links: Array.isArray(page.links) ? page.links.slice(0, 200) : [],
    metadata: page.metadata && typeof page.metadata === 'object' ? page.metadata : {},
    accessibility: page.accessibility || page.accessibilityTree || '',
    capturedAt: page.capturedAt || new Date().toISOString(),
    accessStatus: String(page.accessStatus || page.statusText || 'ok'),
    provider: String(page.provider || ''),
  };
}

export function formatBrowserDocumentation(documentation = {}) {
  const links = documentation.links
    .map((link) => typeof link === 'string'
      ? `- ${link}`
      : `- ${link.text || link.title || 'Link'}: ${link.url || link.href || ''}`)
    .join('\n');
  const metadata = Object.entries(documentation.metadata || {})
    .map(([key, value]) => `- ${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join('\n');

  return [
    '=== MCP CHROME WEBSITE DOCUMENTATION ===',
    `URL: ${documentation.url || 'unknown'}`,
    `Title: ${documentation.title || 'unknown'}`,
    `Captured: ${documentation.capturedAt || 'unknown'}`,
    `Access status: ${documentation.accessStatus || 'ok'}`,
    documentation.summary ? `\nSummary:\n${documentation.summary}` : '',
    documentation.structure ? `\nPage structure:\n${typeof documentation.structure === 'string' ? documentation.structure : JSON.stringify(documentation.structure, null, 2)}` : '',
    documentation.accessibility ? `\nAccessibility tree:\n${typeof documentation.accessibility === 'string' ? documentation.accessibility : JSON.stringify(documentation.accessibility, null, 2)}` : '',
    links ? `\nLinks:\n${links}` : '',
    metadata ? `\nMetadata:\n${metadata}` : '',
    documentation.sourceCode ? `\nSource excerpt:\n${documentation.sourceCode.slice(0, 40000)}` : '',
    '=== END MCP CHROME WEBSITE DOCUMENTATION ===',
  ].filter(Boolean).join('\n');
}

function requestThroughEventBridge(request, timeoutMs) {
  return new Promise((resolve, reject) => {
    const requestId = createRequestId();
    let timer;
    const cleanup = () => {
      window.removeEventListener(RESPONSE_EVENT, onResponse);
      clearTimeout(timer);
    };
    const onResponse = (event) => {
      if (event?.detail?.requestId !== requestId) return;
      cleanup();
      if (event.detail.error) {
        reject(new Error(String(event.detail.error)));
        return;
      }
      resolve(event.detail.result || event.detail.documentation || {});
    };

    window.addEventListener(RESPONSE_EVENT, onResponse);
    timer = setTimeout(() => {
      cleanup();
      reject(new Error('The Chrome MCP connector did not respond in time.'));
    }, timeoutMs);

    window.dispatchEvent(new CustomEvent(REQUEST_EVENT, {
      detail: {
        requestId,
        capability: 'chrome.inspectWebsite',
        url: request.url,
        task: request.task,
        include: ['structure', 'accessibility', 'source', 'links', 'metadata'],
      },
    }));
  });
}

async function requestThroughServerGateway(request) {
  const response = await fetch('/api/browser-mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: request.url, task: request.task }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok && [404, 503].includes(response.status)) {
    const crawlResponse = await fetch('/api/crawl', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: request.url }),
    });
    const crawlPayload = await crawlResponse.json().catch(() => ({}));
    const page = crawlPayload?.pages?.[0];
    if (page) {
      return {
        ...page,
        source: page.content || page.summary || '',
        metadata: {
          provider: page.provider || 'jina-reader',
          accessStatus: page.accessStatus || 'ok',
        },
      };
    }
    throw new Error(
      crawlPayload?.error
      || payload?.error
      || `Website inspection failed (${response.status}).`,
    );
  }
  if (!response.ok) throw new Error(payload?.error || `Browser MCP gateway failed (${response.status}).`);
  return payload.documentation || payload.result || payload;
}

export async function requestBrowserDocumentation(request, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (typeof window === 'undefined') throw new Error('Browser access is only available in the app.');
  const approved = window.confirm(
    `Allow MIRA to inspect this website using the connected Chrome MCP tool?\n\n${request.url}\n\nPurpose: ${request.task}`
  );
  if (!approved) {
    diagnosticLog('browser', 'user denied browser MCP request', { url: request.url });
    throw new Error('Browser access was not approved.');
  }

  diagnosticLog('browser', 'browser MCP request approved', {
    url: request.url,
    task: request.task,
  });

  try {
    const directBridge = window.miraMcp?.browser?.inspectWebsite;
    const payload = typeof directBridge === 'function'
      ? await directBridge({
        url: request.url,
        task: request.task,
        include: ['structure', 'accessibility', 'source', 'links', 'metadata'],
      })
      : window.__MIRA_MCP_BROWSER_CONNECTED__ === true
        ? await requestThroughEventBridge(request, timeoutMs)
        : await requestThroughServerGateway(request);
    return normalizeDocumentation(payload, request);
  } catch (error) {
    diagnosticWarn('browser', 'browser MCP request failed', {
      url: request.url,
      error: error?.message || String(error),
    });
    throw error;
  }
}
