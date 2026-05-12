/**
 * Text Analysis Service
 * Handles both public and protected text analysis API calls
 */

import {
  HEALTH_ENDPOINT,
  PROTECTED_INFERENCE_BASE_URL,
  PROTECTED_INFERENCE_API_KEY,
  PUBLIC_INFERENCE_BASE_URL,
  PUBLIC_INFERENCE_APP_TOKEN,
} from '../config/endpoints.js';

const TIMEOUT_MS = 30000; // 30 second timeout

/**
 * Check API health status
 */
export async function checkHealth() {
  try {
    const response = await fetch(HEALTH_ENDPOINT, {
      method: 'GET',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { ok: response.ok, status: response.status };
  } catch (error) {
    console.error('Health check failed:', error.message);
    return { ok: false, status: 503, error: error.message };
  }
}

/**
 * Analyze text using PUBLIC endpoint
 * Requires: X-App-Token header
 * 
 * @param {string} prompt - The text to analyze
 * @param {File|null} file - Optional file to include
 * @returns {Promise<{result: string} | {error: string}>}
 */
export async function analyzeTextPublic(prompt, file = null) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('Prompt must be a non-empty string');
  }

  const formData = new FormData();
  formData.append('prompt', prompt);

  if (file) {
    formData.append('file', file);
  }

  try {
    const response = await fetch(`${PUBLIC_INFERENCE_BASE_URL}/public/analyze`, {
      method: 'POST',
      headers: {
        'X-App-Token': PUBLIC_INFERENCE_APP_TOKEN,
      },
      body: formData,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data?.detail || data?.error || `API Error: ${response.status}`);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Public text analysis error:', error.message);
    throw error;
  }
}

/**
 * Analyze text using PROTECTED endpoint
 * Requires: X-API-KEY header
 * 
 * @param {string} prompt - The text to analyze
 * @param {File|null} file - Optional file to include
 * @returns {Promise<{result: string} | {error: string}>}
 */
export async function analyzeTextProtected(prompt, file = null) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('Prompt must be a non-empty string');
  }

  const formData = new FormData();
  formData.append('prompt', prompt);

  if (file) {
    formData.append('file', file);
  }

  try {
    const response = await fetch(`${PROTECTED_INFERENCE_BASE_URL}/v1/analyze`, {
      method: 'POST',
      headers: {
        'X-API-KEY': PROTECTED_INFERENCE_API_KEY,
      },
      body: formData,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data?.detail || data?.error || `API Error: ${response.status}`);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Protected text analysis error:', error.message);
    throw error;
  }
}

/**
 * Smart analyze function - tries protected first, falls back to public
 * 
 * @param {string} prompt - The text to analyze
 * @param {File|null} file - Optional file to include
 * @param {boolean} usePublic - Force public endpoint
 * @returns {Promise<{result: string} | {error: string}>}
 */
export async function analyzeText(prompt, file = null, usePublic = false) {
  if (usePublic) {
    return analyzeTextPublic(prompt, file);
  }

  try {
    // Try protected endpoint first
    return await analyzeTextProtected(prompt, file);
  } catch (protectedError) {
    console.warn('Protected endpoint failed, trying public:', protectedError.message);
    try {
      // Fall back to public endpoint
      return await analyzeTextPublic(prompt, file);
    } catch (publicError) {
      console.error('Both endpoints failed:', publicError.message);
      throw new Error(`Text analysis failed: ${publicError.message}`);
    }
  }
}

/**
 * Batch analyze multiple texts
 * 
 * @param {string[]} prompts - Array of texts to analyze
 * @param {boolean} usePublic - Force public endpoint
 * @returns {Promise<Array>} Array of results
 */
export async function analyzeTextBatch(prompts, usePublic = false) {
  if (!Array.isArray(prompts) || prompts.length === 0) {
    throw new Error('Prompts must be a non-empty array');
  }

  const results = await Promise.allSettled(
    prompts.map((prompt) => analyzeText(prompt, null, usePublic))
  );

  return results.map((result) => ({
    ok: result.status === 'fulfilled',
    data: result.value,
    error: result.reason?.message,
  }));
}
