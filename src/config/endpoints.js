/**
 * AI Model Endpoint Configuration
<<<<<<< HEAD
 * 
=======
 *
>>>>>>> 8c839060c0f2a4ead530ba0fdc44e0712b33d020
 * All inference endpoints for MIRA AI assistant
 */

// Health Check Endpoint (GET)
export const HEALTH_ENDPOINT = import.meta.env.VITE_HEALTH_ENDPOINT || 'http://142.127.68.223:15166/health';

// Protected Endpoint - Requires API Key (for PRO/Safety users)
export const PROTECTED_INFERENCE_BASE_URL = import.meta.env.VITE_PROTECTED_INFERENCE_BASE_URL || 'http://142.127.68.223:15166';
export const PROTECTED_INFERENCE_API_KEY = import.meta.env.VITE_PROTECTED_INFERENCE_API_KEY || 'PRO_SAFETY_TOKEN_2026';

// Public Endpoint - Requires App Token (for regular users)
export const PUBLIC_INFERENCE_BASE_URL = import.meta.env.VITE_PUBLIC_INFERENCE_BASE_URL || 'http://142.127.68.223:15166';
export const PUBLIC_INFERENCE_APP_TOKEN = import.meta.env.VITE_PUBLIC_INFERENCE_APP_TOKEN || 'f6d30c6778656de0ed82045a28ab2ff3';

// Export combined config object
export const INFERENCE_ENDPOINTS = {
  health: HEALTH_ENDPOINT,
  protected: {
    baseUrl: PROTECTED_INFERENCE_BASE_URL,
    analyze: `${PROTECTED_INFERENCE_BASE_URL}/v1/analyze`,
    apiKey: PROTECTED_INFERENCE_API_KEY,
  },
  public: {
    baseUrl: PUBLIC_INFERENCE_BASE_URL,
    analyze: `${PUBLIC_INFERENCE_BASE_URL}/public/analyze`,
    appToken: PUBLIC_INFERENCE_APP_TOKEN,
  },
};

export default INFERENCE_ENDPOINTS;
