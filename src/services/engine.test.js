import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isFactBasedQuestion,
  needsFreshInformation,
  processQuery,
  shouldUseModelThinking,
} from './engine.js';

test('requires web validation for fact-based questions, including conversational wrappers', () => {
  assert.equal(processQuery('Explain how gravity works').needsSearch, true);
  assert.equal(processQuery('What does recursion mean?').needsSearch, true);
  assert.equal(processQuery('Okay can you let me know what an algae tree is?').needsSearch, true);
  assert.equal(processQuery('Is giant kelp an algae?').needsSearch, true);
  assert.equal(isFactBasedQuestion('Could you please tell me who founded Anthropic?'), true);
});

test('keeps assistant identity and capability questions out of web retrieval', () => {
  assert.equal(processQuery('Tell me something about yourself!').needsSearch, false);
  assert.equal(processQuery('Introduce yourself').needsSearch, false);
  assert.equal(processQuery('What can you do?').needsSearch, false);
});

test('routes current, explicit, and high-stakes facts to search', () => {
  assert.equal(processQuery('What is the latest Bitcoin price?').needsSearch, true);
  assert.equal(processQuery('Search the web for MIRA release notes').needsSearch, true);
  assert.equal(processQuery('What are the current visa regulations for India?').needsSearch, true);
  assert.equal(processQuery('इंटरनेट पर खोजो कि आज बिटकॉइन की कीमत क्या है').needsSearch, true);
  assert.equal(processQuery('Busca en internet las noticias actuales').needsSearch, true);
  assert.equal(processQuery('在网上搜索今天的新闻').needsSearch, true);
  assert.equal(processQuery('ابحث في الإنترنت عن أحدث الأخبار').needsSearch, true);
});

test('identifies requests that require newest-first evidence', () => {
  assert.equal(needsFreshInformation('What is the latest release?'), true);
  assert.equal(needsFreshInformation('Explain the release process'), false);
  assert.equal(needsFreshInformation('आज की ताज़ा खबर क्या है?'), true);
  assert.equal(needsFreshInformation('最新ニュースを調べて'), true);
});

test('routes sufficiently specific niche topics to search', () => {
  assert.equal(processQuery('Tell me about AlgaeTree BioUrban').needsSearch, true);
  assert.equal(processQuery('Tell me something about the Algae tree').needsSearch, true);
  assert.equal(processQuery('What is an algae tree?').needsSearch, true);
});

test('does not expose model-routing metadata', () => {
  assert.equal('model' in processQuery('Hello there'), false);
  assert.equal('model' in processQuery('Build a React component'), false);
});

test('keeps greetings and ordinary conversation out of media generation', () => {
  assert.equal(processQuery('Hey').classification.intent, 'general');
  assert.equal(processQuery('Hello there').interpretation.imageIntent, false);
  assert.equal(processQuery('How are you?').interpretation.videoIntent, false);
  assert.equal(processQuery('Please generate an image of an elephant').interpretation.imageIntent, true);
});

test('does not turn creative, transformation, calculation, or implementation work into web searches', () => {
  assert.equal(processQuery('Write a poem about gravity').needsSearch, false);
  assert.equal(processQuery('Translate this sentence into Hindi').needsSearch, false);
  assert.equal(processQuery('Calculate 37 * 42').needsSearch, false);
  assert.equal(processQuery('Build a React component for a profile card').needsSearch, false);
});

test('uses reasoning only when request complexity justifies its latency', () => {
  assert.equal(shouldUseModelThinking({ complexity: 'low' }), false);
  assert.equal(shouldUseModelThinking({ complexity: 'medium' }), true);
  assert.equal(shouldUseModelThinking({ complexity: 'low', hasAttachments: true }), true);
  assert.equal(shouldUseModelThinking({ complexity: 'low', document: true }), true);
});
