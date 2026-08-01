/**
 * excelIndexer.ts
 *
 * Generates a plain-text markdown index of all tabs in an Excel workbook.
 * The index is used to enrich Kiro prompts so Kiro can find business statements
 * without reading the binary .xlsx file directly.
 *
 * Generated at Load Tabs time — once per workbook, cached to disk.
 *
 * Output format:
 *
 *   # Excel Index — <workbook name>
 *   Generated: <timestamp>
 *
 *   ## Tab: Leg Base Credits [RULE_NAMES]
 *   Row 21 | For each Leg: check NM/NP legs first, then Forced credits...
 *   Row 22 | if my Leg's deadhead code is in the list (NM, NP), Base Credits = 0.00
 *   ...
 *
 *   ## Tab: Leg Premium Credits [PROSE_LOGIC]
 *   Row 15 | If trip label is "D", apply premium pay...
 *   ...
 */

import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { classifyTab } from './excelParser';
import type { TabType } from '../types';

// Max rows to index per tab (keeps the file manageable)
const MAX_ROWS_PER_TAB = 200;

// Min cell length to include (skip empty/trivial cells)
const MIN_CELL_LENGTH = 3;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ExcelIndexResult {
  /** Absolute path to the generated markdown file */
  filePath: string;
  /** Number of tabs indexed */
  tabCount: number;
  /** Total rows indexed across all tabs */
  totalRows: number;
}

/**
 * Generate a plain-text markdown index of all tabs in the workbook.
 * Saves to the same directory as the Excel file with a .index.md extension.
 *
 * @param excelPath   Absolute path to the .xlsx file
 * @param workbookName  Display name (original filename)
 * @returns ExcelIndexResult with the path to the generated file
 */
export function generateExcelIndex(
  excelPath: string,
  workbookName: string
): ExcelIndexResult {
  const buf = fs.readFileSync(excelPath);
  const workbook = XLSX.read(buf, { type: 'buffer' });
  const tabs = workbook.SheetNames;

  const lines: string[] = [];
  const timestamp = new Date().toLocaleString();

  lines.push(`# Excel Index — ${workbookName}`);
  lines.push(`Generated: ${timestamp}`);
  lines.push(`Tabs: ${tabs.length}`);
  lines.push('');

  let totalRows = 0;

  for (const tabName of tabs) {
    // Classify the tab
    let tabType: TabType;
    try {
      tabType = classifyTab(buf, tabName);
    } catch {
      tabType = 'REFERENCE';
    }

    // Skip purely reference tabs to keep the index lean
    // REFERENCE tabs have no verifiable rules — Kiro doesn't need them
    if (tabType === 'REFERENCE') continue;

    const sheet = workbook.Sheets[tabName];
    if (!sheet) continue;

    const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
      blankrows: false,
    });

    lines.push(`## Tab: ${tabName} [${tabType}]`);

    let rowsIndexed = 0;
    for (let rowIdx = 0; rowIdx < rows.length && rowsIndexed < MAX_ROWS_PER_TAB; rowIdx++) {
      const row = rows[rowIdx] as unknown[];

      // Collect non-trivial cells
      const cells = row
        .map(c => (c == null ? '' : String(c).trim()))
        .filter(c => c.length >= MIN_CELL_LENGTH);

      if (cells.length === 0) continue;

      // Join cells with pipe separator — readable and parseable
      const rowText = cells.join(' | ');

      lines.push(`Row ${rowIdx + 1} | ${rowText}`);
      rowsIndexed++;
      totalRows++;
    }

    if (rows.length > MAX_ROWS_PER_TAB) {
      lines.push(`[... ${rows.length - MAX_ROWS_PER_TAB} more rows truncated ...]`);
    }

    lines.push('');
  }

  // Save to uploads dir next to the Excel file
  const dir = path.dirname(excelPath);
  const baseName = path.basename(excelPath, path.extname(excelPath));
  const outPath = path.join(dir, `${baseName}.index.md`);

  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');

  return {
    filePath: outPath,
    tabCount: tabs.filter(t => {
      try { return classifyTab(buf, t) !== 'REFERENCE'; } catch { return false; }
    }).length,
    totalRows,
  };
}

/**
 * Read the Excel index file and return its content as a string.
 * Returns empty string if the file does not exist.
 */
export function readExcelIndex(indexPath: string): string {
  try {
    return fs.readFileSync(indexPath, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Extract only the section for a specific tab from the full index.
 * Useful when sending a focused prompt for one tab.
 */
export function extractTabSection(indexContent: string, tabName: string): string {
  const header = `## Tab: ${tabName}`;
  const start = indexContent.indexOf(header);
  if (start === -1) return '';

  // Find next ## Tab: or end of file
  const nextTab = indexContent.indexOf('\n## Tab:', start + header.length);
  const section = nextTab === -1
    ? indexContent.slice(start)
    : indexContent.slice(start, nextTab);

  return section.trim();
}
