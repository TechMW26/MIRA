const ERROR_PATTERN = /(?:^sorry[,!]?\s+(?:something|i)\b|\bcould(?:n't| not) complete\b|\bservice (?:is )?unavailable\b|\b(?:request|service|model) (?:failed|timed? out)\b|\bsomething went wrong\b)/i;
const DIRECT_HOSTILITY_PATTERN = /(?:\b(?:you(?:'re| are)?|mira)\b.{0,36}\b(?:awful|bad|dumb|idiot|pathetic|stupid|useless|worthless|worst|bakwa+s|bewakoof|ghatiya|nikammi|pagal)\b|\b(?:awful|dumb|idiot|pathetic|stupid|useless|worthless|bakwa+s|bewakoof|ghatiya|nikammi)\b.{0,24}\b(?:you|mira)\b|\b(?:fuck you|shut up|go to hell|i hate you|chup ho|chup kar|kamine)\b)/i;
const THREAT_PATTERN = /\b(?:i(?:'ll| will| am going to)?\s+(?:destroy|hurt|kill|remove|erase|delete)\s+(?:you|mira)|threat(?:en|ening)?\s+(?:you|mira))\b/i;
const DISTRESS_PATTERN = /\b(?:(?:i am|i'm)\s+(?:feeling\s+)?|(?:feeling|feel)\s+)(?:very\s+)?(?:depressed|heartbroken|hopeless|lonely|sad|upset)\b|\b(?:grief|lost someone|passed away)\b/i;
const FEAR_PATTERN = /\b(?:(?:i am|i'm)\s+(?:feeling\s+)?|(?:feeling|feel)\s+)(?:very\s+)?(?:afraid|anxious|scared|terrified|worried)\b|\bpanic(?:king|ked)?\b/i;
const PRAISE_PATTERN = /\b(?:amazing|awesome|brilliant|excellent|great job|love you|nice work|perfect|thank you|thanks|well done)\b/i;
const LAUGHTER_PATTERN = /(?:\b(?:haha+|hehe+|lol|lmao|funny|hilarious)\b|😂|🤣)/i;
const EXCITEMENT_PATTERN = /\b(?:can't wait|excited|fantastic|incredible|wow|yay)\b|!{2,}/i;
const CONFUSION_PATTERN = /\b(?:confused|don't understand|do not understand|makes no sense|what do you mean|samajh nahi)\b/i;

export function shouldShowMiraWelcome(conversationId, messages = []) {
  return !conversationId && messages.length === 0;
}

export function messageHasError(message) {
  if (!message || message.role !== 'assistant') return false;
  if (message.error) return true;
  return ERROR_PATTERN.test(String(message.content || ''));
}

export function expressionForAssistantContent(content = '') {
  const text = String(content || '');
  if (/\b(?:done|completed|fixed|resolved|passed|successful(?:ly)?|ready|shipped|deployed)\b/i.test(text)) return 'proud';
  if (/\b(?:haha|hehe|lol|funny|joke|laugh)\b/i.test(text)) return 'laughing';
  if (/\b(?:wow|surpris(?:e|ed|ing)|unexpected|remarkable|incredible)\b/i.test(text)) return 'surprised';
  if (/\b(?:thank you|thanks|appreciate|glad to help|my pleasure)\b/i.test(text)) return 'shy';
  if (/\b(?:not sure|unclear|ambiguous|could mean|need clarification)\b/i.test(text)) return 'confused';
  if (/[!！]\s*$/.test(text.trim())) return 'excited';
  return 'neutral';
}

export function expressionForUserContent(content = '') {
  const text = String(content || '').trim();
  if (!text) return 'neutral';
  if (THREAT_PATTERN.test(text)) return 'scared';
  if (DIRECT_HOSTILITY_PATTERN.test(text)) return 'angry';
  if (DISTRESS_PATTERN.test(text)) return 'sad';
  if (FEAR_PATTERN.test(text)) return 'scared';
  if (LAUGHTER_PATTERN.test(text)) return 'laughing';
  if (PRAISE_PATTERN.test(text)) return 'shy';
  if (CONFUSION_PATTERN.test(text)) return 'confused';
  if (EXCITEMENT_PATTERN.test(text)) return 'excited';
  if (/\b(?:hello|hey|hi|namaste)\b/i.test(text)) return 'happy';
  if (/\?\s*$/.test(text)) return 'curious';
  return 'attentive';
}

export function resolveMiraExpression({
  isWelcome = false,
  isGenerating = false,
  isSearching = false,
  voiceStatus = 'idle',
  taskWorkflow = null,
  lastMessage = null,
  latestUserMessage = null,
} = {}) {
  const userExpression = expressionForUserContent(latestUserMessage?.content);
  const hasStrongUserReaction = ['angry', 'scared', 'sad', 'shy', 'laughing', 'excited', 'confused']
    .includes(userExpression);
  if (voiceStatus === 'error' || messageHasError(lastMessage)) return 'sad';
  if (voiceStatus === 'speaking') return expressionForAssistantContent(lastMessage?.content);
  if (voiceStatus === 'listening') return 'attentive';
  if (voiceStatus === 'transcribing') return 'curious';
  if (voiceStatus === 'thinking') return hasStrongUserReaction ? userExpression : 'curious';
  if (voiceStatus === 'connecting') return 'shy';
  if (isSearching) return hasStrongUserReaction ? userExpression : 'curious';

  if (taskWorkflow?.status === 'running') {
    if (hasStrongUserReaction) return userExpression;
    if (taskWorkflow.phase === 'planning') return 'curious';
    if (taskWorkflow.phase === 'synthesizing') return 'excited';
    if (taskWorkflow.phase === 'responding') return 'proud';
    return 'attentive';
  }

  if (isGenerating) return hasStrongUserReaction ? userExpression : 'attentive';
  if (isWelcome) return 'neutral';
  if (lastMessage?.role === 'assistant') return expressionForAssistantContent(lastMessage.content);
  if (lastMessage?.role === 'user') return expressionForUserContent(lastMessage.content);
  return 'attentive';
}
