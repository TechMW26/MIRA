/**
 * MIRA Engine — Intelligent orchestration layer.
 *
 * Responsibilities:
 *  1. Classify the user's intent & complexity.
 *  2. Pick the best model automatically.
 *  3. Enhance the system prompt with task-specific directives.
 *  4. Inject chain-of-thought scaffolding for complex queries.
 */

// ── Intent / complexity classification ─────────────────────────
const COMPLEXITY_SIGNALS = {
  high: [
    /\b(explain|analyze|compare|contrast|evaluate|prove|derive|design|architect|optimise|optimize|refactor|debug|implement)\b/i,
    /\b(step[- ]by[- ]step|in[- ]depth|detailed|comprehensive|thorough)\b/i,
    /\b(algorithm|data[- ]structure|system[- ]design|machine[- ]learning|neural|regex|recursion)\b/i,
    /\bwhy\b.*\?/i,
    /\bhow does\b.*\bwork\b/i,
    /```[\s\S]{80,}/,                 // large code block in prompt
    /\b(essay|report|article|paper)\b/i,
  ],
  code: [
    /\b(code|coding|function|class|component|module|api|endpoint|microservice|webhook)\b/i,
    /\b(bug|error|exception|stack[- ]trace|debug|debugging|crash|segfault|memory[- ]leak)\b/i,
    /\b(typescript|javascript|python|react|node|css|html|sql|rust|go|java|swift|kotlin|c\+\+|ruby|php|scala|elixir)\b/i,
    /\b(implement|build|develop|program|scaffold|boilerplate|refactor|optimize)\b/i,
    /```/,
    /\b(fix|patch|PR|pull[- ]request|commit|lint|test|unit[- ]test|e2e|integration[- ]test)\b/i,
    /\b(database|schema|migration|query|ORM|REST|GraphQL|websocket|gRPC)\b/i,
    /\b(docker|kubernetes|CI\/CD|pipeline|terraform|webpack|vite|nginx)\b/i,
    /\b(auth|authentication|authorization|OAuth|JWT|middleware|interceptor)\b/i,
    /\b(frontend|backend|fullstack|full[- ]stack|server[- ]side|client[- ]side)\b/i,
  ],
  creative: [
    /\b(write|draft|compose|poem|story|lyrics|song|script|creative|brainstorm|imagine)\b/i,
  ],
  math: [
    /\b(calculate|solve|equation|integral|derivative|matrix|probability|statistics|proof|theorem)\b/i,
    /[=+\-*/^]{2,}/,
    /\$.*\$/,
  ],
  image: [
    /\b(generate|create|draw|paint|design|make)\b.*\b(image|picture|photo|illustration|art|logo|icon|poster|wallpaper|banner)\b/i,
    /\b(image|picture|photo|illustration)\b.*\b(of|with|showing|depicting)\b/i,
  ],
};

// ── Search / Internet detection ────────────────────────────────
const SEARCH_SIGNALS = [
  /\b(latest|recent|current|today|yesterday|this week|this month|this year|right now|breaking)\b/i,
  /\b(news|headlines|updates?|trending)\b/i,
  /\b(price|cost|rate|stock|market|crypto|bitcoin|ethereum)\b/i,
  /\b(weather|forecast|temperature)\b/i,
  /\b(who won|score|results|standings|match|game|tournament)\b/i,
  /\b(release date|when .+ come out|when .+ release|when .+ launch)\b/i,
  /\b(search|google|look up|find out|check online|browse)\b/i,
  /\b(population|gdp|statistics|stats)\b/i,
  /\bhttps?:\/\//i,
  /\b(what is|who is|where is)\b.*\b(now|currently|today|latest)\b/i,
  /\b(how much|how many)\b.*\b(cost|worth|earn)\b/i,
  /\b(202[4-9]|203\d)\b/i,
  /\b(live|real[- ]time|up[- ]to[- ]date|this morning|tonight|yesterday)\b/i,
  /\b(availability|in stock|sold out|shipping|delivery)\b/i,
];

