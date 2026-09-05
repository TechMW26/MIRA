export function appendContinuation(prefix, next = '') {
  if (!prefix) return next;
  if (next.startsWith(prefix)) return next;
  // Ignore short matches: repeated whitespace or punctuation can be valid.
  // KMP finds the exact overlap in linear time without a 4,000-character cap.
  const failure = new Uint32Array(next.length);
  for (let i = 1, matched = 0; i < next.length; i += 1) {
    while (matched && next[i] !== next[matched]) matched = failure[matched - 1];
    if (next[i] === next[matched]) matched += 1;
    failure[i] = matched;
  }
  let overlap = 0;
  for (const character of prefix.split('')) {
    while (overlap && (overlap === next.length || character !== next[overlap])) overlap = failure[overlap - 1];
    if (character === next[overlap]) overlap += 1;
  }
  return prefix + next.slice(overlap >= 32 ? overlap : 0);
}

// Continue only an explicitly truncated or interrupted response, never a
// completed answer or a tool call. Each segment remains independently bounded.
export async function completeChatResponse(options, requestSegment) {
  let answer = '';
  let thinking = '';
  let result;
  for (let segment = 0; ; segment += 1) {
    const prefix = answer;
    let partialAnswer = '';
    let partialThinking = '';
    try {
      result = await requestSegment({
        ...options,
        ...(segment ? {
          messages: [
            ...options.messages,
            { role: 'assistant', content: prefix },
            { role: 'user', content: 'Your response was interrupted. Continue exactly from where it ended. The preceding assistant message contains the complete output so far. Retain the original goal, task phase, constraints, sources and earlier decisions. Do not repeat, summarize, rewrite previous text or restart the answer. Resume any unfinished sentence, list item or code block; do not open a second code fence inside an unfinished block. Complete the original request, preserving Markdown and code formatting.' },
          ],
          tools: [],
        } : {}),
        onChunk: (chunk) => {
          partialAnswer = chunk.answerFull || '';
          partialThinking = chunk.thinkingFull || '';
          options.onChunk?.({
            ...chunk,
            answerFull: appendContinuation(prefix, partialAnswer),
            thinkingFull: thinking + partialThinking,
          });
        },
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      answer = appendContinuation(prefix, partialAnswer);
      thinking += partialThinking;
      if (!answer) throw error;
      break;
    }
    answer = appendContinuation(prefix, result.answer || '');
    thinking += result.thinking || '';
    if (!result.incomplete || result.finishReason === 'tool_calls') return { ...result, answer, thinking };
    // Stop a stalled/repeating provider, not an answer that is still progressing.
    if (!(result.answer || '').trim() || answer === prefix) break;
  }
  // Keep the partial content visible; never label it a complete response.
  if (options.requestClass !== 'task') answer += '\n\n_Response interrupted before completion. Ask me to continue from here._';
  options.onChunk?.({ answerFull: answer, thinkingFull: thinking });
  return { ...result, answer, thinking, incomplete: true };
}
