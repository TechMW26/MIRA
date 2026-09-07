// High-confidence format failures only: do not treat refusals or honest
// uncertainty as something to bypass with another generation attempt.
export function validateTaskResult(answer, request = '') {
  const text = String(answer || '').trim();
  const plain = text.replace(/[*_`#]/g, '').trim();
  const identityRequested = /\b(?:about (?:you|yourself)|who are you|introduce yourself|your (?:identity|capabilities))\b/i.test(request);
  const codeRequested = /\b(?:html|css|code|coding|website|webpage|web page|component|javascript|frontend|landing page)\b/i.test(request);
  let reason = '';
  if (!identityRequested && /^(?:i am|i'm)\s+mira\b/i.test(plain)) reason = 'The model returned an unrelated self-introduction.';
  if (!codeRequested && /(?:<!doctype html|<html\b|<style\b|<link\s+[^>]*rel=["']stylesheet)/i.test(text)) reason = 'The model returned webpage code instead of the requested task result.';
  if (reason) {
    const error = new Error(reason);
    error.name = 'InvalidTaskResultError';
    throw error;
  }
  return text;
}

export function taskFailureNotice(plan, results) {
  const failed = results.flatMap((result, index) => result.status === 'error'
    ? [`- ${plan[index]?.title || `Part ${index + 1}`}: ${result.failureReason || 'Could not be completed.'}`] : []);
  if (!failed.length) return '';
  return `This task is incomplete: ${failed.length} of ${plan.length} parts failed.\n\n${failed.join('\n')}\n\nAny conclusions below are partial, not a verified completed result.`;
}
