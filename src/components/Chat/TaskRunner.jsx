import { useState } from 'react';
import { X, Play, CheckCircle2, Circle, Loader, ChevronDown, ChevronRight, Zap } from 'lucide-react';
<<<<<<< HEAD
import { PUBLIC_INFERENCE_BASE_URL, PUBLIC_INFERENCE_APP_TOKEN } from '../../config/endpoints.js';

const STATUS = { pending: 'pending', running: 'running', done: 'done', error: 'error' };

async function readSseResponseText(res) {
=======

const STATUS = { pending: 'pending', running: 'running', done: 'done', error: 'error' };

async function readSseText(res) {
>>>>>>> 8c839060c0f2a4ead530ba0fdc44e0712b33d020
  if (!res.ok) {
    const errorPayload = await res.json().catch(() => ({}));
    throw new Error(errorPayload?.error || `API error ${res.status}`);
  }

  const contentType = String(res.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('application/json')) {
    const data = await res.json().catch(() => ({}));
    return String(data?.result || data?.text || data?.answer || '');
  }

  if (!res.body) {
<<<<<<< HEAD
    const data = await res.text().catch(() => '');
    return String(data || '');
=======
    return await res.text().catch(() => '');
>>>>>>> 8c839060c0f2a4ead530ba0fdc44e0712b33d020
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  const reader = res.body.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
<<<<<<< HEAD
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      if (line.includes('[DONE]')) continue;
      try {
        const payload = JSON.parse(line.slice(6));
        if (typeof payload?.text === 'string') text += payload.text;
      } catch {
        continue;
      }
    }
  }

  if (buffer.startsWith('data: ') && !buffer.includes('[DONE]')) {
    try {
      const payload = JSON.parse(buffer.slice(6));
      if (typeof payload?.text === 'string') text += payload.text;
    } catch {}
  }

=======
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const payload = JSON.parse(data);
        if (typeof payload?.text === 'string') text += payload.text;
      } catch {}
    }
  }

>>>>>>> 8c839060c0f2a4ead530ba0fdc44e0712b33d020
  return text;
}

function extractJsonArray(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('Task plan response was empty.');

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    if (parsed?.tasks && Array.isArray(parsed.tasks)) return parsed.tasks;
  } catch {}

  const start = text.indexOf('[');
  if (start === -1) throw new Error('Could not find a JSON array in the task plan.');

  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '[') depth++;
    if (text[i] === ']') {
      depth--;
      if (depth === 0) {
        const candidate = text.slice(start, i + 1);
        try {
          const parsed = JSON.parse(candidate);
          if (Array.isArray(parsed)) return parsed;
        } catch {}
      }
    }
  }

  throw new Error('Could not parse task plan.');
}

<<<<<<< HEAD
=======
async function fetchChatPrompt(prompt) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], images: [] }),
  });

  return await readSseText(res);
}

