/**
 * analysis.ts — Express routes for Excel upload, tab loading, and gap analysis.
 *
 * Route prefix: /api/analysis  (mounted in index.ts)
 *
 * Routes implemented:
 *   POST /upload_excel          — save uploaded .xlsx to disk, return path
 *   POST /validate              — validate excel or repo path
 *   POST /load_tabs             — open workbook, classify tabs, return tab list
 *   POST /run_analysis          — run full gap analysis for one tab
 *   POST /run_analysis_stream   — same but SSE stream
 *   POST /ask_kiro              — drill-down question to Kiro
 *   GET  /report                — serve last-generated HTML report
 *   GET  /home_info             — OS / path metadata
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'os';

import {
  parseWorkbook,
  parseTab,
  classifyTab,
  groupTabs,
  isRhwWorkbook,
  extractTabText,
  extractStatements,
} from '../services/excelParser';

import {
  validateRepo,
  indexRules,
} from '../services/blazeIndexer';

import {
  analyzeGaps,
  analyzeProseTab,
  analyzeProseTabByStatement,
  findUndocumentedRules,
  findUndocumentedByRulesets,
} from '../services/gapAnalyzer';

import { runKiro } from '../services/kiroRunner';
import { runKiroVerification } from '../services/kiroVerifier';
import { generateExcelIndex } from '../services/excelIndexer';

import {
  GapResult,
  RuleEntry,
  UndocumentedRule,
  RunAnalysisResponse,
  StreamEvent,
  TabType,
} from '../types';

export const analysisRouter = Router();

// ---------------------------------------------------------------------------
// Session state (in-memory — single-user tool)
// ---------------------------------------------------------------------------

interface SessionState {
  lastReportPath: string | null;
  lastExcelBuffer: Buffer | null;
  lastExcelName: string | null;
  lastRepoPath: string | null;
  lastAnnotatedExcelPath: string | null;
  // Cached rule index — keyed by repo path to invalidate when repo changes
  ruleIndexCache: Map<string, RuleEntry> | null;
  ruleIndexCacheRepoPath: string | null;
  // Path to the generated Excel index markdown file
  excelIndexPath: string | null;
}

const session: SessionState = {
  lastReportPath: null,
  lastExcelBuffer: null,
  lastExcelName: null,
  lastRepoPath: null,
  lastAnnotatedExcelPath: null,
  ruleIndexCache: null,
  ruleIndexCacheRepoPath: null,
  excelIndexPath: null,
};

/**
 * Get (or build and cache) the rule index for a repo path.
 * Re-indexes only when the repo path changes — subsequent analyses on the
 * same repo reuse the cached Map, saving 5-30s per run.
 */
function getRepoRules(repoPath: string): Map<string, RuleEntry> {
  if (session.ruleIndexCache && session.ruleIndexCacheRepoPath === repoPath) {
    return session.ruleIndexCache;
  }
  const ruleMap = indexRules(repoPath);
  session.ruleIndexCache = ruleMap;
  session.ruleIndexCacheRepoPath = repoPath;
  return ruleMap;
}

// ---------------------------------------------------------------------------
// Multer config — store uploaded Excel in memory, save to uploads dir
// ---------------------------------------------------------------------------

const UPLOAD_DIR = path.join(os.homedir(), 'Documents', 'RHW-Analysis', 'uploads');

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.xlsx' || ext === '.xls') {
      cb(null, true);
    } else {
      cb(new Error('Only .xlsx and .xls files are allowed'));
    }
  },
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
});

// ---------------------------------------------------------------------------
// POST /upload_excel
// ---------------------------------------------------------------------------

analysisRouter.post('/upload_excel', upload.single('file'), (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded. Send field name "file".' });
    return;
  }

  // Persist to uploads directory
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._\- ]/g, '_');
  const dest = path.join(UPLOAD_DIR, safeName);
  fs.writeFileSync(dest, req.file.buffer);

  // Keep in session for subsequent calls
  session.lastExcelBuffer = req.file.buffer;
  session.lastExcelName = req.file.originalname;

  res.json({ path: dest });
});

