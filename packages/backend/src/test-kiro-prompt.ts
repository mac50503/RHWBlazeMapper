#!/usr/bin/env ts-node
/**
 * test-kiro-prompt.ts
 *
 * Muestra el prompt exacto que se enviaría a Kiro para el reverse check.
 * Lo escribe en un archivo de log para revisión.
 */

import { indexRules } from './services/blazeIndexer';
import { classifyTab, extractStatements } from './services/excelParser';
import { analyzeProseTabByStatement, findUndocumentedByRulesets } from './services/gapAnalyzer';
import { generateExcelIndex } from './services/excelIndexer';
import { readExcelIndex, extractTabSection } from './services/excelIndexer';
import * as fs from 'fs';
import * as path from 'path';

const EXCEL = 'C:\\Users\\X322736\\Documents\\RHW-Analysis\\uploads\\IF Pay Rules Harvesting Workbook.xlsx';
const REPO  = 'C:\\MIGUEL\\branches\\APIC-1773\\crew-java-app-blaze-css-if-rules-service\\CrewRulesRepository';
const TAB   = 'Leg Base Credits';

async function main() {
  console.log('Building Kiro prompt for reverse check...\n');

  const buf = fs.readFileSync(EXCEL);
  const tabType = classifyTab(buf, TAB);
  const statements = extractStatements(buf, TAB);

  console.log(`Tab type: ${tabType}`);
  console.log(`Statements: ${statements.length}`);

  const repoRules = indexRules(REPO);
  console.log(`Repo rules: ${repoRules.size}`);

  const gaps = analyzeProseTabByStatement(TAB, statements, repoRules);
  console.log(`Forward check gaps: ${gaps.length}`);

  // Generate excel index
  const indexResult = generateExcelIndex(EXCEL, path.basename(EXCEL));
  const fullIndex = readExcelIndex(indexResult.filePath);
  const tabSection = extractTabSection(fullIndex, TAB);
  console.log(`Excel index section: ${tabSection.length} chars`);

  // Get reverse check candidates
  const undocEntries = findUndocumentedByRulesets(statements, gaps, repoRules, 25);
  console.log(`Reverse candidates: ${undocEntries.length}`);

  // Build the prompt manually (same as kiroVerifier.buildVerifyPrompt)
  const templatePath = path.join(__dirname, 'prompts', 'kiro-verify.md');
  let template = fs.readFileSync(templatePath, 'utf8');

  // Build FORWARD_ITEMS — all gaps, not just MISSING/MISMATCH
  const forwardToVerify = gaps.slice(0, 30);
  const forwardSection = forwardToVerify.length > 0
    ? forwardToVerify.map((g, i) => {
        const entry = repoRules.get(g.code_name?.toLowerCase() ?? '');
        const body = entry?.body ? `\nRule body:\n\`\`\`\n${entry.body.slice(0, 800)}\n\`\`\`` : '';
        const issues = g.issues.length > 0 ? `\nIssues: ${g.issues.join('; ')}` : '';
        return `${i+1}. excel_name: "${g.excel_name}"\n   code_name: "${g.code_name || 'NOT FOUND'}"\n   status: ${g.status}${issues}${body}`;
      }).join('\n\n')
    : '(none)';

  // Build REVERSE_ITEMS
  const reverseSection = undocEntries.slice(0, 25).map((r, i) => {
    const body = r.body ? `\nBody:\n\`\`\`\n${r.body.slice(0, 600)}\n\`\`\`` : '';
    return `${i+1}. name: "${r.name}"\n   kind: ${r.kind}\n   file: ${r.source}${body}`;
  }).join('\n\n');

  // Excel index section
  const excelIndexSection = tabSection
    ? `\n\n## Excel Workbook Content — ${TAB}\n\n${tabSection}`
    : '';

  const prompt = template
    .replace('{{TAB_NAME}}', TAB)
    .replace('{{TAB_TYPE}}', tabType)
    .replace('{{REPO_PATH}}', REPO)
    .replace('{{EXCEL_INDEX}}', excelIndexSection)
    .replace('{{FORWARD_ITEMS}}', forwardSection)
    .replace('{{REVERSE_ITEMS}}', reverseSection);

  // Write to log file
  const logPath = path.join(__dirname, '..', '..', '..', 'kiro-prompt-debug.txt');
  fs.writeFileSync(logPath, prompt, 'utf8');

  console.log(`\nPrompt written to: ${logPath}`);
  console.log(`Prompt size: ${prompt.length} chars`);
  console.log(`\n--- PROMPT PREVIEW (first 2000 chars) ---\n`);
  console.log(prompt.slice(0, 2000));
  console.log('\n--- END PREVIEW ---');
  console.log('\n--- REVERSE ITEMS SECTION ---\n');
  const reverseStart = prompt.indexOf('## PART 2');
  console.log(prompt.slice(reverseStart, reverseStart + 3000));
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
