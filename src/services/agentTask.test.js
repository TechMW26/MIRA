import test from 'node:test';
import assert from 'node:assert/strict';
import { completeChatResponse } from './responseContinuation.js';
import {
  agentTaskUsedRecovery,
  agentTaskRequiresResearch,
  buildTaskSearchQueries,
  extractAgentTaskAnswer,
  extractAgentTaskFallback,
  parseAgentPlan,
  runAgentTask,
  shouldRunAgentTask,
  buildTaskConclusionPrompt,
  buildTaskConversationContext,
} from './agentTask.js';

test('task worker keeps old constraints, project context and complete continued step output', async () => {
  const history = [{role:'user',content:'ORIGINAL_CONSTRAINT: no weekend sessions.'}, ...Array.from({length:10},()=>({role:'assistant',content:'Later discussion.'}))];
  const context = buildTaskConversationContext(history, 'PROJECT_CONSTRAINT: online workshop.');
  const long = '## Workshop plan\n' + 'Detailed material.\n'.repeat(1000);
  let execution = 0;
  const handoff = await runAgentTask({goal:'Plan the workshop',context,generate:async (prompt, options) => {
    assert.match(prompt,/ORIGINAL_CONSTRAINT/);
    assert.match(prompt,/PROJECT_CONSTRAINT/);
    assert.equal(options.maxTokens,undefined);
    if(options.phase==='planning') return JSON.stringify([{title:'Draft',instruction:'Draft plan',tool:'reason'},{title:'Review',instruction:'Review plan',tool:'reason'}]);
    if(options.phase==='executing' && ++execution===1) {
      let segment=0;
      return completeChatResponse({messages:[{role:'user',content:prompt}],requestClass:'task'},async request=>{
        segment++;
        if(segment===1)return {answer:long,incomplete:true,finishReason:'length'};
        assert.equal(request.messages[0].content,prompt);
        assert.equal(request.messages[1].content,long);
        return {answer:'FINAL_STEP_DETAIL',incomplete:false};
      });
    }
    assert.ok(prompt.includes('FINAL_STEP_DETAIL'));
    return {answer:'A complete workshop plan with next actions.',incomplete:false};
  }});
  assert.match(extractAgentTaskAnswer(handoff),/complete workshop plan/);
});

test('incomplete steps are preserved as failed and incomplete conclusions are not marked final', async () => {
  const phases=[];
  let execution=0;
  const output=await runAgentTask({goal:'Plan a workshop',onPhase:p=>phases.push(p),generate:async(_,options)=>{
    if(options.phase==='planning')return JSON.stringify([{title:'Draft',instruction:'Draft plan',tool:'reason'},{title:'Review',instruction:'Review plan',tool:'reason'}]);
    if(options.phase==='executing') return ++execution===1 ? {answer:'PRESERVED_PARTIAL_STEP',incomplete:true} : {answer:'Review complete',incomplete:false};
    return {answer:'PRESERVED_PARTIAL_CONCLUSION',incomplete:true};
  }});
  assert.equal(phases.filter(p=>p.phase==='step-error').length,1);
  assert.equal(phases.filter(p=>p.phase==='step-completed').length,1);
  assert.ok(output.includes('PRESERVED_PARTIAL_STEP'));
  assert.equal(extractAgentTaskAnswer(output),'');
  assert.match(extractAgentTaskFallback(output),/PRESERVED_PARTIAL_CONCLUSION/);
  assert.ok(phases.some(p=>p.phase==='summary-error'));
});