>>>>>>> 8c839060c0f2a4ead530ba0fdc44e0712b33d020
export default function TaskRunner({ onSendMessage, onClose }) {
  const [goal, setGoal] = useState('');
  const [tasks, setTasks] = useState([]);
  const [running, setRunning] = useState(false);
  const [expanded, setExpanded] = useState({});

<<<<<<< HEAD
  async function fetchInferencePrompt(prompt) {
    const baseUrl = PUBLIC_INFERENCE_BASE_URL || 'http://142.127.68.223:15166';
    const token = PUBLIC_INFERENCE_APP_TOKEN || 'f6d30c6778656de0ed82045a28ab2ff3';

    const formData = new FormData();
    formData.append('prompt', prompt);

    const res = await fetch(`${baseUrl}/public/analyze`, {
      method: 'POST',
      headers: { 'X-App-Token': token },
      body: formData,
    });

    return await readSseResponseText(res);
  }

=======
>>>>>>> 8c839060c0f2a4ead530ba0fdc44e0712b33d020
  async function planTasks() {
    if (!goal.trim()) return;
    setRunning(true);
    setTasks([]);

    const planPrompt = `Break this goal into 3-6 concrete sequential tasks. Reply ONLY with a JSON array of task objects like: [{"title":"Task name","prompt":"Exact prompt to execute this task"}]. Goal: ${goal}`;

    try {
<<<<<<< HEAD
      const planText = await fetchInferencePrompt(planPrompt);
      const parsed = extractJsonArray(planText);
      const taskList = parsed.map((t, i) => ({
        id: i,
        title: String(t.title || t.task || `Task ${i + 1}`),
        prompt: String(t.prompt || t.task || t.description || t.title || ``),
=======
      const planText = await fetchChatPrompt(planPrompt);
      const parsed = extractJsonArray(planText);
      const taskList = parsed.map((task, index) => ({
        id: index,
        title: String(task.title || task.task || `Task ${index + 1}`),
        prompt: String(task.prompt || task.task || task.description || task.title || ''),
>>>>>>> 8c839060c0f2a4ead530ba0fdc44e0712b33d020
        status: STATUS.pending,
        result: '',
      }));

      if (taskList.length === 0) {
        throw new Error('Task plan returned no tasks.');
      }

      setTasks(taskList);
      await executeTasks(taskList);
    } catch (e) {
      setTasks([{ id: 0, title: 'Planning failed', prompt: '', status: STATUS.error, result: e.message }]);
    }
    setRunning(false);
  }

  async function executeTasks(taskList) {
    const results = [];
    for (let i = 0; i < taskList.length; i++) {
<<<<<<< HEAD
      setTasks(prev => prev.map((t, idx) => idx === i ? { ...t, status: STATUS.running } : t));

      try {
        // Build context from previous results
        const context = results.length ? `\nPrevious results:\n${results.map((r, j) => `Step ${j + 1}: ${r}`).join('\n')}\n\n` : '';
        const fullPrompt = context + taskList[i].prompt;

        const result = await fetchInferencePrompt(fullPrompt);
        results.push(result.slice(0, 500));
        setTasks(prev => prev.map((t, idx) => idx === i ? { ...t, status: STATUS.done, result } : t));
      } catch (e) {
        setTasks(prev => prev.map((t, idx) => idx === i ? { ...t, status: STATUS.error, result: e.message } : t));
      }
    }

    // Send final summary to chat
    const summary = `I completed the multi-step task: "${goal}"\n\nHere's a summary of all steps:\n${taskList.map((t, i) => `**Step ${i + 1}: ${t.title}**\n${results[i] || 'Error'}`).join('\n\n')}`;
=======
      setTasks(prev => prev.map((task, index) => index === i ? { ...task, status: STATUS.running } : task));

      try {
        const context = results.length ? `\nPrevious results:\n${results.map((result, index) => `Step ${index + 1}: ${result}`).join('\n')}\n\n` : '';
        const fullPrompt = context + taskList[i].prompt;
        const result = await fetchChatPrompt(fullPrompt);

        results.push(result.slice(0, 500));
        setTasks(prev => prev.map((task, index) => index === i ? { ...task, status: STATUS.done, result } : task));
      } catch (e) {
        setTasks(prev => prev.map((task, index) => index === i ? { ...task, status: STATUS.error, result: e.message } : task));
      }
    }

    const summary = `I completed the multi-step task: "${goal}"\n\nHere's a summary of all steps:\n${taskList.map((task, index) => `**Step ${index + 1}: ${task.title}**\n${results[index] || 'Error'}`).join('\n\n')}`;
>>>>>>> 8c839060c0f2a4ead530ba0fdc44e0712b33d020
    onSendMessage(summary);
  }

  const statusIcon = (status) => {
    if (status === STATUS.done) return <CheckCircle2 size={14} style={{ color: '#10b981' }} />;
    if (status === STATUS.running) return <Loader size={14} className="animate-spin" style={{ color: 'var(--accent)' }} />;
    if (status === STATUS.error) return <X size={14} style={{ color: '#ef4444' }} />;
    return <Circle size={14} style={{ color: 'var(--text-tertiary)' }} />;
  };

  return (
<<<<<<< HEAD
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-primary)', borderLeft: '1px solid var(--border)' }}>
=======
    <div className="flex flex-col h-full w-full">
>>>>>>> 8c839060c0f2a4ead530ba0fdc44e0712b33d020
      <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
        <Zap size={13} style={{ color: 'var(--accent)' }} />
        <span className="text-xs font-semibold flex-1" style={{ color: 'var(--text-primary)' }}>Task Runner</span>
        <button onClick={onClose} className="p-1 rounded hover:opacity-70"><X size={13} style={{ color: 'var(--text-tertiary)' }} /></button>
      </div>

      <div className="p-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <textarea
          value={goal}
<<<<<<< HEAD
          onChange={e => setGoal(e.target.value)}
=======
          onChange={event => setGoal(event.target.value)}
>>>>>>> 8c839060c0f2a4ead530ba0fdc44e0712b33d020
          placeholder="Describe a complex goal... e.g. 'Research quantum computing, write a summary, create a presentation'"
          rows={3}
          className="w-full text-xs px-3 py-2 rounded-xl outline-none resize-none"
          style={{ background: 'var(--hover-bg)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
        />
        <button
          onClick={planTasks}
          disabled={running || !goal.trim()}
          className="mt-2 w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-medium transition-all hover:opacity-90 disabled:opacity-50"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          {running ? <Loader size={12} className="animate-spin" /> : <Play size={12} />}
          {running ? 'Running...' : 'Run Task'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {tasks.length === 0 && (
          <p className="text-xs text-center py-8" style={{ color: 'var(--text-tertiary)' }}>
            Enter a goal above and MIRA will break it into steps and execute each one automatically.
          </p>
        )}
<<<<<<< HEAD
        {tasks.map((task, i) => (
          <div key={task.id} className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <button
              onClick={() => setExpanded(e => ({ ...e, [i]: !e[i] }))}
=======
        {tasks.map((task, index) => (
          <div key={task.id} className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <button
              onClick={() => setExpanded(value => ({ ...value, [index]: !value[index] }))}
>>>>>>> 8c839060c0f2a4ead530ba0fdc44e0712b33d020
              className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
              style={{ background: 'var(--glass-bg)' }}
            >
              {statusIcon(task.status)}
              <span className="text-xs font-medium flex-1" style={{ color: 'var(--text-primary)' }}>
<<<<<<< HEAD
                Step {i + 1}: {task.title}
              </span>
              {expanded[i] ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            </button>
            {expanded[i] && task.result && (
=======
                Step {index + 1}: {task.title}
              </span>
              {expanded[index] ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            </button>
            {expanded[index] && task.result && (
>>>>>>> 8c839060c0f2a4ead530ba0fdc44e0712b33d020
              <div className="px-3 py-2 text-xs" style={{ color: 'var(--text-secondary)', background: 'var(--bg-primary)', borderTop: '1px solid var(--border)' }}>
                {task.result.slice(0, 400)}{task.result.length > 400 ? '...' : ''}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
