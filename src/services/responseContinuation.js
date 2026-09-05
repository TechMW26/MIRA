export function appendContinuation(prefix, next = '') {
  if (!prefix) return next;
  if (next.startsWith(prefix)) return next;
  // Ignore short matches: repeated whitespace or punctuation can be valid.
  for (let length = Math.min(prefix.length, next.length, 4000); length >= 32; length -= 1) {
    if (prefix.endsWith(next.slice(0, length))) return prefix + next.slice(length);
  }
  return prefix + next;
}

// Continue only an explicitly truncated or interrupted response, never a
// completed answer or a tool call. Each segment remains independently bounded.
export async function completeChatResponse(options, requestSegment) {
  let answer = '';
  let thinking = '';
  let result;
  for (let segment = 0; segment < 3; segment += 1) {
    const prefix = answer;
    try {
      result = await requestSegment({
        ...options,
        ...(segment ? {
          messages: [
            ...options.messages,
            { role: 'assistant', content: prefix },
            { role: 'user', content: 'Your response was interrupted. Continue exactly from where it ended. Do not repeat previous text or restart the answer. Complete the original request, preserving Markdown and code formatting.' },
          ],
          tools: [],
        } : {}),
        onChunk: (chunk) => options.onChunk?.({
          ...chunk,
          answerFull: appendContinuation(prefix, chunk.answerFull || ''),
          thinkingFull: thinking + (chunk.thinkingFull || ''),
        }),
      });
    } catch (error) {
      if (error?.name === 'AbortError' || !answer) throw error;
      break;
    }
    answer = appendContinuation(prefix, result.answer || '');
    thinking += result.thinking || '';
    if (!result.incomplete || result.finishReason === 'tool_calls') return { ...result, answer, thinking };
    if (!(result.answer || '').trim()) break;
  }
  // Keep the partial content visible; never label it a complete response.
  answer += '\n\n_Response interrupted before completion. Ask me to continue from here._';
  options.onChunk?.({ answerFull: answer, thinkingFull: thinking });
  return { ...result, answer, thinking, incomplete: true };
}
