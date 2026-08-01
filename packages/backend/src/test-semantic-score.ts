#!/usr/bin/env ts-node
/**
 * test-semantic-score.ts
 *
 * Muestra las top 25 reglas del repo con mayor score semántico para un tab dado.
 * Sin Kiro, sin validación — solo el scoring.
 *
 * Uso:
 *   cd packages/backend
 *   npx ts-node src/test-semantic-score.ts <excel> <repo> <tab>
 */

import { indexRules } from './services/blazeIndexer';
import { classifyTab, extractStatements, extractTabText } from './services/excelParser';
import * as fs from 'fs';

const EXCEL = process.argv[2] || 'C:\\Users\\X322736\\Documents\\RHW-Analysis\\uploads\\IF Pay Rules Harvesting Workbook.xlsx';
const REPO  = process.argv[3] || 'C:\\MIGUEL\\branches\\APIC-1773\\crew-java-app-blaze-css-if-rules-service\\CrewRulesRepository';
const TAB   = process.argv[4] || 'Leg Base Credits';

// Inline scoring function (same as gapAnalyzer.scoreStatementVsRule but scores tab text vs rule)
function scoreTabVsRule(tabText: string, body: string, ruleName: string): number {
  const tabLower = tabText.toLowerCase();
  const bodyLower = body.toLowerCase();
  const tabWords = new Set(tabLower.match(/[a-z]{3,}/g) ?? []);
  let score = 0;

  // Rule name word hits against tab words
  const nameParts = ruleName.match(/[A-Z][a-z0-9]+/g) ?? [];
  const nameHits = nameParts.filter(p => tabWords.has(p.toLowerCase()));
  score += nameHits.length * 4;
  if (nameHits.length >= 2) score += nameHits.length * 3;

  // Quoted codes in tab also in body
  const tabQuoted = new Set(tabText.match(/"([A-Z0-9]{1,6})"/g)?.map(m => m.slice(1,-1)) ?? []);
  const bodyQuoted = new Set(body.match(/"([A-Z0-9]{1,6})"/g)?.map(m => m.slice(1,-1)) ?? []);
  score += [...tabQuoted].filter(c => bodyQuoted.has(c)).length * 6;

  // Numeric thresholds
  const tabNums = new Set(tabText.match(/\b(\d{2,4})\b/g) ?? []);
  const bodyNums = new Set(body.match(/\b(\d{2,4})\b/g) ?? []);
  score += [...tabNums].filter(n => bodyNums.has(n)).length * 5;

  // Body words in tab
  const bodyWords = new Set(bodyLower.match(/[a-z]{4,}/g) ?? []);
  score += [...tabWords].filter(w => w.length >= 5 && bodyWords.has(w)).length * 2;

  return score;
}

async function main() {
  console.log('='.repeat(60));
  console.log('Semantic Score Test — Top 25 Rules');
  console.log('='.repeat(60));
  console.log(`Tab  : ${TAB}`);
  console.log('');

  const buf = fs.readFileSync(EXCEL);
  const tabType = classifyTab(buf, TAB);
  console.log(`Tab type: ${tabType}`);

  // Get tab text for scoring
  const tabText = extractTabText(buf, TAB);
  console.log(`Tab text: ${tabText.length} chars`);
  console.log('');

  // Index repo
  console.log('Indexing repo...');
  const repoRules = indexRules(REPO);
  console.log(`Rules indexed: ${repoRules.size}`);
  console.log('');

  // Score every rule
  const scored: { name: string; score: number; kind: string; source: string }[] = [];
  const seen = new Set<string>();

  for (const [, entry] of repoRules) {
    if (seen.has(entry.name)) continue;
    seen.add(entry.name);

    // Skip non-verifiable
    if (entry.kind === 'ruleset' || entry.kind === 'group_template') continue;
    if (entry.source.toLowerCase().includes('businesslibrary')) continue;

    const score = scoreTabVsRule(tabText, entry.body ?? '', entry.name);
    if (score > 0) {
      scored.push({ name: entry.name, score, kind: entry.kind ?? 'unknown', source: entry.source });
    }
  }

  // Sort and take top 25
  scored.sort((a, b) => b.score - a.score);
  const top25 = scored.slice(0, 25);

  console.log(`Rules with score > 0: ${scored.length}`);
  console.log(`Top 25:`);
  console.log('');

  for (let i = 0; i < top25.length; i++) {
    const r = top25[i];
    console.log(`${String(i+1).padStart(2)}. [${r.score.toString().padStart(3)}] ${r.name}`);
    console.log(`       kind: ${r.kind} | ${r.source}`);
  }

  console.log('');
  console.log('='.repeat(60));
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
