import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgentTask, extractTaskClarification, extractAgentTaskAnswer} from './agentTask.js';
import {resolveClarificationReply, clarificationReplyContext} from './clarification.js';

test('assumptions reply resumes the saved task without repeating completed work', async () => {
  let step = 0;
  const first = await runAgentTask({goal:'Plan a workshop', generate:async(_, options)=>{
    if(options.phase==='planning')return JSON.stringify([{title:'Constraints',instruction:'Review constraints',tool:'reason'},{title:'Schedule',instruction:'Prepare schedule',tool:'reason'}]);
    return ++step === 1 ? 'Confirmed: online only, 20 attendees.' : JSON.stringify({questions:['Which weekday and budget?']});
  }});
  const saved = JSON.parse(JSON.stringify(extractTaskClarification(first)));
  const history = [{role:'user',content:'Plan a workshop'},{role:'assistant',clarification:saved}];
  const pending = resolveClarificationReply(history,'Use reasonable assumptions');
  assert.equal(pending.task,true);
  assert.equal(pending.goal,'Plan a workshop');
  const phases=[];
  const output=await runAgentTask({goal:pending.goal,checkpoint:pending.checkpoint,
    context:clarificationReplyContext(pending,'Use reasonable assumptions'),onPhase:p=>phases.push(p),
    generate:async(prompt, options)=>{
      assert.notEqual(options.phase,'planning');
      assert.match(prompt,/Use reasonable assumptions/);
      assert.match(prompt,/online only/);
      if(options.phase==='executing') { assert.match(prompt,/Current step: Schedule/); return 'Assume Tuesday and a modest budget.'; }
      return 'Workshop plan: online on Tuesday for 20 attendees. Budget is an assumption.';
    }});
  assert.match(extractAgentTaskAnswer(output),/Tuesday/);
  assert.equal(phases.filter(p=>p.phase==='executing').length,1);
  assert.equal(phases.filter(p=>p.phase==='step-completed').length,2);
});

test('a question before planning retains task identity across persistence', async()=>{
  const first=await runAgentTask({goal:'Plan a workshop',generate:async()=>JSON.stringify({questions:['Who is attending?']})});
  const pending=extractTaskClarification(first);
  assert.equal(pending.task,true);
  assert.equal(pending.checkpoint,undefined);
  const output=await runAgentTask({goal:pending.goal,context:clarificationReplyContext(pending,'20 teachers'),generate:async(prompt,options)=>{
    assert.match(prompt,/20 teachers/);
    return options.phase==='planning' ? JSON.stringify([{title:'Schedule',instruction:'Plan session',tool:'reason'}]) : 'Workshop plan for 20 teachers: introductions then practice.';
  }});
  assert.match(extractAgentTaskAnswer(output),/20 teachers/);
});

test('cancellation and explicit topic changes do not resume a pending task',()=>{
  const history=[{role:'assistant',clarification:{goal:'Plan a workshop',task:true,questions:['Budget?']}}];
  for(const reply of ['Cancel this task','Never mind','New topic: explain photosynthesis','Ignore the previous task'])assert.equal(resolveClarificationReply(history,reply),null);
  assert.equal(resolveClarificationReply(history,'500 dollars').goal,'Plan a workshop');
  assert.equal(resolveClarificationReply([], 'Use reasonable assumptions'),null);
});
