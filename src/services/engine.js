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
    /\b(draw|paint|illustrate|sketch|render)\b\s+(?!.*\b(code|html|css|javascript|react|component|website|webpage)\b).{3,}/i,
    /\b(create|generate|make|design)\b.*\b(visual|artwork|cinematic|scene|character|concept art|product visual|thumbnail|cover art|album cover|sticker|mascot)\b/i,
    /\b(turn|transform|convert)\b.*\b(into|to)\b.*\b(image|picture|photo|illustration|artwork|poster|logo)\b/i,
    /\b(edit|modify|retouch|enhance|upscale|change|replace|remove|add)\b.*\b(image|picture|photo|background|object|person|logo)\b/i,
    /\b(image|picture|photo|illustration|artwork|poster|logo|wallpaper|banner|thumbnail)\s+of\b/i,
  ],
  video: [
    /\b(generate|create|make|produce|render)\b.*\b(video|clip|movie|animation|cinematic|trailer|reel|short)\b/i,
    /\b(video|clip|movie|animation|trailer|reel|short)\b.*\b(of|about|showing|depicting|with)\b/i,
    /\b(animate|animation|motion)\b.*\b(scene|shot|sequence|visual|character)\b/i,
    /\b(turn|convert|transform)\b.*\b(into|to)\b.*\b(video|animation|clip)\b/i,
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
  /\b(who\s+(makes|manufactures|produces|produced|created|built|developed|owns|founded)|which\s+company|what\s+company|manufacturer|producer|maker|company\s+behind|brand\s+behind|official\s+website)\b/i,
  /\b(law|legal|regulation|regulatory|tax|visa|immigration|medication|drug\s+interaction|dosage|diagnosis|treatment\s+guideline)\b/i,
];

// Investigative research intent — user explicitly wants the assistant to
// go look something up rather than answer from memory.
const RESEARCH_INTENT_SIGNALS = [
  /\b(do\s+some\s+digging|dig\s+(?:into|on|up)|digging\s+(?:into|on)|look\s+(?:into|up)|investigate|research\s+(?:this|that|on|about)|deep\s+dive|background\s+check|find\s+(?:details|info|information)|pull\s+details)\b/i,
  /\b(check\s+(?:what|who)\s+(?:this|that)\s+is|find\s+(?:what|who)\s+(?:this|that)\s+is|verify\s+(?:this|that)|cross[-\s]?check\s+(?:this|that))\b/i,
  /\b(?:find|fetch|gather)\s+(?:me\s+)?(?:more\s+)?(?:info|information|details|background)\b/i,
];

// Informational intent — user is asking ABOUT a topic. This is the broad
// surface that previously had to be triggered keyword-by-keyword (and missed
// phrasings like "tell me something about X").
const INFO_INTENT_SIGNALS = [
  /\b(tell\s+me\s+(?:something|more|anything|everything|a\s+bit|a\s+little)?\s*about|tell\s+me\s+about)\b/i,
  /\b(what(?:'s|\s+is|\s+are)|who(?:'s|\s+is|\s+are)|where\s+(?:is|are)|how\s+(?:big|small|tall|old|long|much|many)\s+(?:is|are))\b/i,
  /\b(do\s+you\s+know|have\s+you\s+heard\s+of|ever\s+heard\s+of|familiar\s+with|any\s+idea\s+(?:what|who|where))\b/i,
  /\b(give\s+me\s+(?:some\s+)?(?:info|information|details|background|context)|share\s+(?:info|information|details))\b/i,
  /\b(learn\s+(?:more\s+)?about|teach\s+me\s+about|brief\s+me\s+on|walk\s+me\s+through|overview\s+of|introduce\s+(?:me\s+to)?)\b/i,
  /\b(more\s+about|info\s+(?:on|about)|details?\s+(?:on|about)|background\s+on|context\s+on)\b/i,
];

