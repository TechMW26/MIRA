import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agentTaskUsedRecovery,
  agentTaskRequiresResearch,
  buildTaskSearchQueries,
  extractAgentTaskAnswer,
  extractAgentTaskFallback,
  parseAgentPlan,
  runAgentTask,
  shouldRunAgentTask,
} from './agentTask.js';

test('broadens repeated task searches instead of retrying the same branded sentence', () => {
  const queries = buildTaskSearchQueries({
    query: 'Right, can you do a deep dive on Canact and make this app more engaging?',
    goal: 'Do market research for a civic score app and make it more engaging.',
    context: 'Canact is a people ratings and civic score application.',
    instruction: 'Gather current market evidence.',
  });
  assert.equal(queries.length, 3);
  assert.match(queries[1], /civic engagement app/i);
  assert.match(queries[1], /gamification retention benchmarks/i);
  assert.equal(new Set(queries).size, queries.length);
});

test('infers live research from the task goal before any search has run', () => {
  assert.equal(agentTaskRequiresResearch('Gather current market data via web search'), true);
  assert.equal(agentTaskRequiresResearch('Compare the latest product pricing'), true);
  assert.equal(agentTaskRequiresResearch('Rewrite this paragraph'), false);
  assert.equal(agentTaskRequiresResearch('इस कंपनी के बारे में गहराई से रिसर्च करो'), true);
  assert.equal(agentTaskRequiresResearch('深入研究这家公司的信誉'), true);
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
  assert.equal(shouldRunAgentTask({ text: 'इस कंपनी के सोशल प्रोफाइल और रिव्यू पर रिसर्च करो' }), true);
  assert.equal(shouldRunAgentTask({ text: 'ابحث بعمق عن سمعة هذه الشركة' }), true);
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
  assert.equal(plan.filter((step) => step.tool === 'web.search').length, 4);
  assert.ok(plan.slice(4).every((step) => step.tool === 'reason'));
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
    { phase: 'executing', think: false, maxTokens: 1600 },
  ]);
  assert.match(output, /Benchmark/);
  assert.match(output, /product A for speed/);
  assert.match(extractAgentTaskAnswer(output), /product A for speed/);
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

test('marks the final reasoning result as the user-visible task answer', async () => {
  const output = await runAgentTask({
    goal: 'Use the earlier Canact context to propose engagement improvements',
    context: 'Canact is a people ratings and civic score application, not a social network.',
    generate: async (_prompt, options) => options.phase === 'planning'
      ? JSON.stringify([
        { title: 'Assess', instruction: 'Assess the constraints', tool: 'reason' },
        { title: 'Answer', instruction: 'Produce the final answer', tool: 'reason' },
      ])
      : options.maxTokens === 1600
        ? 'Use verified-rating prompts and transparent score explanations while preserving the civic-score framing.'
        : '',
  });
  const answer = extractAgentTaskAnswer(output);
  assert.match(answer, /civic-score framing/i);
  assert.doesNotMatch(answer, /Completed internal work|USER-SAFE TASK/i);
});

test('stops the workflow immediately when generation is cancelled', async () => {
  const cancelled = new Error('Cancelled');
  cancelled.name = 'AbortError';
  await assert.rejects(runAgentTask({
    goal: 'Cancelled task',
    generate: async () => { throw cancelled; },
  }), { name: 'AbortError' });
});

test('retries empty task steps and completes after a transient failure', async () => {
  const phases = [];
  let stepAttempts = 0;
  const output = await runAgentTask({
    goal: 'Prepare a two-step answer',
    generate: async (_prompt, options) => {
      if (options.phase === 'planning') {
        return JSON.stringify([
          { title: 'Draft', instruction: 'Draft the answer', tool: 'reason' },
          { title: 'Verify', instruction: 'Verify the answer', tool: 'reason' },
        ]);
      }
      stepAttempts += 1;
      if (stepAttempts === 1) return '';
      return stepAttempts === 2 ? 'Draft completed.' : 'Verification completed.';
    },
    onPhase: (phase) => phases.push(phase),
  });

  assert.equal(stepAttempts, 3);
  assert.equal(phases.filter((phase) => phase.phase === 'step-retrying').length, 1);
  assert.match(output, /Draft completed/);
  assert.match(output, /Verification completed/);
});

test('completes a reasoning step from available context when the model is temporarily unavailable', async () => {
  let executionCalls = 0;
  const output = await runAgentTask({
    goal: 'Research and summarize a market',
    context: 'The available evidence supports a cautious market assessment.',
    generate: async (_prompt, options) => {
      if (options.phase === 'planning') {
        return JSON.stringify([
          { title: 'Unavailable source', instruction: 'Get unavailable data', tool: 'reason' },
          { title: 'Available analysis', instruction: 'Use the available evidence', tool: 'reason' },
        ]);
      }
      executionCalls += 1;
      if (executionCalls === 1) throw new Error('The model is temporarily unavailable.');
      return 'The available evidence supports a cautious market assessment.';
    },
  });

  const fallback = extractAgentTaskFallback(output);
  assert.equal(executionCalls, 1);
  assert.match(fallback, /available evidence supports/i);
  assert.doesNotMatch(fallback, /Incomplete areas/i);
  assert.match(fallback, /Unavailable source/);
  assert.equal(agentTaskUsedRecovery(output), true);
});

test('does not contact the model again after planning confirms it is unavailable', async () => {
  let calls = 0;
  const output = await runAgentTask({
    goal: 'Research a civic app market',
    requiresResearch: true,
    generate: async () => {
      calls += 1;
      throw new Error('The model service is temporarily unavailable.');
    },
    search: async () => ({
      results: [{ title: 'Benchmark', snippet: 'Verified evidence', url: 'https://example.com' }],
    }),
  });
  assert.equal(calls, 1);
  assert.equal(agentTaskUsedRecovery(output), true);
  assert.match(extractAgentTaskFallback(output), /Verified evidence/);
});

test('uses a different research query on each empty-result retry', async () => {
  const queries = [];
  const phases = [];
  await runAgentTask({
    goal: 'Research a civic score app and improve engagement.',
    context: 'The product uses people ratings and civic scores.',
    requiresResearch: true,
    generate: async (_prompt, options) => options.phase === 'planning'
      ? JSON.stringify([
        { title: 'Research', instruction: 'Gather market evidence', tool: 'web.search', query: 'Canact engagement research' },
        { title: 'Synthesize', instruction: 'Use the evidence', tool: 'reason' },
      ])
      : 'Synthesis completed.',
    search: async (query) => {
      queries.push(query);
      return queries.length < 3
        ? { results: [] }
        : { results: [{ title: 'Civic benchmark', snippet: 'Gamification improves participation.', url: 'https://example.com/civic' }] };
    },
    onPhase: (phase) => phases.push(phase),
  });
  assert.equal(queries.length, 3);
  assert.equal(new Set(queries).size, 3);
  assert.equal(phases.some((phase) => phase.phase === 'step-error'), false);
});
