import { useState } from 'react';
import { X, Play, CheckCircle2, Circle, Loader, ChevronDown, ChevronRight, Zap } from 'lucide-react';

const STATUS = { pending: 'pending', running: 'running', done: 'done', error: 'error' };

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
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: planPrompt }], images: [] }),
      });

      let planText = '';
      const reader = res.body?.getReader();
      if (reader) {
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          for (const line of chunk.split('\n')) {
            if (line.startsWith('data: ') && !line.includes('[DONE]')) {
              try { planText += JSON.parse(line.slice(6)).text || ''; } catch {}
            }
          }
        }
      } else {
        const data = await res.json();
        planText = data.result || '';
      }

      // Parse JSON from response
      const jsonMatch = planText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('Could not parse task plan');
      const parsed = JSON.parse(jsonMatch[0]);
      const taskList = parsed.map((t, i) => ({ id: i, title: t.title, prompt: t.prompt, status: STATUS.pending, result: '' }));
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
      setTasks(prev => prev.map((t, idx) => idx === i ? { ...t, status: STATUS.running } : t));

      try {
        // Build context from previous results
        const context = results.length ? `\nPrevious results:\n${results.map((r, j) => `Step ${j + 1}: ${r}`).join('\n')}\n\n` : '';
        const fullPrompt = context + taskList[i].prompt;

        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: [{ role: 'user', content: fullPrompt }], images: [] }),
        });

        let result = '';
        const reader = res.body?.getReader();
        if (reader) {
          const decoder = new TextDecoder();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value);
            for (const line of chunk.split('\n')) {
              if (line.startsWith('data: ') && !line.includes('[DONE]')) {
                try { result += JSON.parse(line.slice(6)).text || ''; } catch {}
              }
            }
          }
        } else {
          const data = await res.json();
          result = data.result || '';
        }

        results.push(result.slice(0, 500));
        setTasks(prev => prev.map((t, idx) => idx === i ? { ...t, status: STATUS.done, result } : t));
      } catch (e) {
        setTasks(prev => prev.map((t, idx) => idx === i ? { ...t, status: STATUS.error, result: e.message } : t));
      }
    }

    // Send final summary to chat
    const summary = `I completed the multi-step task: "${goal}"\n\nHere's a summary of all steps:\n${taskList.map((t, i) => `**Step ${i + 1}: ${t.title}**\n${results[i] || 'Error'}`).join('\n\n')}`;
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
          onChange={e => setGoal(e.target.value)}
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
        {tasks.map((task, i) => (
          <div key={task.id} className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <button
              onClick={() => setExpanded(e => ({ ...e, [i]: !e[i] }))}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
              style={{ background: 'var(--glass-bg)' }}
            >
              {statusIcon(task.status)}
              <span className="text-xs font-medium flex-1" style={{ color: 'var(--text-primary)' }}>
                Step {i + 1}: {task.title}
              </span>
              {expanded[i] ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            </button>
            {expanded[i] && task.result && (
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
