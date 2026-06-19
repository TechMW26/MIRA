import { useState, useEffect, useRef } from 'react';
import { Calculator, Code2, Cloud, DollarSign, TrendingUp, X, Play, Loader, MessageSquareShare } from 'lucide-react';

function PublishButton({ onClick, disabled = false }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-medium disabled:opacity-40"
      style={{ background: 'var(--hover-bg)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
    >
      <MessageSquareShare size={12} /> Send result to chat
    </button>
  );
}

function CalculatorTool({ onPublish }) {
  const [expr, setExpr] = useState('');
  const [result, setResult] = useState('');

  function calculate() {
    try {
      // Safe eval using Function
      const res = new Function('return ' + expr.replace(/[^0-9+\-*/().%\s^]/g, ''))();
      setResult(String(res));
    } catch {
      setResult('Error');
    }
  }

  const btns = ['7','8','9','/','4','5','6','*','1','2','3','-','0','.','=','+','C','(',')','^'];

  function press(b) {
    if (b === 'C') { setExpr(''); setResult(''); return; }
    if (b === '=') { calculate(); return; }
    if (b === '^') { setExpr(e => e + '**'); return; }
    setExpr(e => e + b);
  }

  return (
    <div className="p-3">
      <div className="rounded-xl p-3 mb-3 text-right" style={{ background: 'var(--hover-bg)', border: '1px solid var(--border)' }}>
        <div className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>{expr || '0'}</div>
        <div className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{result || '0'}</div>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {btns.map(b => (
          <button key={b} onClick={() => press(b)}
            className="py-2.5 rounded-xl text-sm font-medium transition-all hover:opacity-80 active:scale-95"
            style={{ background: b === '=' ? 'var(--accent)' : 'var(--glass-bg)', color: b === '=' ? '#fff' : 'var(--text-primary)', border: '1px solid var(--border)' }}>
            {b}
          </button>
        ))}
      </div>
      <div className="mt-3">
        <PublishButton
          disabled={!result}
          onClick={() => onPublish('Calculator', `Expression: ${expr}\nResult: ${result}`)}
        />
      </div>
    </div>
  );
}

function CodeRunnerTool({ onPublish }) {
  const [code, setCode] = useState('// Write JavaScript here\nconsole.log("Hello from MIRA!");\n\n// Try: Math.random(), Date.now(), etc.');
  const [output, setOutput] = useState('');
  const [running, setRunning] = useState(false);
  const iframeRef = useRef(null);
  const runIdRef = useRef(0);

  useEffect(() => {
    function handleMessage(e) {
      const data = e.data;
      if (!data || data.__mira !== 'code-runner') return;
      if (data.runId !== runIdRef.current) return;
      if (data.type === 'result') {
        setOutput(data.logs.length ? data.logs.join('\n') : '(no output)');
        setRunning(false);
      } else if (data.type === 'error') {
        setOutput('Error: ' + data.message);
        setRunning(false);
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  function run() {
    setRunning(true);
    setOutput('');
    const runId = ++runIdRef.current;

    // Build a sandboxed iframe document that executes the user code in isolation.
    // The sandbox attribute uses only allow-scripts (NO allow-same-origin) so the
    // iframe runs in a null origin without access to parent DOM, cookies, storage, etc.
    const runner = `
      <!doctype html><html><head><meta charset="utf-8"></head><body><script>
      (function(){
        var logs = [];
        var fmt = function(a){ try { return typeof a === 'string' ? a : JSON.stringify(a); } catch(e){ return String(a); } };
        var send = function(msg){ try { parent.postMessage(Object.assign({__mira:'code-runner', runId:${runId}}, msg), '*'); } catch(e){} };
        var sandboxConsole = {
          log: function(){ logs.push(Array.prototype.map.call(arguments, fmt).join(' ')); },
          warn: function(){ logs.push('WARN: ' + Array.prototype.map.call(arguments, fmt).join(' ')); },
          error: function(){ logs.push('ERROR: ' + Array.prototype.map.call(arguments, fmt).join(' ')); },
          info: function(){ logs.push(Array.prototype.map.call(arguments, fmt).join(' ')); },
        };
        var timer = setTimeout(function(){ send({ type:'error', message:'Execution timed out (3s)' }); }, 3000);
        try {
          (new Function('console', ${JSON.stringify(code)}))(sandboxConsole);
          clearTimeout(timer);
          send({ type:'result', logs: logs });
        } catch(e) {
          clearTimeout(timer);
          send({ type:'error', message: (e && e.message) ? e.message : String(e) });
        }
      })();
      </script></body></html>
    `;

    if (iframeRef.current) {
      iframeRef.current.srcdoc = runner;
    }

    // Hard fail-safe in case the iframe never reports back.
    setTimeout(() => {
      if (runIdRef.current === runId && running) {
        setRunning(false);
        setOutput(prev => prev || 'Error: Execution did not return.');
      }
    }, 5000);
  }

  return (
    <div className="p-3 space-y-2">
      <textarea value={code} onChange={e => setCode(e.target.value)} rows={8}
        className="w-full text-xs px-3 py-2 rounded-xl outline-none resize-none font-mono"
        style={{ background: 'var(--hover-bg)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
      <button onClick={run} disabled={running}
        className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-medium"
        style={{ background: 'var(--accent)', color: '#fff' }}>
        {running ? <Loader size={12} className="animate-spin" /> : <Play size={12} />} Run
      </button>
      {output && (
        <pre className="text-xs p-3 rounded-xl overflow-auto max-h-32"
          style={{ background: 'var(--hover-bg)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
          {output}
        </pre>
      )}
      <PublishButton
        disabled={!output}
        onClick={() => onPublish('Code Runner', `Code:\n\`\`\`javascript\n${code}\n\`\`\`\n\nExecution output:\n\`\`\`text\n${output}\n\`\`\``)}
      />
      <iframe ref={iframeRef} title="code-runner-sandbox" sandbox="allow-scripts"
        style={{ display: 'none' }} aria-hidden="true" />
    </div>
  );
}

function WeatherTool({ onPublish }) {
  const [city, setCity] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function fetch_weather() {
    if (!city.trim()) return;
    setLoading(true); setError(''); setData(null);
    try {
      const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`);
      if (!res.ok) throw new Error('City not found');
      const d = await res.json();
      const cur = d.current_condition[0];
      setData({
        temp: cur.temp_C,
        feels: cur.FeelsLikeC,
        desc: cur.weatherDesc[0].value,
        humidity: cur.humidity,
        wind: cur.windspeedKmph,
        location: d.nearest_area[0].areaName[0].value + ', ' + d.nearest_area[0].country[0].value,
      });
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  return (
    <div className="p-3 space-y-3">
      <div className="flex gap-2">
        <input value={city} onChange={e => setCity(e.target.value)} onKeyDown={e => e.key === 'Enter' && fetch_weather()}
          placeholder="Enter city name..." className="flex-1 text-xs px-3 py-2 rounded-xl outline-none"
          style={{ background: 'var(--hover-bg)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
        <button onClick={fetch_weather} disabled={loading}
          className="px-3 py-2 rounded-xl text-xs font-medium" style={{ background: 'var(--accent)', color: '#fff' }}>
          {loading ? <Loader size={12} className="animate-spin" /> : 'Go'}
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {data && (
        <div className="rounded-xl p-4 space-y-2" style={{ background: 'var(--glass-bg)', border: '1px solid var(--border)' }}>
          <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{data.location}</p>
          <div className="flex items-end gap-2">
            <span className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>{data.temp}°C</span>
            <span className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>Feels {data.feels}°C</span>
          </div>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{data.desc}</p>
          <div className="flex gap-4 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            <span>💧 {data.humidity}%</span>
            <span>💨 {data.wind} km/h</span>
          </div>
        </div>
      )}
      <PublishButton
        disabled={!data && !error}
        onClick={() => onPublish(
          'Weather',
          error
            ? `Location requested: ${city}\nError: ${error}`
            : `Location: ${data.location}\nTemperature: ${data.temp}°C\nFeels like: ${data.feels}°C\nConditions: ${data.desc}\nHumidity: ${data.humidity}%\nWind: ${data.wind} km/h`,
        )}
      />
    </div>
  );
}

function CurrencyTool({ onPublish }) {
  const [amount, setAmount] = useState('1');
  const [from, setFrom] = useState('USD');
  const [to, setTo] = useState('EUR');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);

  const currencies = ['USD','EUR','GBP','JPY','INR','CAD','AUD','CHF','CNY','BRL','MXN','SGD','AED','SAR','KRW'];

  async function convert() {
    setLoading(true);
    try {
      const res = await fetch(`https://api.frankfurter.app/latest?amount=${amount}&from=${from}&to=${to}`);
      const d = await res.json();
      setResult(`${amount} ${from} = ${d.rates[to]?.toFixed(4)} ${to}`);
    } catch { setResult('Conversion failed'); }
    setLoading(false);
  }

  return (
    <div className="p-3 space-y-3">
      <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
        className="w-full text-xs px-3 py-2 rounded-xl outline-none"
        style={{ background: 'var(--hover-bg)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
      <div className="flex gap-2">
        <select value={from} onChange={e => setFrom(e.target.value)} className="flex-1 text-xs px-2 py-2 rounded-xl outline-none"
          style={{ background: 'var(--hover-bg)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
          {currencies.map(c => <option key={c}>{c}</option>)}
        </select>
        <span className="self-center text-xs" style={{ color: 'var(--text-tertiary)' }}>→</span>
        <select value={to} onChange={e => setTo(e.target.value)} className="flex-1 text-xs px-2 py-2 rounded-xl outline-none"
          style={{ background: 'var(--hover-bg)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
          {currencies.map(c => <option key={c}>{c}</option>)}
        </select>
      </div>
      <button onClick={convert} disabled={loading}
        className="w-full py-2 rounded-xl text-xs font-medium" style={{ background: 'var(--accent)', color: '#fff' }}>
        {loading ? <Loader size={12} className="animate-spin inline" /> : 'Convert'}
      </button>
      {result && <p className="text-sm font-semibold text-center" style={{ color: 'var(--text-primary)' }}>{result}</p>}
      <PublishButton disabled={!result} onClick={() => onPublish('Currency Converter', result)} />
    </div>
  );
}

const TOOLS = [
  { id: 'calc', label: 'Calculator', icon: Calculator, component: CalculatorTool },
  { id: 'code', label: 'Code Runner', icon: Code2, component: CodeRunnerTool },
  { id: 'weather', label: 'Weather', icon: Cloud, component: WeatherTool },
  { id: 'currency', label: 'Currency', icon: DollarSign, component: CurrencyTool },
];

export default function ToolsPanel({ onClose, onPublish }) {
  const [activeTool, setActiveTool] = useState('calc');
  const Tool = TOOLS.find(t => t.id === activeTool)?.component;

  return (
    <div className="flex flex-col h-full w-full">
      <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
        <TrendingUp size={13} style={{ color: 'var(--accent)' }} />
        <span className="text-xs font-semibold flex-1" style={{ color: 'var(--text-primary)' }}>Tools</span>
        <button onClick={onClose} className="p-1 rounded hover:opacity-70"><X size={13} style={{ color: 'var(--text-tertiary)' }} /></button>
      </div>

      <div className="flex gap-1 p-2 flex-shrink-0 overflow-x-auto" style={{ borderBottom: '1px solid var(--border)' }}>
        {TOOLS.map(t => (
          <button key={t.id} onClick={() => setActiveTool(t.id)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium whitespace-nowrap transition-all flex-shrink-0"
            style={{ background: activeTool === t.id ? 'var(--accent)' : 'var(--hover-bg)', color: activeTool === t.id ? '#fff' : 'var(--text-secondary)' }}>
            <t.icon size={11} />{t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {Tool && <Tool onPublish={onPublish} />}
      </div>
    </div>
  );
}
