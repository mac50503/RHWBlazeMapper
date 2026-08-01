/**
 * kiroVerifier.ts
 *
 * Post-analysis verification service.
 *
 * Takes the already-computed forward check results and reverse check candidates,
 * sends them to Kiro CLI in a single call, and returns updated results.
 *
 * Kiro does NOT re-index the repo. It only validates using:
 *   - The rule body already extracted by blazeIndexer (passed inline in the prompt)
 *   - The repo path for any additional targeted reads Kiro needs
 *
 * Input:
 *   - forward: GapResult[] from analyzeGaps / analyzeProseTabByStatement
 *   - reverse: RuleEntry[] undocumented candidates from findUndocumentedRules
 *   - repoRules: Map<string, RuleEntry> indexed repo (for body lookup)
 *
 * Output:
 *   - forward: updated GapResult[] (MISSING may upgrade to NAME_TYPO, MISMATCH to MATCH)
 *   - reverse: filtered RuleEntry[] (only genuinely undocumented remain)
 */

import fs from 'fs';
import path from 'path';
import { runKiro } from './kiroRunner';
import type { GapResult, RuleEntry } from '../types';

// Max items to send in a single batch (to stay within Kiro context window)
const MAX_FORWARD_ITEMS = 30;
const MAX_REVERSE_ITEMS = 25;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface KiroVerifyInput {
  tabName:        string;
  tabType:        string;
  repoPath:       string;
  forward:        GapResult[];
  reverse:        RuleEntry[];
  repoRules:      Map<string, RuleEntry>;
  /** Path to the generated Excel index markdown file (optional) */
  excelIndexPath?: string;
}

export interface KiroVerifyOutput {
  forward:    GapResult[];
  reverse:    import('../types').UndocumentedRule[];
  skipped:    boolean;   // true if Kiro was not called (nothing to verify or error)
  error?:     string;
}

/**
 * Run Kiro verification on forward + reverse check results.
 * Only sends items that actually need verification:
 *   - Forward: MISSING and MISMATCH (MATCH is already confirmed)
 *   - Reverse: all undocumented candidates
 */
