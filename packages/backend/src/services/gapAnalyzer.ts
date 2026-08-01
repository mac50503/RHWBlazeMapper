/**
 * gapAnalyzer.ts
 *
 * Core gap analysis engine.
 *
 * Compares rule entries from an Excel workbook against the indexed Blaze repo
 * and produces GapResult[] with:
 *   MATCH            — found in code, names agree
 *   MISSING          — in Excel but not found anywhere in code
 *   MISMATCH         — found but condition values differ (detected heuristically)
 *   NAME_TYPO        — found under a slightly different name (fuzzy match)
 *   REMOVED          — row note contains a DE####-Removed marker
 *   NOT_IMPLEMENTED  — Excel row explicitly marks rule as not yet implemented
 */

import { RuleEntry, GapResult, RuleStatus, Recommendation, RecommendedAction, Confidence } from '../types';
import { BusinessStatement } from './excelParser';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REMOVED_PATTERN = /DE\d{4,}-?Removed|removed/i;
const NOT_IMPLEMENTED_MARKER = /not[\s_-]?implemented|N\/A|TBD/i;
const MAX_EDIT_DISTANCE = 3;

// Minimum score threshold to consider a statement MATCHED to a rule
const PROSE_MATCH_THRESHOLD = 20;

// ---------------------------------------------------------------------------
// Statement-based PROSE analysis
// ---------------------------------------------------------------------------

/**
 * Score a single business statement against a repo rule.
 * Returns a numeric score — higher = better match.
 */
function scoreStatementVsRule(statement: string, entry: RuleEntry): number {
  if (!statement || !entry) return 0;
  const body = entry.body ?? '';
  const stmtLower = statement.toLowerCase();
  const bodyLower = body.toLowerCase();
  const stmtWords = new Set(stmtLower.match(/[a-z]{3,}/g) ?? []);
  let score = 0;

  // Rule name word hits against statement words
  const nameParts = entry.name.match(/[A-Z][a-z0-9]+/g) ?? [];
  const nameHits = nameParts.filter(p => stmtWords.has(p.toLowerCase()));
  score += nameHits.length * 4;

  // Specificity boost
  if (nameHits.length >= 2) score += nameHits.length * 3;

  // Quoted codes in statement also in body ("NM", "GR", "F", etc.)
  const stmtQuoted = new Set(statement.match(/"([A-Z0-9]{1,6})"/g)?.map(m => m.slice(1,-1)) ?? []);
  const bodyQuoted = new Set(body.match(/"([A-Z0-9]{1,6})"/g)?.map(m => m.slice(1,-1)) ?? []);
  const quotedHits = [...stmtQuoted].filter(c => bodyQuoted.has(c));
  score += quotedHits.length * 6;

  // Numeric thresholds shared
  const stmtNums = new Set(statement.match(/\b(\d{2,4})\b/g) ?? []);
  const bodyNums = new Set(body.match(/\b(\d{2,4})\b/g) ?? []);
  score += [...stmtNums].filter(n => bodyNums.has(n)).length * 5;

  // Zero-value condition
  if (statement.includes('0.00') && body.includes('0.0')) score += 4;

  // Body contains key words from statement
  const bodyWords = new Set(bodyLower.match(/[a-z]{4,}/g) ?? []);
  const wordHits = [...stmtWords].filter(w => w.length >= 5 && bodyWords.has(w));
  score += wordHits.length * 2;

  // CamelCase body identifier decomposition vs statement words
  const bodyIdents = body.match(/\b[a-zA-Z]{6,}\b/g) ?? [];
  for (const ident of new Set(bodyIdents)) {
    const parts = ident.match(/[A-Z][a-z0-9]+|[a-z]+/g) ?? [];
    for (const p of parts) {
      if (p.length >= 5 && stmtWords.has(p.toLowerCase())) { score += 2; break; }
    }
  }

  // Condition patterns: "field = value" in both statement and body
  for (const m of stmtLower.matchAll(/(\w{4,})\s*[=<>]+\s*([\w.]+)/g)) {
    if (bodyLower.includes(m[1]) && bodyLower.includes(m[2])) score += 5;
  }

  return score;
}

