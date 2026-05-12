/**
 * Image Analysis Service
 * Handles image analysis via the protected API endpoint
 */

import {
  PROTECTED_INFERENCE_BASE_URL,
  PROTECTED_INFERENCE_API_KEY,
  PUBLIC_INFERENCE_BASE_URL,
  PUBLIC_INFERENCE_APP_TOKEN,
} from '../config/endpoints.js';

const TIMEOUT_MS = 60000; // 60 second timeout for image processing

/**
 * Convert base64 image to Blob
 * 
 * @param {string} base64 - Base64 encoded image string
 * @param {string} mimeType - MIME type of the image (e.g., 'image/jpeg')
 * @returns {Blob} Blob object
 */
function base64ToBlob(base64, mimeType = 'image/jpeg') {
  const sanitized = base64.includes(',') ? base64.split(',')[1] : base64;
  try {
    const bytes = Uint8Array.from(atob(sanitized), (c) => c.charCodeAt(0));
    return new Blob([bytes], { type: mimeType });
  } catch (error) {
    throw new Error(`Failed to decode base64 image: ${error.message}`);
  }
}

/**
 * Analyze image using PROTECTED endpoint
 * Requires: X-API-KEY header
 * 
 * @param {string} prompt - The analysis prompt
 * @param {string|File} image - Base64 string or File object
 * @param {string} mimeType - MIME type of the image
 * @returns {Promise<{result: string} | {error: string}>}
 */
export async function analyzeImageProtected(prompt, image, mimeType = 'image/jpeg') {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('Prompt must be a non-empty string');
  }

  if (!image) {
    throw new Error('Image is required for image analysis');
  }

  const formData = new FormData();
  formData.append('prompt', prompt);

  // Convert base64 to Blob if necessary
  if (typeof image === 'string') {
    const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
    const blob = base64ToBlob(image, mimeType);
    formData.append('file', blob, `image.${ext}`);
  } else {
    formData.append('file', image);
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
    console.error('Protected image analysis error:', error.message);
    throw error;
  }
}

/**
 * Analyze image using PUBLIC endpoint
 * Requires: X-App-Token header
 * 
 * @param {string} prompt - The analysis prompt
 * @param {string|File} image - Base64 string or File object
 * @param {string} mimeType - MIME type of the image
 * @returns {Promise<{result: string} | {error: string}>}
 */
export async function analyzeImagePublic(prompt, image, mimeType = 'image/jpeg') {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('Prompt must be a non-empty string');
  }

  if (!image) {
    throw new Error('Image is required for image analysis');
  }

  const formData = new FormData();
  formData.append('prompt', prompt);

  // Convert base64 to Blob if necessary
  if (typeof image === 'string') {
    const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
    const blob = base64ToBlob(image, mimeType);
    formData.append('file', blob, `image.${ext}`);
  } else {
    formData.append('file', image);
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
    console.error('Public image analysis error:', error.message);
    throw error;
  }
}

/**
 * Smart analyze function - tries protected first, falls back to public
 * 
 * @param {string} prompt - The analysis prompt
 * @param {string|File} image - Base64 string or File object
 * @param {string} mimeType - MIME type of the image
 * @param {boolean} usePublic - Force public endpoint
 * @returns {Promise<{result: string} | {error: string}>}
 */
export async function analyzeImage(prompt, image, mimeType = 'image/jpeg', usePublic = false) {
  if (usePublic) {
    return analyzeImagePublic(prompt, image, mimeType);
  }

  try {
    // Try protected endpoint first
    return await analyzeImageProtected(prompt, image, mimeType);
  } catch (protectedError) {
    console.warn('Protected image endpoint failed, trying public:', protectedError.message);
    try {
      // Fall back to public endpoint
      return await analyzeImagePublic(prompt, image, mimeType);
    } catch (publicError) {
      console.error('Both image endpoints failed:', publicError.message);
      throw new Error(`Image analysis failed: ${publicError.message}`);
    }
  }
}

/**
 * Batch analyze multiple images
 * 
 * @param {Array<{prompt: string, image: string|File, mimeType?: string}>} items - Array of image analysis items
 * @param {boolean} usePublic - Force public endpoint
 * @returns {Promise<Array>} Array of results
 */
export async function analyzeImageBatch(items, usePublic = false) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Items must be a non-empty array');
  }

  const results = await Promise.allSettled(
    items.map(({ prompt, image, mimeType = 'image/jpeg' }) =>
      analyzeImage(prompt, image, mimeType, usePublic)
    )
  );

  return results.map((result) => ({
    ok: result.status === 'fulfilled',
    data: result.value,
    error: result.reason?.message,
  }));
}
