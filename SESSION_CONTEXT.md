# RHW Blaze Mapper — Session Context

**Last updated:** 2026-08-01  
**Session:** Gap analysis + Kiro verification implementation

---

## What This Project Does

Compares a **Rules Harvesting Workbook (Excel)** against a **Blaze Advisor rules repository**, producing two reports:

1. **Forward Check** — for each business statement in the Excel tab, finds the rule/function in the repo that implements it (semantic scoring)
2. **Reverse Check** — finds rules/functions in the repo related to the tab that may not be documented in the Excel

Both reports are verified by **Kiro CLI** after the mechanical analysis.

---

## Reference Project

Python reference at: `C:\Users\X322736\Downloads\GAP analizer\repo\rhw-vs-code-gap-analyzer`

Key files to understand:
- `engines/blaze/blaze_gap_analyzer.py` — full Blaze analysis engine
- `app.py` — Flask API
- `rule_index_generator.py` — Kiro-based rule index generator

---

## Architecture

```
Excel (.xlsx)
  → classifyTab()         PROSE_LOGIC | RULE_NAMES | LEGALITY_* | LOOKUP_TABLE | REFERENCE
  → extractStatements()   individual business statements from the tab
  → indexRules()          walks repo, extracts all rules/functions with bodies (cached)
  → generateExcelIndex()  creates plain-text .index.md of all tabs (at Load Tabs time)

Forward Check:
  PROSE tabs    → analyzeProseTabByStatement()   semantic score per statement vs repo
  RULE_NAMES    → analyzeGaps()                  exact/fuzzy name matching

Reverse Check:
  → findUndocumentedByRulesets()   top 25 rules semantically related to tab (name-based scoring)
                                   excludes infrastructure rules, already-matched rules

Kiro Verification:
  → runKiroVerification()
      PART 1: validates forward check — Kiro searches repo to confirm/correct each match
              returns correct_code_name when it finds a better match
      PART 2: for each reverse candidate, Kiro searches the Excel index to find
              the business statement that corresponds to it
```

---

## Key Files

### Backend (`packages/backend/src/`)

| File | Purpose |
|------|---------|
| `services/blazeIndexer.ts` | Walks Blaze repo, extracts rules with CDATA bodies. Handles `<rule><name>...<body>` pattern (no srl: namespace). kind: rule\|function\|ruleset\|decision_table\|group_template |
| `services/excelParser.ts` | Parses Excel workbooks. `classifyTab()` detects PROSE_LOGIC using business-rule markers. `extractStatements()` extracts individual statements. `extractTabText()` for full text |
| `services/gapAnalyzer.ts` | Forward check scoring. `analyzeProseTabByStatement()`. `findUndocumentedByRulesets()` uses **name-based scoring** (not body) for reverse check candidates |
| `services/excelIndexer.ts` | Generates `workbook.index.md` at Load Tabs time — plain text of all non-REFERENCE tabs. Used by Kiro to find business statements |
| `services/kiroVerifier.ts` | Builds prompt from `kiro-verify.md`, calls Kiro CLI, parses JSON response, applies updates to forward and reverse results |
| `services/kiroRunner.ts` | Spawns Kiro CLI as subprocess. Sends prompt as direct argument (NOT @file — Kiro treats @file as context to analyze, not instructions) |
| `routes/analysis.ts` | Main stream route `/run_analysis_stream`. Session caches: rule index (by repo path), excel index path |
| `prompts/kiro-verify.md` | Kiro prompt template with {{placeholders}} |
| `prompts/blaze-glossary.md` | Full Blaze SRL reference — Kiro uses this to understand Blaze constructs |

### Frontend (`packages/frontend/src/`)

| File | Purpose |
|------|---------|
| `App.tsx` | State: results, completeEvent, undocumentedRules. handleComplete() replaces results with Kiro-verified finals |
| `components/AnalysisTable.tsx` | Forward check table + collapsible reverse check table. Green rows = found in Excel, Red rows = not found |
| `components/WorkbookUpload.tsx` | Upload Excel, Load Tabs, select tab |
| `components/RunButton.tsx` | SSE stream consumer, progress log |
| `components/RepoInput.tsx` | Repo path input + validate |

### Test Scripts (`packages/backend/src/`)

| File | Purpose |
|------|---------|
| `test-reverse-check.ts` | Full pipeline test: forward + reverse + Kiro verification |
| `test-semantic-score.ts` | Shows top 25 semantically scored rules for a tab (no Kiro) |
| `test-kiro-prompt.ts` | Generates the exact prompt that would be sent to Kiro, writes to `kiro-prompt-debug.txt` |

---

## Blaze Repo Structure (Critical Knowledge)

From `blaze-glossary.md` section 2:

| Prefix | Kind | Note |
|--------|------|------|
| `rs`   | ruleset | Orchestrator container — NOT individually verifiable |
| `fcn`  | function | Verifiable |
| `rule` | rule | Individual rule inside a ruleset — verifiable |
| `dt`   | decision_table | |
| `rst`, `grp`, `ct`, `rt` | group_template | NOT individually verifiable |

**Critical:** Blaze rulesets store individual rules as:
```xml
<rule managementPropertiesRef='...'>
  <name>ruleLimoSameStation</name>
  <body>if (condition) then { action. }</body>
</rule>
```
NOT `<srl:rule>` — no namespace. The indexer uses Strategy 1b to capture this pattern.

---

