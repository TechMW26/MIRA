import { fallbackSearchQuery } from './searchQuery.js';

const MAX_TASK_STEPS = 5;
const MAX_RESEARCH_STEPS = 4;
const MAX_CONTEXT_CHARS = 14000;
const MAX_STEP_RESULT_CHARS = 5000;
const MAX_STEP_ATTEMPTS = 3;
const FALLBACK_START = '=== USER-SAFE TASK FALLBACK ===';
const FALLBACK_END = '=== END USER-SAFE TASK FALLBACK ===';

const RESEARCH_WORKFLOW_PATTERN = /\b(research|investigate|deep\s+dive|due\s+diligence|literature\s+review|market\s+analysis|competitive\s+analysis|compare\s+(?:current|latest)|evaluate\s+(?:current|latest)|verify\s+across\s+sources)\b/i;
const PLANNING_WORKFLOW_PATTERN = /\b(plan|roadmap|strategy|step[-\s]?by[-\s]?step|break\s+(?:it\s+)?down|split\s+into\s+steps|phases?|milestones?|end[-\s]?to[-\s]?end|implementation\s+plan|execution\s+plan|action\s+plan|first.+then|and\s+then)\b/i;
const EXTERNAL_EVIDENCE_PATTERN = /\b(web|internet|online|sources?|citations?|evidence|data\s+sources?|current|latest|recent|today|market|news|pricing|availability|verify|fact[-\s]?check)\b/i;
const MULTILINGUAL_RESEARCH_PATTERN = /(?:रिसर्च|शोध|गहराई\s+से|पता\s+लगाओ|जाँच\s+पड़ताल|जांच\s+पड़ताल|इंटरनेट\s+पर|वेब\s+पर|ताज़ा|ताजा|वर्तमान|नवीनतम|深入研究|调查|研究一下|詳しく調べ|調査|深掘り|심층\s*조사|조사해|연구해|بحث\s+متعمق|ابحث\s+بعمق|تحقق|исследуй|расследуй|проведи\s+исследование|গভীর\s+গবেষণা|তদন্ত)|\b(?:investiga|investigar|recherche|pesquisa|ricerca|recherchieren|untersuchen|onderzoek|araştır|araştırma|recherche approfondie)\b/iu;

