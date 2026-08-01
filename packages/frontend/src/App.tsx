import { useState } from 'react';
import { WorkbookUpload } from './components/WorkbookUpload.tsx';
import { RepoInput } from './components/RepoInput.tsx';
import { RunButton } from './components/RunButton.tsx';
import { AnalysisTable } from './components/AnalysisTable.tsx';
import type { CompleteEvent, RuleResult, TabType, UndocumentedRule } from './types.ts';

function App() {
  // ─── Shared state ───────────────────────────────────────────────────────────
  const [excelPath, setExcelPath] = useState('');
  const [repoPath, setRepoPath] = useState('');
  const [selectedTab, setSelectedTab] = useState('');
  const [tabTypes, setTabTypes] = useState<Record<string, TabType>>({});

  // Results from streaming analysis
  const [results, setResults] = useState<RuleResult[]>([]);
  const [completeEvent, setCompleteEvent] = useState<CompleteEvent | null>(null);
  const [undocumentedRules, setUndocumentedRules] = useState<UndocumentedRule[]>([]);

  // ─── Handlers ───────────────────────────────────────────────────────────────

  function handleTabsLoaded(
    path: string,
    _tabs: string[],
    types: Record<string, TabType>,
  ) {
    setExcelPath(path);
    if (Object.keys(types).length > 0) {
      setTabTypes(types);
    }
    setResults([]);
    setCompleteEvent(null);
    setUndocumentedRules([]);
  }

  function handleTabSelect(tab: string) {
    setSelectedTab(tab);
    setResults([]);
    setCompleteEvent(null);
    setUndocumentedRules([]);
  }

  function handleRepoChange(path: string) {
    setRepoPath(path);
    setResults([]);
    setCompleteEvent(null);
    setUndocumentedRules([]);
  }

  function handleResults(live: RuleResult[]) {
    setResults(live);
  }

  function handleComplete(event: CompleteEvent) {
    setCompleteEvent(event);
    setUndocumentedRules(event.undocumented_rules ?? []);
    // Replace streaming results with the final Kiro-verified results
    if (event.results && event.results.length > 0) {
      setResults(event.results);
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={appShell}>
      {/* Header */}
      <header style={header}>
        <div style={headerInner}>
          <h1 style={logoTitle}>RHW Blaze Mapper</h1>
          <p style={logoSub}>
            Gap analysis between Rules Harvesting Workbooks and Blaze Advisor codebases
          </p>
        </div>
      </header>

      {/* Main content */}
      <main style={main}>
        {/* Step 1 + 2 side by side on wide screens */}
        <div style={setupGrid}>
          <WorkbookUpload
            repoPath={repoPath}
            selectedTab={selectedTab}
            onTabsLoaded={handleTabsLoaded}
            onTabSelect={handleTabSelect}
          />
          <RepoInput value={repoPath} onChange={handleRepoChange} />
        </div>

        {/* Run button — step 3 */}
        <RunButton
          excelPath={excelPath}
          repoPath={repoPath}
          selectedTab={selectedTab}
          onResults={handleResults}
          onComplete={handleComplete}
        />

        {/* Summary banner after completion */}
        {completeEvent && (
          <CompletionBanner event={completeEvent} tabTypes={tabTypes} selectedTab={selectedTab} />
        )}

        {/* Results table */}
        {(results.length > 0 || completeEvent) && (
          <section style={resultsSection}>
            <h2 style={resultsSectionTitle}>
              Analysis Results
              {selectedTab && (
                <span style={tabBadge}>{selectedTab}</span>
              )}
            </h2>
            <AnalysisTable results={results} undocumentedRules={undocumentedRules} />
          </section>
        )}
      </main>
    </div>
  );
}

// ─── Completion banner ────────────────────────────────────────────────────────

interface BannerProps {
  event: CompleteEvent;
  tabTypes: Record<string, TabType>;
  selectedTab: string;
}

function CompletionBanner({ event, tabTypes, selectedTab }: BannerProps) {
  const { counts, undocumented, report_url, annotated_excel } = event;
  const hasGaps = counts.MISSING > 0 || counts.MISMATCH > 0 || counts.NOT_IMPLEMENTED > 0;
  const tabType = tabTypes[selectedTab];

  const bannerBg = hasGaps ? '#fff8e6' : '#f0fff4';
  const bannerBorder = hasGaps ? '#f0a500' : '#2a8a2a';
  const bannerIcon = hasGaps ? '⚠️' : '✅';
  const bannerText = hasGaps
    ? 'Review Recommended — gaps were found'
    : 'No gaps detected — all rules confirmed';

  return (
    <div
      style={{
        ...completionBox,
        background: bannerBg,
        borderColor: bannerBorder,
      }}
    >
      <div style={bannerHeader}>
        <span style={bannerIconStyle}>{bannerIcon}</span>
        <strong style={{ fontSize: 15, color: '#1a2b4a' }}>{bannerText}</strong>
      </div>

      {/* Counts grid */}
      <div style={countsGrid}>
        <CountChip label="Match" value={counts.MATCH} color="#276d3b" bg="#d4edda" />
        <CountChip label="Missing" value={counts.MISSING} color="#cc0000" bg="#fce8e8" />
        <CountChip label="Mismatch" value={counts.MISMATCH} color="#7a5800" bg="#fff3cd" />
        <CountChip label="Typo" value={counts.NAME_TYPO} color="#1a4fa0" bg="#dae8ff" />
        <CountChip label="Removed" value={counts.REMOVED} color="#5a0088" bg="#f3e8ff" />
        <CountChip label="Not Impl." value={counts.NOT_IMPLEMENTED} color="#555" bg="#e8e8e8" />
        {undocumented > 0 && (
          <CountChip label="Undocumented" value={undocumented} color="#aa5500" bg="#fff0e0" />
        )}
      </div>

      {tabType && (
        <div style={metaLine}>
          Tab type: <strong>{tabType}</strong>
        </div>
      )}

      {/* Action links */}
      <div style={actionLinks}>
        {report_url && (
          <a href={report_url} target="_blank" rel="noreferrer" style={actionLink}>
            📄 Open Full Report
          </a>
        )}
        {annotated_excel?.success && annotated_excel.path && (
          <a href="/api/download_annotated_excel" style={actionLink}>
            📥 Download Annotated Excel
          </a>
        )}
      </div>
    </div>
  );
}

function CountChip({
  label,
  value,
  color,
  bg,
}: {
  label: string;
  value: number;
  color: string;
  bg: string;
}) {
  if (value === 0) return null;
  return (
    <div style={{ ...chip, background: bg, color }}>
      <span style={chipValue}>{value}</span>
      <span style={chipLabel}>{label}</span>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const appShell: React.CSSProperties = {
  minHeight: '100vh',
  background: '#f4f6fb',
  fontFamily: "'Segoe UI', Arial, sans-serif",
};

const header: React.CSSProperties = {
  background: 'linear-gradient(135deg, #0a2a6e 0%, #0066cc 100%)',
  padding: '20px 0',
  marginBottom: 28,
};

const headerInner: React.CSSProperties = {
  maxWidth: 1100,
  margin: '0 auto',
  padding: '0 24px',
};

const logoTitle: React.CSSProperties = {
  color: '#fff',
  margin: '0 0 4px',
  fontSize: 26,
  fontWeight: 700,
  letterSpacing: -0.5,
};

const logoSub: React.CSSProperties = {
  color: 'rgba(255,255,255,0.75)',
  margin: 0,
  fontSize: 13,
};

const main: React.CSSProperties = {
  maxWidth: 1100,
  margin: '0 auto',
  padding: '0 24px 48px',
};

const setupGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 20,
};

const resultsSection: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #dde3ec',
  borderRadius: 8,
  padding: '20px 24px',
  boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
};

const resultsSectionTitle: React.CSSProperties = {
  margin: '0 0 16px',
  fontSize: 17,
  fontWeight: 600,
  color: '#1a2b4a',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
};

const tabBadge: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 400,
  background: '#e8f0fe',
  color: '#0055aa',
  border: '1px solid #aac4ee',
  borderRadius: 4,
  padding: '2px 8px',
  fontFamily: 'monospace',
};

// Completion banner
const completionBox: React.CSSProperties = {
  border: '1px solid',
  borderRadius: 8,
  padding: '16px 20px',
  marginBottom: 20,
  boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
};

const bannerHeader: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 12,
};

const bannerIconStyle: React.CSSProperties = {
  fontSize: 20,
};

const countsGrid: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  marginBottom: 10,
};

const chip: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  padding: '4px 10px',
  borderRadius: 20,
  fontSize: 12,
  fontWeight: 500,
};

const chipValue: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 14,
};

const chipLabel: React.CSSProperties = {
  opacity: 0.85,
};

const metaLine: React.CSSProperties = {
  fontSize: 12,
  color: '#666',
  marginBottom: 10,
};

const actionLinks: React.CSSProperties = {
  display: 'flex',
  gap: 14,
  flexWrap: 'wrap',
};

const actionLink: React.CSSProperties = {
  fontSize: 13,
  color: '#0066cc',
  fontWeight: 600,
  textDecoration: 'none',
  padding: '5px 12px',
  background: '#eaf2ff',
  border: '1px solid #aac4ee',
  borderRadius: 5,
};

export default App;
