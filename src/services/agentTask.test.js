import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agentTaskRequiresResearch,
  parseAgentPlan,
  runAgentTask,
  shouldRunAgentTask,
} from './agentTask.js';

test('infers live research from the task goal before any search has run', () => {
  assert.equal(agentTaskRequiresResearch('Gather current market data via web search'), true);
  assert.equal(agentTaskRequiresResearch('Compare the latest product pricing'), true);
  assert.equal(agentTaskRequiresResearch('Rewrite this paragraph'), false);
});

test('keeps an AI-requested task.run research plan wired to web search', async () => {
  let searchCalls = 0;
  await runAgentTask({
    goal: 'Research current battery market data and summarize the sources',
    generate: async (_prompt, options) => {
      if (options.phase === 'planning') {
        return JSON.stringify([
          { title: 'Gather web data', instruction: 'Find current evidence', tool: 'web.search', query: 'battery market data' },
          { title: 'Synthesize', instruction: 'Summarize the evidence', tool: 'reason' },
        ]);
      }
      return 'Synthesis complete.';
    },
    search: async () => {
      searchCalls += 1;
      return { results: [{ title: 'Market source', snippet: 'Current market evidence', url: 'https://example.com/market' }] };
    },
  });
  assert.equal(searchCalls, 1);
});

test('automatically plans research and explicit multi-step work but not simple questions', () => {
  assert.equal(shouldRunAgentTask({ text: 'Research current battery recycling companies', requiresResearch: true }), true);
  assert.equal(shouldRunAgentTask({ text: 'Create an implementation plan and break it into phases' }), true);
  assert.equal(shouldRunAgentTask({ text: 'What is 2 + 2?' }), false);
  assert.equal(shouldRunAgentTask({ text: 'Generate an image', mediaIntent: true }), false);
});

test('bounds and sanitizes model-generated plans', () => {
  const plan = parseAgentPlan(JSON.stringify(Array.from({ length: 8 }, (_, index) => ({
    title: `Step ${index + 1}`,
    instruction: `Do work ${index + 1}`,
    tool: index < 4 ? 'web.search' : 'task.run',
    query: 'current evidence',
  }))), { goal: 'Research a topic', requiresResearch: true });
  assert.equal(plan.length, 5);
  assert.equal(plan[0].tool, 'web.search');
  assert.equal(plan.filter((step) => step.tool === 'web.search').length, 2);
  assert.ok(plan.slice(2).every((step) => step.tool === 'reason'));
});

test('executes planned research and reasoning sequentially before returning the final handoff', async () => {
  const generatedPrompts = [];
  const generationOptions = [];
  const phases = [];
  let generation = 0;
  const output = await runAgentTask({
    goal: 'Compare two products',
    requiresResearch: true,
    generate: async (prompt, options) => {
      generatedPrompts.push(prompt);
      generationOptions.push(options);
      generation += 1;
      if (generation === 1) {
        return JSON.stringify([
          { title: 'Research', instruction: 'Gather current facts', tool: 'web.search', query: 'product comparison' },
          { title: 'Compare', instruction: 'Compare the evidence', tool: 'reason' },
        ]);
      }
      return 'The evidence supports product A for speed and product B for price.';
    },
    search: async () => ({ results: [{ title: 'Benchmark', snippet: 'Measured results', url: 'https://example.com' }] }),
    onPhase: (phase) => phases.push(phase),
  });
  assert.equal(generatedPrompts.length, 2);
  assert.deepEqual(generationOptions, [
    { phase: 'planning', think: false, maxTokens: 900 },
    { phase: 'executing', think: true, maxTokens: 2400 },
  ]);
  assert.match(output, /Benchmark/);
  assert.match(output, /product A for speed/);
  assert.match(output, /Final response requirement/);
  assert.deepEqual(phases.map((phase) => phase.phase), [
    'planning',
    'planned',
    'executing',
    'step-completed',
    'executing',
    'step-completed',
    'synthesizing',
  ]);
  assert.deepEqual(phases[1].steps.map((step) => step.title), ['Research', 'Compare']);
  assert.match(phases[3].result, /Benchmark/);
});

test('stops the workflow immediately when generation is cancelled', async () => {
  const cancelled = new Error('Cancelled');
  cancelled.name = 'AbortError';
  await assert.rejects(runAgentTask({
    goal: 'Cancelled task',
    generate: async () => { throw cancelled; },
  }), { name: 'AbortError' });
});