// ---------------------------------------------------------------------------
// POST /validate
// ---------------------------------------------------------------------------

analysisRouter.post('/validate', (req: Request, res: Response) => {
  const { type, path: targetPath } = req.body as { type: 'excel' | 'repo'; path: string };

  if (!type || !targetPath) {
    res.status(400).json({ error: '"type" and "path" are required' });
    return;
  }

  if (type === 'excel') {
    if (!fs.existsSync(targetPath)) {
      res.json({ ok: false, error: `File not found: ${targetPath}` });
      return;
    }
    const ext = path.extname(targetPath).toLowerCase();
    if (ext !== '.xlsx' && ext !== '.xls') {
      res.json({ ok: false, error: 'File must be .xlsx or .xls' });
      return;
    }
    try {
      const buf = fs.readFileSync(targetPath);
      if (!isRhwWorkbook(buf)) {
        const tabs = parseWorkbook(buf);
        res.json({
          ok: false,
          error: `File does not appear to be a Rules Harvesting Workbook. Tabs found: ${tabs.slice(0, 10).join(', ')}`,
        });
        return;
      }
      session.lastExcelBuffer = buf;
      session.lastExcelName = path.basename(targetPath);
      res.json({ ok: true });
    } catch (err) {
      res.json({ ok: false, error: `Cannot read file: ${String(err)}` });
    }
    return;
  }

  if (type === 'repo') {
    const result = validateRepo(targetPath);
    if (!result.valid) {
      res.json({ ok: false, error: result.message ?? 'Invalid repository' });
      return;
    }
    session.lastRepoPath = targetPath;
    // Invalidate cache if repo path changed
    if (session.ruleIndexCacheRepoPath !== targetPath) {
      session.ruleIndexCache = null;
      session.ruleIndexCacheRepoPath = null;
    }
    res.json({
      ok: true,
      rule_files: result.rule_files,
      message: result.message,
    });
    return;
  }

  res.status(400).json({ error: 'type must be "excel" or "repo"' });
});

// ---------------------------------------------------------------------------
// POST /load_tabs
// ---------------------------------------------------------------------------

analysisRouter.post('/load_tabs', async (req: Request, res: Response) => {
  const { excel, repo } = req.body as {
    excel: string;
    repo: string;
    gitlab_branch?: string;
  };

  if (!excel) {
    res.status(400).json({ error: '"excel" is required' });
    return;
  }

  // Load Excel
  let buf: Buffer;
  try {
    buf = fs.readFileSync(excel);
  } catch {
    res.json({ error: `Cannot read Excel file: ${excel}` });
    return;
  }
  session.lastExcelBuffer = buf;
  session.lastRepoPath = repo;

  // Get all tab names
  let tabs: string[];
  try {
    tabs = parseWorkbook(buf);
  } catch (err) {
    res.json({ error: `Failed to parse workbook: ${String(err)}` });
    return;
  }

  // Classify each tab
  const tabTypes: Record<string, TabType> = {};
  for (const tab of tabs) {
    try {
      tabTypes[tab] = classifyTab(buf, tab);
    } catch {
      tabTypes[tab] = 'REFERENCE';
    }
  }

  const groups = groupTabs(tabs);

  // Generate Excel index markdown for Kiro prompts
  try {
    const workbookName = path.basename(excel);
    const indexResult = generateExcelIndex(excel, workbookName);
    session.excelIndexPath = indexResult.filePath;
    console.log(`[ExcelIndex] Generated: ${indexResult.filePath} (${indexResult.tabCount} tabs, ${indexResult.totalRows} rows)`);
  } catch (err) {
    console.warn(`[ExcelIndex] Failed to generate index: ${String(err)}`);
    session.excelIndexPath = null;
  }

  res.json({
    tabs,
    tab_types: tabTypes,
    groups,
    tabs_with_images: [],
  });
});

// ---------------------------------------------------------------------------
// POST /run_analysis
// ---------------------------------------------------------------------------