/**
 * Analyze a PROSE tab statement by statement.
 *
 * For each extracted business statement:
 *   1. Score it against every rule in the repo
 *   2. Pick the best-matching rule
 *   3. If score >= PROSE_MATCH_THRESHOLD → MATCH
 *   4. If score <  PROSE_MATCH_THRESHOLD → MISSING
 *
 * Returns one GapResult per statement.
 */
export function analyzeProseTabByStatement(
  tabName: string,
  statements: BusinessStatement[],
  repoRules: Map<string, RuleEntry>
): GapResult[] {
  // Deduplicate repo rules
  const uniqueRules: RuleEntry[] = [];
  const seen = new Set<string>();
  for (const [, entry] of repoRules) {
    if (seen.has(entry.name)) continue;
    if (entry.source.toLowerCase().includes('businesslibrary')) continue;
    seen.add(entry.name);
    uniqueRules.push(entry);
  }

  const results: GapResult[] = [];

  for (const stmt of statements) {
    // Skip pure DESCRIPTION rows — too generic to verify mechanically
    if (stmt.type === 'DESCRIPTION') continue;

    // Score against all rules
    let bestScore = 0;
    let bestEntry: RuleEntry | null = null;

    for (const entry of uniqueRules) {
      const score = scoreStatementVsRule(stmt.text, entry);
      if (score > bestScore) {
        bestScore = score;
        bestEntry = entry;
      }
    }

    const status: RuleStatus = bestScore >= PROSE_MATCH_THRESHOLD ? 'MATCH' : 'MISSING';
    const issues = status === 'MISSING'
      ? [`No matching rule found (best score: ${bestScore})`]
      : [];
    const notes = `Score: ${bestScore} | Row ${stmt.rowNum} | ${stmt.type}`;

    const partialResult = {
      excel_name:   stmt.text.slice(0, 100) + (stmt.text.length > 100 ? '…' : ''),
      code_name:    bestEntry?.name ?? '',
      status,
      issues,
      notes,
      row_num:      stmt.rowNum,
      section:      tabName,
      rule_file:    bestEntry?.source ?? null,
      config_keys:  [] as string[],
      hardcoded_dates: [] as string[],
    };

    results.push({
      ...partialResult,
      recommendation: getRecommendation(partialResult),
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Reverse check helpers (ported from Python reference)
// ---------------------------------------------------------------------------

/**
 * Infrastructure rule prefixes — never documented in Excel by convention.
 * These are technical scaffolding rules, not business logic.
 * (from Python reference INFRASTRUCTURE_PREFIXES)
 */
const INFRASTRUCTURE_PREFIXES = [
  'ruleInitialize',
  'ruleSetExempt',
  'ruleShowVariables',
  'finalRule',
  'returnPremium',
  'ruleSet',
  '__ND_',
  'initializationRule',
  'defaultRule',
];

function isInfrastructureRule(name: string): boolean {
  return INFRASTRUCTURE_PREFIXES.some(p => name.startsWith(p));
}

/**
 * Derive relevant ruleset file names from forward check results.
 * Expands to sibling rulesets in the same Rulesets/ directory that share
 * domain keywords — same logic as Python auto_detect_rulesets().
 *
 * Key: only expands within Rulesets/ directories, NOT Functions/.
 * This avoids flooding the reverse check with hundreds of functions.
 */
export function autoDetectRulesets(
  gaps: GapResult[],
  repoRules: Map<string, RuleEntry>
): Set<string> {
  const matchedFiles = new Set<string>();
  const matchedDirs  = new Set<string>();

  for (const g of gaps) {
    if (!g.rule_file) continue;
    const sep = g.rule_file.includes('\\') ? '\\' : '/';
    const parts = g.rule_file.split(sep);
    matchedFiles.add(parts[parts.length - 1]);
    matchedDirs.add(parts.slice(0, -1).join(sep).toLowerCase());
  }

  if (matchedDirs.size === 0) return matchedFiles;

  // Extract domain keywords from matched file names
  const domainWords = new Set<string>();
  for (const fname of matchedFiles) {
    const words = fname.match(/[A-Z][a-z0-9]+/g) ?? [];
    for (const w of words) {
      if (w.length >= 4) domainWords.add(w.toLowerCase());
    }
  }

  // Expand to sibling rulesets in same dirs that share ≥1 domain word
  // Only within Rulesets/ directories — not Functions/
  const expanded = new Set(matchedFiles);
  const seen = new Set<string>();

  for (const [, entry] of repoRules) {
    if (seen.has(entry.name)) continue;
    seen.add(entry.name);

    const sep = entry.source.includes('\\') ? '\\' : '/';
    const parts = entry.source.split(sep);
    const fname = parts[parts.length - 1];
    const fdir  = parts.slice(0, -1).join(sep).toLowerCase();

    if (!matchedDirs.has(fdir)) continue;
    if (expanded.has(fname)) continue;

    // Only expand within Rulesets/ — not Functions/ (too many fcn* items)
    if (!entry.source.toLowerCase().includes('rulesets')) continue;

    const fnameWords = new Set(
      (fname.match(/[A-Z][a-z0-9]+/g) ?? [])
        .filter(w => w.length >= 4)
        .map(w => w.toLowerCase())
    );

    // Share at least 1 domain word
    if ([...fnameWords].some(w => domainWords.has(w))) {
      expanded.add(fname);
    }
  }

  return expanded;
}

/**
 * Find the top N rules semantically related to a tab that are NOT already
 * covered by the forward check results.
 *
 * Scores each repo rule against each individual statement from the tab
 * and takes the max score — same approach as the forward check.
 * This ensures rules like ruleLimoSameStation score high when the tab
 * mentions "isLIMO" even if the full tab text dilutes the signal.
 *
 * @param statements  Individual business statements from the tab
 * @param gaps        Forward check results (to exclude already-matched rules)
 * @param repoRules   Indexed repo rules
 * @param limit       Max rules to return (default 25)
 */
export function findUndocumentedByRulesets(
  statements: BusinessStatement[],
  gaps: GapResult[],
  repoRules: Map<string, RuleEntry>,
  limit = 25
): RuleEntry[] {
  // Build set of names already covered by forward check
  const covered = new Set<string>();
  for (const g of gaps) {
    if (g.excel_name) covered.add(g.excel_name.toLowerCase());
    if (g.code_name)  covered.add(g.code_name.toLowerCase());
  }

  // Use only verifiable statements
  const verifiable = statements.filter(s => s.type !== 'DESCRIPTION');
  if (verifiable.length === 0) return [];

  const scored: { score: number; entry: RuleEntry }[] = [];
  const seen = new Set<string>();

  for (const [, entry] of repoRules) {
    if (seen.has(entry.name)) continue;
    seen.add(entry.name);

    // Skip non-verifiable kinds
    if (entry.kind === 'ruleset' || entry.kind === 'group_template') continue;
    if (entry.source.toLowerCase().includes('businesslibrary')) continue;

    // Skip infrastructure rules
    if (isInfrastructureRule(entry.name)) continue;

    // Skip already covered by forward check
    if (covered.has(entry.name.toLowerCase())) continue;

    // Score using rule NAME words vs statement text (not body)
    // Name-based scoring is more precise:
    //   ruleLimoSameStation → "Limo", "Same", "Station" → hits "isLIMO...Arrival Station = Departure Station"
    //   ruleZeroLegBaseCredits → "Zero", "Leg", "Base", "Credits" → hits multiple statements
    const nameParts = entry.name.match(/[A-Z][a-z0-9]+/g) ?? [];
    if (nameParts.length === 0) continue;

    let maxScore = 0;
    for (const stmt of verifiable) {
      const stmtLower = stmt.text.toLowerCase();
      let score = 0;
      const hits = nameParts.filter(p => p.length >= 3 && stmtLower.includes(p.toLowerCase()));
      for (const h of hits) {
        score += h.length >= 5 ? 6 : 4;
      }
      // Specificity boost: 2+ name parts hit same statement
      if (hits.length >= 2) score += hits.length * 3;
      if (score > maxScore) maxScore = score;
    }

    if (maxScore > 0) {
      scored.push({ score: maxScore, entry });
    }
  }

  // Sort by score descending, return top N
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(s => s.entry);
}

// ---------------------------------------------------------------------------

// Public API
// ---------------------------------------------------------------------------

/**
 * Analyze a PROSE tab using semantic scoring.
 *
 * PROSE tabs have no explicit rule names in Excel — they contain business
 * language descriptions. We score every repo rule against the tab text and
 * return the top 25 most relevant rules as MATCH results.
 *
 * Scoring signals (same as the Python reference project):
 *   - Tab-name word hits in rule name (+6 each, no length filter)
 *   - Other tab content words in rule name (+2 each)
 *   - Specificity boost when 2+ name words hit (+3 each)
 *   - Quoted codes (NM, NP, GR, F) matched between body and tab (+5 each)
 *   - Threshold numbers (243, 55, 40) matched (+4 each)
 *   - Bigram phrase matches (+3 each)
 *   - basePay=0.0 when tab mentions 0.00 (+3)
 *   - Condition field+value matches (+4 each)
 *   - CamelCase body identifier decomposition (+2 per hit)
 *   - Penalty if rule name shares no words with tab name (-5)
 */
export function analyzeProseTab(
  tabName: string,
  tabText: string,
  repoRules: Map<string, RuleEntry>
): GapResult[] {
  const tabLower = tabText.toLowerCase();

  // Tab name words (no length filter — "Leg", "Base" count too)
  const tabNameWords = new Set(tabName.toLowerCase().match(/[a-z]{2,}/g) ?? []);

  // All meaningful words in tab text (4+ chars)
  const tabWords = new Set(tabLower.match(/[a-z]{4,}/g) ?? []);

  // Quoted codes from tab: "NM", "GR", "F", etc.
  const tabQuoted = new Set(tabText.match(/"([A-Z0-9]{1,6})"/g)?.map(m => m.slice(1, -1)) ?? []);

  // Numeric thresholds from tab
  const tabThresholds = new Set(tabText.match(/\b(\d{2,4})\b/g)?.filter(n => n !== '0000' && n !== '9999') ?? []);

  // Bigrams from tab (consecutive 4+ letter words)
  const tabWordList = Array.from(tabText.matchAll(/[a-zA-Z]{4,}/g)).map(m => m[0].toLowerCase());
  const tabBigrams = new Set<string>();
  for (let i = 0; i < tabWordList.length - 1; i++) {
    tabBigrams.add(`${tabWordList[i]}|${tabWordList[i + 1]}`);
  }

  // Conditions from tab: field=value pairs
  const tabConditions = new Set<string>();
  for (const m of tabLower.matchAll(/(\w+)\s*[=<>]+\s*([\w.]+)/g)) {
    tabConditions.add(`${m[1]}:${m[2]}`);
  }

  // Score each repo rule — deduplicate by rule name to avoid counting twice
  const scored: Array<{ score: number; entry: RuleEntry }> = [];
  const seenNames = new Set<string>();

  for (const [, entry] of repoRules) {
    // Skip business instances
    if (entry.source.toLowerCase().includes('businesslibrary')) continue;
    // Deduplicate — indexRules stores each rule under both exact and lowercase key
    if (seenNames.has(entry.name)) continue;
    seenNames.add(entry.name);

    const body = entry.body ?? '';
    const bodyLower = body.toLowerCase();
    const nameParts = entry.name.match(/[A-Z][a-z0-9]+/g) ?? [];
    let score = 0;

    // Tab-name word hits (highest priority, no length filter)
    const tabNameHits = nameParts.filter(p => tabNameWords.has(p.toLowerCase()));
    score += tabNameHits.length * 6;

    // Other tab content word hits (4+ char)
    const otherHits = nameParts.filter(p => p.length >= 4 && tabWords.has(p.toLowerCase()) && !tabNameWords.has(p.toLowerCase()));
    score += otherHits.length * 2;

    // Specificity boost: 2+ name words hit tab
    const totalHits = tabNameHits.length + otherHits.length;
    if (totalHits >= 2) score += totalHits * 3;

    // Penalty: no name words match tab name at all
    const nameLowerParts = new Set(nameParts.filter(p => p.length >= 2).map(p => p.toLowerCase()));
    if (tabNameWords.size > 0 && ![...tabNameWords].some(w => nameLowerParts.has(w))) {
      score = Math.max(0, score - 5);
    }

    // Quoted code matches
    const bodyQuoted = new Set(body.match(/"([A-Z0-9]{1,6})"/g)?.map(m => m.slice(1, -1)) ?? []);
    const quotedHits = [...bodyQuoted].filter(c => tabQuoted.has(c));
    score += quotedHits.length * 5;

    // Threshold number matches
    const bodyThresholds = new Set(body.match(/\b(\d{2,4})\b/g)?.filter(n => n !== '0000') ?? []);
    const threshHits = [...bodyThresholds].filter(t => tabThresholds.has(t));
    score += threshHits.length * 4;

    // Bigram matches
    const bodyWordList = Array.from(body.matchAll(/[a-zA-Z]{4,}/g)).map(m => m[0].toLowerCase());
    let bigramHits = 0;
    for (let i = 0; i < bodyWordList.length - 1; i++) {
      if (tabBigrams.has(`${bodyWordList[i]}|${bodyWordList[i + 1]}`)) bigramHits++;
    }
    score += bigramHits * 3;

    // Zero-value condition
    if (body.includes('0.0') && tabText.includes('0.00')) score += 3;

    // Condition field+value matches
    for (const cond of tabConditions) {
      const [field, val] = cond.split(':');
      if (field && val && bodyLower.includes(field) && bodyLower.includes(val)) score += 4;
    }

    // Multi-value condition matching: ("J" or "V" or "U" or "S") → +6 per overlap
    // Catches rules like ruleForcedLegTripLabelJVUS whose conditions list multiple values
    const bodyValueGroups = [...body.matchAll(/"([A-Z0-9]{1,3})"\s*(?:or\s*"[A-Z0-9]{1,3}"\s*)+/gi)];
    const bodyMultiVals = new Set<string>();
    for (const m of bodyValueGroups) {
      for (const v of m[0].matchAll(/"([A-Z0-9]{1,3})"/g)) bodyMultiVals.add(v[1]);
    }
    const tabValueGroups = [...tabText.matchAll(/"([A-Z0-9]{1,3})"\s*(?:or\s*"[A-Z0-9]{1,3}"\s*)+/gi)];
    const tabLabelLists = [...tabText.matchAll(/\b([A-Z])\b(?:,\s*\b([A-Z])\b)+/g)];
    const tabMultiVals = new Set<string>();
    for (const m of tabValueGroups) {
      for (const v of m[0].matchAll(/"([A-Z0-9]{1,3})"/g)) tabMultiVals.add(v[1]);
    }
    for (const m of tabLabelLists) {
      for (const v of m.slice(1)) { if (v) tabMultiVals.add(v); }
    }
    const multiOverlap = [...bodyMultiVals].filter(v => tabMultiVals.has(v));
    if (multiOverlap.length >= 2) score += multiOverlap.length * 6;

    // CamelCase body identifier decomposition
    const bodyIdentifiers = body.match(/\b[a-zA-Z]{6,}\b/g) ?? [];
    const seenIdents = new Set<string>();
    for (const ident of bodyIdentifiers) {
      if (seenIdents.has(ident)) continue;
      seenIdents.add(ident);
      const parts = ident.match(/[A-Z][a-z0-9]+|[a-z]+/g) ?? [];
      for (const part of parts) {
        if (part.length >= 5 && tabWords.has(part.toLowerCase())) {
          score += 2;
          break;
        }
      }
    }

    if (score > 0) scored.push({ score, entry });
  }

  // Sort by score descending, take top 25
  scored.sort((a, b) => b.score - a.score);
  const top25 = scored.slice(0, 25);

  // Convert to GapResult[] — all MATCH (semantic confirmation)
  return top25.map((item, idx) => makeResult({
    excel_name:  item.entry.name,
    code_name:   item.entry.name,
    status:      'MATCH',
    issues:      [],
    notes:       `Semantic score: ${item.score}`,
    row_num:     idx + 1,
    section:     item.entry.section ?? '',
    rule_file:   item.entry.source,
    config_keys: [],
    hardcoded_dates: [],
  }));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compare Excel rule entries against indexed repo rules and return gap results.
 *
 * @param excelRules  Rules extracted from one Excel tab
 * @param repoRules   Map of ruleName (lowercase) → RuleEntry from the repo
 */
export function analyzeGaps(
  excelRules: RuleEntry[],
  repoRules: Map<string, RuleEntry>
): GapResult[] {
  const results: GapResult[] = [];

  // Build lowercase key set for fast lookup
  const repoKeys = new Set(repoRules.keys());

  // Track which repo rules were matched (for reverse check later)
  const matchedRepoKeys = new Set<string>();

  for (let i = 0; i < excelRules.length; i++) {
    const excel = excelRules[i];
    const rowNotes = (excel.rowData ?? []).join(' ');
    const rowNum = parseRowNum(excel.source);

    // 1. REMOVED — row note contains a removal marker
    if (REMOVED_PATTERN.test(rowNotes)) {
      results.push(makeResult({
        excel_name:  excel.name,
        code_name:   excel.name,
        status:      'REMOVED',
        issues:      [],
        notes:       extractRemovalNote(rowNotes),
        row_num:     rowNum,
        section:     excel.section ?? '',
        rule_file:   null,
        config_keys: [],
        hardcoded_dates: [],
      }));
      continue;
    }

    // 2. NOT_IMPLEMENTED — row note contains not-implemented marker
    if (NOT_IMPLEMENTED_MARKER.test(rowNotes) && !excel.name.startsWith('rule') && !excel.name.startsWith('fcn')) {
      results.push(makeResult({
        excel_name:  excel.name,
        code_name:   excel.name,
        status:      'NOT_IMPLEMENTED',
        issues:      ['Row marked as not yet implemented in workbook'],
        notes:       '',
        row_num:     rowNum,
        section:     excel.section ?? '',
        rule_file:   null,
        config_keys: [],
        hardcoded_dates: [],
      }));
      continue;
    }

    const lowerName = excel.name.toLowerCase();

    // 3. Exact match (case-insensitive)
    if (repoKeys.has(lowerName)) {
      const codeEntry = repoRules.get(lowerName)!;
      matchedRepoKeys.add(lowerName);

      const issues = compareConditions(excel, codeEntry);

      results.push(makeResult({
        excel_name:  excel.name,
        code_name:   codeEntry.name,
        status:      issues.length > 0 ? 'MISMATCH' : 'MATCH',
        issues,
        notes:       '',
        row_num:     rowNum,
        section:     excel.section ?? '',
        rule_file:   codeEntry.source,
        config_keys: [],
        hardcoded_dates: [],
      }));
      continue;
    }

    // 4. Fuzzy / NAME_TYPO match
    const fuzzyMatch = findFuzzyMatch(lowerName, repoKeys);
    if (fuzzyMatch) {
      const codeEntry = repoRules.get(fuzzyMatch)!;
      matchedRepoKeys.add(fuzzyMatch);

      results.push(makeResult({
        excel_name:  excel.name,
        code_name:   codeEntry.name,
        status:      'NAME_TYPO',
        issues:      [`Excel name "${excel.name}" vs code name "${codeEntry.name}"`],
        notes:       '',
        row_num:     rowNum,
        section:     excel.section ?? '',
        rule_file:   codeEntry.source,
        config_keys: [],
        hardcoded_dates: [],
      }));
      continue;
    }

    // 5. MISSING — not found anywhere
    results.push(makeResult({
      excel_name:  excel.name,
      code_name:   '',
      status:      'MISSING',
      issues:      [`Rule "${excel.name}" not found in repository`],
      notes:       '',
      row_num:     rowNum,
      section:     excel.section ?? '',
      rule_file:   null,
      config_keys: [],
      hardcoded_dates: [],
    }));
  }

  return results;
}

/**
 * Return repo rules that were NOT matched by any Excel rule (reverse check).
 * These are "MISSING IN RHW" — in code but not documented.
 */
export function findUndocumentedRules(
  excelRules: RuleEntry[],
  repoRules: Map<string, RuleEntry>
): RuleEntry[] {
  const excelNames = new Set(excelRules.map((r) => r.name.toLowerCase()));

  const undocumented: RuleEntry[] = [];
  const seen = new Set<string>();

  for (const [key, entry] of repoRules) {
    // Skip duplicate lowercase aliases
    if (seen.has(entry.name)) continue;
    seen.add(entry.name);

    // Skip orchestrator containers — rulesets (rsXxx) and group templates are not
    // individually verifiable business rules per the Blaze glosario (section 2)
    if (entry.kind === 'ruleset' || entry.kind === 'group_template') continue;

    // Skip BusinessLibrary instances — they are parameterized instantiations,
    // not individual rules to be documented in the workbook
    if (entry.source.toLowerCase().includes('businesslibrary')) continue;

    if (!excelNames.has(key)) {
      undocumented.push(entry);
    }
  }

  return undocumented;
}

// ---------------------------------------------------------------------------
// Recommendation engine
// ---------------------------------------------------------------------------

/**
 * Derive the recommended action for a gap result.
 * Mirrors the Python reference implementation logic exactly.
 */
export function getRecommendation(result: Omit<GapResult, 'recommendation'>): Recommendation {
  const { status, issues, notes } = result;

  switch (status) {
    case 'MATCH':
      return rec('NO_ACTION', 'HIGH', 'Rule confirmed in code — no action needed');

    case 'REMOVED':
      return rec(
        'UPDATE_RHW',
        'HIGH',
        notes
          ? `Rule has removal note (${notes}) — update or remove this row from the workbook`
          : 'Rule appears to have been removed from code — update the workbook'
      );

    case 'NAME_TYPO': {
      // Kiro found it under a different name → update the workbook
      const issueText = issues[0] ?? '';
      return rec(
        'UPDATE_RHW',
        'HIGH',
        `Rule IS implemented in code under a different name. ${issueText}. Fix the rule name in the workbook.`
      );
    }

    case 'MISMATCH': {
      // Context-level mismatches (ℹ️ notes) → no action
      const allContext = issues.every((i) => i.startsWith('ℹ️'));
      if (allContext) {
        return rec('NO_ACTION', 'HIGH', 'Condition differences are context-level (set by calling ruleset) — no action needed');
      }
      return rec(
        'VERIFY_WITH_BUSINESS',
        'MEDIUM',
        `Condition value differs from code. Option 1: the workbook is out of date — update it. Option 2: the code has a defect — raise a story. Issues: ${issues.join('; ')}`
      );
    }

    case 'MISSING': {
      // Row with removal-style note → workbook update
      if (REMOVED_PATTERN.test(notes) || REMOVED_PATTERN.test(issues.join(' '))) {
        return rec('UPDATE_RHW', 'HIGH', 'Rule note indicates removal — update or remove this row from the workbook');
      }
      return rec(
        'VERIFY_WITH_BUSINESS',
        'MEDIUM',
        `Rule not found in code. Option 1: it was intentionally removed — remove from the workbook. Option 2: it was never implemented — raise a story to implement it.`
      );
    }

    case 'NOT_IMPLEMENTED':
      return rec(
        'VERIFY_WITH_BUSINESS',
        'MEDIUM',
        'Rule is documented in workbook but not implemented in code. Option 1: intentionally deferred — add a note. Option 2: should be implemented — raise a story.'
      );

    default:
      return rec('VERIFY_WITH_BUSINESS', 'MEDIUM', 'Unknown status — manual review required');
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface PartialGapResult {
  excel_name:      string;
  code_name:       string;
  status:          RuleStatus;
  issues:          string[];
  notes:           string;
  row_num:         number;
  section:         string;
  rule_file:       string | null;
  config_keys:     string[];
  hardcoded_dates: string[];
}

function makeResult(partial: PartialGapResult): GapResult {
  const recommendation = getRecommendation(partial);
  return { ...partial, recommendation };
}

function rec(action: RecommendedAction, confidence: Confidence, reason: string): Recommendation {
  return { action, confidence, reason };
}

/**
 * Compare conditions between an Excel row and a code entry.
 * Currently a heuristic check — looks for numeric threshold differences
 * in the row data vs the rule source path / name.
 *
 * Returns a list of issue strings (empty = full match).
 */
function compareConditions(excel: RuleEntry, code: RuleEntry): string[] {
  const issues: string[] = [];
  const body = code.body ?? '';
  const rowData = excel.rowData ?? [];

  // ── Pay code / work code check ────────────────────────────────────────────
  // Row layout (typical RULE_NAMES tab):
  //   col 4 = CT condition + work code description  e.g. "Not CT, Contains JA"
  //   col 6 = pay code  e.g. "JA", "DT", "VJ"
  const payCode = rowData[6]?.trim() ?? '';
  if (payCode && payCode.length <= 6 && /^[A-Z0-9]+$/.test(payCode)) {
    // Check if pay code appears in rule body
    if (!body.includes(`"${payCode}"`)) {
      issues.push(`Pay code: Excel="${payCode}" not found in rule body`);
    }
  }

  // ── CT condition check ────────────────────────────────────────────────────
  // col 4 often says "Not CT, Contains XX" or "CT, Contains XX"
  const ctCol = rowData[4]?.trim() ?? '';
  if (ctCol) {
    const excelNotCT = /not\s*ct/i.test(ctCol);
    const excelIsCT  = /\bct\b/i.test(ctCol) && !excelNotCT;
    // Check body for CT template references (ctXxx)
    const bodyHasCT    = /\bct[A-Z][a-zA-Z]+/.test(body);
    const bodyHasNotCT = /creditType\s*[<>]|not.*ct|creditType.*F/i.test(body);

    if (excelNotCT && bodyHasCT && !bodyHasNotCT) {
      issues.push(`CT condition: Excel says "Not CT" but code references CT templates`);
    } else if (excelIsCT && !bodyHasCT) {
      issues.push(`CT condition: Excel says "CT" but code has no CT template references`);
    }
  }

  // ── Numeric threshold check ───────────────────────────────────────────────
  // Find numbers in the Excel row (col 5 = duty threshold, col 3 = actual duty)
  for (const col of [3, 5]) {
    const cell = rowData[col]?.trim() ?? '';
    if (!cell) continue;
    // Extract numbers like "> 12:00", "<= 16", "= 243"
    const nums = cell.match(/\b(\d{1,4})\b/g) ?? [];
    for (const num of nums) {
      if (['0','1','2','3','4','5','6','7','8','9'].includes(num)) continue; // skip trivial
      if (!body.includes(num)) {
        issues.push(`Threshold: Excel has "${num}" (col ${col}) but not found in rule body`);
      }
    }
  }

  // ── Trip label check ──────────────────────────────────────────────────────
  // col 0 often contains trip label: "D", "E", "J", etc.
  const labelCol = rowData[0]?.trim() ?? '';
  if (labelCol && /^[A-Z]$/.test(labelCol)) {
    if (!body.includes(`"${labelCol}"`)) {
      issues.push(`Trip label: Excel says label="${labelCol}" but not found in rule body`);
    }
  }

  return issues;
}

/**
 * Find the closest matching key in repoKeys using edit distance.
 * Returns the key if within MAX_EDIT_DISTANCE, else null.
 */
function findFuzzyMatch(name: string, repoKeys: Set<string>): string | null {
  let bestKey: string | null = null;
  let bestDist = MAX_EDIT_DISTANCE + 1;

  for (const key of repoKeys) {
    // Quick length filter — skip keys whose length differs too much
    if (Math.abs(key.length - name.length) > MAX_EDIT_DISTANCE) continue;

    const dist = editDistance(name, key);
    if (dist < bestDist) {
      bestDist = dist;
      bestKey = key;
    }
  }

  return bestDist <= MAX_EDIT_DISTANCE ? bestKey : null;
}

/**
 * Levenshtein edit distance between two strings (optimised for short strings).
 */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  // Use a single row rolling array
  const row: number[] = Array.from({ length: n + 1 }, (_, i) => i);

  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = row[j];
      row[j] =
        a[i - 1] === b[j - 1]
          ? prev
          : 1 + Math.min(prev, row[j], row[j - 1]);
      prev = temp;
    }
  }

  return row[n];
}

/**
 * Parse row number from a source string like "row:5" → 5.
 */
function parseRowNum(source: string): number {
  const match = source.match(/row:(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Extract a removal note (DE####-Removed style) from row text.
 */
function extractRemovalNote(text: string): string {
  const match = text.match(/DE\d{4,}-?Removed\S*/i);
  return match ? match[0] : 'Marked as removed';
}
