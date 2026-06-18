import { useState } from 'react';
import { X, Play, CheckCircle2, Circle, Loader, ChevronDown, ChevronRight, Zap } from 'lucide-react';

const STATUS = { pending: 'pending', running: 'running', done: 'done', error: 'error' };

async function readSseText(res) {
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
    return await res.text().catch(() => '');
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

async function fetchChatPrompt(prompt) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      images: [],
      stream: true,
    }),
  });

  return await readSseText(res);
}

export default function TaskRunner({ onSendMessage, onClose }) {
  const [goal, setGoal] = useState('');
  const [tasks, setTasks] = useState([]);
  const [running, setRunning] = useState(false);
  const [expanded, setExpanded] = useState({});

  async function planTasks() {
    if (!goal.trim()) return;
    setRunning(true);
    setTasks([]);

    const planPrompt = `Break this goal into 3-6 concrete sequential tasks. Reply ONLY with a JSON array of task objects like: [{"title":"Task name","prompt":"Exact prompt to execute this task"}]. Goal: ${goal}`;

    try {
      const planText = await fetchChatPrompt(planPrompt);
      const parsed = extractJsonArray(planText);
      const taskList = parsed.map((task, index) => ({
        id: index,
        title: String(task.title || task.task || `Task ${index + 1}`),
        prompt: String(task.prompt || task.task || task.description || task.title || ''),
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
    onSendMessage(summary);
  }

  const statusIcon = (status) => {
    if (status === STATUS.done) return <CheckCircle2 size={14} style={{ color: '#10b981' }} />;
    if (status === STATUS.running) return <Loader size={14} className="animate-spin" style={{ color: 'var(--accent)' }} />;
    if (status === STATUS.error) return <X size={14} style={{ color: '#ef4444' }} />;
    return <Circle size={14} style={{ color: 'var(--text-tertiary)' }} />;
  };

  return (
    <div className="flex flex-col h-full w-full">
      <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
        <Zap size={13} style={{ color: 'var(--accent)' }} />
        <span className="text-xs font-semibold flex-1" style={{ color: 'var(--text-primary)' }}>Task Runner</span>
        <button onClick={onClose} className="p-1 rounded hover:opacity-70"><X size={13} style={{ color: 'var(--text-tertiary)' }} /></button>
      </div>

      <div className="p-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <textarea
          value={goal}
          onChange={event => setGoal(event.target.value)}
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
        {tasks.map((task, index) => (
          <div key={task.id} className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <button
              onClick={() => setExpanded(value => ({ ...value, [index]: !value[index] }))}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
              style={{ background: 'var(--glass-bg)' }}
            >
              {statusIcon(task.status)}
              <span className="text-xs font-medium flex-1" style={{ color: 'var(--text-primary)' }}>
                Step {index + 1}: {task.title}
              </span>
              {expanded[index] ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            </button>
            {expanded[index] && task.result && (
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
