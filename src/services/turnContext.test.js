import test from 'node:test';
import assert from 'node:assert/strict';
import { selectTurnContext } from './turnContext.js';
import { runAgentTask } from './agentTask.js';

const history = [
  { role: 'user', content: 'Build a website for Nebula' },
  { role: 'assistant', content: '<html><style>body{color:red}</style>NEBULA ARTIFACT</html>' },
  { role: 'user', content: 'Tell me about yourself' },
  { role: 'assistant', content: 'I am MIRA.' },
];
test('a standalone workshop request does not inherit website code or identity answers', () => {
  assert.deepEqual(selectTurnContext('Can you help me plan a workshop please?', history), []);
});
test('explicit artifact references and short followups retain context', () => {
  for (const request of ['Please improve that page', 'Continue', 'What about accessibility?']) {
    assert.equal(selectTurnContext(request, history), history);
  }
});
test('same-subject requests select the related turn instead of the latest unrelated answer', () => {
  assert.deepEqual(selectTurnContext('Please explain the architecture of Nebula', history), history.slice(0, 2));
});
test('clarification replies retain the original task but explicit topic switches do not', () => {
  const pending = [...history, {role:'assistant', clarification:{questions:['What budget?']}}];
  assert.equal(selectTurnContext('Use a budget of 5000 dollars', pending), pending);
  assert.deepEqual(selectTurnContext('New topic: explain photosynthesis', pending), []);
});
test('failed HTML stays in task details but never reaches later reasoning or conclusion', async () => {
  const prompts = [];
  let execution = 0;
  const output = await runAgentTask({goal:'Plan a workshop',generate:async(prompt, options)=>{
    prompts.push({prompt,phase:options.phase});
    if(options.phase==='planning')return JSON.stringify([{title:'Review',instruction:'Review constraints',tool:'reason'},{title:'Schedule',instruction:'Prepare schedule',tool:'reason'}]);
    if(options.phase==='synthesizing')return 'Workshop plan: two sessions and a break.';
    return ++execution===1 ? {answer:'<html>REJECTED_NEBULA_ARTIFACT</html>',incomplete:true} : 'Use two sessions.';
  }});
  assert.match(output,/REJECTED_NEBULA_ARTIFACT/);
  for(const {prompt} of prompts.slice(2)) assert.doesNotMatch(prompt,/REJECTED_NEBULA_ARTIFACT/);
  assert.match(prompts.at(-1).prompt,/response was interrupted/);
});