function compact(value = '', limit = MAX_CONTEXT_CHARS) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit).trim()}…`;
}

export function shouldRunAgentTask({
  text = '',
  complexity = 'low',
  requiresResearch = false,
  simpleGreeting = false,
  mediaIntent = false,
  websiteInspection = false,
} = {}) {
  const value = String(text || '').trim();
  if (!value || simpleGreeting || mediaIntent || websiteInspection) return false;
  const explicitResearch = RESEARCH_WORKFLOW_PATTERN.test(value);
  const explicitPlanning = PLANNING_WORKFLOW_PATTERN.test(value);
  if (explicitResearch || MULTILINGUAL_RESEARCH_PATTERN.test(value) || explicitPlanning) return true;
  if (requiresResearch && complexity !== 'low' && /\b(compare|recommend|assess|analy[sz]e|report|options?|tradeoffs?|pros?\s+and\s+cons?)\b/i.test(value)) {
    return true;
  }
  return complexity === 'high' && /\b(build|design|implement|debug|audit|migrate|launch|create|prepare|solve)\b/i.test(value);
}

export function agentTaskRequiresResearch(goal = '', explicit = false) {
  const value = String(goal || '').trim();
  return Boolean(explicit || RESEARCH_WORKFLOW_PATTERN.test(value) || EXTERNAL_EVIDENCE_PATTERN.test(value) || MULTILINGUAL_RESEARCH_PATTERN.test(value));
}

function extractJsonArray(text = '') {
  const cleaned = String(text || '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.steps)) return parsed.steps;
  } catch {}

  const start = cleaned.indexOf('[');
  if (start < 0) return [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < cleaned.length; index += 1) {
    const char = cleaned[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '[') depth += 1;
    else if (char === ']') {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(cleaned.slice(start, index + 1));
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      }
    }
  }
  return [];
}

export function fallbackAgentPlan(goal = '', requiresResearch = false) {
  if (requiresResearch) {
    return [
      { title: 'Gather evidence', instruction: 'Find current, directly relevant evidence for the goal.', tool: 'web.search', query: compact(goal, 240) },
      { title: 'Evaluate evidence', instruction: 'Compare the retrieved evidence, resolve conflicts, and identify gaps.', tool: 'reason' },
      { title: 'Form the answer', instruction: 'Turn the verified findings into a complete answer that directly satisfies the goal.', tool: 'reason' },
    ];
  }
  return [
    { title: 'Define the solution', instruction: 'Identify the goal, constraints, dependencies, and acceptance criteria.', tool: 'reason' },
    { title: 'Execute the solution', instruction: 'Produce the substantive solution using the established constraints.', tool: 'reason' },
    { title: 'Verify completeness', instruction: 'Check the result for correctness, omissions, and alignment with the original goal.', tool: 'reason' },
  ];
}

export function parseAgentPlan(text = '', { goal = '', requiresResearch = false } = {}) {
  let researchSteps = 0;
  const parsed = extractJsonArray(text).slice(0, MAX_TASK_STEPS).flatMap((step, index) => {
    const instruction = compact(step?.instruction || step?.prompt || step?.description || '', 900);
    if (!instruction) return [];
    const requestedTool = String(step?.tool || '').toLowerCase();
    const useResearch = requestedTool === 'web.search'
      && requiresResearch
      && researchSteps < MAX_RESEARCH_STEPS;
    const tool = useResearch ? 'web.search' : 'reason';
    if (useResearch) researchSteps += 1;
    return [{
      title: compact(step?.title || `Step ${index + 1}`, 100),
      instruction,
      tool,
      ...(tool === 'web.search' ? { query: compact(step?.query || goal, 240) } : {}),
    }];
  });
  return parsed.length >= 2 ? parsed : fallbackAgentPlan(goal, requiresResearch);
}

export function buildAgentPlanPrompt({ goal = '', context = '', requiresResearch = false } = {}) {
  return [
    'Create a compact execution plan for the goal below.',
    `Use 2-${MAX_TASK_STEPS} sequential steps with explicit dependencies.`,
    requiresResearch
      ? 'Use tool "web.search" only for steps that need new external evidence; use tool "reason" for analysis and synthesis.'
      : 'Use tool "reason" for every step. Do not request external tools.',
    'Return only JSON: [{"title":"...","instruction":"...","tool":"reason|web.search","query":"required only for web.search"}]',
    `Goal: ${compact(goal)}`,
    context ? `Available context/evidence: ${compact(context)}` : '',
  ].filter(Boolean).join('\n\n');
}

function formatSearchEvidence(payload = {}, query = '') {
  const results = Array.isArray(payload?.results) ? payload.results.slice(0, 8) : [];
  if (!results.length) return `No relevant live evidence was returned for: ${query}`;
  const evidence = results.map((result, index) => [
    `${index + 1}. ${compact(result?.title || 'Untitled source', 240)}`,
    result?.publishedAt ? `Published: ${result.publishedAt}` : '',
    result?.accessStatus && result.accessStatus !== 'ok' ? `Page access: ${result.accessStatus}` : '',
    compact(result?.snippet || '', 1200),
    result?.url ? `Source: ${result.url}` : '',
  ].filter(Boolean).join('\n')).join('\n\n');
  const restricted = Array.isArray(payload?.research?.restricted) ? payload.research.restricted : [];
  if (!restricted.length) return evidence;
  return `${evidence}\n\nRestricted pages (do not pretend these were read):\n${restricted
    .map((item) => `- ${item.url}: ${item.status}`)
    .join('\n')}`;
}

function buildStepPrompt({ goal, context, plan, step, index, results }) {
  const priorResults = results.map((result, resultIndex) => (
    `Completed step ${resultIndex + 1} (${plan[resultIndex].title}):\n${compact(result?.text || result, MAX_STEP_RESULT_CHARS)}`
  )).join('\n\n');
  return [
    `Execute step ${index + 1} of ${plan.length} for this goal: ${compact(goal)}`,
    `Current step: ${step.title}\nInstruction: ${step.instruction}`,
    context ? `Available context and verified evidence:\n${compact(context)}` : '',
    priorResults ? `Prior completed results:\n${priorResults}` : '',
    'Return only the useful result of this step. Do not expose hidden reasoning, planning syntax, or tool mechanics.',
  ].filter(Boolean).join('\n\n');
}

function resolveTaskSearchQuery(query, goal, context) {
  const requested = String(query || goal || '').trim();
  return fallbackSearchQuery(requested, context) || fallbackSearchQuery(goal, context) || requested;
}

function broadResearchQuery(goal = '', context = '') {
  const corpus = `${goal} ${context}`.replace(/\s+/g, ' ').trim();
  const domain = /\b(?:civic|citizen|community|public participation)\b/i.test(corpus)
    ? 'civic engagement app'
    : /\b(?:rating|ratings|reputation|social score|trust score)\b/i.test(corpus)
      ? 'social reputation app'
      : /\b(?:app|application|platform|software|product)\b/i.test(corpus)
        ? 'mobile app'
        : /\b(?:business|company|startup|service)\b/i.test(corpus)
          ? 'digital product'
          : 'industry';
  const outcome = /\b(?:engag|retention|active users?|participation|sticky|habit)\w*/i.test(corpus)
    ? 'gamification retention benchmarks'
    : /\b(?:market|competitor|competitive|benchmark|position)\w*/i.test(corpus)
      ? 'market benchmarks competitors'
      : /\b(?:trust|safety|abuse|moderation|privacy)\w*/i.test(corpus)
        ? 'trust safety best practices'
        : 'research trends benchmarks';
  return `${domain} ${outcome}`;
}

export function buildTaskSearchQueries({ query = '', goal = '', context = '', instruction = '' } = {}) {
  const primary = resolveTaskSearchQuery(query, goal, context);
  const instructionQuery = resolveTaskSearchQuery(
    [instruction, goal].filter(Boolean).join(' '),
    context,
  );
  return Array.from(new Set([
    primary,
    broadResearchQuery(goal, context),
    instructionQuery,
  ].map((value) => compact(value, 220)).filter(Boolean))).slice(0, MAX_STEP_ATTEMPTS);
}

function retryableTaskError(error) {
  if (error?.name === 'AbortError') return false;
  const message = String(error?.message || error || '').toLowerCase();
  return !/(not approved|permission denied|unauthori[sz]ed|invalid credential|authentication failed|bad request)/i.test(message);
}

async function waitForRetry(attempt) {
  // Provider recovery and rate-limit windows need breathing room. The old
  // 250/500ms loop simply hit the same unhealthy server state three times.
  const baseDelay = Math.min(3000, 1000 * (2 ** (attempt - 1)));
  const jitter = Math.floor(Math.random() * 250);
  await new Promise((resolve) => setTimeout(resolve, baseDelay + jitter));
}

async function executeStepWithRetry({ operation, onPhase, step, total, title }) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_STEP_ATTEMPTS; attempt += 1) {
    try {
      const result = await operation(attempt);
      if (!String(result || '').trim()) throw new Error('The task step returned no result.');
      return String(result).trim();
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      lastError = error;
      if (attempt >= MAX_STEP_ATTEMPTS || !retryableTaskError(error)) break;
      onPhase?.({
        phase: 'step-retrying',
        step,
        total,
        title,
        attempt: attempt + 1,
        maxAttempts: MAX_STEP_ATTEMPTS,
        error: error?.message || 'The step returned no result.',
      });
      await waitForRetry(attempt);
    }
  }
  throw lastError || new Error('The task step could not be completed.');
}

function buildReasonStepFallback({ goal, context, step, results }) {
  const completed = results
    .filter((result) => result.status === 'done' && String(result.text || '').trim())
    .map((result) => compact(result.text, MAX_STEP_RESULT_CHARS));
  if (completed.length) {
    return [
      `${step.title}: evidence-backed working result`,
      ...completed,
      `Apply these findings directly to the goal: ${compact(goal, 500)}`,
    ].join('\n\n');
  }
  const knownContext = compact(context, MAX_STEP_RESULT_CHARS);
  return [
    `${step.title}: working result`,
    `Goal: ${compact(goal, 700)}`,
    knownContext ? `Known project context: ${knownContext}` : '',
    `Required outcome: ${compact(step.instruction, 700)}`,
  ].filter(Boolean).join('\n\n');
}

function buildTaskFallback(goal, plan, results) {
  const completed = results
    .map((result, index) => ({ ...result, title: plan[index]?.title || `Step ${index + 1}` }))
    .filter((result) => result.status === 'done' && String(result.text || '').trim());
  const failed = results
    .map((result, index) => ({ ...result, title: plan[index]?.title || `Step ${index + 1}` }))
    .filter((result) => result.status === 'error');

  if (!completed.length) {
    return `I couldn't obtain reliable task results for **${compact(goal, 300)}** after automatic retries.${failed.length ? `\n\nIncomplete areas: ${failed.map((item) => item.title).join(', ')}.` : ''}`;
  }

  return [
    `## Findings`,
    ...completed.map((result) => `### ${result.title}\n\n${compact(result.text, MAX_STEP_RESULT_CHARS)}`),
    failed.length
      ? `## Incomplete areas\n\n${failed.map((result) => `- **${result.title}:** ${compact(result.text, 500)}`).join('\n')}`
      : '',
  ].filter(Boolean).join('\n\n');
}

