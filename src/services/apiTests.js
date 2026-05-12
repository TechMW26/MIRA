/**
 * API Testing Utility
 * Run these tests from browser console to verify API integration
 */

import { 
  checkHealth, 
  analyzeTextPublic, 
  analyzeTextProtected, 
  analyzeText 
} from './textAnalysis.js';
import { 
  analyzeImage, 
  analyzeImageProtected, 
  analyzeImagePublic 
} from './imageAnalysis.js';

/**
 * Test health endpoint
 */
export async function testHealthEndpoint() {
  console.log('🔍 Testing Health Endpoint...');
  try {
    const result = await checkHealth();
    if (result.ok) {
      console.log('✅ Health Check PASSED', result);
      return true;
    } else {
      console.error('❌ Health Check FAILED', result);
      return false;
    }
  } catch (error) {
    console.error('❌ Health Check ERROR:', error.message);
    return false;
  }
}

/**
 * Test public text analysis
 */
export async function testPublicTextAnalysis() {
  console.log('🔍 Testing Public Text Analysis...');
  try {
    const result = await analyzeTextPublic('What is artificial intelligence?');
    if (result?.result) {
      console.log('✅ Public Text Analysis PASSED');
      console.log('Response:', result.result);
      return true;
    } else {
      console.error('❌ Public Text Analysis FAILED - No result');
      console.log('Response:', result);
      return false;
    }
  } catch (error) {
    console.error('❌ Public Text Analysis ERROR:', error.message);
    return false;
  }
}

/**
 * Test protected text analysis
 */
export async function testProtectedTextAnalysis() {
  console.log('🔍 Testing Protected Text Analysis...');
  try {
    const result = await analyzeTextProtected('Explain quantum computing');
    if (result?.result) {
      console.log('✅ Protected Text Analysis PASSED');
      console.log('Response:', result.result);
      return true;
    } else {
      console.error('❌ Protected Text Analysis FAILED - No result');
      console.log('Response:', result);
      return false;
    }
  } catch (error) {
    console.error('❌ Protected Text Analysis ERROR:', error.message);
    return false;
  }
}

/**
 * Test smart text analysis (with fallback)
 */
export async function testSmartTextAnalysis() {
  console.log('🔍 Testing Smart Text Analysis (with fallback)...');
  try {
    const result = await analyzeText('What is machine learning?');
    if (result?.result) {
      console.log('✅ Smart Text Analysis PASSED');
      console.log('Response:', result.result);
      return true;
    } else {
      console.error('❌ Smart Text Analysis FAILED - No result');
      console.log('Response:', result);
      return false;
    }
  } catch (error) {
    console.error('❌ Smart Text Analysis ERROR:', error.message);
    return false;
  }
}

/**
 * Test image analysis (requires base64 image)
 */
export async function testImageAnalysis(base64Image, mimeType = 'image/jpeg') {
  if (!base64Image) {
    console.error('❌ Image Analysis - No base64 image provided');
    console.log('Usage: testImageAnalysis(base64String, mimeType)');
    return false;
  }

  console.log('🔍 Testing Image Analysis...');
  try {
    const result = await analyzeImage('Describe what you see in this image', base64Image, mimeType);
    if (result?.result) {
      console.log('✅ Image Analysis PASSED');
      console.log('Response:', result.result);
      return true;
    } else {
      console.error('❌ Image Analysis FAILED - No result');
      console.log('Response:', result);
      return false;
    }
  } catch (error) {
    console.error('❌ Image Analysis ERROR:', error.message);
    return false;
  }
}

/**
 * Run all tests
 */
export async function runAllTests(base64Image = null) {
  console.log('🚀 Starting API Integration Tests...\n');
  
  const results = {
    health: await testHealthEndpoint(),
    publicText: await testPublicTextAnalysis(),
    protectedText: await testProtectedTextAnalysis(),
    smartText: await testSmartTextAnalysis(),
    image: base64Image ? await testImageAnalysis(base64Image) : null,
  };

  console.log('\n📊 Test Results Summary:');
  console.log('Health Endpoint:', results.health ? '✅ PASS' : '❌ FAIL');
  console.log('Public Text Analysis:', results.publicText ? '✅ PASS' : '❌ FAIL');
  console.log('Protected Text Analysis:', results.protectedText ? '✅ PASS' : '❌ FAIL');
  console.log('Smart Text Analysis:', results.smartText ? '✅ PASS' : '❌ FAIL');
  if (results.image !== null) {
    console.log('Image Analysis:', results.image ? '✅ PASS' : '❌ FAIL');
  }

  const passed = Object.values(results).filter(r => r === true).length;
  const total = Object.values(results).filter(r => r !== null).length;
  console.log(`\n📈 Total: ${passed}/${total} tests passed\n`);

  return results;
}

/**
 * Quick test from console
 * Usage in browser console:
 * 
 * import { runAllTests } from './services/apiTests.js';
 * await runAllTests();
 * 
 * Or for quick individual tests:
 * 
 * import { testHealthEndpoint } from './services/apiTests.js';
 * await testHealthEndpoint();
 */
export async function quickTest() {
  return runAllTests();
}

// Export all test functions for easy access
export const API_TESTS = {
  health: testHealthEndpoint,
  publicText: testPublicTextAnalysis,
  protectedText: testProtectedTextAnalysis,
  smartText: testSmartTextAnalysis,
  image: testImageAnalysis,
  runAll: runAllTests,
  quick: quickTest,
};

console.log('✅ API Test utilities loaded. Use window.API_TESTS to access tests.');
