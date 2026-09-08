import test from 'node:test';
import assert from 'node:assert/strict';
import providers from '../../desktop/aiProviders.cjs';

test('desktop provider preserves long input, answers and reasoning', async () => {
  const content = 'Long response detail.\n'.repeat(6000) + 'FINAL_DETAIL';
  const result = await providers.requestDeepSeekChat({
    apiKey:'test', messages:[{role:'user',content}],
    fetchImpl:async (_, options) => {
      assert.equal(JSON.parse(options.body).messages[0].content, content);
      return Response.json({choices:[{message:{content,reasoning_content:content}}]});
    },
  });
  assert.equal(result.answer, content);
  assert.equal(result.thinking, content);
});