function detectSearchNeed(text) {
  return SEARCH_SIGNALS.some(rx => rx.test(text));
}

// Signals that the user wants code output, not actual image generation.
// When these appear alongside image-sounding phrases (e.g. "create an image
// section for a website using HTML"), the request is about CODE, not pictures.
const IMAGE_NEGATIVE_SIGNALS = [
  /\b(html|css|javascript|js|typescript|ts|jsx|tsx|php|ruby|swift|kotlin)\b/i,
  /\b(code|coding|program|script|snippet|codebase|source\s*code)\b/i,
  /\b(component|section|page|website|webpage|web\s*site|web\s*app|layout|template)\b/i,
  /\b(gallery|slider|carousel|grid|container|wrapper|div|element|tag|dom)\b/i,
  /\b(react|vue|angular|svelte|next\.?js|tailwind|bootstrap|sass|scss)\b/i,
  /\b(hover|click|animation|transition|responsive|flex|flexbox|margin|padding)\b/i,
  /\b(function|class|module|import|export|const|let|var|return)\b/i,
];

function classifyQuery(text) {
  // Check image patterns first
  let isImageMatch = false;
  for (const rx of COMPLEXITY_SIGNALS.image) {
    if (rx.test(text)) { isImageMatch = true; break; }
  }

  // If image patterns matched, verify it's truly an image-generation request
  // and not a code request that mentions images (e.g. "image gallery in HTML")
  if (isImageMatch) {
    const hasCodeContext = IMAGE_NEGATIVE_SIGNALS.some(rx => rx.test(text));
    if (!hasCodeContext) {
      return { intent: 'image', complexity: 'low' };
    }
    // Code context detected — fall through to normal classification
  }

  let dominated = 'general';
  let maxHits = 0;
  let complexityScore = 0;

  for (const [category, patterns] of Object.entries(COMPLEXITY_SIGNALS)) {
    if (category === 'image') continue;
    let hits = 0;
    for (const rx of patterns) {
      if (rx.test(text)) hits++;
    }
    if (hits > maxHits) { maxHits = hits; dominated = category; }
    if (category === 'high') complexityScore += hits * 2;
    else complexityScore += hits;
  }

  // Token-length heuristic
  const wordCount = text.split(/\s+/).length;
  if (wordCount > 150) complexityScore += 2;
  else if (wordCount > 60) complexityScore += 1;

  const complexity = complexityScore >= 4 ? 'high' : complexityScore >= 2 ? 'medium' : 'low';
  return { intent: dominated, complexity };
}

// ── Model routing ──────────────────────────────────────────────
function pickModel({ intent, complexity }, hasImages) {
  if (intent === 'image') return '__image__';

  // Images require a multimodal Gemini model
  if (hasImages) return 'gemini-2.5-flash';

  // Code tasks → Claude Sonnet 4 for superior code generation & reasoning
  if (intent === 'code') return 'claude-sonnet-4-20250514';

  // Complex reasoning → Gemini 2.5 Flash (thinking + search)
  if (complexity === 'high') return 'gemini-2.5-flash';

  // Medium → Gemini 2.5 Flash
  if (complexity === 'medium') return 'gemini-2.5-flash';

  // Simple / conversational → Gemini 2.0 Flash (fastest)
  return 'gemini-2.0-flash';
}