export async function runKiroVerification(input: KiroVerifyInput): Promise<KiroVerifyOutput> {
  const { tabName, tabType, repoPath, forward, reverse, repoRules, excelIndexPath } = input;

  // Send all forward check results to Kiro for verification — not just gaps
  // A mechanical MATCH needs Kiro confirmation just as much as a MISSING
  const forwardToVerify = forward.slice(0, MAX_FORWARD_ITEMS);

  const reverseToVerify = reverse.slice(0, MAX_REVERSE_ITEMS);

  // Convert RuleEntry[] to UndocumentedRule[] base format for skipped returns
  const reverseAsUndoc = reverse.map(r => ({ name: r.name, source: r.source }));

  // Nothing to verify
  if (forwardToVerify.length === 0 && reverseToVerify.length === 0) {
    return { forward, reverse: reverseAsUndoc, skipped: true };
  }

  // Build the prompt
  const prompt = buildVerifyPrompt({
    tabName,
    tabType,
    repoPath,
    forwardItems: forwardToVerify,
    reverseItems: reverseToVerify,
    repoRules,
    excelIndexPath,
  });

  // Call Kiro CLI
  const result = await runKiro(prompt, 'claude-haiku-4.5', 180_000);

  if (!result.success) {
    return { forward, reverse: reverseAsUndoc, skipped: true, error: result.error };
  }

  // Parse Kiro response
  const parsed = parseKiroResponse(result.output);
  if (!parsed) {
    return { forward, reverse: reverseAsUndoc, skipped: true, error: 'Kiro response was not valid JSON' };
  }

  // Apply forward updates
  const updatedForward = applyForwardUpdates(forward, parsed.forward);

  // Apply reverse — enrich with business_statement and sheet_name from Kiro
  const updatedReverse = applyReverseFilter(reverse, parsed.reverse);

  return { forward: updatedForward, reverse: updatedReverse, skipped: false };
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

interface PromptInput {
  tabName:        string;
  tabType:        string;
  repoPath:       string;
  forwardItems:   GapResult[];
  reverseItems:   RuleEntry[];
  repoRules:      Map<string, RuleEntry>;
  excelIndexPath?: string;
}

function buildVerifyPrompt(input: PromptInput): string {
  const { tabName, tabType, repoPath, forwardItems, reverseItems, repoRules, excelIndexPath } = input;

  // Load the prompt template
  const templatePath = path.join(__dirname, '..', 'prompts', 'kiro-verify.md');
  let template: string;
  try {
    template = fs.readFileSync(templatePath, 'utf8');
  } catch {
    template = buildFallbackTemplate();
  }

  // Load Excel index — extract only the section for this tab to keep prompt lean
  let excelIndexSection = '';
  if (excelIndexPath) {
    try {
      const { readExcelIndex, extractTabSection } = require('./excelIndexer');
      const fullIndex = readExcelIndex(excelIndexPath);
      if (fullIndex) {
        const tabSection = extractTabSection(fullIndex, tabName);
        excelIndexSection = tabSection
          ? `\n\n## Excel Workbook Content — ${tabName}\n\n${tabSection}`
          : `\n\n## Excel Workbook Content\n\n${fullIndex.slice(0, 4000)}`;
      }
    } catch {
      // Index not available — Kiro will work without it
    }
  }

  // Build FORWARD_ITEMS section
  const forwardSection = forwardItems.length > 0
    ? forwardItems.map((g, i) => {
        const entry = repoRules.get(g.code_name?.toLowerCase() ?? '') ??
                      repoRules.get(g.excel_name?.toLowerCase() ?? '');
        const body = entry?.body
          ? `\nRule body:\n\`\`\`\n${entry.body.slice(0, 800)}\n\`\`\``
          : '';
        const issues = g.issues.length > 0
          ? `\nIssues found: ${g.issues.join('; ')}`
          : '';
        return `${i + 1}. excel_name: "${g.excel_name}"
   code_name: "${g.code_name || 'NOT FOUND'}"
   current_status: ${g.status}
   file: ${entry?.source ?? 'unknown'}${issues}${body}`;
      }).join('\n\n')
    : '(none)';

  // Build REVERSE_ITEMS section
  const reverseSection = reverseItems.length > 0
    ? reverseItems.map((r, i) => {
        const body = r.body
          ? `\nRule body:\n\`\`\`\n${r.body.slice(0, 600)}\n\`\`\``
          : '';
        return `${i + 1}. name: "${r.name}"
   kind: ${r.kind ?? 'unknown'}
   file: ${r.source}${body}`;
      }).join('\n\n')
    : '(none)';

  // Replace placeholders
  return template
    .replace('{{TAB_NAME}}', tabName)
    .replace('{{TAB_TYPE}}', tabType)
    .replace('{{REPO_PATH}}', repoPath)
    .replace('{{EXCEL_INDEX}}', excelIndexSection)
    .replace('{{FORWARD_ITEMS}}', forwardSection)
    .replace('{{REVERSE_ITEMS}}', reverseSection);
}

function buildFallbackTemplate(): string {
  return `# Kiro Verification

Tab: {{TAB_NAME}} ({{TAB_TYPE}})
Repo: {{REPO_PATH}}

## PART 1 — Forward Check Validation
{{FORWARD_ITEMS}}

## PART 2 — Reverse Check Validation
{{REVERSE_ITEMS}}

Respond ONLY with valid JSON:
{
  "forward": [{"excel_name": "...", "status": "CONFIRMED|NOT_CONFIRMED|PARTIAL", "notes": "..."}],
  "reverse": [{"name": "...", "documented": true|false, "reason": "..."}]
}`;
}

// ---------------------------------------------------------------------------
// Response parser
// ---------------------------------------------------------------------------

interface KiroForwardItem {
  excel_name:         string;
  status:             'CONFIRMED' | 'NOT_CONFIRMED' | 'PARTIAL';
  correct_code_name?: string;
  notes:              string;
}

interface KiroReverseItem {
  name:               string;
  business_statement: string | null;
  sheet_name:         string | null;
}

interface KiroResponse {
  forward: KiroForwardItem[];
  reverse: KiroReverseItem[];
}

function parseKiroResponse(output: string): KiroResponse | null {
  // Strip ANSI codes and clean output
  const clean = output
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/▸[^\n]*\n/g, '')
    .trim();

  // Try to extract JSON block from output
  const jsonMatch =
    clean.match(/```json\s*([\s\S]*?)```/) ??
    clean.match(/```\s*([\s\S]*?)```/) ??
    clean.match(/(\{[\s\S]*\})/);

  const jsonStr = jsonMatch ? jsonMatch[1].trim() : clean;

  try {
    const parsed = JSON.parse(jsonStr) as KiroResponse;
    if (!Array.isArray(parsed.forward) || !Array.isArray(parsed.reverse)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Result mergers
// ---------------------------------------------------------------------------

function applyForwardUpdates(
  original: GapResult[],
  kiroUpdates: KiroForwardItem[]
): GapResult[] {
  if (!kiroUpdates || kiroUpdates.length === 0) return original;

  const updateMap = new Map(
    kiroUpdates
      .filter(u => u.excel_name)
      .map(u => [u.excel_name.toLowerCase(), u])
  );

  return original.map(gap => {
    if (!gap.excel_name) return gap;
    const update = updateMap.get(gap.excel_name.toLowerCase());
    if (!update) return gap;

    // Filter out placeholder values Kiro uses when it hasn't found the rule yet
    const correctName = (update.correct_code_name &&
      !['SEARCH_REQUIRED', 'NOT_FOUND', 'UNKNOWN', 'N/A', ''].includes(update.correct_code_name.toUpperCase()))
      ? update.correct_code_name
      : null;

    // Kiro confirmed the current code_name is correct
    if (update.status === 'CONFIRMED') {
      if (gap.status === 'MISSING') {
        return {
          ...gap,
          status: 'NAME_TYPO' as const,
          code_name: correctName || gap.code_name,
          notes: `Kiro: ${update.notes}`,
          recommendation: {
            action: 'UPDATE_RHW' as const,
            confidence: 'HIGH' as const,
            reason: `Kiro confirmed rule exists as "${correctName || gap.code_name}". ${update.notes}`,
          },
        };
      }
      if (gap.status === 'MISMATCH') {
        return {
          ...gap,
          status: 'MATCH' as const,
          issues: [],
          notes: `Kiro: ${update.notes}`,
          recommendation: {
            action: 'NO_ACTION' as const,
            confidence: 'HIGH' as const,
            reason: `Kiro confirmed rule correctly implements the statement. ${update.notes}`,
          },
        };
      }
      // MATCH — already correct, just add Kiro note if needed
      if (correctName && correctName !== gap.code_name) {
        // Kiro found a better match
        return {
          ...gap,
          code_name: correctName,
          status: 'NAME_TYPO' as const,
          notes: gap.notes ? `${gap.notes} | Kiro: ${update.notes}` : `Kiro: ${update.notes}`,
          recommendation: {
            action: 'UPDATE_RHW' as const,
            confidence: 'HIGH' as const,
            reason: `Kiro found correct implementation: "${correctName}". ${update.notes}`,
          },
        };
      }
      return gap; // CONFIRMED with same code_name — no change needed
    }

    // Kiro says the current code_name does NOT implement the excel_name
    if (update.status === 'NOT_CONFIRMED') {
      return {
        ...gap,
        status: correctName ? 'NAME_TYPO' as const : 'MISSING' as const,
        code_name: correctName || gap.code_name,
        notes: gap.notes ? `${gap.notes} | Kiro: ${update.notes}` : `Kiro: ${update.notes}`,
        recommendation: {
          action: correctName ? 'UPDATE_RHW' as const : 'VERIFY_WITH_BUSINESS' as const,
          confidence: 'HIGH' as const,
          reason: correctName
            ? `Kiro found correct implementation: "${correctName}". ${update.notes}`
            : `Kiro confirmed genuine gap. ${update.notes}`,
        },
      };
    }

    // PARTIAL — keep status, add note
    if (update.status === 'PARTIAL') {
      return {
        ...gap,
        code_name: correctName || gap.code_name,
        notes: gap.notes ? `${gap.notes} | Kiro: ${update.notes}` : `Kiro: ${update.notes}`,
      };
    }

    return gap;
  });
}

function applyReverseFilter(
  original: RuleEntry[],
  kiroUpdates: KiroReverseItem[]
): import('../types').UndocumentedRule[] {
  if (!kiroUpdates || kiroUpdates.length === 0) {
    return original.map(r => ({ name: r.name, source: r.source }));
  }

  // Build lookup by rule name (case-insensitive)
  const kiroMap = new Map(
    kiroUpdates
      .filter(u => u.name)
      .map(u => [u.name.toLowerCase(), u])
  );

  // Map every original entry to UndocumentedRule with Kiro enrichment
  return original.map(r => {
    const kiro = kiroMap.get(r.name.toLowerCase());
    return {
      name:               r.name,
      source:             r.source,
      business_statement: kiro?.business_statement ?? undefined,
      sheet_name:         kiro?.sheet_name ?? undefined,
    };
  });
}
