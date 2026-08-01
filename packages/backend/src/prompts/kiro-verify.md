# RHW Blaze Mapper — Post-Analysis Validation

You are validating gap analysis results for a Rules Harvesting Workbook (RHW) against a Blaze Advisor rules repository.

- Read rule and function bodies directly from the repository at:
  `{{REPO_PATH}}`
- Consider a business statement CONFIRMED if the logic is implemented collectively across rules and helper functions.
- The `excel_name` field references the full business statement from the Excel workbook content below.

---

## Excel Workbook Content — {{TAB_NAME}}

{{EXCEL_INDEX}}

---

## Blaze Naming Conventions

- `ruleXxx` — individual rule inside a ruleset (verifiable)
- `fcnXxx` — function (verifiable)
- `rsXxx` — ruleset container/orchestrator (NOT individually verifiable)
- `dtXxx` — decision table
- Rule bodies use SRL syntax: `if (condition) then { action. }`

---

## PART 1 — Forward Check

Read the Excel Workbook Content above and extract every row that contains actionable business logic (conditions, formulas, or rules). Skip headers, revision history, narrative descriptions, and overview rows.

For each extracted statement, search the repository to find the rule or function that implements it. Consider CONFIRMED if the logic is implemented collectively across rules and helper functions.

---

## PART 2 — Reverse Check

For each rule/function below, read its body from the repository and search the Excel content above for a matching business statement. Sort results with non-null matches first.

**Rules/functions to check:**

{{REVERSE_ITEMS}}

---

## Repository Search Strategy

For PART 2, extract each rule body using grep pattern matching:

    Pattern: "<name>{RULE_NAME}</name>"
    Context lines: 30 (enough to capture the <body> tag)

Do NOT use the read tool on full ruleset files.
Batch grep calls: up to 5 rule names per grep call using alternation:

    grep -E "<name>(rule1|rule2|rule3)</name>" file -A 25

## Processing limit

Process PART 2 in batches of 8 rules maximum per iteration.

---

## Required Response Format

Respond ONLY with the following JSON — no explanation, no markdown wrapping, just the JSON object:

```json
{
  "forward": [
    {
      "excel_name": "exact business statement from the Excel workbook (full text)",
      "status": "CONFIRMED | NOT_CONFIRMED | PARTIAL",
      "correct_code_name": "rule or function name that implements the logic",
      "notes": "one sentence reason"
    }
  ],
  "reverse": [
    {
      "name": "exact rule/function name",
      "business_statement": "exact quote from Excel tab or null",
      "sheet_name": "sheet tab name or null"
    }
  ]
}
```
