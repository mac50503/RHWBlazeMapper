import { useState } from 'react';
import type {
  CompleteEvent,
  ProgressEvent,
  RuleEvent,
  RuleResult,
  StreamErrorEvent,
  StreamEvent,
} from '../types.ts';

interface Props {
  excelPath: string;
  repoPath: string;
  selectedTab: string;
  onResults: (results: RuleResult[]) => void;
  onComplete: (event: CompleteEvent) => void;
}

interface ProgressLine {
  phase: ProgressEvent['phase'];
  message: string;
}

const PHASE_ICON: Record<ProgressEvent['phase'], string> = {
  indexing: '🔍',
  forward_check: '⚙',
  kiro_verify: '🤖',
  report: '📄',
};

export function RunButton({ excelPath, repoPath, selectedTab, onResults, onComplete }: Props) {
  const [running, setRunning] = useState(false);
  const [progressLines, setProgressLines] = useState<ProgressLine[]>([]);
  const [rulesStreamed, setRulesStreamed] = useState(0);
  const [error, setError] = useState('');

  const canRun = !!excelPath && !!repoPath && !!selectedTab && !running;

  async function handleRun() {
    if (!canRun) return;

    setRunning(true);
    setError('');
    setProgressLines([]);
    setRulesStreamed(0);

    const accumulated: RuleResult[] = [];

    try {
      const res = await fetch('/api/run_analysis_stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          excel: excelPath,
          repo: repoPath,
          tab: selectedTab,
          out: '', // server chooses the output path
        }),
      });

      if (!res.ok || !res.body) {
        const text = await res.text();
        let msg = `Server error (${res.status})`;
        try {
          const json = JSON.parse(text) as { error?: string };
          if (json.error) msg = json.error;
        } catch {
          // ignore parse error — use status code message
        }
        throw new Error(msg);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // Keep the last (potentially incomplete) line in the buffer
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const jsonStr = line.slice(5).trim();
          if (!jsonStr) continue;

          let event: StreamEvent;
          try {
            event = JSON.parse(jsonStr) as StreamEvent;
          } catch {
            continue;
          }

          if (event.type === 'progress') {
            const pe = event as ProgressEvent;
            setProgressLines((prev) => [
              ...prev,
              { phase: pe.phase, message: pe.message },
            ]);
          } else if (event.type === 'rule') {
            const re = event as RuleEvent;
            accumulated.push(re.result);
            setRulesStreamed((n) => n + 1);
            // Push incremental results so the table updates live
            onResults([...accumulated]);
          } else if (event.type === 'complete') {
            const ce = event as CompleteEvent;
            onComplete(ce);
          } else if (event.type === 'error') {
            const ee = event as StreamErrorEvent;
            throw new Error(ee.error);
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div style={wrapper}>
      <div style={topRow}>
        <button
          style={{
            ...runBtn,
            opacity: canRun ? 1 : 0.45,
            cursor: canRun ? 'pointer' : 'not-allowed',
          }}
          disabled={!canRun}
          onClick={handleRun}
        >
          {running ? '⏳ Running…' : '▶ Run Analysis'}
        </button>

        {!canRun && !running && (
          <span style={readinessHint}>
            {!excelPath && '→ Upload a workbook '}
            {excelPath && !repoPath && '→ Enter repo path '}
            {excelPath && repoPath && !selectedTab && '→ Select a tab '}
          </span>
        )}

        {running && rulesStreamed > 0 && (
          <span style={progressCount}>{rulesStreamed} rules verified…</span>
        )}
      </div>

      {/* Progress log */}
      {progressLines.length > 0 && (
        <div style={progressBox}>
          {progressLines.map((line, i) => (
            <div key={i} style={progressLine}>
              <span style={phaseIcon}>{PHASE_ICON[line.phase]}</span>
              <span style={progressText}>{line.message}</span>
            </div>
          ))}
          {running && <div style={{ ...progressLine, color: '#888' }}>⏳ Working…</div>}
        </div>
      )}

      {error && <p style={errorMsg}>⚠ {error}</p>}
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const wrapper: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #dde3ec',
  borderRadius: 8,
  padding: '18px 24px',
  marginBottom: 20,
  boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
};

const topRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  flexWrap: 'wrap',
};

const runBtn: React.CSSProperties = {
  padding: '10px 28px',
  border: 'none',
  borderRadius: 5,
  background: '#0a7a0a',
  color: '#fff',
  fontWeight: 700,
  fontSize: 15,
  letterSpacing: 0.3,
};

const readinessHint: React.CSSProperties = {
  fontSize: 13,
  color: '#888',
  fontStyle: 'italic',
};

const progressCount: React.CSSProperties = {
  fontSize: 13,
  color: '#0066cc',
  fontWeight: 600,
};

const progressBox: React.CSSProperties = {
  marginTop: 14,
  padding: '10px 14px',
  background: '#f5f7fa',
  borderRadius: 5,
  border: '1px solid #e0e4ec',
  maxHeight: 180,
  overflowY: 'auto',
  fontFamily: 'monospace',
};

const progressLine: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  marginBottom: 4,
  fontSize: 12,
  color: '#333',
};

const phaseIcon: React.CSSProperties = {
  flexShrink: 0,
  fontSize: 13,
};

const progressText: React.CSSProperties = {
  lineHeight: 1.4,
};

const errorMsg: React.CSSProperties = {
  margin: '12px 0 0',
  color: '#cc3300',
  fontSize: 13,
  fontWeight: 500,
};
