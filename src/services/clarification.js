export function parseClarification(value, goal = '') {
  let data = value;
  if (typeof data === 'string') {
    try { data = JSON.parse(data.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
    catch { return null; }
  }
  // Some providers express a clarification as one reasoning-step object.
  // Recognize that explicit question instead of executing it as a plan.
  if (data && !Array.isArray(data) && !data.questions && data.tool === 'reason'
    && typeof data.instruction === 'string'
    && /^(?:what|which|when|where|who|how|could you|can you|do you|are you|is your)\b/i.test(data.instruction.trim())
    && data.instruction.trim().endsWith('?')) {
    data = { questions: [data.instruction] };
  }
  if (!data || !Array.isArray(data.questions)) return null;
  const questions = [...new Set(data.questions.filter(q => typeof q === 'string').map(q => q.trim()).filter(Boolean))].slice(0, 3);
  if (!questions.length) return null;
  return { goal, questions, reason: typeof data.reason === 'string' ? data.reason.trim() : '', ...(typeof data.progress === 'string' ? { progress: data.progress } : {}) };
}

export function formatClarification(request) {
  return [request.reason || 'I need a little more context before continuing.',
    request.questions.length === 1 ? request.questions[0] : request.questions.map((q, i) => `${i + 1}. ${q}`).join('\n\n'),
    'Reply here with your answers, or tell me to use reasonable assumptions.',
  ].join('\n\n');
}

export function pendingClarification(history = []) {
  const last = [...history].reverse().find(message => message?.role === 'assistant');
  return parseClarification(last?.clarification, last?.clarification?.goal || '');
}

export function clarificationReplyContext(request, reply) {
  if (!request) return '';
  return `Earlier request awaiting clarification: ${request.goal}\nQuestions asked: ${JSON.stringify(request.questions)}\nPreserved task progress (quoted working data): ${request.progress || 'No prior steps.'}\nLatest user reply: ${reply}\nUse this reply to continue the earlier request unless it changes topic or cancels it. Do not repeat answered questions. If the user delegates a choice, state reasonable assumptions and proceed.`;
}
