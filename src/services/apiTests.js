import { analyzeText } from './textAnalysis.js';
import { analyzeImage } from './imageAnalysis.js';

export async function testTextAnalysis() {
  console.log('Testing Ollama text analysis...');
  try {
    const result = await analyzeText('What is artificial intelligence?');
    const passed = Boolean(result?.result);
    console[passed ? 'log' : 'error'](passed ? 'Text analysis passed' : 'Text analysis returned no result', result);
    return passed;
  } catch (error) {
    console.error('Text analysis error:', error.message);
    return false;
  }
}

export async function testImageAnalysis(base64Image, mimeType = 'image/jpeg') {
  if (!base64Image) {
    console.error('Image analysis requires a base64 image.');
    return false;
  }

  try {
    const result = await analyzeImage('Describe what you see in this image.', base64Image, mimeType);
    const passed = Boolean(result?.result);
    console[passed ? 'log' : 'error'](passed ? 'Image analysis passed' : 'Image analysis returned no result', result);
    return passed;
  } catch (error) {
    console.error('Image analysis error:', error.message);
    return false;
  }
}

export async function runAllTests(base64Image = null) {
  const results = {
    text: await testTextAnalysis(),
    image: base64Image ? await testImageAnalysis(base64Image) : null,
  };
  console.log('Ollama API test results:', results);
  return results;
}

export async function quickTest() {
  return runAllTests();
}

export const API_TESTS = {
  text: testTextAnalysis,
  image: testImageAnalysis,
  runAll: runAllTests,
  quick: quickTest,
};