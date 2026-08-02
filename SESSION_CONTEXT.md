# RHW Blaze Mapper — Session Context

**Last updated:** 2026-08-02  
**Session:** Gap analysis + Kiro verification implementation

---

## What This Project Does

Compares a **Rules Harvesting Workbook (Excel)** against a **Blaze Advisor rules repository**, producing two reports:

1. **Forward Check** — for each business statement in the Excel tab, finds the rule/function in the repo that implements it (semantic scoring). Kiro verifies and corrects each match.
2. **Reverse Check** — finds rules/functions in the repo semantically related to the tab. Kiro searches the entire workbook index for matching business statements.

---

## Reference Project

Python reference at: `C:\Users\X322736\Downloads\GAP analizer\repo\rhw-vs-code-gap-analyzer`

Key files: `engines/blaze/blaze_gap_analyzer.py`, `app.py`, `rule_index_generator.py`

---

## Architecture

```
Excel (.xlsx)
  → classifyTab()         PROSE_LOGIC | RULE_NAMES | LEGALITY_* | LOOKUP_TABLE | REFERENCE
  → extractStatements()   individual business statements from the tab
  → indexRules()          walks repo, extracts all rules/functions with bodies (cached)
  → generateExcelIndex()  creates plain-text .index.md of ALL tabs (at Load Tabs time)

Forward Check:
  PROSE tabs    → analyzeProseTabByStatement()   semantic score per statement vs repo
  RULE_NAMES    → analyzeGaps()                  exact/fuzzy name matching

Reverse Check:
  → findUndocumentedByRulesets()   top 15 rules by name-based semantic score
                                   excludes infrastructure rules, already-matched rules

Kiro Verification (single call, 300s timeout):
  → runKiroVerification()
      PART 1: Kiro reads rule bodies FROM REPO via grep, validates each forward match,
              returns correct_code_name when it finds a better match
      PART 2: Kiro reads rule bodies FROM REPO via grep, searches ENTIRE workbook index
              (.index.md) for matching business statements
      Report built DIRECTLY from Kiro JSON — no merging with mechanical results
```

---

## Key Files

### Backend (`packages/backend/src/`)

| File | Purpose |
|------|---------|
| `services/blazeIndexer.ts` | Walks Blaze repo. Strategy 1b: `<rule><name>...<body>` (no srl: namespace). kind: rule\|function\|ruleset\|decision_table\|group_template |
| `services/excelParser.ts` | `classifyTab()` detects PROSE_LOGIC. `extractStatements()` extracts individual statements |
| `services/gapAnalyzer.ts` | `analyzeProseTabByStatement()`. `findUndocumentedByRulesets()` — name-based scoring, top 15 |
| `services/excelIndexer.ts` | Generates `workbook.index.md` at Load Tabs — plain text ALL non-REFERENCE tabs |
| `services/kiroVerifier.ts` | Builds prompt, calls Kiro, parses JSON. Saves prompt to `kiro-prompt-last.txt`. MAX=15 items each part |
| `services/kiroRunner.ts` | Spawns Kiro CLI. Uses `@file` for prompt delivery. Model: `claude-haiku-4.5`. Timeout: 300s |
| `routes/analysis.ts` | SSE stream. Session: rule index cache + excelIndexPath. Aborts on Kiro timeout |
| `prompts/kiro-verify.md` | Kiro prompt template |
| `prompts/blaze-glossary.md` | Full Blaze SRL reference |

### Frontend (`packages/frontend/src/`)

| File | Purpose |
|------|---------|
| `App.tsx` | State: results, completeEvent, undocumentedRules. handleComplete() uses Kiro JSON directly |
| `components/AnalysisTable.tsx` | Forward table + collapsible reverse table. Green=found, Red=not found in workbook |
| `components/WorkbookUpload.tsx` | Upload Excel, Load Tabs, tab selection |
| `components/RunButton.tsx` | SSE stream consumer, progress log |
| `components/RepoInput.tsx` | Repo path + validate |

### Test Scripts (`packages/backend/src/`)

| File | Purpose |
|------|---------|
| `test-reverse-check.ts` | Full pipeline: forward + reverse + Kiro. Shows raw Kiro output |
| `test-semantic-score.ts` | Top 25 semantic score for a tab (no Kiro) |
| `test-kiro-prompt.ts` | Generates exact prompt → `kiro-prompt-debug.txt` at repo root |

### Debug Files (generated at runtime)

| File | Purpose |
|------|---------|
| `~/Documents/RHW-Analysis/kiro-prompt-last.txt` | Last prompt sent to Kiro |
| `~/Documents/RHW-Analysis/kiro-raw-debug.txt` | Last raw Kiro output |
| `~/Documents/RHW-Analysis/kiro-parsed-debug.json` | Last parsed Kiro JSON |
| `kiro-prompt-debug.txt` (repo root) | Output of test-kiro-prompt.ts |

