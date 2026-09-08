import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClarification, formatClarification, pendingClarification, clarificationReplyContext } from './clarification.js';
import { runAgentTask, extractTaskClarification, extractAgentTaskAnswer } from './agentTask.js';
import { MODEL_TOOLS } from './modelTools.js';
import { filterToolsForRuntime, getAgentRuntimeCapabilities } from './agentCapabilities.js';
import { toolCallsToControl } from './api.js';
import { extractToolCall } from './toolControl.js';
import { sanitizeTools } from '../../api/chat.js';

test('question tool survives runtime filtering, server allowlist and native-call conversion', () => {
  const tools = filterToolsForRuntime(MODEL_TOOLS, getAgentRuntimeCapabilities({}));
  const questionTool = tools.find(tool => tool.function.name === 'user.ask');
  assert.ok(questionTool);
  assert.equal(sanitizeTools([questionTool]).length, 1);
  const control = toolCallsToControl([{function:{name:'user.ask',arguments:{questions:['What is the budget?']}}}]);
  assert.deepEqual(extractToolCall(control).arguments.questions,['What is the budget?']);
});

test('clarification validates questions, deduplicates and avoids empty cards', () => {
  assert.equal(parseClarification({questions:[null,{},' ']}),null);
  assert.equal(parseClarification('not json'),null);
  const request=parseClarification({questions:[' Budget? ','Budget?','Audience?','Deadline?','Style?']},'Plan an event');
  assert.equal(request.questions.length,3);
  assert.match(formatClarification(request),/1\. Budget\?/);
});

test('recognizes the live provider question-in-step format without executing it', async () => {
  const raw=JSON.stringify({title:'Determine event type',instruction:'What is the primary purpose of the event?',tool:'reason'});
  const phases=[];
  const output=await runAgentTask({goal:'Plan my event',generate:async()=>raw,onPhase:p=>phases.push(p.phase)});
  assert.deepEqual(phases,['planning','awaiting-input']);
  assert.deepEqual(extractTaskClarification(output).questions,['What is the primary purpose of the event?']);
  assert.equal(parseClarification({instruction:'Analyze the event requirements.',tool:'reason'}),null);
});

test('task pauses before search or execution when planning requires context', async () => {
  let calls=0; const phases=[];
  const output=await runAgentTask({goal:'Plan an event',requiresResearch:true,
    generate:async()=>{calls++;return JSON.stringify({questions:['What is the event location and budget?'],reason:'These determine the feasible plan.'});},
    search:async()=>{throw Error('Must not search before clarification');},onPhase:p=>phases.push(p.phase)});
  assert.equal(calls,1);
  assert.deepEqual(phases,['planning','awaiting-input']);
  assert.equal(extractTaskClarification(output).goal,'Plan an event');
  assert.match(extractAgentTaskAnswer(output),/location and budget/);
});

test('task preserves earlier results when a later step needs a user decision', async () => {
  let execution=0;
  const output=await runAgentTask({goal:'Plan a workshop',generate:async(_,options)=>{
    if(options.phase==='planning')return JSON.stringify([{title:'Review',instruction:'Review constraints',tool:'reason'},{title:'Schedule',instruction:'Schedule workshop',tool:'reason'}]);
    return ++execution===1 ? 'Confirmed constraint: online only.' : {answer:JSON.stringify({questions:['Which weekday should I use?']}),incomplete:false};
  }});
  const request=extractTaskClarification(output);
  assert.match(request.progress,/online only/);
  assert.match(clarificationReplyContext(request,'Tuesday'),/Tuesday/);
  assert.match(clarificationReplyContext(request,'Tuesday'),/online only/);
});

test('next reply retains the goal and questions; a later assistant turn clears pending context', () => {
  const request=parseClarification({questions:['What is the budget?']},'Plan the workshop');
  const history=[{role:'assistant',content:formatClarification(request),clarification:request}];
  const context=clarificationReplyContext(pendingClarification(history),'Choose a reasonable budget');
  assert.match(context,/Plan the workshop/);
  assert.match(context,/reasonable assumptions/);
  assert.match(context,/changes topic or cancels/);
  history.push({role:'assistant',content:'Here is the plan.'});
  assert.equal(pendingClarification(history),null);
});
