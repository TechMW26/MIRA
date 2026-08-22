import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLocalWorkspaceSummary, requestWorkspaceSynthesis } from './workspaceSynthesis.js';

test('requests server-side workspace synthesis from bounded local evidence', async () => {
  let requestBody;
  const answer = await requestWorkspaceSynthesis({
    request: 'Study this codebase',
    toolResults: [{ name: 'workspace.index', result: JSON.stringify({ indexedFiles: 4 }) }],
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ suggestion: 'Project summary' }), { status: 200 });
    },
  });
  assert.equal(answer, 'Project summary');
  assert.equal(requestBody.task, 'workspace-synthesis');
  assert.match(requestBody.evidence, /indexedFiles/);
});

test('builds a useful local summary if both reasoning services are unavailable', () => {
  const answer = buildLocalWorkspaceSummary('Summarise this project', [
    { name: 'workspace.index', result: JSON.stringify({ indexedFiles: 43, indexedChunks: 80, project: { name: 'MIRA', scripts: ['test'], dependencies: ['react'] }, languages: ['.js:12'] }) },
    { name: 'workspace.search', result: JSON.stringify({ results: [{ path: 'src/App.jsx' }] }) },
  ]);
  assert.match(answer, /43 indexed files/);
  assert.match(answer, /src\/App\.jsx/);
  assert.doesNotMatch(answer, /fetch failed/i);
});