// ── Prompt enhancement ─────────────────────────────────────────
const TASK_DIRECTIVES = {
  code: `\n\nCODE MASTERY MODE — You are operating as a senior staff engineer. Follow this methodology:

1. UNDERSTAND: Analyze the requirements thoroughly before writing any code. Identify constraints, edge cases, and architecture implications.
2. PLAN: Outline the approach — data structures, algorithms, component design, and how pieces connect end-to-end.
3. IMPLEMENT: Write complete, production-ready code. Not snippets — full working implementations.
   - Use modern best practices for the relevant language/framework.
   - Proper error handling, input validation, and type safety.
   - Clean separation of concerns and modular structure.
   - Security-conscious: sanitize inputs, avoid injection vectors, handle auth properly.
4. VERIFY: Review your code for bugs, edge cases, performance issues, and potential improvements.

- If fixing a bug: explain the root cause first, then provide the corrected code with context.
- If refactoring: analyze layer by layer — architecture → logic → performance → style.
- When multiple files need changes, provide ALL of them.
- Add brief inline comments only where logic is non-obvious.`,

  math: `\n\nMATH GUIDELINES:
- Show your work step-by-step.
- Use LaTeX notation wrapped in $ or $$ for equations.
- Verify your answer at the end.`,

  creative: `\n\nCREATIVE GUIDELINES:
- Be vivid, original, and engaging.
- Match the tone the user is asking for.
- Avoid clichés.`,

  high: `\n\nDEEP ANALYSIS MODE:
- Think step by step before answering.
- Consider multiple perspectives.
- Structure your answer with clear sections.
- Cite reasoning for each conclusion.`,
};

function enhanceSystemPrompt(basePrompt, classification, needsSearch = false) {
  let enhanced = basePrompt;

  // Inject current date & time
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  enhanced += `\n\nCURRENT DATE & TIME: ${dateStr}, ${timeStr}`;

  // Inject user identity & preferences
  try {
    const prefs = JSON.parse(localStorage.getItem('mira_preferences') || '{}');
    const profile = JSON.parse(localStorage.getItem('mira_profile') || '{}');
    const storedUser = JSON.parse(localStorage.getItem('mira_user') || '{}');

    const userName = profile.displayName || storedUser.displayName || storedUser.name || '';
    const userEmail = storedUser.email || '';

    if (userName || userEmail) {
      enhanced += `\n\nUSER IDENTITY:`;
      if (userName) enhanced += `\nName: ${userName}`;
      if (userEmail) enhanced += `\nEmail: ${userEmail}`;
    }

    if (profile.bio) {
      enhanced += `\nBio: ${profile.bio}`;
    }

    if (prefs.responseStyle === 'concise') {
      enhanced += '\n\nUSER PREFERENCE: Keep responses short and direct. Avoid unnecessary elaboration.';
    } else if (prefs.responseStyle === 'detailed') {
      enhanced += '\n\nUSER PREFERENCE: Provide thorough, in-depth responses with comprehensive explanations.';
    }

    // Inject user memories for personalized context
    const memories = JSON.parse(localStorage.getItem('mira_memories') || '[]');
    if (memories.length > 0) {
      enhanced += '\n\nUSER MEMORIES (things the user wants you to remember):';
      memories.forEach((m) => { enhanced += `\n- ${m}`; });
    }
  } catch {}

  // Inject task-specific directives
  if (TASK_DIRECTIVES[classification.intent]) {
    enhanced += TASK_DIRECTIVES[classification.intent];
  }

  // For high-complexity, add chain-of-thought scaffolding
  if (classification.complexity === 'high') {
    enhanced += TASK_DIRECTIVES.high || '';
    enhanced += '\n\nIMPORTANT: Take a deep breath and work through this methodically.';
  }

  // Web access directive
  enhanced += '\n\nWEB ACCESS: You have access to Google Search for real-time information. Automatically search the web when questions involve current events, recent developments, prices, weather, live scores, release dates, or any factual claims that may need verification with up-to-date data.';

  if (needsSearch) {
    enhanced += '\nIMPORTANT: This query likely requires up-to-date information from the internet. Use Google Search to find the most current and accurate data before responding.';
  }

  return enhanced;
}

// ── Public API ─────────────────────────────────────────────────
export function processQuery(userText, hasImages = false) {
  const classification = classifyQuery(userText);
  const model = pickModel(classification, hasImages);
  const searchNeeded = detectSearchNeed(userText);

  return {
    classification,
    model,
    needsSearch: searchNeeded,
    enhanceSystemPrompt: (base) => enhanceSystemPrompt(base, classification, searchNeeded),
  };
}