export function extractAgentTaskFallback(handoff = '') {
  const value = String(handoff || '');
  const start = value.indexOf(FALLBACK_START);
  const end = value.indexOf(FALLBACK_END);
  if (start < 0 || end <= start) return '';
  return value.slice(start + FALLBACK_START.length, end).trim();
}

export async function runAgentTask({
  goal = '',
  context = '',
  requiresResearch = false,
  freshness = false,
  generate,
  search,
  onPhase,
} = {}) {
  if (!String(goal || '').trim()) throw new Error('A task goal is required.');
  if (typeof generate !== 'function') throw new Error('The task planning model is unavailable.');
  const useResearch = agentTaskRequiresResearch(goal, requiresResearch);

  onPhase?.({ phase: 'planning' });
  let plan;
  try {
    const planText = await generate(buildAgentPlanPrompt({ goal, context, requiresResearch: useResearch }), {
      phase: 'planning',
      think: false,
      maxTokens: 900,
    });
    plan = parseAgentPlan(planText, { goal, requiresResearch: useResearch });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    plan = fallbackAgentPlan(goal, useResearch);
  }
  onPhase?.({
    phase: 'planned',
    total: plan.length,
    steps: plan.map((step, index) => ({
      id: index,
      title: step.title,
      instruction: step.instruction,
    })),
  });

  const results = [];
  for (let index = 0; index < plan.length; index += 1) {
    const step = plan[index];
    onPhase?.({ phase: 'executing', step: index + 1, total: plan.length, title: step.title });
    try {
      const result = await executeStepWithRetry({
        step: index + 1,
        total: plan.length,
        title: step.title,
        onPhase,
        operation: async (attempt) => {
          if (step.tool === 'web.search' && typeof search === 'function') {
            const queries = buildTaskSearchQueries({
              query: step.query,
              goal,
              context,
              instruction: step.instruction,
            });
            const resolvedQuery = queries[Math.min(attempt - 1, queries.length - 1)]
              || resolveTaskSearchQuery(step.query, goal, context);
            const evidence = await search(resolvedQuery, { freshness, deepResearch: true });
            if (!Array.isArray(evidence?.results) || evidence.results.length === 0) {
              throw new Error('Web search returned no useful evidence.');
            }
            return formatSearchEvidence(evidence, resolvedQuery);
          }
          try {
            return await generate(buildStepPrompt({ goal, context, plan, step, index, results }), {
              phase: 'executing',
              think: false,
              maxTokens: 1600,
            });
          } catch (error) {
            if (!retryableTaskError(error)) throw error;
            // A temporarily cold or overloaded local model must not invalidate
            // evidence that earlier steps already gathered. The workflow can
            // still produce a useful handoff and the normal final synthesis
            // will refine it whenever Ollama is available.
            return buildReasonStepFallback({ goal, context, step, results });
          }
        },
      });
      results.push({ status: 'done', text: compact(result, MAX_STEP_RESULT_CHARS) });
      onPhase?.({
        phase: 'step-completed',
        step: index + 1,
        total: plan.length,
        title: step.title,
        result: results[index].text,
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      const result = `Step could not be completed after ${MAX_STEP_ATTEMPTS} attempts: ${error?.message || 'Unknown error'}`;
      results.push({ status: 'error', text: result });
      onPhase?.({
        phase: 'step-error',
        step: index + 1,
        total: plan.length,
        title: step.title,
        result,
      });
    }
  }

  onPhase?.({ phase: 'synthesizing', total: plan.length });
  const fallback = buildTaskFallback(goal, plan, results);
  return [
    `Original goal: ${compact(goal)}`,
    'Completed internal work:',
    ...plan.map((step, index) => `\n${index + 1}. ${step.title}\n${results[index]?.text || 'No result.'}`),
    `\n${FALLBACK_START}\n${fallback}\n${FALLBACK_END}`,
    '\nFinal response requirement: answer the original goal directly using the completed work. Resolve inconsistencies, preserve source URLs for citations when useful, omit process chatter, and do not mention internal plans or tools.',
  ].join('\n');
}
