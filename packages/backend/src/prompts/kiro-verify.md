# Kiro Verification Prompt
# RHW Blaze Mapper — Post-Analysis Validation

**IMPORTANT: Your response must be ONLY a valid JSON object. No text before or after. No explanation. No markdown. Just the JSON.**

You are validating gap analysis results for a Rules Harvesting Workbook (RHW) against a Blaze Advisor rules repository.

**PART 1** — You MAY search the repository at `{{REPO_PATH}}` to find or confirm rule implementations.
**PART 2** — Use ONLY the data provided in this prompt. Do NOT read files or search the repository.

---

## Context

- **Tab analyzed:** {{TAB_NAME}}
- **Tab type:** {{TAB_TYPE}}
- **Repository path:** {{REPO_PATH}}

{{EXCEL_INDEX}}

### Blaze naming conventions (for reference)
- `ruleXxx` — individual rule inside a ruleset (verifiable)
- `fcnXxx` — function (verifiable)
- `rsXxx` — ruleset container/orchestrator (NOT individually verifiable)
- `dtXxx` — decision table
- Rule bodies use SRL syntax: `if (condition) then { action. }`

---

## PART 1 — Forward Check Validation

These items need verification. For each:

- Read the `excel_name` (business statement from the workbook).
- Read the `code_name` body provided inline.
- **Step 1:** Does the body of `code_name` implement the logic described in `excel_name`? Yes or No.
- **Step 2:** If NO — regardless of current status — **search the repository at `{{REPO_PATH}}`** using your file tools. Look in the `file:` path first, then nearby files. Find the rule or function whose body actually implements the `excel_name` logic.
- **Step 3:** Return the correct `code_name` you found (or original if confirmed correct) and your verdict.

{{FORWARD_ITEMS}}

---

## PART 2 — Reverse Check

The Excel workbook content is provided above in the "Excel Workbook Content" section.
Below is a list of rules from the repository. For each rule:
1. Read its body (provided inline)
2. Search the Excel content above for any row that describes the same logic
3. Return the exact row text and the tab name where you found it
4. If nothing matches, return null for both fields

**STRICT: Do NOT read any files. Do NOT search the repository. Use ONLY the rule bodies below and the Excel content above.**

{{REVERSE_ITEMS}}

---

## Instructions

1. For PART 1: determine if the `code_name` body correctly implements the `excel_name` logic — search the repository if needed
2. For PART 1 MISSING or NOT_CONFIRMED: actively search `{{REPO_PATH}}` to find the rule or function that implements the `excel_name` logic
3. For PART 1 MISMATCH: determine if the condition difference is real or context-level
4. For PART 2: use ONLY the Excel content and rule bodies provided in this prompt — do NOT read files or search the repository
6. Keep all text fields to ONE sentence maximum
7. **YOUR ENTIRE RESPONSE MUST BE ONLY THE JSON OBJECT — start with `{` and end with `}`, nothing else**

## Required Response Format

```json
{
  "forward": [
    {
      "excel_name": "exact excel_name from input",
      "status": "CONFIRMED",
      "correct_code_name": "the rule/function name that actually implements the logic, or same as code_name if confirmed",
      "notes": "one sentence reason"
    }
  ],
  "reverse": [
    {
      "name": "exact rule name from input",
      "business_statement": "exact quote from Excel tab or null",
      "sheet_name": "sheet tab name where found or null"
    }
  ]
}
```

### Status values (PART 1)

- `CONFIRMED` — `code_name` body correctly implements the statement
- `NOT_CONFIRMED` — `code_name` does not implement the statement — set `correct_code_name` to the rule you found in the repo that does
- `PARTIAL` — partial implementation, missing conditions or edge cases

### Reverse check fields (PART 2)

- `business_statement` — exact quote from the Excel tab that corresponds to this rule, or `null` if not found
- `sheet_name` — name of the Excel sheet/tab where the statement was found, or `null` if not found
