import { useState } from 'react';
import type { ValidateResponse } from '../types.ts';

interface Props {
  value: string;
  onChange: (path: string) => void;
}

export function RepoInput({ value, onChange }: Props) {
  const [validating, setValidating] = useState(false);
  const [validationState, setValidationState] = useState<'idle' | 'ok' | 'error'>('idle');
  const [validationMsg, setValidationMsg] = useState('');
  const [ruleFiles, setRuleFiles] = useState<number | null>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    onChange(e.target.value);
    if (validationState !== 'idle') {
      setValidationState('idle');
      setValidationMsg('');
      setRuleFiles(null);
    }
  }

  async function handleValidate() {
    if (!value.trim()) return;
    setValidating(true);
    setValidationState('idle');
    setValidationMsg('');
    setRuleFiles(null);

    try {
      const res = await fetch('/api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'repo', path: value.trim() }),
      });
      const data = (await res.json()) as ValidateResponse;

      if (data.ok) {
        setValidationState('ok');
        setValidationMsg(data.message ?? 'Repo looks good.');
        if (data.rule_files !== undefined) setRuleFiles(data.rule_files);
      } else {
        setValidationState('error');
        setValidationMsg(data.error);
      }
    } catch (err) {
      setValidationState('error');
      setValidationMsg(err instanceof Error ? err.message : 'Validation request failed');
    } finally {
      setValidating(false);
    }
  }

  const canValidate = value.trim().length > 0 && !validating;

  return (
    <section style={card}>
      <h2 style={sectionTitle}>② Rules Engine Repo</h2>
      <p style={helpText}>
        Paste the local path to your Blaze Advisor rules repository.
        <br />
        <code style={codeHint}>e.g. C:\path\to\CrewRulesRepository</code>
      </p>

      <div style={inputRow}>
        <input
          type="text"
          value={value}
          onChange={handleChange}
          placeholder="C:\path\to\CrewRulesRepository"
          style={textInput}
          spellCheck={false}
        />
        <button
          style={{ ...validateBtn, opacity: canValidate ? 1 : 0.5 }}
          disabled={!canValidate}
          onClick={handleValidate}
        >
          {validating ? '⏳' : '✔ Validate'}
        </button>
      </div>

      {validationState === 'ok' && (
        <div style={successBox}>
          <span style={successIcon}>✓</span>
          <span style={successText}>
            {validationMsg}
            {ruleFiles !== null && (
              <> — <strong>{ruleFiles.toLocaleString()}</strong> rule files found</>
            )}
          </span>
        </div>
      )}

      {validationState === 'error' && (
        <div style={errorBox}>
          <span style={errorIcon}>✗</span>
          <span style={errorText}>{validationMsg}</span>
        </div>
      )}
    </section>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #dde3ec',
  borderRadius: 8,
  padding: '20px 24px',
  marginBottom: 20,
  boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
};

const sectionTitle: React.CSSProperties = {
  margin: '0 0 6px',
  fontSize: 17,
  fontWeight: 600,
  color: '#1a2b4a',
};

const helpText: React.CSSProperties = {
  margin: '0 0 12px',
  fontSize: 13,
  color: '#666',
  lineHeight: 1.6,
};

const codeHint: React.CSSProperties = {
  fontFamily: 'monospace',
  fontSize: 12,
  background: '#f0f2f5',
  padding: '1px 5px',
  borderRadius: 3,
  color: '#444',
};

const inputRow: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
};

const textInput: React.CSSProperties = {
  flex: 1,
  padding: '8px 12px',
  border: '1px solid #ccd6e8',
  borderRadius: 5,
  fontSize: 13,
  fontFamily: 'monospace',
  color: '#222',
  outline: 'none',
};

const validateBtn: React.CSSProperties = {
  padding: '8px 16px',
  border: '1px solid #3a8a3a',
  borderRadius: 5,
  background: '#f0faf0',
  color: '#2a6a2a',
  fontWeight: 600,
  cursor: 'pointer',
  fontSize: 13,
  whiteSpace: 'nowrap',
};

const successBox: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  marginTop: 10,
  padding: '8px 12px',
  background: '#f0faf0',
  border: '1px solid #88cc88',
  borderRadius: 5,
};

const successIcon: React.CSSProperties = {
  color: '#2a8a2a',
  fontWeight: 700,
  fontSize: 15,
  lineHeight: '1.4',
};

const successText: React.CSSProperties = {
  fontSize: 13,
  color: '#1a5a1a',
};

const errorBox: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  marginTop: 10,
  padding: '8px 12px',
  background: '#fff4f4',
  border: '1px solid #f08080',
  borderRadius: 5,
};

const errorIcon: React.CSSProperties = {
  color: '#cc2222',
  fontWeight: 700,
  fontSize: 15,
  lineHeight: '1.4',
};

const errorText: React.CSSProperties = {
  fontSize: 13,
  color: '#aa2222',
};
