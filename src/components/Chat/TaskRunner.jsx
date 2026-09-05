import { useRef, useState } from 'react';
import { X, Play, CheckCircle2, Circle, Loader, ChevronDown, ChevronRight, Zap, Square } from 'lucide-react';
import { sendChatMessage, stopChatGeneration } from '../../services/api';

const STATUS = { pending: 'pending', running: 'running', retrying: 'retrying', done: 'done', error: 'error', stopped: 'stopped' };
const MAX_TASK_ATTEMPTS = 3;

function extractJsonArray(text) {
  const trimmed = String(text || '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  if (!trimmed) throw new Error('Task plan response was empty.');

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    if (parsed?.tasks && Array.isArray(parsed.tasks)) return parsed.tasks;
  } catch {}

  const start = trimmed.indexOf('[');
  if (start === -1) throw new Error('Could not find a JSON array in the task plan.');

  let depth = 0;
  for (let i = start; i < trimmed.length; i++) {
    if (trimmed[i] === '[') depth++;
    if (trimmed[i] === ']') {
      depth--;
      if (depth === 0) {
        const candidate = trimmed.slice(start, i + 1);
        try {
          const parsed = JSON.parse(candidate);
          if (Array.isArray(parsed)) return parsed;
        } catch {}
      }
    }
  }

  throw new Error('Could not parse task plan.');
}

const PHASE_LABELS = {
  'awaiting-input': 'Waiting for your reply',
  planning: 'Planning',
  executing: 'Executing',
  synthesizing: 'Synthesizing',
  responding: 'Writing response',
  completed: 'Completed',
  partial: 'Completed with issues',
  stopped: 'Stopped',
  error: 'Failed',
};

