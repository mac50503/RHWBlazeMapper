/**
 * excelParser.ts
 *
 * Parses Excel workbooks (.xlsx / .xls) and extracts:
 * - Sheet names from the workbook
 * - Rule entries (ruleXxx / fcnXxx patterns) from a named tab
 *
 * Uses the 'xlsx' (SheetJS) package.
 */

import * as XLSX from 'xlsx';
import { RuleEntry, TabType } from '../types';

// Patterns that identify Blaze rule / function names
const RULE_NAME_PATTERN = /^(rule[A-Z]\w*|fcn[A-Z]\w*|dt[A-Z]\w*|ct[A-Z]\w*|rs[A-Z]\w*)/;

// RHW keyword check — workbook must contain at least one of these to be valid
const RHW_KEYWORDS = [
  'legality', 'pay', 'vacancy', 'rest', 'credits', 'rules harvesting',
  'rhw', 'harvesting workbook',
];

/**
 * Return all sheet names from the workbook buffer.
 */
export function parseWorkbook(buffer: Buffer): string[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  return workbook.SheetNames;
}

/**
 * Return true if the workbook looks like a Rules Harvesting Workbook.
 * Checks that at least one sheet name matches an RHW keyword.
 */
export function isRhwWorkbook(buffer: Buffer): boolean {
  const names = parseWorkbook(buffer);
  const lower = names.map((n) => n.toLowerCase());
  return lower.some((n) => RHW_KEYWORDS.some((kw) => n.includes(kw)));
}

/**
 * Extract rule entries (ruleXxx / fcnXxx names) from a named tab.
 *
 * Scans every column of every row for cells whose string value matches
 * RULE_NAME_PATTERN. Returns unique entries in order of first appearance.
 *
 * @param buffer   Raw workbook bytes
 * @param tabName  Sheet name to parse
 */
export function parseTab(buffer: Buffer, tabName: string): RuleEntry[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[tabName];

  if (!sheet) {
    throw new Error(`Sheet "${tabName}" not found in workbook`);
  }

  // Convert to array-of-arrays (raw cell values as strings)
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    blankrows: true,
  });

  const results: RuleEntry[] = [];
  const seen = new Set<string>();
  let currentSection = '';

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx] as unknown[];
    const rowStrings = row.map((cell) => (cell == null ? '' : String(cell).trim()));

    // Track section headers: rows where col-0 looks like a heading
    // (non-empty, no rule pattern, not a pure number)
    const col0 = rowStrings[0];
    if (col0 && !RULE_NAME_PATTERN.test(col0) && !/^\d/.test(col0)) {
      currentSection = col0;
    }

    // Scan every column for rule names
    for (let colIdx = 0; colIdx < rowStrings.length; colIdx++) {
      const cell = rowStrings[colIdx];
      if (!cell) continue;

      if (RULE_NAME_PATTERN.test(cell) && !seen.has(cell)) {
        seen.add(cell);
        results.push({
          name:     cell,
          source:   `row:${rowIdx + 1}`,
          section:  currentSection,
          rowData:  rowStrings,
        });
      }
    }
  }

  return results;
}

/**
 * Auto-detect tab type from content.
 *
 * Detection priority (first match wins):
 *   LEGALITY_DECISION_TABLE  — col-0 header "Rule Description" + "Message" col exists
 *   LEGALITY_MASTER          — 50+ rule IDs matching X_Xxx_NNN pattern in col 2
 *   RULE_NAMES               — ≥30% of sampled cells match ruleXxx/fcnXxx, ≥5 total
 *   PROSE_LOGIC              — ≥3 cells with business-rule language markers
 *   LOOKUP_TABLE             — short uppercase codes + TFP numbers
 *   REFERENCE                — otherwise (nothing checkable)
 */