// Words that name very broad / well-known topics. An LLM almost certainly
// knows these from training, so informational prompts about them stay on
// the model and don't waste a web search call.
const COMMON_TOPIC_TOKENS = new Set([
  'love','life','death','time','money','happiness','sadness','luck','fate',
  'food','water','air','fire','earth','sky','sun','moon','star','stars',
  'gravity','math','science','physics','chemistry','biology','history','geography',
  'philosophy','psychology','sociology','economy','politics','art','music','sport',
  'sports','game','games','book','books','movie','movies','show','shows','dream',
  'dreams','people','person','world','animal','animals','plant','plants','color',
  'colors','colour','colours','god','religion','culture','society','nature','technology',
  'computer','phone','car','cars','dog','dogs','cat','cats','bird','birds','tree','trees',
  'flower','flowers','river','ocean','mountain','language','english','programming',
]);

const STRUCTURAL_STOPWORDS = new Set([
  'the','a','an','and','or','but','if','then','than','that','this','these','those',
  'so','to','of','for','from','with','about','around','into','onto','over','under',
  'is','are','was','were','be','been','being','am','do','does','did','done',
  'have','has','had','having','can','could','should','would','may','might','will','shall',
  'tell','me','you','your','my','our','his','her','their','its','it','they','them',
  'we','us','i','someone','something','anyone','anything','everyone','everything',
  'know','let','say','said','please','kindly','maybe','perhaps','also','too','very',
  'really','still','again','just','only','more','less','some','any','few','many','much',
  'what','who','where','when','why','how','which',
]);

// Mirrors the retrieval-routing approach used by Perplexity / GPT-with-browse:
// combine intent with a topic-specificity score. Search only fires when the
// user shows informational intent AND the topic looks specific enough that a
// general LLM is unlikely to know it reliably (proper nouns, slugs, model
// names, niche compound words, quoted entities, etc.).
function scoreTopicSpecificity(text = '') {
  const value = String(text || '');
  if (!value) return { score: 0, hits: [] };

  let score = 0;
  const hits = [];

  if (/["'“”‘’][^"'“”‘’]{2,80}["'“”‘’]/.test(value)) { score += 3; hits.push('quoted'); }
  if (/\b[a-z][a-z0-9]*[-_][a-z0-9][a-z0-9-_]{1,}\b/i.test(value)) { score += 2; hits.push('slug'); }
  if (/\b[A-Z][a-z]+[A-Z][A-Za-z0-9]+\b/.test(value)) { score += 2; hits.push('camel'); }
  if (/\b[A-Za-z]+[0-9]+[A-Za-z0-9]*\b|\b[A-Za-z]*[0-9]{2,}\b/.test(value)) { score += 2; hits.push('digit'); }
  if (/\b[A-Z]{3,8}\b/.test(value) && !/^[A-Z]{3,8}\b/.test(value.trim())) { score += 2; hits.push('acronym'); }

  const tokens = value.split(/\s+/).map((token) => token.replace(/[^\w-]/g, ''));
  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token) continue;
    if (!/^[A-Z][a-z]{2,}$/.test(token)) continue;
    if (COMMON_TOPIC_TOKENS.has(token.toLowerCase())) continue;
    score += 2;
    hits.push(`proper:${token}`);
    break;
  }

  const lowerLong = (value.toLowerCase().match(/\b[a-z]{7,}\b/g) || [])
    .filter((word) => !COMMON_TOPIC_TOKENS.has(word) && !STRUCTURAL_STOPWORDS.has(word));
  if (lowerLong.length > 0) {
    score += 2;
    hits.push(`compound:${lowerLong[0]}`);
  }

  return { score, hits };
}

// Phrases that strongly suggest the topic is broad/well-known. Avoid
// triggering search on these unless the user also shows research intent.
const EVERGREEN_PROMPT_SIGNALS = [
  /^\s*(define|definition\s+of|meaning\s+of)\b/i,
  /\b(in\s+general|generally\s+speaking|broadly\s+speaking)\b/i,
];

