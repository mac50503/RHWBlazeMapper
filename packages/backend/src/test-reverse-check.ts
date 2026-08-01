#!/usr/bin/env ts-node
/**
 * test-reverse-check.ts
 *
 * Prueba directa del reverse check y verificación Kiro.
 * Uso:
 *   cd packages/backend
 *   npx ts-node src/test-reverse-check.ts
 *
 * Ajusta EXCEL_PATH, REPO_PATH y TAB_NAME según tu entorno.
 */

import { indexRules } from './services/blazeIndexer';
import { parseTab, classifyTab, extractStatements, extractTabText } from './services/excelParser';
import { analyzeGaps, analyzeProseTabByStatement, findUndocumentedByRulesets } from './services/gapAnalyzer';
import { runKiroVerification } from './services/kiroVerifier';
import { generateExcelIndex } from './services/excelIndexer';
import { runKiro } from './services/kiroRunner';
import * as fs from 'fs';
import * as path from 'path';

// ─── CONFIG — ajusta estas rutas ─────────────────────────────────────────────
const EXCEL_PATH = process.argv[2] || 'C:\\Users\\X322736\\Documents\\RHW-Analysis\\uploads\\IF Pay Rules Harvesting Workbook.xlsx';
const REPO_PATH  = process.argv[3] || 'C:\\path\\to\\CrewRulesRepository';
const TAB_NAME   = process.argv[4] || 'Leg Base Credits';
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(60));
  console.log('RHW Blaze Mapper — Reverse Check Test');
  console.log('='.repeat(60));
  console.log(`Excel : ${EXCEL_PATH}`);
  console.log(`Repo  : ${REPO_PATH}`);
  console.log(`Tab   : ${TAB_NAME}`);
  console.log('');

  // 1. Validar paths
  if (!fs.existsSync(EXCEL_PATH)) {
    console.error(`ERROR: Excel not found: ${EXCEL_PATH}`);
    console.error('Usage: npx ts-node src/test-reverse-check.ts <excel> <repo> <tab>');
    process.exit(1);
  }
  if (!fs.existsSync(REPO_PATH)) {
    console.error(`ERROR: Repo not found: ${REPO_PATH}`);
    process.exit(1);
  }

  // 2. Leer Excel
  console.log('▸ Reading Excel...');
  const buf = fs.readFileSync(EXCEL_PATH);

  const tabType = classifyTab(buf, TAB_NAME);
  console.log(`  Tab type: ${tabType}`);

  const excelRules = parseTab(buf, TAB_NAME);
  console.log(`  Excel rules found: ${excelRules.length}`);
  if (excelRules.length > 0) {
    console.log(`  Sample: ${excelRules.slice(0, 3).map(r => r.name).join(', ')}`);
  }

  // 3. Indexar repo
  console.log('\n▸ Indexing repo...');
  const repoRules = indexRules(REPO_PATH);
  console.log(`  Total repo rules indexed: ${repoRules.size}`);

  // 4. Forward check — handle PROSE vs RULE_NAMES
  console.log('\n▸ Running forward check...');
  let gaps: ReturnType<typeof analyzeGaps>;
  let statements = extractStatements(buf, TAB_NAME);

  if (tabType === 'RULE_NAMES' || tabType === 'LEGALITY_DECISION_TABLE' ||
      tabType === 'LEGALITY_MASTER' || tabType === 'LOOKUP_TABLE') {
    const excelRules = parseTab(buf, TAB_NAME);
    console.log(`  Excel rules found: ${excelRules.length}`);
    gaps = analyzeGaps(excelRules, repoRules);
  } else {
    // PROSE_LOGIC or REFERENCE
    const verifiable = statements.filter(s => s.type !== 'DESCRIPTION');
    console.log(`  Statements found: ${statements.length} (${verifiable.length} verifiable)`);
    if (verifiable.length > 0) {
      console.log(`  Sample: "${verifiable[0].text.slice(0, 80)}"`);
    }
    gaps = analyzeProseTabByStatement(TAB_NAME, statements, repoRules);
  }

  console.log(`  Results: ${gaps.length} total`);
  const statusCounts: Record<string, number> = {};
  for (const g of gaps) {
    statusCounts[g.status] = (statusCounts[g.status] || 0) + 1;
  }
  console.log(`  Counts: ${JSON.stringify(statusCounts)}`);
  const withFile = gaps.filter(g => g.rule_file);
  console.log(`  Rules with file: ${withFile.length}`);
  if (withFile.length > 0) {
    console.log(`  Sample rule_file: "${withFile[0].rule_file}"`);
  }

  // 5. Generate Excel index
  console.log('\n▸ Generating Excel index...');
  const indexResult = generateExcelIndex(EXCEL_PATH, path.basename(EXCEL_PATH));
  console.log(`  Index: ${indexResult.filePath}`);
  console.log(`  Tabs: ${indexResult.tabCount}, Rows: ${indexResult.totalRows}`);

  // 6. Reverse check — semantic scoring per statement
  console.log('\n▸ Running reverse check (semantic score per statement)...');

  const undocEntries = findUndocumentedByRulesets(statements, gaps, repoRules, 25);

  console.log(`  Undocumented candidates: ${undocEntries.length}`);
  for (let i = 0; i < undocEntries.length; i++) {
    const e = undocEntries[i];
    console.log(`  ${String(i+1).padStart(2)}. ${e.name} | ${e.kind} | ${e.source}`);
  }

  // 7. Kiro verification — send ALL forward results + reverse candidates
  console.log('\n▸ Running Kiro verification...');
  console.log(`  Forward items: ${gaps.length}, Reverse items: ${undocEntries.slice(0, 5).length}`);

  if (gaps.length === 0 && undocEntries.length === 0) {
    console.log('  Nothing to verify — skipping Kiro');
    return;
  }

  const kiroResult = await runKiroVerification({
    tabName:        TAB_NAME,
    tabType,
    repoPath:       REPO_PATH,
    forward:        gaps,
    reverse:        undocEntries.slice(0, 5),
    repoRules,
    excelIndexPath: indexResult.filePath,
  });

  console.log(`\n  Kiro skipped: ${kiroResult.skipped}`);
  if (kiroResult.error) console.log(`  Kiro error: ${kiroResult.error}`);

  if (!kiroResult.skipped) {
    console.log(`\n  Forward results (${kiroResult.forward.length}):`);
    for (const g of kiroResult.forward) {
      const changed = g.notes?.includes('Kiro') ? ' ← KIRO UPDATED' : '';
      console.log(`    [${g.status}] ${g.excel_name.slice(0, 60)} → ${g.code_name}${changed}`);
      if (g.notes?.includes('Kiro')) console.log(`      note: ${g.notes}`);
    }

    console.log(`\n  Reverse results (${kiroResult.reverse.length}):`);
    for (const r of kiroResult.reverse) {
      console.log(`    ${r.name}`);
      console.log(`      sheet: ${r.sheet_name ?? 'null'}`);
      console.log(`      statement: ${r.business_statement?.slice(0, 80) ?? 'null'}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('Test complete.');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