---

## Kiro Prompt Structure (`kiro-verify.md`)

```
Context:
  - Repo path (Kiro reads bodies from here via grep)
  - EXCEL_INDEX_PATH (full .index.md path — Kiro reads for cross-tab search)
  - Excel Workbook Content for selected tab (inline rows)

PART 1 — Forward Check:
  List of rules to verify: name + file path only (NO bodies — Kiro greps them)
  Kiro: reads body via grep, validates if it implements the statement
        If not → searches repo, returns correct_code_name

PART 2 — Reverse Check:
  List of reverse candidates: name + file path only
  Kiro: reads body via grep, searches ENTIRE workbook index for matching statement
  Returns: business_statement + sheet_name

Response: JSON only — {forward: [...], reverse: [...]}
  forward item: {excel_name, status, correct_code_name, notes}
  reverse item: {name, business_statement, sheet_name}
```

**Kiro settings:** model=claude-haiku-4.5, timeout=300s, MAX 15 items per part

---

## Critical: Load Tabs Before Run Analysis

`session.excelIndexPath` is set during Load Tabs. If you restart the backend and run analysis without Load Tabs first, Kiro won't get the Excel index and PART 1/2 will fail (Excel content missing from prompt).

**Always: Load Tabs → Select Tab → Run Analysis**

---

## Session State

```typescript
{
  lastReportPath,
  lastExcelBuffer,
  lastExcelName,
  lastRepoPath,
  lastAnnotatedExcelPath,
  ruleIndexCache,           // cached per repo path
  ruleIndexCacheRepoPath,
  excelIndexPath,           // set at Load Tabs — REQUIRED for Kiro
}
```

---

## Blaze Repo Structure (Critical)

| Prefix | Kind | Note |
|--------|------|------|
| `rs`   | ruleset | Orchestrator — NOT verifiable individually |
| `fcn`  | function | Verifiable |
| `rule` | rule | Individual rule inside ruleset — verifiable |
| `dt`   | decision_table | |
| `rst`, `grp`, `ct`, `rt` | group_template | NOT verifiable |

Rules inside rulesets use `<rule><name>ruleName</name><body>...</body></rule>` — NO `srl:` namespace.

---

## Test Paths (known working)

```
Excel:  C:\Users\X322736\Documents\RHW-Analysis\uploads\IF Pay Rules Harvesting Workbook.xlsx
Repo:   C:\MIGUEL\branches\APIC-1773\crew-java-app-blaze-css-if-rules-service\CrewRulesRepository
Tab:    Leg Base Credits
```

---

## What Works ✅

1. Tab classification — PROSE_LOGIC, RULE_NAMES, LEGALITY_*, LOOKUP_TABLE, REFERENCE
2. Excel indexer — generates .index.md at Load Tabs (all non-REFERENCE tabs)
3. Rule indexer — captures individual rules inside rulesets + functions (2844 rules for test repo)
4. Forward check — semantic scoring per statement
5. Reverse check candidates — top 15 by name-based score
6. Kiro PART 1 — reads bodies from repo via grep, corrects wrong matches
7. Kiro PART 2 — reads bodies from repo, searches workbook index for statements
8. Report built from Kiro JSON directly (full excel_name, correct code_name)
9. Session cache — repo index cached per repo path
10. SSE streaming — live progress in UI
11. HTML report — 4-column reverse table with color coding (green/red)
12. UI reverse table — collapsible, green (found) / red (not documented in this sheet)
13. Abort on Kiro timeout — no false reports generated
14. Prompt saved to kiro-prompt-last.txt before each Kiro call

---

## What's Pending 🔧

### 1. Kiro inconsistency — results vary between runs
- When prompt is pasted manually in Kiro interactive terminal: best results (finds all statements)
- When sent via backend `@file`: results are more limited / inconsistent
- Hypothesis: Kiro may have session memory that helps on manual runs
- Load Tabs must be done after every backend restart — `session.excelIndexPath` is required
- First run after Load Tabs tends to produce better results than subsequent runs

### 2. Forward check table — no visual Kiro correction indicator
- When Kiro changes code_name, no badge showing "🤖 Kiro corrected"

### 3. Annotated Excel download
- `session.lastAnnotatedExcelPath` never set — endpoint returns 404

### 4. RULE_NAMES tab — end-to-end Kiro verification untested

### 5. `runAnalysisPipeline` (non-stream) outdated
- `/run_analysis` route doesn't use Kiro

### 6. Debug logs still in kiroVerifier.ts — intentionally kept during development

---

## Start Servers

```bash
cd C:\Users\X322736\Downloads\project3\RHWBlazeMapper
npm run dev
```

- Frontend: http://localhost:3000  
- Backend: http://localhost:3001

Restart backend after changes to `blazeIndexer.ts`, `gapAnalyzer.ts`, `kiroVerifier.ts`.
