import { useState } from 'react';
import type { RecommendedAction, RuleResult, RuleStatus, UndocumentedRule } from '../types.ts';

interface Props {
  results: RuleResult[];
  undocumentedRules?: UndocumentedRule[];
}

// ─── Status display config ────────────────────────────────────────────────────

const STATUS_LABEL: Record<RuleStatus, string> = {
  MATCH: '✓ MATCH',
  MISSING: '✗ MISSING',
  MISMATCH: '✗ MISMATCH',
  NAME_TYPO: '✎ EXCEL TYPO',
  REMOVED: '✗ REMOVED',
  NOT_IMPLEMENTED: '⊘ NOT IMPL.',
};

const STATUS_BADGE: Record<RuleStatus, React.CSSProperties> = {
  MATCH: { background: '#d4edda', color: '#276d3b', border: '1px solid #a8d5b5' },
  MISSING: { background: '#fce8e8', color: '#cc0000', border: '1px solid #f5b0b0' },
  MISMATCH: { background: '#fff3cd', color: '#7a5800', border: '1px solid #ffd966' },
  NAME_TYPO: { background: '#dae8ff', color: '#1a4fa0', border: '1px solid #a8c8f5' },
  REMOVED: { background: '#f3e8ff', color: '#5a0088', border: '1px solid #c8a8f5' },
  NOT_IMPLEMENTED: { background: '#e8e8e8', color: '#555', border: '1px solid #ccc' },
};

const ROW_BG: Record<RuleStatus, string> = {
  MATCH: '#f6fff8',
  MISSING: '#fff5f5',
  MISMATCH: '#fffbf0',
  NAME_TYPO: '#f0f5ff',
  REMOVED: '#faf5ff',
  NOT_IMPLEMENTED: '#f8f8f8',
};

const ACTION_BADGE: Record<RecommendedAction, React.CSSProperties> = {
  NO_ACTION: { background: '#d4edda', color: '#276d3b', border: '1px solid #a8d5b5' },
  UPDATE_RHW: { background: '#dae8ff', color: '#1a5fb4', border: '1px solid #a8c8f5' },
  VERIFY_WITH_BUSINESS: { background: '#fef3c7', color: '#b45309', border: '1px solid #fcd34d' },
};

const ACTION_LABEL: Record<RecommendedAction, string> = {
  NO_ACTION: '✓ No Action',
  UPDATE_RHW: '📝 Update RHW',
  VERIFY_WITH_BUSINESS: '🔍 Verify With Business',
};

// ─── Component ────────────────────────────────────────────────────────────────

