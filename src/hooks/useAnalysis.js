/**
 * React Hook for API Analysis
 * Provides easy access to text and image analysis APIs
 */

import { useState, useCallback } from 'react';
import { analyzeText, analyzeTextPublic, analyzeTextProtected } from '../services/textAnalysis.js';
import { analyzeImage } from '../services/imageAnalysis.js';

export function useAnalysis() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  /**
   * Analyze text
   * @param {string} prompt - Text to analyze
   * @param {boolean} usePublic - Force public endpoint
   */
  const analyzeTextAsync = useCallback(async (prompt, usePublic = false) => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = usePublic
        ? await analyzeTextPublic(prompt)
        : await analyzeText(prompt);
      
      setResult(response.result);
      return response;
    } catch (err) {
      const errorMsg = err.message || 'Failed to analyze text';
      setError(errorMsg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Analyze image
   * @param {string} prompt - Analysis prompt
   * @param {string|File} image - Base64 string or File object
   * @param {string} mimeType - Image MIME type
   */
  const analyzeImageAsync = useCallback(async (prompt, image, mimeType = 'image/jpeg') => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await analyzeImage(prompt, image, mimeType);
      setResult(response.result);
      return response;
    } catch (err) {
      const errorMsg = err.message || 'Failed to analyze image';
      setError(errorMsg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Clear state
   */
  const reset = useCallback(() => {
    setLoading(false);
    setError(null);
    setResult(null);
  }, []);

  return {
    loading,
    error,
    result,
    analyzeText: analyzeTextAsync,
    analyzeImage: analyzeImageAsync,
    reset,
  };
}

/**
 * Example Usage in a Component:
 * 
 * function MyAnalysisComponent() {
 *   const { loading, error, result, analyzeText } = useAnalysis();
 * 
 *   const handleAnalyze = async (prompt) => {
 *     try {
 *       await analyzeText(prompt);
 *     } catch (err) {
 *       console.error('Analysis failed:', err);
 *     }
 *   };
 * 
 *   return (
 *     <div>
 *       <input onChange={(e) => setPrompt(e.target.value)} />
 *       <button onClick={() => handleAnalyze(prompt)} disabled={loading}>
 *         {loading ? 'Analyzing...' : 'Analyze'}
 *       </button>
 *       {error && <div style={{ color: 'red' }}>{error}</div>}
 *       {result && <div>{result}</div>}
 *     </div>
 *   );
 * }
 */
