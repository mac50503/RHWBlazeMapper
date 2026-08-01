import { useRef, useState } from 'react';
import type { LoadTabsResponse, TabType, UploadExcelResponse } from '../types.ts';

interface Props {
  repoPath: string;
  selectedTab: string;
  onTabsLoaded: (excelPath: string, tabs: string[], tabTypes: Record<string, TabType>) => void;
  onTabSelect: (tab: string) => void;
}

const TAB_TYPE_LABEL: Record<TabType, string> = {
  RULE_NAMES: 'Rule Names',
  LEGALITY_DECISION_TABLE: 'Legality Table',
  LEGALITY_MASTER: 'Legality Master',
  LOOKUP_TABLE: 'Lookup Table',
  PROSE_LOGIC: 'Prose Logic',
  REFERENCE: 'Reference',
};

const TAB_TYPE_COLOR: Record<TabType, string> = {
  RULE_NAMES: '#0066cc',
  LEGALITY_DECISION_TABLE: '#006633',
  LEGALITY_MASTER: '#005522',
  LOOKUP_TABLE: '#663300',
  PROSE_LOGIC: '#550066',
  REFERENCE: '#888888',
};

export function WorkbookUpload({ repoPath, selectedTab, onTabsLoaded, onTabSelect }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [excelPath, setExcelPath] = useState('');
  const [tabs, setTabs] = useState<string[]>([]);
  const [tabTypes, setTabTypes] = useState<Record<string, TabType>>({});
  const [uploading, setUploading] = useState(false);
  const [loadingTabs, setLoadingTabs] = useState(false);
  const [error, setError] = useState('');

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'xlsx' && ext !== 'xls') {
      setError('Please select an .xlsx or .xls file.');
      return;
    }

    setError('');
    setFileName(file.name);
    setTabs([]);
    setTabTypes({});
    onTabSelect('');
    setUploading(true);

    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/upload_excel', { method: 'POST', body: form });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? `Upload failed (${res.status})`);
      }
      const data = (await res.json()) as UploadExcelResponse;
      setExcelPath(data.path);
      // Notify parent immediately so excelPath is available for RunButton
      onTabsLoaded(data.path, [], {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function handleLoadTabs() {
    if (!excelPath) return;
    setError('');
    setLoadingTabs(true);
    setTabs([]);
    onTabSelect('');

    try {
      const res = await fetch('/api/load_tabs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ excel: excelPath, repo: repoPath || '', gitlab_branch: 'master' }),
      });
      const data = (await res.json()) as LoadTabsResponse;
      if (data.error) throw new Error(data.error);
      setTabs(data.tabs);
      setTabTypes(data.tab_types);
      onTabsLoaded(excelPath, data.tabs, data.tab_types);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tabs');
    } finally {
      setLoadingTabs(false);
    }
  }

  const canLoadTabs = !!excelPath && !uploading && !loadingTabs;

  return (
    <section style={card}>
      <h2 style={sectionTitle}>① Upload Workbook</h2>

      <div style={row}>
        <button style={browseBtn} onClick={() => fileRef.current?.click()} disabled={uploading}>
          📂 Browse…
        </button>
        <span style={fileNameStyle}>{fileName || 'No file selected'}</span>
        {uploading && <span style={hint}>Uploading…</span>}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {excelPath && (
        <div style={pathHint}>
          <strong>Server path:</strong> <code style={codeStyle}>{excelPath}</code>
        </div>
      )}

      <button
        style={{ ...primaryBtn, opacity: canLoadTabs ? 1 : 0.4 }}
        disabled={!canLoadTabs}
        onClick={handleLoadTabs}
      >
        {loadingTabs ? '⏳ Loading tabs…' : 'Load Tabs →'}
      </button>

      {error && <p style={errorMsg}>⚠ {error}</p>}

      {tabs.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h3 style={subTitle}>Select a Tab ({tabs.length} found)</h3>
          <ul style={tabList}>
            {tabs.map((tab) => {
              const type = tabTypes[tab];
              const isSelected = tab === selectedTab;
              return (
                <li
                  key={tab}
                  style={{
                    ...tabItem,
                    background: isSelected ? '#e8f0fe' : '#fafafa',
                    borderColor: isSelected ? '#0066cc' : '#ddd',
                  }}
                  onClick={() => onTabSelect(tab)}
                >
                  <span style={tabName}>{tab}</span>
                  {type !== undefined && (
                    <span
                      style={{
                        ...badge,
                        background: TAB_TYPE_COLOR[type],
                      }}
                    >
                      {TAB_TYPE_LABEL[type]}
                    </span>
                  )}
                  {isSelected && <span style={checkMark}>✓</span>}
                </li>
              );
            })}
          </ul>
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
  margin: '0 0 14px',
  fontSize: 17,
  fontWeight: 600,
  color: '#1a2b4a',
};

const subTitle: React.CSSProperties = {
  margin: '0 0 10px',
  fontSize: 14,
  fontWeight: 600,
  color: '#333',
};

const row: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  marginBottom: 12,
};

const browseBtn: React.CSSProperties = {
  padding: '7px 14px',
  border: '1px solid #aac4ee',
  borderRadius: 5,
  background: '#eaf2ff',
  color: '#0055aa',
  fontWeight: 600,
  cursor: 'pointer',
  fontSize: 13,
};

const primaryBtn: React.CSSProperties = {
  padding: '8px 20px',
  border: 'none',
  borderRadius: 5,
  background: '#0066cc',
  color: '#fff',
  fontWeight: 600,
  cursor: 'pointer',
  fontSize: 14,
  marginTop: 4,
};

const fileNameStyle: React.CSSProperties = {
  fontSize: 13,
  color: '#444',
};

const hint: React.CSSProperties = {
  fontSize: 12,
  color: '#888',
  fontStyle: 'italic',
};

const pathHint: React.CSSProperties = {
  fontSize: 12,
  color: '#555',
  marginBottom: 10,
  padding: '6px 10px',
  background: '#f5f7fa',
  borderRadius: 4,
};

const codeStyle: React.CSSProperties = {
  fontFamily: 'monospace',
  fontSize: 11,
  color: '#2255aa',
};

const errorMsg: React.CSSProperties = {
  margin: '10px 0 0',
  color: '#cc3300',
  fontSize: 13,
  fontWeight: 500,
};

const tabList: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  maxHeight: 340,
  overflowY: 'auto',
};

const tabItem: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '7px 12px',
  border: '1px solid #ddd',
  borderRadius: 5,
  cursor: 'pointer',
};

const tabName: React.CSSProperties = {
  flex: 1,
  fontSize: 13,
  color: '#222',
};

const badge: React.CSSProperties = {
  fontSize: 11,
  color: '#fff',
  borderRadius: 3,
  padding: '2px 7px',
  fontWeight: 600,
  whiteSpace: 'nowrap',
};

const checkMark: React.CSSProperties = {
  color: '#0066cc',
  fontWeight: 700,
  fontSize: 15,
};