## Kiro Prompt Structure (`kiro-verify.md`)

```
IMPORTANT: Response must be ONLY valid JSON

PART 1 — Forward Check:
  - excel_name: business statement from Excel
  - code_name: rule/function found by scoring
  - body: rule body (truncated to 800 chars)
  Kiro: verify if code_name implements excel_name
        If not → SEARCH the repo, find correct rule
        Return correct_code_name

PART 2 — Reverse Check:
  - list of rules from repo
  - body: rule body
  Kiro: search Excel index (provided above) for matching business statement
  Return business_statement + sheet_name
  DO NOT search the repo for PART 2
```

**Known issue:** Kiro sometimes returns `SEARCH_REQUIRED` as `correct_code_name` when it can't find the rule. This is filtered in `applyForwardUpdates`.

---

## Session State (in-memory, per backend process)

```typescript
{
  lastReportPath,
  lastExcelBuffer,
  lastExcelName,
  lastRepoPath,
  lastAnnotatedExcelPath,
  ruleIndexCache,           // Map<string, RuleEntry> — invalidated when repo changes
  ruleIndexCacheRepoPath,   // string — used to detect repo change
  excelIndexPath,           // path to .index.md — generated at Load Tabs
}
```

---

## Test Paths (known working)

```
Excel:  C:\Users\X322736\Documents\RHW-Analysis\uploads\IF Pay Rules Harvesting Workbook.xlsx
Repo:   C:\MIGUEL\branches\APIC-1773\crew-java-app-blaze-css-if-rules-service\CrewRulesRepository
Tab:    Leg Base Credits
```

---

## What Works ✅

1. **Tab classification** — PROSE_LOGIC, RULE_NAMES, LEGALITY_*, LOOKUP_TABLE, REFERENCE
2. **Excel indexer** — generates plain-text index at Load Tabs time
3. **Rule indexer** — captures individual rules inside rulesets (`<rule><name>`) + functions
4. **Forward check** — semantic scoring per statement → matches rules with MATCH/MISSING status
5. **Reverse check candidates** — top 25 rules by name-based semantic score, excluding infrastructure/already-matched
6. **Kiro PART 2** — finds business statements in Excel index for reverse candidates (green/red rows)
7. **Kiro PART 1** — verifies forward check, corrects wrong matches (e.g. `ruleCalculateLegBaseCreditsForWorkCodeNotEqualToGRorDVorUL` corrected from wrong initial match)
8. **Session cache** — repo index cached, invalidated on repo change
9. **SSE streaming** — live progress updates in UI
10. **HTML report** — 4-column reverse check table with color coding
11. **UI reverse check table** — collapsible, green rows (found) / red rows (not found)

---

## What's Pending / In Progress 🔧

### 1. Kiro PART 1 — LIMO rule not found
- Statement: `"If my Leg's isLIMO Flag = TRUE and Arrival Station = Departure Station, then Base Credits = 0"`
- Current: matched to `ctLegDepartureArrival` (wrong — it's an XML template)
- Expected: Kiro should find `ruleLimoSameStation` in `rsCalculateLegBaseCredits`
- Why failing: Kiro says NOT_CONFIRMED but returns `SEARCH_REQUIRED` instead of the correct rule
- Root cause: rule body sent to Kiro is truncated (800 chars) — may not have enough context
- Fix needed: possibly increase body limit for PART 1, or improve prompt to give Kiro the file path to read directly

### 2. Remove debug log from `parseKiroResponse`
- `kiroVerifier.ts` has `console.log('[KIRO RAW OUTPUT...]')` — remove before production

### 3. UI — forward check table doesn't show Kiro corrections visually
- When Kiro changes `code_name`, the table updates but there's no visual indicator that Kiro made a correction
- Nice to have: "🤖 Kiro corrected" badge on updated rows

### 4. Annotated Excel download
- `session.lastAnnotatedExcelPath` is never set — endpoint returns 404
- Python reference has `excel_annotator.py` — not yet ported

### 5. `RULE_NAMES` tab support for Kiro verification
- Currently Kiro verification runs for all tab types but `findUndocumentedByRulesets` uses `extractStatements()` which may return few results for RULE_NAMES tabs
- Need to verify RULE_NAMES tabs work correctly end-to-end

### 6. `runAnalysisPipeline` (non-stream) is outdated
- The non-stream `/run_analysis` route doesn't use Kiro, doesn't use `findUndocumentedByRulesets`
- Only the stream route is up to date

---

## How to Run Tests

```bash
cd C:\Users\X322736\Downloads\project3\RHWBlazeMapper\packages\backend

# See top 25 semantic score for a tab
npx ts-node src/test-semantic-score.ts "<excel>" "<repo>" "<tab>"

# Full pipeline test with Kiro
npx ts-node src/test-reverse-check.ts "<excel>" "<repo>" "<tab>"

# Inspect exact Kiro prompt
npx ts-node src/test-kiro-prompt.ts "<excel>" "<repo>" "<tab>"
# Output: kiro-prompt-debug.txt at repo root
```

---

## Start Servers

```bash
cd C:\Users\X322736\Downloads\project3\RHWBlazeMapper
npm run dev
```

- Frontend: http://localhost:3000
- Backend: http://localhost:3001

After code changes to `blazeIndexer.ts`, `gapAnalyzer.ts`, or `kiroVerifier.ts` — restart backend manually (ts-node-dev may miss deep changes).