const IMAGE_GROUNDED_SEARCH_SIGNALS = [
  /\b(tell\s+me(?:\s+(?:something|more))?|details?|information|info|background|research|explain|what\s+is|what's|identify|recognize|verify|look\s+up|find\s+out|search|check)\b[^.!?]{0,110}\b(image|photo|picture|device|product|object|item|thing|prototype|machine|system|this|that|it)\b/i,
  /\b(image|photo|picture|device|product|object|item|thing|prototype|machine|system|this|that|it)\b[^.!?]{0,110}\b(tell\s+me(?:\s+(?:something|more))?|details?|information|info|background|research|explain|what\s+is|what's|identify|recognize|verify|look\s+up|find\s+out|search|check)\b/i,
];

function detectSearchNeed(text, hasImages = false) {
  const value = String(text || '').trim();
  if (!value) return false;

  // 1) Time-sensitive or explicit "look this up" cues — always search.
  if (SEARCH_SIGNALS.some((rx) => rx.test(value))) return true;

  // 2) Image-grounded research about an attached photo.
  if (hasImages && IMAGE_GROUNDED_SEARCH_SIGNALS.some((rx) => rx.test(value))) return true;

  const researchIntent = RESEARCH_INTENT_SIGNALS.some((rx) => rx.test(value));
  const infoIntent = INFO_INTENT_SIGNALS.some((rx) => rx.test(value));
  const specificity = scoreTopicSpecificity(value);
  const words = value.split(/\s+/).filter(Boolean).length;

  // 3) Bare topic shorthand — a short prompt that is just a topic, optionally
  //    ending in "?". e.g. "Algaetree?", "TensorFlow", "OpenAI?", "mira-v4".
  //    Treat as implicit "tell me about X" and search when the topic is
  //    specific enough that an LLM may not know it.
  if (!researchIntent && !infoIntent && words <= 3 && specificity.score >= 2) {
    return true;
  }

  if (!researchIntent && !infoIntent) return false;

  // 4) Investigative intent ("do some digging on X") almost always triggers
  //    search; we only block trivially short prompts with zero topic surface.
  if (researchIntent) {
    if (specificity.score >= 1) return true;
    if (words >= 4) return true;
    return false;
  }

  // 5) Informational intent → search only when the topic looks specific
  //    enough that a general LLM is unlikely to know it reliably. This keeps
  //    "what is gravity" cheap while routing "tell me about algaetree" to
  //    live sources.
  const evergreen = EVERGREEN_PROMPT_SIGNALS.some((rx) => rx.test(value));
  if (evergreen && specificity.score < 3) return false;
  return specificity.score >= 2;
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

const CODE_INTENT_SIGNALS = [
  /\b(code|coding|source\s*code|implementation|implement|build|develop|program|script|component|page|website|webpage|web\s*app|landing\s*page|template)\b/i,
  /\b(html|css|javascript|js|typescript|ts|jsx|tsx|react|vue|angular|svelte|next\.?js|tailwind|bootstrap|node|python|java|php|ruby|swift|kotlin|sql)\b/i,
  /\b(production[-\s]*ready|end[-\s]*to[-\s]*end|full\s*(?:code|implementation)|complete\s*(?:code|app|website|page))\b/i,
  /\b(navbar|footer|hero|section|layout|responsive|button|form|modal|canvas|dom|api|frontend|backend)\b/i,
];

function detectCodeIntent(text = '') {
  return CODE_INTENT_SIGNALS.some(rx => rx.test(text));
}

function classifyQuery(text) {
  if (detectCodeIntent(text)) {
    const complexity = /\b(production[-\s]*ready|end[-\s]*to[-\s]*end|complete|full|app|website|architecture)\b/i.test(text) ? 'high' : 'medium';
    return { intent: 'code', complexity };
  }

  let isVideoMatch = false;
  for (const rx of COMPLEXITY_SIGNALS.video) {
    if (rx.test(text)) { isVideoMatch = true; break; }
  }
  if (isVideoMatch) {
    const hasCodeContext = IMAGE_NEGATIVE_SIGNALS.some(rx => rx.test(text));
    if (!hasCodeContext) {
      return { intent: 'video', complexity: 'low' };
    }
  }

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

export function isImageGenerationRequest(text = '') {
  const classification = classifyQuery(text);
  return classification.intent === 'image';
}

export function interpretUserPrompt(text = '', hasImages = false) {
  const classification = classifyQuery(text);
  const codeIntent = detectCodeIntent(text);
  const imageIntent = classification.intent === 'image' && !codeIntent;
  const videoIntent = classification.intent === 'video' && !codeIntent;
  const resolvedIntent = codeIntent ? 'code' : classification.intent;
  return {
    intent: resolvedIntent,
    classification: codeIntent ? { ...classification, intent: 'code' } : classification,
    codeIntent,
    imageIntent,
    videoIntent,
    hasImages,
    route: codeIntent ? 'code' : videoIntent ? 'video' : imageIntent ? 'image' : 'chat',
  };
}

function looksMultilingual(text = '') {
  const value = String(text || '');
  if (!value.trim()) return false;

  // Non-latin scripts are a strong multilingual signal.
  if (/[\u0400-\u04FF\u0600-\u06FF\u0900-\u097F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(value)) {
    return true;
  }

  // Common language hints for latin-script requests.
  return /\b(in\s+(spanish|hindi|french|german|italian|portuguese|japanese|korean|arabic)|translate|traduce|traducir|traduire|uebersetze|übersetze|bahasa|espanol|español|francais|français|deutsch|portugues|português)\b/i.test(value);
}

// ── Small-talk gating (kept for intent heuristics/search behavior) ─────────
const SMALL_TALK_RE = /^[^\w]*(?:hi+|hii+|hello+|hey+|heya+|yo+|sup+|howdy+|hola|namaste|salaam|salam|ciao|aloha|good\s+(?:morning|afternoon|evening|night|day)|gm|gn|how\s+(?:are|r|do|is|have)\s+(?:you|u|ya|yu|things|it|life|your\s+day|you\s+doing|you\s+been)|how'?s\s+(?:it\s+going|life|your\s+day|things|everything|tricks)|what'?s\s+(?:up|new|good|happening|cracking|cookin'?g?|poppin'?g?)|wassup|wazzup|wyd|nice\s+(?:to\s+meet\s+you|one)|pleasure\s+to\s+meet\s+you|thanks+|thank\s+you|thx+|tysm|ty\b|appreciate\s+it|cool|nice|awesome|great|amazing|wonderful|ok(?:ay)?|alright|sure|sounds\s+good|lol+|haha+|hehe+|lmao+|lmfao+|rofl+|nope+|yep+|yup+|yeah+|yes|no\b|maybe|bye+|goodbye+|see\s+(?:you|ya)|cya|ttyl|peace|catch\s+you\s+later|take\s+care|have\s+a\s+(?:good|nice|great)\s+(?:day|night|one|weekend)|cheer\s+me\s+up|make\s+me\s+(?:laugh|smile|happy)|tell\s+me\s+a\s+joke|joke\s+(?:please|for\s+me)|got\s+any\s+jokes|i'?m\s+(?:sad|bored|happy|tired|fine|good|ok|okay|down|lonely|stressed|excited|chill|chilling)|feeling\s+(?:sad|bored|happy|tired|fine|good|down|low|lonely|stressed|excited)|who\s+are\s+you|what(?:'s|\s+is)\s+your\s+name|your\s+name\??|introduce\s+yourself|tell\s+me\s+about\s+yourself)\b/iu;

function wordCount(text = '') {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

function isTrivialSmallTalk(text = '', { hasImages = false } = {}) {
  if (hasImages) return false;
  const value = String(text || '').trim();
  if (!value) return true;            // empty prompt is harmless
  if (value.length > 140) return false;
  if (wordCount(value) > 14) return false;
  if (/```|\$\$|\\[a-z]+\{/.test(value)) return false; // code/math markup
  return SMALL_TALK_RE.test(value);
}

// ── Model routing ──────────────────────────────────────────────
function pickModel(classification, hasImages, selectedMode = 'auto') {
  if (selectedMode === 'locked') return 'locked';
  if (selectedMode === 'mira-pro') return 'mira-pro';
  if (selectedMode === 'mira-lite') return 'mira-lite';
  if (selectedMode === 'mira') return 'mira';
  // Auto: keep almost all conversation on Lite unless vision is needed.
  if (hasImages) return 'mira-pro';
  return 'mira-lite';
}

// ── Public API ─────────────────────────────────────────────────
export function processQuery(userText, hasImages = false, options = {}) {
  const { selectedMode = 'auto' } = options;
  const interpretation = interpretUserPrompt(userText, hasImages);
  const classification = interpretation.classification;
  const model = pickModel(classification, hasImages, selectedMode, userText);
  const searchNeeded = detectSearchNeed(userText, hasImages);

  return {
    classification,
    interpretation,
    model,
    needsSearch: searchNeeded,
  };
}
