# RHW Blaze Mapper

Gap analysis tool between **Rules Harvesting Workbooks (Excel)** and **Blaze Advisor** codebases, with AI verification via Kiro CLI.

## What It Does

Given an Excel workbook tab and a Blaze Advisor repository, the tool produces two reports:

**Forward Check** — for each business statement in the Excel tab, finds the rule or function in the repository that implements it, using semantic scoring. Kiro then verifies each match and corrects wrong ones.

**Reverse Check** — finds rules and functions in the repository that are semantically related to the tab but may not be documented in the Excel. Kiro searches the workbook content to find the corresponding business statement for each.

### Status types

| Status | Meaning |
|--------|---------|
| ✓ MATCH | Rule confirmed in code |
| ✗ MISSING | Statement in Excel, no matching rule found |
| ✗ MISMATCH | Rule found but conditions differ |
| ✎ NAME_TYPO | Rule found under a different name (Kiro corrected) |
| ✗ REMOVED | Row marked as removed in workbook |
| ⊘ NOT_IMPL | Row marked as not yet implemented |

### Reverse Check table

Each reverse candidate shows:
- **Rule Name** — rule or function in the repo
- **File** — source file path
- **Sheet** — Excel sheet where Kiro found the matching statement (green row) or "Not found" (red row)
- **Business Statement** — exact quote from the Excel tab

---

## Stack

- **Frontend:** React + TypeScript (Vite) — port 3000
- **Backend:** Node.js + TypeScript (Express) — port 3001
- **AI:** Kiro CLI (claude-haiku-4.5) — required for verification

---

## Prerequisites

- Node.js 18+
- npm 9+
- Kiro CLI installed and authenticated (`kiro-cli auth login`)

---

## Install & Run

```bash
npm install
npm run dev
```

Opens:
- Frontend: http://localhost:3000
- Backend API: http://localhost:3001

---

## Usage

1. **Upload Workbook** — select an Excel RHW workbook
2. **Load Tabs →** — classifies each tab (PROSE_LOGIC, RULE_NAMES, etc.) and generates an Excel index for Kiro
3. **Select a tab** from the list
4. **Enter repo path** — local path to the Blaze Advisor `CrewRulesRepository`
5. **▶ Run Analysis** — runs forward check → reverse check → Kiro verification

Reports save to `~/Documents/RHW-Analysis/reports/`

---

## How It Works

```
Load Tabs
  → classifyTab()         PROSE_LOGIC | RULE_NAMES | LEGALITY_* | LOOKUP_TABLE | REFERENCE
  → generateExcelIndex()  creates plain-text index of all tabs for Kiro

Run Analysis
  → indexRules()          walks repo, extracts rules/functions with SRL bodies (cached per repo)
  → Forward Check
      PROSE tabs  → analyzeProseTabByStatement()   semantic score per statement
      RULE_NAMES  → analyzeGaps()                  exact/fuzzy name matching
  → Reverse Check
      → findUndocumentedByRulesets()  top 25 rules by name-based semantic score
  → Kiro Verification
      PART 1: verify forward matches, correct wrong code_names, find MISSING rules
      PART 2: for each reverse candidate, find its business statement in the Excel
  → HTML Report + UI update
```

---

## Project Structure

```
RHWBlazeMapper/
  packages/
    frontend/               React UI
    backend/
      src/
        services/
          blazeIndexer.ts   Repo walker + rule extractor
          excelParser.ts    Workbook parser + tab classifier
          excelIndexer.ts   Generates plain-text Excel index for Kiro
          gapAnalyzer.ts    Forward + reverse check scoring
          kiroVerifier.ts   Kiro prompt builder + response parser
          kiroRunner.ts     Kiro CLI subprocess runner
        routes/
          analysis.ts       Main API routes + SSE stream
          repo.ts           Repo validation + discovery
        prompts/
          kiro-verify.md    Kiro prompt template
          blaze-glossary.md Blaze SRL reference for Kiro
        test-*.ts           Test scripts (not production)
  SESSION_CONTEXT.md        Full session context + pending work
  package.json              Monorepo root
```

---

## Session Context

For full details on what has been implemented, what's pending, and known issues, see **[SESSION_CONTEXT.md](./SESSION_CONTEXT.md)**.