export function AnalysisTable({ results, undocumentedRules = [] }: Props) {
  const [undocExpanded, setUndocExpanded] = useState(false);
  if (results.length === 0) {
    return (
      <div style={emptyState}>
        <span style={{ fontSize: 32 }}>📋</span>
        <p style={{ margin: '8px 0 0', color: '#888' }}>
          No results yet. Run an analysis to see results here.
        </p>
      </div>
    );
  }

  // Summary counts
  const counts: Record<RuleStatus, number> = {
    MATCH: 0,
    MISSING: 0,
    MISMATCH: 0,
    NAME_TYPO: 0,
    REMOVED: 0,
    NOT_IMPLEMENTED: 0,
  };
  for (const r of results) {
    counts[r.status] = (counts[r.status] ?? 0) + 1;
  }

  return (
    <div>
      {/* Summary bar */}
      <div style={summaryBar}>
        {(Object.entries(counts) as [RuleStatus, number][])
          .filter(([, n]) => n > 0)
          .map(([status, n]) => (
            <span key={status} style={{ ...summaryChip, ...STATUS_BADGE[status] }}>
              {STATUS_LABEL[status]} &nbsp;<strong>{n}</strong>
            </span>
          ))}
      </div>

      {/* Table */}
      <div style={tableWrapper}>
        <table style={table}>
          <thead>
            <tr>
              <th style={{ ...th, width: 40 }}>#</th>
              <th style={th}>Rule Name (Excel)</th>
              <th style={th}>Rule Name (Code)</th>
              <th style={{ ...th, width: 140 }}>Status</th>
              <th style={th}>Issues</th>
              <th style={{ ...th, width: 200 }}>Recommended Action</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <ResultRow key={`${r.row_num}-${r.excel_name}`} result={r} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Reverse check — undocumented rules */}
      {undocumentedRules.length > 0 && (
        <div style={undocSection}>
          <button
            style={undocToggle}
            onClick={() => setUndocExpanded((v) => !v)}
          >
            <span style={undocToggleIcon}>{undocExpanded ? '▾' : '▸'}</span>
            <span>
              Rules found in repo related to this tab
            </span>
            <span style={undocBadge}>{undocumentedRules.length}</span>
          </button>

          {undocExpanded && (
            <div style={undocTableWrapper}>
              <table style={table}>
                <thead>
                  <tr>
                    <th style={th}>Rule Name</th>
                    <th style={th}>File</th>
                    <th style={{ ...th, width: 160 }}>Sheet</th>
                    <th style={th}>Business Statement</th>
                  </tr>
                </thead>
                <tbody>
                  {undocumentedRules.map((u, i) => {
                    const found = !!u.business_statement;
                    const rowBg = found ? '#f0fff4' : '#fff5f5';
                    const leftBorder = found ? '3px solid #2a8a2a' : '3px solid #cc3300';
                    return (
                      <tr key={i} style={{ background: rowBg, borderLeft: leftBorder }}>
                        <td style={{ ...td, fontFamily: 'monospace', fontSize: 12, color: '#333', whiteSpace: 'nowrap' }}>
                          {u.name}
                        </td>
                        <td style={{ ...td, fontSize: 11, color: '#666', fontFamily: 'monospace' }}>
                          {u.source}
                        </td>
                        <td style={{ ...td, fontSize: 12 }}>
                          {u.sheet_name
                            ? <span style={sheetBadge}>{u.sheet_name}</span>
                            : <span style={notFoundStyle}>Not found</span>
                          }
                        </td>
                        <td style={{ ...td, fontSize: 12, color: found ? '#333' : '#cc3300' }}>
                          {u.business_statement
                            ?? <span style={notFoundStyle}>Not documented in workbook</span>
                          }
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Row sub-component ────────────────────────────────────────────────────────

function ResultRow({ result: r }: { result: RuleResult }) {
  const rowBg = ROW_BG[r.status];
  const isAmberHighlight =
    r.status === 'MATCH' && (r.config_keys.length > 0 || r.hardcoded_dates.length > 0);

  const rowStyle: React.CSSProperties = {
    background: isAmberHighlight ? '#fffbe6' : rowBg,
    borderLeft: isAmberHighlight ? '4px solid #f0a500' : undefined,
  };

  return (
    <tr style={rowStyle}>
      {/* Row number */}
      <td style={{ ...td, color: '#999', fontSize: 11, textAlign: 'center' }}>{r.row_num}</td>

      {/* Excel name */}
      <td style={td}>
        <span style={ruleNameStyle}>{r.excel_name}</span>
        {r.section && <div style={sectionLabel}>{r.section}</div>}
      </td>

      {/* Code name */}
      <td style={td}>
        {r.code_name && r.code_name !== r.excel_name ? (
          <span style={{ ...ruleNameStyle, color: '#665500' }}>{r.code_name}</span>
        ) : r.rule_file ? (
          <span style={fileRef} title={r.rule_file}>
            {r.rule_file.split('/').pop()}
          </span>
        ) : (
          <span style={{ color: '#bbb', fontStyle: 'italic', fontSize: 12 }}>—</span>
        )}
        {r.config_keys.length > 0 && (
          <div style={{ marginTop: 4 }}>
            {r.config_keys.map((k) => (
              <span key={k} style={configKey}>
                ⚙ {k}
              </span>
            ))}
          </div>
        )}
        {r.hardcoded_dates.length > 0 && (
          <div style={{ marginTop: 4 }}>
            {r.hardcoded_dates.map((d) => (
              <span key={d} style={dateTag}>
                📅 {d}
              </span>
            ))}
          </div>
        )}
      </td>

      {/* Status badge */}
      <td style={{ ...td, textAlign: 'center' }}>
        <span style={{ ...badgeBase, ...STATUS_BADGE[r.status] }}>{STATUS_LABEL[r.status]}</span>
        {r.notes && <div style={notesStyle}>{r.notes}</div>}
      </td>

      {/* Issues */}
      <td style={td}>
        {r.issues.length === 0 ? (
          <span style={{ color: '#aaa', fontSize: 12, fontStyle: 'italic' }}>None</span>
        ) : (
          <ul style={issueList}>
            {r.issues.map((issue, i) => (
              <li key={i} style={issueItem}>
                {issue}
              </li>
            ))}
          </ul>
        )}
      </td>

      {/* Recommended action */}
      <td style={{ ...td, textAlign: 'center' }}>
        <span
          style={{ ...badgeBase, ...ACTION_BADGE[r.recommendation.action] }}
          title={r.recommendation.reason}
        >
          {ACTION_LABEL[r.recommendation.action]}
        </span>
        <div style={confidenceLabel}>
          {r.recommendation.confidence === 'HIGH' ? '● HIGH' : '◐ MEDIUM'} confidence
        </div>
        {r.recommendation.reason && (
          <div style={reasonStyle} title={r.recommendation.reason}>
            {r.recommendation.reason.length > 80
              ? r.recommendation.reason.slice(0, 80) + '…'
              : r.recommendation.reason}
          </div>
        )}
      </td>
    </tr>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const emptyState: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  padding: '40px 0',
  color: '#888',
};

const summaryBar: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  marginBottom: 12,
};

const summaryChip: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: 20,
  fontSize: 12,
  fontWeight: 500,
};

const tableWrapper: React.CSSProperties = {
  overflowX: 'auto',
  borderRadius: 6,
  border: '1px solid #dde3ec',
};

const table: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
};

const th: React.CSSProperties = {
  background: '#f0f4fb',
  padding: '10px 12px',
  textAlign: 'left',
  fontWeight: 600,
  color: '#334',
  borderBottom: '2px solid #dde3ec',
  whiteSpace: 'nowrap',
};

const td: React.CSSProperties = {
  padding: '9px 12px',
  verticalAlign: 'top',
  borderBottom: '1px solid #eef0f4',
};

const badgeBase: React.CSSProperties = {
  display: 'inline-block',
  padding: '3px 8px',
  borderRadius: 4,
  fontSize: 11,
  fontWeight: 600,
  whiteSpace: 'nowrap',
};

const ruleNameStyle: React.CSSProperties = {
  fontFamily: 'monospace',
  fontSize: 12,
  color: '#222',
};

const sectionLabel: React.CSSProperties = {
  fontSize: 11,
  color: '#888',
  marginTop: 3,
};

const fileRef: React.CSSProperties = {
  fontFamily: 'monospace',
  fontSize: 11,
  color: '#555',
  textDecoration: 'underline dotted',
  cursor: 'help',
};

const configKey: React.CSSProperties = {
  display: 'inline-block',
  fontSize: 10,
  background: '#fff3cd',
  color: '#7a5800',
  border: '1px solid #ffd966',
  borderRadius: 3,
  padding: '1px 5px',
  marginRight: 4,
  fontFamily: 'monospace',
};

const dateTag: React.CSSProperties = {
  display: 'inline-block',
  fontSize: 10,
  background: '#fff3cd',
  color: '#7a5800',
  border: '1px solid #ffd966',
  borderRadius: 3,
  padding: '1px 5px',
  marginRight: 4,
};

const notesStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#666',
  marginTop: 4,
  fontStyle: 'italic',
};

const issueList: React.CSSProperties = {
  margin: 0,
  padding: '0 0 0 16px',
  color: '#444',
};

const issueItem: React.CSSProperties = {
  fontSize: 12,
  marginBottom: 3,
  lineHeight: 1.4,
};

const confidenceLabel: React.CSSProperties = {
  fontSize: 10,
  color: '#888',
  marginTop: 4,
};

const reasonStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#666',
  marginTop: 3,
  lineHeight: 1.3,
  cursor: 'help',
};


// ─── Undocumented rules section styles ────────────────────────────────────────

const undocSection: React.CSSProperties = {
  marginTop: 16,
  border: '1px solid #f0d0a0',
  borderRadius: 6,
  overflow: 'hidden',
};

const undocToggle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '10px 14px',
  background: '#fff8ee',
  border: 'none',
  borderBottom: '1px solid #f0d0a0',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
  color: '#7a4400',
  textAlign: 'left',
};

const undocToggleIcon: React.CSSProperties = {
  fontSize: 14,
  flexShrink: 0,
};

const undocBadge: React.CSSProperties = {
  marginLeft: 'auto',
  background: '#f0a040',
  color: '#fff',
  fontSize: 11,
  fontWeight: 700,
  borderRadius: 10,
  padding: '2px 8px',
};

const undocTableWrapper: React.CSSProperties = {
  overflowX: 'auto',
  maxHeight: 320,
  overflowY: 'auto',
};

const sheetBadge: React.CSSProperties = {
  display: 'inline-block',
  background: '#e8f0fe',
  color: '#0055aa',
  border: '1px solid #aac4ee',
  borderRadius: 4,
  padding: '1px 7px',
  fontSize: 11,
  fontWeight: 600,
  whiteSpace: 'nowrap',
};

const noMatchStyle: React.CSSProperties = {
  color: '#bbb',
  fontStyle: 'italic',
  fontSize: 12,
};

const notFoundStyle: React.CSSProperties = {
  color: '#cc3300',
  fontStyle: 'italic',
  fontSize: 12,
  fontWeight: 600,
};
