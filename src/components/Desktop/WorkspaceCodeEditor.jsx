import { useCallback, useMemo, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { autocompletion, startCompletion } from '@codemirror/autocomplete';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { syntaxTree } from '@codemirror/language';
import { keymap } from '@codemirror/view';
import { linter } from '@codemirror/lint';
import { oneDark } from '@codemirror/theme-one-dark';

function extensionForPath(path = '') {
  const extension = path.split('.').pop()?.toLowerCase();
  if (['js', 'jsx', 'mjs', 'cjs'].includes(extension)) return javascript({ jsx: extension === 'jsx' });
  if (['ts', 'tsx'].includes(extension)) return javascript({ jsx: extension === 'tsx', typescript: true });
  if (extension === 'json') return json();
  if (['css', 'scss', 'less'].includes(extension)) return css();
  if (['html', 'htm', 'vue', 'svelte'].includes(extension)) return html();
  if (extension === 'py') return python();
  if (['md', 'mdx'].includes(extension)) return markdown();
  return [];
}

function languageName(path = '') {
  return path.split('.').pop()?.toLowerCase() || 'text';
}

export default function WorkspaceCodeEditor({ path, value, onChange, onSave, onDiagnostics }) {
  const editorRef = useRef(null);
  const [aiBusy, setAiBusy] = useState(false);
  const lastDiagnosticsRef = useRef('');

  const syntaxLinter = useMemo(() => linter((view) => {
    const diagnostics = [];
    const cursor = syntaxTree(view.state).cursor();
    do {
      if (cursor.type.isError) {
        diagnostics.push({
          from: cursor.from,
          to: Math.max(cursor.from + 1, cursor.to),
          severity: 'error',
          message: 'Syntax error',
        });
      }
    } while (cursor.next());
    const diagnosticKey = `${path}:${diagnostics.length}`;
    if (lastDiagnosticsRef.current !== diagnosticKey) {
      lastDiagnosticsRef.current = diagnosticKey;
      queueMicrotask(() => onDiagnostics?.(diagnostics));
    }
    return diagnostics;
  }, { delay: 250 }), [onDiagnostics, path]);

  const aiCompletion = useCallback(async (context) => {
    if (!context.explicit) return null;
    setAiBusy(true);
    try {
      const source = context.state.doc.toString();
      const response = await fetch('/api/code-assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: 'completion',
          path,
          language: languageName(path),
          prefix: source.slice(0, context.pos),
          suffix: source.slice(context.pos),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.suggestion) return null;
      const suggestion = String(payload.suggestion);
      return {
        from: context.pos,
        options: [{
          label: suggestion.split('\n')[0].slice(0, 100) || 'AI suggestion',
          detail: 'MIRA AI completion',
          type: 'text',
          apply: suggestion,
        }],
      };
    } finally {
      setAiBusy(false);
    }
  }, [path]);

  const extensions = useMemo(() => [
    extensionForPath(path),
    syntaxLinter,
    autocompletion({ override: [aiCompletion], activateOnTyping: false }),
    keymap.of([
      { key: 'Mod-s', preventDefault: true, run: () => { onSave?.(); return true; } },
      { key: 'Alt-\\', run: startCompletion },
    ]),
  ], [aiCompletion, onSave, path, syntaxLinter]);

  return (
    <div className="desktop-code-editor-shell">
      <CodeMirror
        ref={editorRef}
        value={value}
        height="100%"
        theme={oneDark}
        extensions={extensions}
        onChange={onChange}
        basicSetup={{ autocompletion: false, foldGutter: true, highlightActiveLine: true, lineNumbers: true }}
        aria-label={`Editing ${path}`}
      />
      <button
        type="button"
        className="desktop-ai-complete"
        onClick={() => editorRef.current?.view && startCompletion(editorRef.current.view)}
        disabled={aiBusy}
        title="Generate AI completion (Option + \\)"
      >
        {aiBusy ? 'Thinking…' : 'AI complete'}
      </button>
    </div>
  );
}