analysisRouter.post('/run_analysis', async (req: Request, res: Response) => {
  const { excel, repo, tab, out } = req.body as {
    excel: string;
    repo: string;
    tab: string;
    out?: string;
    index?: string;
    model?: string;
  };

  if (!excel || !repo || !tab) {
    res.status(400).json({ error: '"excel", "repo", and "tab" are required' });
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
  const safeTab = tab.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
  const resolvedOut = out || path.join(os.homedir(), 'Documents', 'RHW-Analysis', 'reports', `${safeTab}-${timestamp}.html`);

  try {
    const result = await runAnalysisPipeline(excel, repo, tab, resolvedOut);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ---------------------------------------------------------------------------
// POST /run_analysis_stream  (SSE)
// ---------------------------------------------------------------------------

analysisRouter.post('/run_analysis_stream', async (req: Request, res: Response) => {
  const { excel, repo, tab, out } = req.body as {
    excel: string;
    repo: string;
    tab: string;
    out?: string;
    model?: string;
  };

  if (!excel || !repo || !tab) {
    res.status(400).json({ error: '"excel", "repo", and "tab" are required' });
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
  const safeTab = tab.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
  const resolvedOut = out || path.join(os.homedir(), 'Documents', 'RHW-Analysis', 'reports', `${safeTab}-${timestamp}.html`);

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event: StreamEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    // Phase: indexing
    send({ type: 'progress', message: 'Indexing rules…', phase: 'indexing' });

    let buf: Buffer;
    try {
      buf = fs.readFileSync(excel);
    } catch {
      send({ type: 'error', error: `Cannot read Excel file: ${excel}` });
      res.end();
      return;
    }

    const repoValidation = validateRepo(repo);
    if (!repoValidation.valid) {
      send({ type: 'error', error: repoValidation.message ?? 'Invalid repository' });
      res.end();
      return;
    }

    send({
      type: 'progress',
      message: `Indexing rules (${repoValidation.rule_files} files found)…`,
      phase: 'indexing',
    });

    const repoRules = getRepoRules(repo);

    // Phase: forward check
    send({
      type: 'progress',
      message: `Forward check: parsing tab "${tab}"…`,
      phase: 'forward_check',
    });

    // Classify tab to determine analysis strategy
    const tabType = classifyTab(buf, tab);
    let gaps;
    // excelRules kept in scope for reverse check (RULE_NAMES tabs only)
    let excelRulesForReverse: RuleEntry[] | null = null;
    // matched rule names from PROSE scoring (for reverse check filter)
    const matchedRuleNames = new Set<string>();
    // statements kept in scope for reverse check semantic scoring
    let statementsForReverse: import('../services/excelParser').BusinessStatement[] = [];

    if (tabType === 'RULE_NAMES' || tabType === 'LEGALITY_DECISION_TABLE' || tabType === 'LEGALITY_MASTER' || tabType === 'LOOKUP_TABLE') {
      // Forward check: match Excel rule names against repo
      let excelRules;
      try {
        excelRules = parseTab(buf, tab);
      } catch (err) {
        send({ type: 'error', error: `Failed to parse tab: ${String(err)}` });
        res.end();
        return;
      }
      excelRulesForReverse = excelRules;
      // Also extract statements for reverse check scoring
      statementsForReverse = extractStatements(buf, tab);
      gaps = analyzeGaps(excelRules, repoRules);
    } else {
      // PROSE or REFERENCE — statement-by-statement analysis
      send({
        type: 'progress',
        message: `Extracting business statements…`,
        phase: 'forward_check',
      });

      const statements = extractStatements(buf, tab);
      statementsForReverse = statements;
      const verifiableCount = statements.filter(s => s.type !== 'DESCRIPTION').length;

      if (statements.length === 0) {
        send({ type: 'error', error: `Tab "${tab}" appears to be empty — nothing to analyze.` });
        res.end();
        return;
      }

      send({
        type: 'progress',
        message: `Found ${statements.length} statements (${verifiableCount} verifiable) — scoring against repo…`,
        phase: 'forward_check',
      });

      gaps = analyzeProseTabByStatement(tab, statements, repoRules);
      // Track matched rule names for semantic reverse check filter
      for (const g of gaps) {
        if (g.code_name) matchedRuleNames.add(g.code_name.toLowerCase());
      }
    }

    // Emit each rule result
    for (const result of gaps) {
      send({ type: 'rule', result });
    }

    // Phase: reverse check — top 25 semantically related rules not in Excel
    send({ type: 'progress', message: 'Running reverse check…', phase: 'report' });

    const undocumentedEntries = findUndocumentedByRulesets(statementsForReverse, gaps, repoRules, 25);

    // Phase: Kiro verification
    send({
      type: 'progress',
      message: `Kiro verifying ${gaps.length} forward result(s) and ${undocumentedEntries.length} reverse candidate(s)…`,
      phase: 'kiro_verify',
    });

    const kiroResult = await runKiroVerification({
      tabName:        tab,
      tabType:        tabType,
      repoPath:       repo,
      forward:        gaps,
      reverse:        undocumentedEntries,
      repoRules,
      excelIndexPath: session.excelIndexPath ?? undefined,
    });

    // Use Kiro-updated results if verification ran successfully
    const finalGaps = kiroResult.skipped ? gaps : kiroResult.forward;
    // When Kiro ran: reverse is already UndocumentedRule[] with business_statement + sheet_name
    // When skipped: map RuleEntry[] to UndocumentedRule[]
    const undocumentedRules = kiroResult.skipped
      ? undocumentedEntries.map(e => ({ name: e.name, source: e.source }))
      : kiroResult.reverse;

    if (kiroResult.error) {
      send({
        type: 'progress',
        message: `Kiro verification skipped: ${kiroResult.error}`,
        phase: 'kiro_verify',
      });
    } else if (!kiroResult.skipped) {
      send({
        type: 'progress',
        message: `Kiro verification complete.`,
        phase: 'kiro_verify',
      });
    }

    // Phase: generate report
    send({ type: 'progress', message: 'Generating HTML report…', phase: 'report' });

    const reportHtml = generateHtmlReport(tab, finalGaps, undocumentedRules);

    fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
    fs.writeFileSync(resolvedOut, reportHtml, 'utf8');
    session.lastReportPath = resolvedOut;

    const counts = countStatuses(finalGaps);

    send({
      type: 'complete',
      counts,
      undocumented: undocumentedRules.length,
      undocumented_rules: undocumentedRules,
      results: finalGaps,
      report_url: '/api/analysis/report',
      report_path: resolvedOut,
      rule_index: null,
      annotated_excel: null,
    });
  } catch (err) {
    send({ type: 'error', error: String(err) });
  }

  res.end();
});

// ---------------------------------------------------------------------------
// POST /ask_kiro
// ---------------------------------------------------------------------------

analysisRouter.post('/ask_kiro', async (req: Request, res: Response) => {
  const { question, repo } = req.body as { question?: string; repo?: string };

  if (!question) {
    res.status(400).json({ error: '"question" is required' });
    return;
  }

  const repoPath = repo ?? session.lastRepoPath ?? '';
  const prompt = repoPath
    ? `You are analyzing a Blaze Advisor rules repository at: ${repoPath}\n\n${question}\n\nAnswer in 2-3 sentences.`
    : `${question}\n\nAnswer in 2-3 sentences.`;

  const result = await runKiro(prompt, 'claude-haiku-4.5', 90_000);

  if (!result.success) {
    if (result.error?.includes('not found')) {
      res.status(503).json({ error: result.error });
    } else if (result.error?.includes('timed out')) {
      res.status(504).json({ error: result.error });
    } else {
      res.status(500).json({ error: result.error ?? 'Unknown Kiro error' });
    }
    return;
  }

  res.json({ answer: result.output.slice(0, 2000) });
});

// ---------------------------------------------------------------------------
// GET /report
// ---------------------------------------------------------------------------

analysisRouter.get('/report', (_req: Request, res: Response) => {
  if (!session.lastReportPath || !fs.existsSync(session.lastReportPath)) {
    res.status(404).json({ error: 'No report generated yet. Run an analysis first.' });
    return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.sendFile(session.lastReportPath);
});

// ---------------------------------------------------------------------------
// GET /download_annotated_excel
// ---------------------------------------------------------------------------

analysisRouter.get('/download_annotated_excel', (_req: Request, res: Response) => {
  if (!session.lastAnnotatedExcelPath || !fs.existsSync(session.lastAnnotatedExcelPath)) {
    res.status(404).json({ error: 'No annotated Excel available. Run an analysis first.' });
    return;
  }
  const fileName = path.basename(session.lastAnnotatedExcelPath);
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.sendFile(session.lastAnnotatedExcelPath);
});

// ---------------------------------------------------------------------------
// GET /home_info
// ---------------------------------------------------------------------------

analysisRouter.get('/home_info', (_req: Request, res: Response) => {
  const home = os.homedir();
  const platform = process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'Darwin' : 'Linux';
  res.json({
    home,
    sep: path.sep,
    out_root: path.join(home, 'Documents', 'RHW-Analysis'),
    engine: 'blaze',
    platform,
  });
});

// ---------------------------------------------------------------------------
// POST /clear_cache  (stub — no git cache in this implementation)
// ---------------------------------------------------------------------------

analysisRouter.post('/clear_cache', (_req: Request, res: Response) => {
  res.json({ ok: true, message: 'Cache cleared. Click Load Tabs to re-clone fresh.' });
});

// ---------------------------------------------------------------------------
// Pipeline helper
// ---------------------------------------------------------------------------

async function runAnalysisPipeline(
  excel: string,
  repo: string,
  tab: string,
  out: string
): Promise<RunAnalysisResponse> {
  const buf = fs.readFileSync(excel);
  const repoRules = indexRules(repo);
  const excelRules = parseTab(buf, tab);
  const gaps = analyzeGaps(excelRules, repoRules);
  const undocumented = findUndocumentedRules(excelRules, repoRules);

  const reportHtml = generateHtmlReport(tab, gaps, undocumented);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, reportHtml, 'utf8');
  session.lastReportPath = out;

  const counts = countStatuses(gaps);

  return {
    counts,
    undocumented: undocumented.length,
    report_url: '/api/analysis/report',
    report_path: out,
    index_written: false,
    index_path: null,
    rule_index: null,
    annotated_excel: null,
  };
}

// ---------------------------------------------------------------------------
// HTML report generator
// ---------------------------------------------------------------------------

function generateHtmlReport(
  tabName: string,
  gaps: GapResult[],
  undocumented: UndocumentedRule[]
): string {
  const counts = countStatuses(gaps);
  const timestamp = new Date().toLocaleString();

  const statusColor = (status: string): string => {
    const map: Record<string, string> = {
      MATCH: '#d4edda',
      MISSING: '#f8d7da',
      MISMATCH: '#fff3cd',
      NAME_TYPO: '#fff3cd',
      REMOVED: '#e2e3e5',
      NOT_IMPLEMENTED: '#e2e3e5',
    };
    return map[status] ?? '#ffffff';
  };

  const badgeColor = (action: string): string => {
    if (action === 'UPDATE_RHW') return '#dae8ff';
    if (action === 'VERIFY_WITH_BUSINESS') return '#fef3c7';
    if (action === 'NO_ACTION') return '#d4edda';
    return '#f0f0f0';
  };

  const badgeLabel = (action: string): string => {
    if (action === 'UPDATE_RHW') return '📝 Update RHW';
    if (action === 'VERIFY_WITH_BUSINESS') return '🔍 Verify With Business';
    if (action === 'NO_ACTION') return '✓ No Action';
    return action;
  };

  const rows = gaps.map((g) => `
    <tr style="background:${statusColor(g.status)}">
      <td>${g.row_num}</td>
      <td>${esc(g.excel_name)}</td>
      <td>${esc(g.code_name || '—')}</td>
      <td><strong>${esc(g.status)}</strong></td>
      <td style="max-width:300px;font-size:0.85em">${g.issues.map(esc).join('<br>')}</td>
      <td>
        <span style="background:${badgeColor(g.recommendation.action)};padding:2px 8px;border-radius:4px;white-space:nowrap">
          ${badgeLabel(g.recommendation.action)}
        </span>
      </td>
      <td style="font-size:0.8em;color:#666">${esc(g.rule_file ?? '—')}</td>
    </tr>`).join('');

  const undocRows = undocumented.slice(0, 100).map((u) => {
    const found = !!(u as any).business_statement;
    const rowBg = found ? '#f0fff4' : '#fff5f5';
    const borderLeft = found ? '3px solid #2a8a2a' : '3px solid #cc3300';
    const sheetCell = (u as any).sheet_name
      ? `<span style="background:#e8f0fe;color:#0055aa;border:1px solid #aac4ee;border-radius:4px;padding:1px 7px;font-size:11px;font-weight:600">${esc((u as any).sheet_name)}</span>`
      : `<span style="color:#cc3300;font-style:italic">Not found</span>`;
    const stmtCell = (u as any).business_statement
      ? esc((u as any).business_statement)
      : `<span style="color:#cc3300;font-style:italic;font-weight:600">Not documented in workbook</span>`;
    return `
    <tr style="background:${rowBg};border-left:${borderLeft}">
      <td style="font-family:monospace;font-size:12px">${esc(u.name)}</td>
      <td style="font-size:0.8em;color:#666;font-family:monospace">${esc(u.source)}</td>
      <td>${sheetCell}</td>
      <td style="font-size:0.85em">${stmtCell}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Gap Analysis — ${esc(tabName)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 20px; color: #333; }
    h1 { font-size: 1.4em; margin-bottom: 4px; }
    .meta { color: #666; font-size: 0.85em; margin-bottom: 20px; }
    .counts { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 20px; }
    .count-badge { padding: 4px 14px; border-radius: 20px; font-size: 0.85em; font-weight: 600; }
    table { border-collapse: collapse; width: 100%; font-size: 0.9em; }
    th { background: #f5f5f5; text-align: left; padding: 8px 10px; border-bottom: 2px solid #ddd; position: sticky; top: 0; }
    td { padding: 6px 10px; border-bottom: 1px solid #eee; vertical-align: top; }
    h2 { margin-top: 32px; font-size: 1.1em; }
    .section-label { font-size: 0.75em; background: #eee; padding: 1px 6px; border-radius: 3px; margin-left: 6px; }
  </style>
</head>
<body>
  <h1>Gap Analysis Report — ${esc(tabName)}</h1>
  <div class="meta">Generated: ${timestamp}</div>

  <div class="counts">
    <span class="count-badge" style="background:#d4edda">✓ MATCH: ${counts.MATCH}</span>
    <span class="count-badge" style="background:#f8d7da">✗ MISSING: ${counts.MISSING}</span>
    <span class="count-badge" style="background:#fff3cd">⚠ MISMATCH: ${counts.MISMATCH}</span>
    <span class="count-badge" style="background:#fff3cd">✎ NAME_TYPO: ${counts.NAME_TYPO}</span>
    <span class="count-badge" style="background:#e2e3e5">REMOVED: ${counts.REMOVED}</span>
    <span class="count-badge" style="background:#e2e3e5">NOT_IMPL: ${counts.NOT_IMPLEMENTED}</span>
    <span class="count-badge" style="background:#e8f4fd">UNDOC: ${undocumented.length}</span>
  </div>

  <h2>Forward Check Results</h2>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Excel Name</th>
        <th>Code Name</th>
        <th>Status</th>
        <th>Issues</th>
        <th>Recommendation</th>
        <th>File</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  ${undocumented.length > 0 ? `
  <h2>Reverse Check — Rules found in repo related to this tab (${undocumented.length})</h2>
  <table>
    <thead><tr><th>Rule Name</th><th>File</th><th>Sheet</th><th>Business Statement</th></tr></thead>
    <tbody>${undocRows}</tbody>
  </table>` : ''}
</body>
</html>`;
}

function countStatuses(gaps: GapResult[]): RunAnalysisResponse['counts'] {
  const counts = { MATCH: 0, NAME_TYPO: 0, MISMATCH: 0, MISSING: 0, REMOVED: 0, NOT_IMPLEMENTED: 0 };
  for (const g of gaps) {
    if (g.status in counts) (counts as Record<string, number>)[g.status]++;
  }
  return counts;
}

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