export function classifyTab(buffer: Buffer, tabName: string): TabType {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[tabName];

  if (!sheet) return 'REFERENCE';

  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    blankrows: false,
  });

  if (rows.length === 0) return 'REFERENCE';

  const headerRow = (rows[0] as unknown[]).map((c) => String(c).trim().toLowerCase());

  // LEGALITY_DECISION_TABLE: first col header contains "rule description" + "message" col
  if (
    headerRow[0]?.includes('rule description') &&
    headerRow.some((h) => h.includes('message'))
  ) {
    return 'LEGALITY_DECISION_TABLE';
  }

  // LEGALITY_MASTER: 50+ IDs like F_RestAmt_001 in column 2
  const RULE_ID_PAT = /^[A-Z]_[A-Za-z]+_\d{3,}$/;
  const col2Values = rows
    .slice(1, 200)
    .map((r) => String((r as unknown[])[2] ?? '').trim());
  const ruleIdCount = col2Values.filter((v) => RULE_ID_PAT.test(v)).length;
  if (ruleIdCount >= 50) return 'LEGALITY_MASTER';

  // RULE_NAMES: ≥30% ruleXxx/fcnXxx names across sampled rows, ≥5 total
  // Track per-column counts (same as Python reference)
  const colRuleCount: Record<number, number> = {};
  const colTotalCount: Record<number, number> = {};
  const sampleRows = rows.slice(0, 100);
  let proseScore = 0;

  // Business-rule language markers (from Python reference _classify_single_tab)
  const PROSE_MARKERS = [
    'for each', 'if my', 'if the',
    'buckets:', 'nonfly code', 'assignment label',
    'trip class', "leg's",
    'revision history',
    '(dreamers', '(apic', '(crew',
    'rate of pay', 'wage code',
    'leg code takes priority',
    'description:',
    'when a limo', 'when a leg',
    'in order of priority',
    // Additional markers for common RHW prose patterns
    'if a leg', 'when the', 'for all',
    'shall be', 'is defined as', 'is calculated',
    'base credit', 'premium credit', 'duty period',
  ];

  for (const row of sampleRows) {
    for (let colIdx = 0; colIdx < (row as unknown[]).length; colIdx++) {
      const val = String((row as unknown[])[colIdx] ?? '').trim();
      if (!val) continue;

      colTotalCount[colIdx] = (colTotalCount[colIdx] ?? 0) + 1;

      if (RULE_NAME_PATTERN.test(val)) {
        colRuleCount[colIdx] = (colRuleCount[colIdx] ?? 0) + 1;
      }

      const valLower = val.toLowerCase();
      if (PROSE_MARKERS.some((m) => valLower.includes(m))) {
        proseScore++;
      }
    }
  }

  // Check RULE_NAMES: any column with ≥30% rule names and ≥5 total
  for (const [colIdx, ruleCount] of Object.entries(colRuleCount)) {
    const total = colTotalCount[Number(colIdx)] ?? 0;
    if (total > 0 && ruleCount >= 5 && ruleCount / total >= 0.3) {
      return 'RULE_NAMES';
    }
  }

  // PROSE_LOGIC: ≥3 cells with business-rule language markers
  if (proseScore >= 3) {
    return 'PROSE_LOGIC';
  }

  // LOOKUP_TABLE: short uppercase codes + TFP numbers in first two columns
  const UPPERCASE_CODE = /^[A-Z]{2,6}$/;
  const TFP_NUMBER = /^\d+(\.\d+)?$/;
  let lookupMatches = 0;
  for (const row of rows.slice(1, 30)) {
    const r = row as unknown[];
    const c0 = String(r[0] ?? '').trim();
    const c1 = String(r[1] ?? '').trim();
    if (UPPERCASE_CODE.test(c0) && TFP_NUMBER.test(c1)) lookupMatches++;
  }
  if (lookupMatches >= 5) return 'LOOKUP_TABLE';

  return 'REFERENCE';
}

/**
 * Extract all text content from a tab as a single string.
 * Used for PROSE tabs where semantic scoring is needed instead of rule name matching.
 */
export function extractTabText(buffer: Buffer, tabName: string): string {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[tabName];
  if (!sheet) return '';

  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    blankrows: false,
  });

  return rows
    .map((row) =>
      (row as unknown[])
        .map((c) => (c == null ? '' : String(c).trim()))
        .filter(Boolean)
        .join(' ')
    )
    .filter(Boolean)
    .join('\n');
}

/**
 * A single business statement extracted from a PROSE tab.
 */
export interface BusinessStatement {
  text:    string;
  rowNum:  number;
  type:    'CONDITION' | 'FORMULA' | 'DESCRIPTION';
}

/**
 * Extract individual business statements from a PROSE tab.
 *
 * - CONDITION: rows starting with "if/when/for each" — verifiable rule logic
 * - FORMULA:   rows containing calculation patterns (ROUND, TRUNC, = Greater of)
 * - DESCRIPTION: narrative context rows
 *
 * Skips metadata rows (dates, revision history, headers).
 */
export function extractStatements(buffer: Buffer, tabName: string): BusinessStatement[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[tabName];
  if (!sheet) return [];

  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    blankrows: false,
  });

  const CONDITION_PAT = /^(if\b|If\b|when\b|When\b|for each\b|For each\b)/i;
  const FORMULA_PAT   = /=\s*(ROUND|TRUNC|CEILING|FLOOR|MAX|MIN|Greater of|SUM)/i;
  const SKIP_PAT      = /^(date\b|by\b|revised|effective|expiration|rule owner|analyst|reference|baseline|ruleset metadata|description:|revision history)/i;
  const DATE_SERIAL   = /^\d{5}$/;  // Excel serial dates like 41898

  const statements: BusinessStatement[] = [];

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx] as unknown[];
    const cells = row.map(c => String(c ?? '').trim()).filter(Boolean);
    if (cells.length === 0) continue;

    const text = cells.join(' ').trim();
    if (text.length < 15) continue;
    if (SKIP_PAT.test(text)) continue;
    if (DATE_SERIAL.test(cells[0])) continue;  // revision history row

    let type: BusinessStatement['type'];
    if (CONDITION_PAT.test(text)) {
      type = 'CONDITION';
    } else if (FORMULA_PAT.test(text)) {
      type = 'FORMULA';
    } else {
      type = 'DESCRIPTION';
    }

    statements.push({ text, rowNum: rowIdx + 1, type });
  }

  return statements;
}

export function groupTabs(tabNames: string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {};

  for (const tab of tabNames) {
    // Derive group from first meaningful word segment in the tab name
    const group = deriveGroup(tab);
    if (!groups[group]) groups[group] = [];
    groups[group].push(tab);
  }

  return groups;
}

function deriveGroup(tabName: string): string {
  const lower = tabName.toLowerCase();
  if (lower.includes('legality')) return 'Legality';
  if (lower.includes('pay') || lower.includes('credit')) return 'Pay';
  if (lower.includes('rest') || lower.includes('duty') || lower.includes('fdp')) return 'Rest & Duty';
  if (lower.includes('vacancy')) return 'Vacancy';
  if (lower.includes('reserve')) return 'Reserve';
  if (lower.includes('lookup') || lower.includes('table')) return 'Lookup Tables';
  return 'Other';
}
