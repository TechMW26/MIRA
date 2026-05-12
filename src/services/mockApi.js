/**
 * Mock API Service for Development
 * Use this when the real API is unavailable
 */

export async function checkHealth() {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 300));
  return { ok: true, status: 200 };
}

export async function analyzeTextPublic(prompt) {
  if (!prompt) throw new Error('Prompt required');
  await new Promise(resolve => setTimeout(resolve, 800));
  
  return {
    result: `Mock Analysis of "${prompt}": This is a simulated response from the public endpoint. In production, this would contain real AI analysis.`
  };
}

export async function analyzeTextProtected(prompt) {
  if (!prompt) throw new Error('Prompt required');
  await new Promise(resolve => setTimeout(resolve, 800));
  
  return {
    result: `Protected Mock Analysis of "${prompt}": This simulates the protected endpoint response with advanced analysis capabilities.`
  };
}

export async function analyzeText(prompt, file = null, usePublic = false) {
  if (usePublic) {
    return analyzeTextPublic(prompt, file);
  }
  
  try {
    return await analyzeTextProtected(prompt, file);
  } catch (err) {
    return analyzeTextPublic(prompt, file);
  }
}

export async function analyzeTextBatch(prompts) {
  if (!Array.isArray(prompts) || prompts.length === 0) {
    throw new Error('Prompts must be a non-empty array');
  }

  return Promise.allSettled(
    prompts.map(prompt => analyzeText(prompt))
  ).then(results => results.map(result => ({
    ok: result.status === 'fulfilled',
    data: result.value,
    error: result.reason?.message,
  })));
}