test('conclusion receives full formatted evidence and conversation context', () => {
  const long = 'Detailed planning evidence.\n'.repeat(2000) + 'FINAL_CRITICAL_DETAIL';
  const prompt = buildTaskConclusionPrompt({goal:long,context:long,plan:[{title:'Analyze'}],results:[{status:'done',text:long}]});
  assert.equal(prompt.split('FINAL_CRITICAL_DETAIL').length - 1, 3);
  assert.ok(prompt.includes('Detailed planning evidence.\n'));
});

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
  assert.equal(generatedPrompts.length, 3);
  assert.deepEqual(generationOptions, [
    { phase: 'planning', think: false },
    { phase: 'executing', think: false },
    { phase: 'synthesizing', think: false },
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

test('uses a dedicated conclusion rather than the last reasoning result', async () => {
  const output = await runAgentTask({
    goal: 'Use the earlier Canact context to propose engagement improvements',
    context: 'Canact is a people ratings and civic score application, not a social network.',
    generate: async (_prompt, options) => options.phase === 'planning'
      ? JSON.stringify([
        { title: 'Assess', instruction: 'Assess the constraints', tool: 'reason' },
        { title: 'Answer', instruction: 'Produce the final answer', tool: 'reason' },
      ])
      : options.phase === 'synthesizing'
        ? 'Use verified-rating prompts and transparent score explanations while preserving the civic-score framing.'
        : 'Intermediate analysis.',
  });
  const answer = extractAgentTaskAnswer(output);
  assert.match(answer, /civic-score framing/i);
  assert.doesNotMatch(answer, /Completed internal work|USER-SAFE TASK/i);
});

test('preserves a formatted conclusion and excludes raw step reports from the final answer', async () => {
  const conclusion = `## Recommendation\n\nLaunch a small pilot first.\n\n## Plan\n\n1. Week 1: prepare the prototype.\n2. Week 2: test with five users.\n\n${'Supporting detail. '.repeat(320)}\n\n## Next action\n\nBook the first feedback session.`;
  let finalPrompt = '';
  const output = await runAgentTask({
    goal: 'Plan a two-week prototype launch',
    context: 'One developer is available and the budget is fixed.',
    generate: async (prompt, options) => {
      if (options.phase === 'planning') return JSON.stringify([
        { title: 'Draft', instruction: 'Prepare the plan', tool: 'reason' },
        { title: 'Verify', instruction: 'Check the constraints', tool: 'reason' },
      ]);
      if (options.phase === 'synthesizing') { finalPrompt = prompt; return conclusion; }
      return 'RAW_STEP_REPORT: constraints checked.';
    },
  });
  assert.equal(extractAgentTaskAnswer(output), conclusion);
  assert.match(finalPrompt, /One developer/);
  assert.match(finalPrompt, /RAW_STEP_REPORT/);
  assert.doesNotMatch(extractAgentTaskAnswer(output), /RAW_STEP_REPORT/);
});

test('empty final synthesis yields an honest summary failure, not a raw-data answer', async () => {
  const output = await runAgentTask({
    goal: 'Plan an onboarding workshop',
    generate: async (_prompt, options) => {
      if (options.phase === 'planning') return JSON.stringify([
        { title: 'Draft', instruction: 'Draft the workshop', tool: 'reason' },
        { title: 'Review', instruction: 'Review the draft', tool: 'reason' },
      ]);
      return options.phase === 'synthesizing' ? '' : 'RAW_PRIVATE_WORKSHOP_NOTES';
    },
  });
  assert.equal(extractAgentTaskAnswer(output), '');
  assert.doesNotMatch(extractAgentTaskFallback(output), /RAW_PRIVATE_WORKSHOP_NOTES/);
  assert.match(extractAgentTaskFallback(output), /couldn't finish a reliable final answer/);
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

  assert.equal(stepAttempts, 4);
  assert.equal(phases.filter((phase) => phase.phase === 'step-retrying').length, 1);
  assert.match(output, /Draft completed/);
  assert.match(output, /Verification completed/);
});

test('marks unavailable reasoning as incomplete instead of duplicating previous evidence', async () => {
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
  assert.match(fallback, /Incomplete areas/i);
  assert.match(fallback, /Unavailable source/);
  assert.equal(agentTaskUsedRecovery(output), true);
});

test('attempts final synthesis of gathered evidence after a planning outage without dumping raw data', async () => {
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
  assert.equal(calls, 2);
  assert.equal(agentTaskUsedRecovery(output), true);
  assert.doesNotMatch(extractAgentTaskFallback(output), /Verified evidence/);
  assert.match(extractAgentTaskFallback(output), /couldn't finish a reliable final answer/i);
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