export default function TaskRunner({
  workflow,
  onStop,
  onClearWorkflow,
  onSendMessage,
  onClose,
}) {
  const [goal, setGoal] = useState('');
  const [tasks, setTasks] = useState([]);
  const [running, setRunning] = useState(false);
  const [expanded, setExpanded] = useState({});
  const [phase, setPhase] = useState('');
  const cancelledRef = useRef(false);

  async function runReasonedPrompt(prompt, onProgress) {
    let result = '';
    await sendChatMessage(
      [{ role: 'user', content: prompt }],
      (text) => {
        result = text;
        onProgress?.(text);
      },
      [],
      {
        think: true,
      },
    );
    return result;
  }

  async function runReasonedPromptWithRetry(prompt, onProgress, onRetry) {
    let lastError;
    for (let attempt = 1; attempt <= MAX_TASK_ATTEMPTS; attempt += 1) {
      try {
        const result = await runReasonedPrompt(prompt, onProgress);
        if (!String(result || '').trim()) throw new Error('The model returned an empty result.');
        return result;
      } catch (error) {
        if (cancelledRef.current || error?.name === 'AbortError') throw error;
        lastError = error;
        if (attempt >= MAX_TASK_ATTEMPTS) break;
        onRetry?.(attempt + 1, error);
        await new Promise((resolve) => setTimeout(resolve, Math.min(1200, 250 * (2 ** (attempt - 1)))));
      }
    }
    throw lastError || new Error('The task returned no result.');
  }

  function stopRunner() {
    cancelledRef.current = true;
    stopChatGeneration();
    setTasks((prev) => prev.map((task) => (
      task.status === STATUS.running || task.status === STATUS.retrying
        ? { ...task, status: STATUS.stopped }
        : task
    )));
    setRunning(false);
    setPhase('Stopped');
  }

  async function planTasks() {
    if (!goal.trim()) return;
    cancelledRef.current = false;
    setRunning(true);
    setTasks([]);
    setPhase('Planning');

    const planPrompt = `You are MIRA's planning engine. Analyze the goal, identify dependencies, and create 3-6 concrete sequential tasks. Each task must be independently executable by an AI reasoning agent. Reply ONLY with valid JSON in this schema: [{"title":"Task name","prompt":"Complete execution instruction including expected output"}]. Goal: ${goal}`;

    try {
      const planText = await runReasonedPromptWithRetry(planPrompt);
      if (cancelledRef.current) return;
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
      setPhase('Executing');
      await executeTasks(taskList);
    } catch (e) {
      if (cancelledRef.current || e?.name === 'AbortError') return;
      setTasks([{ id: 0, title: 'Planning failed', prompt: '', status: STATUS.error, result: e.message }]);
      setPhase('Planning failed');
    }
    setRunning(false);
  }

  async function executeTasks(taskList) {
    const results = [];
    for (let i = 0; i < taskList.length; i++) {
      if (cancelledRef.current) return;
      setTasks(prev => prev.map((task, index) => index === i ? { ...task, status: STATUS.running } : task));

      try {
        const context = results.length ? `\nPrevious completed results:\n${results.map((result, index) => `Step ${index + 1}:\n${result.slice(0, 2500)}`).join('\n\n')}\n\n` : '';
        const fullPrompt = `You are executing step ${i + 1} of ${taskList.length} for this goal: "${goal}".\n${context}Current task: ${taskList[i].prompt}\n\nReason carefully, then provide the useful completed result for this step.`;
        const result = await runReasonedPromptWithRetry(fullPrompt, (text) => {
          setTasks(prev => prev.map((task, index) => index === i ? { ...task, result: text } : task));
        }, (attempt, error) => {
          setTasks(prev => prev.map((task, index) => index === i ? {
            ...task,
            status: STATUS.retrying,
            attempt,
            retryError: error?.message || 'The step returned no result.',
            result: '',
          } : task));
        });
        if (cancelledRef.current) return;
        if (!result.trim()) throw new Error('The model returned an empty result.');

        results.push(result);
        setTasks(prev => prev.map((task, index) => index === i ? { ...task, status: STATUS.done, result } : task));
      } catch (e) {
        if (cancelledRef.current || e?.name === 'AbortError') return;
        results.push(`Error: ${e.message}`);
        setTasks(prev => prev.map((task, index) => index === i ? { ...task, status: STATUS.error, result: e.message } : task));
      }
    }

    setPhase('Completed');
    const summary = `The Task Runner completed this goal: "${goal}"\n\n${taskList.map((task, index) => `## Step ${index + 1}: ${task.title}\n${results[index] || 'No result.'}`).join('\n\n')}`;
    onSendMessage(summary, goal);
  }

  const statusIcon = (status) => {
    if (status === STATUS.done) return <CheckCircle2 size={14} style={{ color: '#10b981' }} />;
    if (status === STATUS.running || status === STATUS.retrying) return <Loader size={14} className="animate-spin" style={{ color: 'var(--accent)' }} />;
    if (status === STATUS.error) return <X size={14} style={{ color: '#ef4444' }} />;
    if (status === STATUS.stopped) return <Square size={12} style={{ color: 'var(--text-tertiary)' }} />;
    return <Circle size={14} style={{ color: 'var(--text-tertiary)' }} />;
  };

  if (workflow) {
    const completedSteps = workflow.steps.filter((task) => task.status === STATUS.done).length;
    const failedSteps = workflow.steps.filter((task) => task.status === STATUS.error).length;
    const finishedSteps = completedSteps + failedSteps;
    const totalSteps = workflow.steps.length;
    const progress = workflow.status === 'completed'
      ? 100
      : totalSteps > 0
        ? Math.round((finishedSteps / totalSteps) * 100)
      : (workflow.phase === 'planning' ? 8 : 0);
    const phaseLabel = PHASE_LABELS[workflow.phase] || 'Working';
    const isRunning = workflow.status === 'running';

    return (
      <div className="flex flex-col h-full w-full">
        <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
          <Zap size={13} style={{ color: 'var(--accent)' }} />
          <span className="text-xs font-semibold flex-1" style={{ color: 'var(--text-primary)' }}>Task Workflow</span>
          <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>{phaseLabel}</span>
          <button onClick={onClose} aria-label="Close task workflow" className="p-1 rounded hover:opacity-70"><X size={13} style={{ color: 'var(--text-tertiary)' }} /></button>
        </div>

        <div className="p-3 flex-shrink-0 space-y-3" style={{ borderBottom: '1px solid var(--border)' }}>
          <div>
            <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>Goal</div>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-primary)' }}>{workflow.goal}</p>
          </div>
          <div>
            <div className="flex items-center justify-between text-[10px] mb-1.5" style={{ color: 'var(--text-tertiary)' }}>
              <span>
                {totalSteps
                  ? `${completedSteps} of ${totalSteps} steps completed${failedSteps ? ` · ${failedSteps} failed` : ''}`
                  : phaseLabel}
              </span>
              <span>{Math.min(100, progress)}%</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--hover-bg)' }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, progress)}%`, background: 'var(--accent)' }}
              />
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2" aria-live="polite">
          {workflow.phase === 'planning' && workflow.steps.length === 0 && (
            <div className="rounded-xl p-3 flex items-center gap-2 text-xs" style={{ background: 'var(--hover-bg)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
              <Loader size={14} className="animate-spin" style={{ color: 'var(--accent)' }} />
              Building the execution plan…
            </div>
          )}
          {workflow.steps.map((task, index) => (
            <div key={task.id ?? index} className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
              <button
                onClick={() => setExpanded(value => ({ ...value, [index]: !value[index] }))}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
                style={{ background: task.status === STATUS.running ? 'var(--hover-bg)' : 'var(--glass-bg)' }}
                aria-expanded={Boolean(expanded[index])}
              >
                {statusIcon(task.status)}
                <span className="text-xs font-medium flex-1" style={{ color: 'var(--text-primary)' }}>
                  Step {index + 1}: {task.title}
                  {task.status === STATUS.retrying && (
                    <span className="ml-2 text-[10px] font-normal" style={{ color: 'var(--accent)' }}>
                      Retry {task.attempt || 2}/{MAX_TASK_ATTEMPTS}
                    </span>
                  )}
                </span>
                {(task.result || task.instruction) && (expanded[index] ? <ChevronDown size={11} /> : <ChevronRight size={11} />)}
              </button>
              {expanded[index] && (task.result || task.instruction) && (
                <div className="px-3 py-2 text-xs whitespace-pre-wrap" style={{ color: 'var(--text-secondary)', background: 'var(--bg-primary)', borderTop: '1px solid var(--border)' }}>
                  {task.result || task.instruction}
                </div>
              )}
            </div>
          ))}
          {workflow.phase === 'responding' && (
            <div className="rounded-xl p-3 flex items-center gap-2 text-xs" style={{ background: 'var(--hover-bg)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
              <Loader size={14} className="animate-spin" style={{ color: 'var(--accent)' }} />
              Preparing the final response in chat…
            </div>
          )}
          {workflow.error && (
            <div className="rounded-xl p-3 text-xs" style={{ border: '1px solid #ef444466', color: '#ef4444' }}>
              {workflow.error}
            </div>
          )}
        </div>

        <div className="p-3 flex-shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
          {workflow.status === 'awaiting-input' ? (
            <p role="status" className="text-xs" style={{ color: 'var(--text-primary)' }}>Reply to MIRA’s questions in the chat to continue.</p>
          ) : isRunning ? (
            <button
              onClick={onStop}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-medium transition-all hover:opacity-90"
              style={{ background: 'var(--hover-bg)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
            >
              <Square size={12} /> Stop workflow
            </button>
          ) : (
            <button
              onClick={onClearWorkflow}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-medium transition-all hover:opacity-90"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              <Play size={12} /> Start another task
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full">
      <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
        <Zap size={13} style={{ color: 'var(--accent)' }} />
        <span className="text-xs font-semibold flex-1" style={{ color: 'var(--text-primary)' }}>Task Runner</span>
        {phase && <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>{phase}</span>}
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
          onClick={running ? stopRunner : planTasks}
          disabled={!running && !goal.trim()}
          className="mt-2 w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-medium transition-all hover:opacity-90 disabled:opacity-50"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          {running ? <Square size={12} /> : <Play size={12} />}
          {running ? 'Stop Task' : 'Run Task'}
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
