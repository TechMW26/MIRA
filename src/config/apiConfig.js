/**
 * API Configuration
 * Switch between real and mock API endpoints
 */

// Set to true to use mock API (when real server is unavailable)
// Set to false to use real API
export const USE_MOCK_API = false;

// Import both implementations
import * as realApi from './textAnalysis.js';
import * as mockApi from './mockApi.js';

// Select which API to use
const apiImpl = USE_MOCK_API ? mockApi : realApi;

// Export unified interface
export const checkHealth = apiImpl.checkHealth;
export const analyzeText = apiImpl.analyzeText;
export const analyzeTextPublic = apiImpl.analyzeTextPublic;
export const analyzeTextProtected = apiImpl.analyzeTextProtected;
export const analyzeTextBatch = apiImpl.analyzeTextBatch;

export function isUsingMockAPI() {
  return USE_MOCK_API;
}

export function getApiStatus() {
  return {
    useMock: USE_MOCK_API,
    message: USE_MOCK_API ? '🔴 Using Mock API (Development Mode)' : '🟢 Using Real API'
  };
}

console.log(`[API Config] ${getApiStatus().message}`);
