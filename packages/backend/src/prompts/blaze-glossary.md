---
inclusion: auto
name: Blaze Glossary
description: Complete reference of all Blaze constructs, SRL syntax, and file types — enables Kiro to generate 100% accurate specs for Blaze changes
---

# Blaze Glossary — Complete Construct Reference

**Product:** FICO Blaze Advisor
**Rule language:** SRL (Structured Rule Language)
**IDE:** Eclipse with Blaze Innovator plugin

## Purpose of This File

This file exists for one reason: **to give Kiro complete, accurate knowledge of Blaze
so that every spec it generates for a Blaze rule change is correct and immediately
actionable by a developer — with zero guesswork.**

Without this file, Kiro treats Blaze as generic XML and produces specs with:
- Wrong SRL syntax (semicolons vs periods, wrong for-each format)
- Wrong file type names (calling a Group Template a "ruleset")
- Wrong instructions ("edit the XML file" instead of "use Blaze Innovator")
- Missing downstream impact (not knowing a function is called by 6 rulesets)

With this file loaded, Kiro:
- Generates design.md with exact SRL code matching your codebase patterns
- Names the correct Blaze file, correct rule position, correct parameter types
- Produces a complete impact analysis across all affected rulesets, functions, and tests
- Gives the developer a step-by-step spec they can follow in Blaze Innovator without ambiguity

**This file is derived from actual code in your CrewRulesRepository/ — not generic Blaze documentation.**
All syntax examples come from real rules in this project (rsDistributeToPremiumPayBuckets,
fcnIsLegEligibleForEDDPay, CssTripPaySubFlow, etc.).

---

# Blaze Constructs Reference

---

## 1. File Types in CrewRulesRepository/

| File | How to identify | Example |
|------|----------------|---------|
| **Ruleset** | Root tag is `<template>`, contains `<srl:ruleset-body>` | `rsDistributeToPremiumPayBuckets` |
| **Function** | Root tag is `<template>`, contains `<srl:function>` with a return type | `fcnCalculateTripDutyHours` |
| **Group Template** | Root tag is `<template>`, contains nested `<template:template>` children | `rstBlockToBlock`, `dtDetermineLDLPLegPremiumMultiplierBucket` |
| **Provider** | Root tag is `<template>`, contains `<template:provider>` | `conusOconusVL`, `InflightBucketNameProvider` |
| **RuleFlow** | Root tag is `<template>`, contains `<template:content section="flow">` | `CssTripPaySubFlow`, `PlnTripPayRuleFlow` |
| **Variable** | Root tag is `<template>`, `family` = `Variable Template` | `legMileageTfp_var` |
| **Decision Table** | Group Template with `family` = `Decision Table Template` | `dtDetermineLDLPLegPremiumMultiplierBucket` |
| **Instance** | Root tag is `<inst:instantiation>` — links a template to a Decision Service | Files under `BusinessLibrary/` |
| **Metadata** | `.innovator_attbs` — always paired with main file, never edit manually | `rsDistributeToPremiumPayBuckets.innovator_attbs` |

---

## 2. Name Prefixes — Convention

| Prefix | Type | Full example |
|--------|------|-------------|
| `rs` | Ruleset | `rsDistributeToPremiumPayBuckets` |
| `rst` | Group Template (Ruleset Template) | `rstBlockToBlock` |
| `fcn` | Function | `fcnCalculateTripDutyHours`, `fcnIsLegEligibleForEDDPay` |
| `dt` | Decision Table | `dtDetermineLDLPLegPremiumMultiplierBucket` |
| `grp` | Group Template (alternative) | `grpTripConflict` |
| `ct` | Code Template (inside a Group Template) | `ctBlockToBlock` |
| `rt` | Rule Template (inside a Group Template) | `rtBlockToBlock` |
| `prv` | Provider or Condition/Action sub-template | `prvBlockToBlockConditions` |
| `vl` | Value List / Provider | `conusOconusVL` |

---

## 3. SRL Syntax Reference (with real examples)

### 3.1 Rule Body Structure

Every rule inside a `<srl:ruleset-body>` follows this exact pattern:

```
if (<condition>) then
{
    <action>.
    <action>.
}
```

Real example from `rsDistributeToPremiumPayBuckets`:
```
if (theTrip <> null and theTrip.tripPay <> null) then
{
    theTrip.tripPay.tripPayInflight.legPayForTrip = fcnGetSumOfLegPayForTrip(theTrip.tripPay).
    fcnLogRuleFireEvent("ruleSetLegPayForTrip", "rsDistributeToPremiumPayBuckets", "SP = " theSchedulePeriodPay.schedulePeriodName).
}
```

**Critical SRL syntax rules:**
- Top-level actions (directly in `{}` of a rule body) end with `.` (period)
- Assignments inside nested `if` blocks use `;` (semicolon): `variable = value;`
- Local variable declarations always end with `.`: `myVar is a real initially 0.0.`
- Null checks always come first: `theTrip <> null and theTrip.tripPay <> null`
- String concatenation uses a space, not `+`: `"text " theVariable " more text"`
- `<>` means "not equal to"
- `is not equal to` is the verbose form (both are valid)
- Comments use `//` — same as Java

### 3.2 Conditional Assignment

```
if (condition) then {
    variable = value.
}
```

With else:
```
if (condition) then {
    variable = value1.
} else {
    variable = value2.
}
```

### 3.3 Local Variable Declaration Inside a Rule Body

```
variableName is a TypeName initially <expression>.
```

Real example:
```
isOnOrAfterEDDEffectiveDate is a boolean initially
    fcnIsDateTimeOnOrAfterConfigCollectionEffectiveDateTime(
        theTrip.beginDateTime, "IF_2024CBA_EXTENDED PREMIUM PAY_EFFECTIVE_DATE").
```

### 3.4 Function Call

```
result = fcnFunctionName(arg1, arg2).
```

Or as a condition:
```
if (fcnIsLegEligibleForEDDPay(theTrip, anyPayLeg, "ruleId", "rulesetId")) then { ... }
```

### 3.5 Iteration (for each)

Real syntax from your codebase — three forms:

**Basic iteration:**
```
for each DutyPeriodPay in theTripPay.dutyPeriodPayList as an array of DutyPeriodPay do
{
    <action for each item>.
}
```

**With filter condition:**
```
for each DutyPeriodPay in theTripPay.dutyPeriodPayList as an array of DutyPeriodPay
  such that (fcnDoesDutyPeriodPayBeginInSchedulePeriodPay(it, theSchedulePeriodPay)
             and it.payDutyPeriod.dutyType <> "RON") do
{
    <action>.
}
```

**With filter on a field:**
```
for each PayLeg in anyDutyPeriod.legList as an array of PayLeg
  such that (it.legPay.positionA) do
{
    <action>.
}
```

Key points:
- Always use `as an array of TypeName` after the collection
- Filter conditions use `such that (condition)` before `do`
- Inside the loop, refer to the current item by the declared variable name or use `it`
- End each action inside the loop with `.` (period)

### 3.6 String Literals vs Variables

```
"literal string value"       ← always in double quotes
theVariable                  ← no quotes — refers to a parameter or local variable
```

### 3.7 Object Creation

Create a new object with initial field values:
```
myObj is a TypeName initially {field1 = value1, field2 = value2}.
```

Real example:
```
a ReserveBlockDay initially {tfpCredited = 0.0, dutyPeriodList = an ArrayList,
                              airportStandbyTripList = an ArrayList}.
```

Create an empty list:
```
myList is a List<TypeName> initially an ArrayList.
```

### 3.8 List Operations

```
myList.add(item).                  -- add item to list
myList.size() > 0                  -- check if list is non-empty
myList.size() = 0                  -- check if list is empty
```

Real example:
```
schedulePeriodPayList.add(aCrewPayResponse.getSchedulePeriodPayByName(schedulePeriodName)).
```

### 3.9 Compound Assignment Operators

```
variable += value.     -- increment
variable -= value.     -- decrement
```

Real examples:
```
theSumOfTripRig += it.payValue.
contribution -= it.basePay.
```

### 3.10 Null and Unknown Checks

Always check both null AND unknown before accessing fields:
```
if (theObject <> null and theObject <> unknown) then { ... }
```

Real pattern used throughout the codebase:
```
if (theConfigCollection <> null and theConfigCollection <> unknown and
    theDateTime <> null and theDateTime <> unknown) then { ... }
```

- `<> null` — object reference is not null
- `<> unknown` — object exists but has no value (Blaze-specific concept, different from null)
- Always check BOTH — checking only null is insufficient in Blaze

### 3.11 String Operations

```
myString.contains("value")           -- true if string contains substring
myString.length() = 0                -- true if empty string
myString.length() > 0                -- true if non-empty
```

Real example:
```
if (deadHeadCode.contains("DH") = false and
    deadHeadCode.contains("DM") = false) then { ... }
```

Note: `.contains()` returns a value that must be compared with `= true` or `= false`
in some contexts. Use `deadHeadCode.contains("DH") = false` not `not deadHeadCode.contains("DH")`.

### 3.12 apply — Calling a Function for Side Effects

`apply` calls a function when you only care about its side effects (not its return value):
```
apply fcnFunctionName(arg1, arg2).
```

Real example:
```
apply fcnFindPreviousDutyToCombineForContractDuty(theTripList, tripCounter, dutyPeriodCounter - 1, combineForDuty).
```

Use `apply` when the function modifies objects passed to it but you don't need a return value.
Use direct assignment when you need the return value: `result = fcnMyFunction(arg).`

### 3.13 not Operator

```
not condition              -- logical negation
not fcnMyFunction(arg)     -- negate a function result
```

Real example:
```
if (not fcnIsDateTimeOnOrAfterConfigCollectionEffectiveDateTime(
        aPayTrip.beginDateTime, "IF_2025_LIMO_EFFECTIVE_DATE")) then { ... }
```

### 3.14 Boolean Logic

Standard `and` / `or` operators — lowercase, not `&&` / `||`:
```
if (conditionA and conditionB) then { ... }
if (conditionA or conditionB) then { ... }
```

Grouping with parentheses:
```
if ((conditionA and conditionB) or conditionC) then { ... }
```

### 3.15 Type Checking

```
myVar is a TypeName            -- check if variable is of a type
```

Real example:
```
if (it is a reserve) then { ... }
```

### 3.16 math() Built-in

```
math().max(value1, value2)     -- returns the larger of two values
math().min(value1, value2)     -- returns the smaller of two values
math().abs(value)              -- absolute value
math().round(value)            -- round to nearest integer
```

Real example:
```
contribution -= math().max(it.dutyHourRatio, it.dutyPeriodMinimum).
```

### 3.17 Comments

```
// Single line comment — same as Java
```

Multi-line comments are not supported. Use multiple `//` lines.

---

## 4. Ruleset Structure

A ruleset file contains:

```xml
<template name="rsMyRuleset">
  <template:content section="srl">
    <srl:ruleset-body>
      <!-- parameters (inputs) -->
      <srl:parameters>
        <srl:parameter>
          <srl:name>theTrip</srl:name>
          <srl:type>PayTrip</srl:type>
        </srl:parameter>
      </srl:parameters>

      <!-- local variables -->
      <srl:variable>
        <srl:name>myFlag</srl:name>
        <srl:type>boolean</srl:type>
        <srl:initializer>false</srl:initializer>
      </srl:variable>

      <!-- rules (ordered — fire in sequence) -->
      <srl:rule>
        <srl:name>ruleMyRuleName</srl:name>
        <srl:body><![CDATA[if (...) then { ... }]]></srl:body>
      </srl:rule>
    </srl:ruleset-body>
  </template:content>
</template>
```

**Key points:**
- Rules fire in **document order** (top to bottom) unless priority is set
- Parameters are the inputs passed from Java via `invokeService()`
- Local variables are scoped to the ruleset execution — reset each invocation
- Rule names must be unique within a ruleset
- The `.innovator_attbs` metadata file is managed automatically by Blaze Innovator — never create or edit it manually

---

## 5. Function Structure

```xml
<template name="fcnMyFunction">
  <template:content section="srl">
    <srl:function>
      <srl:name>fcnMyFunction</srl:name>
      <srl:type>boolean</srl:type>  <!-- return type -->
      <srl:parameters>
        <srl:parameter>
          <srl:name>theTrip</srl:name>
          <srl:type>PayTrip</srl:type>
        </srl:parameter>
      </srl:parameters>
      <srl:body><![CDATA[
        retVal is a boolean initially false.
        if (condition) then { retVal = true. }
        return retVal.
      ]]></srl:body>
    </srl:function>
  </template:content>
</template>
```

**Key points:**
- Functions use `return value.` at the end — the `return` keyword IS used (unlike some Blaze docs suggest)
- Local variables inside function: `varName is a TypeName initially value.`
- Functions should not modify the data model — only compute and return
- Functions can call other functions: `fcnOtherFunction(arg1, arg2)`
- Return null when appropriate: `return null;` (uses semicolon for null return)
- All changes to function files must be made through Eclipse + Blaze Innovator

---

## 6. Group Template (rstXxx, grpXxx, dtXxx)

A Group Template bundles multiple nested templates together. It is NOT a simple ruleset — it contains:

```
Group Template (e.g. rstBlockToBlock)
├── Rule Template (rtBlockToBlock)       ← the if/then rule pattern
├── Code Template (ctBlockToBlock)       ← the code/condition pattern
├── Condition sub-template (prvBlockToBlockConditions)
└── Action sub-template (prvBlockToBlockActions)
```

**When to use:**
- Group Templates are used when the same rule **pattern** applies to many instances
  (e.g. every type of legality check uses the same if/then/message structure)
- To add a new rule using a Group Template, you **instantiate** it in `BusinessLibrary/`
  using Eclipse + Blaze Innovator — fill in the Value Holders in the Innovator editor
- You do NOT modify the Group Template itself

**Decision Table** is a special Group Template (prefix `dt`):
- Rows = conditions, Columns = actions
- The Decision Table template contains nested templates: a Cell Template, Cases Info Template, and Cell Group Info Template
- **Must** be managed via Eclipse + Blaze Innovator — never edit the XML directly
- To add a new row: open in Blaze Innovator Decision Table editor, right-click → Add Row, fill in condition and action
- To add a new column: right-click → Add Column in the Innovator editor
- Direct XML editing of Decision Tables causes irreversible table corruption — the cell structure uses internal IDs

---

## 7. Value Holders

Value Holders are **placeholders** in a Group Template that get filled in per instantiation.
In the rendered output they appear as `<ValueHolderName>` tokens in the rule body.

**Real BusinessLibrary instantiation structure** (how Value Holders are filled):
```xml
<instantiation xmlns='http://www.blazesoft.com/instantiation'
               template='templateId' name='MyInstanceName'>
  <instantiation template='instanceId' name='Instance' id='Instance'/>
  <instantiation template='entryId' name='Entry' id='Entry'>
    <instance ref='Source Reference'>
      <instance ref='value'>
        <instance ref='locationVH'>
          <value></value>
        </instance>
        <instance ref='repositoryNameVH'>
          <value></value>
        </instance>
      </instance>
    </instance>
  </instantiation>
</instantiation>
```

**Key points:**
- Value Holders are deeply nested `<instance ref="..."><value>...</value></instance>` elements
- The `template` attribute references an internal Blaze ID (not the human-readable name)
- Never create or edit instantiation files in a text editor — the template IDs are generated by Blaze Innovator
- To add a new instantiation: use Eclipse + Blaze Innovator, open the template, click "New Instance"
  and fill in the Value Holders in the Innovator form — Innovator generates the correct XML with proper IDs
- To modify an existing instantiation: open it in Blaze Innovator, edit the value fields in the form

---

## 8. Provider

A Provider supplies a list of values or a computed value at runtime.

```xml
<template name="conusOconusVL">
  <template:value>
    <template:provider>com.blazesoft.template.engine.provider.NdListProvider</template:provider>
    <template:arg name="type">string</template:arg>
    <template:arg name="element">conus</template:arg>
    <template:arg name="element">oconus</template:arg>
  </template:value>
</template>
```

Types of providers in this project:
- `NdListProvider` — static list of string values (e.g. `conusOconusVL`)
- `InflightBucketNameProvider` — custom Java class providing dynamic values
- `prvTimeUnits` — time unit values

**When to change a Provider:** Only when the set of valid values changes (e.g. adding a new bucket code). Requires both Blaze file change AND potentially a Java provider class change.

---

## 9. RuleFlow

A RuleFlow orchestrates which rulesets run in sequence for a Decision Service entry point.
RuleFlows live in `CrewRulesRepository/DecisionServices/CSS/Inflight/PayRuleFlows/` (and equivalent for Legality).

**Real RuleFlow task structure** (from `CssTripPaySubFlow`):
```xml
<task type='ruleset'>
  <name>Calculate TAFB</name>
  <implementation>rsCalculateTAFB</implementation>  <!-- ruleset file name -->
  <return-type>void</return-type>
  <parameter>PayTrip</parameter>                    <!-- input type -->
  <input>theTrip</input>                            <!-- variable name -->
</task>
```

To add a new ruleset call to an existing flow:
- Open the RuleFlow file in Eclipse + Blaze Innovator
- Add a new task at the correct position in the flow (order matters — sequential execution)
- Set `<implementation>` to the exact ruleset file name
- Set `<parameter>` and `<input>` to match the ruleset's parameters

**Entry Point files** (`determineTripPay`, `determineTripLegality`, etc.) are separate template
files that link the `.server` entry point name to the RuleFlow. They live in the same
`DecisionServices/` folder. Do not edit entry point files — they are managed by Blaze Innovator.

**Key points:**
- The RuleFlow is what `NdStatelessServer.invokeService(serviceName, entryPoint)` executes
- The entry point name (e.g. `determineTripPay`) in the `.server` file maps to an entry point file
  which in turn links to the RuleFlow
- Order matters — rulesets run sequentially, each seeing results from previous ones
- To add a new ruleset to a flow: use Eclipse + Blaze Innovator — add a task in the flow editor
- NEVER edit RuleFlow XML in a text editor — the flow structure includes internal IDs managed by Innovator

---

## 10. Config Collections

Config Collections are runtime-configurable key-value stores used to control effective dates and feature flags without code changes.

Usage in SRL:
```
fcnIsDateTimeOnOrAfterConfigCollectionEffectiveDateTime(
    theTrip.beginDateTime, "IF_2024CBA_EXTENDED PREMIUM PAY_EFFECTIVE_DATE")
```

**Key points:**
- Config collection keys are **string constants** — must match exactly what's in the database
- Used for phased rollouts: a rule fires only when `beginDateTime >= configDate`
- To add a new config collection gate: use `fcnIsDateTimeOnOrAfterConfigCollectionEffectiveDateTime`
- Do NOT hardcode dates — always use config collections for effective date logic

---

## 11. The .server File — Entry Point Declaration

Every entry point exposed via REST must be declared in the `.server` file.

```xml
<DeployRulesServiceEntryPointConfig>
  <EntryPointId>determineTripPay</EntryPointId>
  <SrlInvocationFunctional>
    <SrlArgumentType>TripPayRequest</SrlArgumentType>
    <SrlName>determineTripPay</SrlName>
    <SrlReturnType>TripPayResponse</SrlReturnType>
  </SrlInvocationFunctional>
</DeployRulesServiceEntryPointConfig>
```

**Key points:**
- `EntryPointId` must match exactly what `RuleEngineDelegate.java` passes to `invokeService()`
- `SrlArgumentType` must match the Java class name of the request object
- `SrlReturnType` must match the Java class name of the response object
- After editing the `.server` file, you MUST run `./gradlew buildAllAdbs`

---

## 12. The .adb File — Compiled Blaze Binary

The `.adb` file is the compiled output of the `.server` + all Blaze rule files.

- **Never commit** `.adb` files — they are build artifacts
- **Always regenerate** after any change to `CrewRulesRepository/` or `.server` files
- Command: `./gradlew buildAllAdbs`
- The deployed WAR contains the `.adb` — it is what runs at runtime

---

## 13. Rule Priority

Rules in a ruleset fire in document order by default. Priority overrides this:

```xml
<srl:rule>
  <srl:name>ruleHighPriorityCheck</srl:name>
  <srl:priority immediate="true">999</srl:priority>
  <srl:body>...</srl:body>
</srl:rule>
```

- Higher number = higher priority
- `immediate="true"` means the rule fires as soon as its condition is met, even mid-iteration
- Most rules in this project do NOT use explicit priority — document order is intentional

---

## 14. Logging Pattern

Every rule that fires should log using `fcnLogRuleFireEvent`:

```
fcnLogRuleFireEvent("ruleName", "rulesetName", "key1 = " value1 " key2 = " value2).
```

- First arg: rule name (string)
- Second arg: ruleset name (string)
- Third arg: diagnostic message — concatenate with spaces, not `+`
- This is mandatory for all new rules — enables production debugging

---

## 15. What Kiro Does vs What Developer Does

| Task | Who |
|------|-----|
| Identify which Blaze file needs changing | Kiro (via knowledge base search) |
| Write the design.md with exact rule condition, action, file location | Kiro |
| Impact analysis — find all downstream files affected | Kiro (via knowledge base) |
| Identify which `.server` file needs updating | Kiro |
| Write the Java changes (RuleEngineDelegate, EntryPointNames, etc.) | Kiro |
| **Implement the Blaze rule change using Eclipse + Blaze Innovator** | **Developer** (following Kiro's exact design.md) |
| **NEVER edit Blaze XML files directly** — always use Blaze Innovator | **Developer rule — no exceptions** |
| **Run ./gradlew buildAllAdbs** after saving in Blaze Innovator | **Developer** |
| **Run ./gradlew test** | **Developer** (or Kiro via hook) |
| Write the .story integration test | Kiro (generates template) — Developer reviews |

---

## 16. Step-by-Step: Adding a New Rule to an Existing Ruleset

**All Blaze changes MUST be made through Eclipse with Blaze Innovator plugin.
Never edit Blaze XML files in a text editor — it corrupts the workspace.**

Follow these exact steps — no deviation:

1. Open Eclipse with the Blaze Innovator plugin
2. Open the target ruleset (e.g. `rsDistributeToPremiumPayBuckets`) in the Blaze Innovator editor
3. Click "Add Rule" in the ruleset editor — do NOT copy-paste XML
4. Enter the rule name (camelCase, starting with `rule`, e.g. `ruleMyNewCheck`)
5. Write the rule condition in the Condition editor using SRL syntax (see section 3)
6. Write the rule action in the Action editor using SRL syntax
7. Add `fcnLogRuleFireEvent("ruleName", "rulesetName", "diagnostic message").` as the last action
8. Position the rule in the correct order by dragging in the Blaze Innovator UI (order matters)
9. Save in Eclipse — Blaze Innovator automatically updates both the rule file AND the `.innovator_attbs` metadata
10. Run `./gradlew buildAllAdbs` — verify it compiles with no errors
11. Run `./gradlew test` — verify existing tests still pass
12. Add or update `.story` files for the new rule behaviour

---

## 17. Step-by-Step: Adding a New Function

**All Blaze changes MUST be made through Eclipse with Blaze Innovator plugin.**

1. In Eclipse + Blaze Innovator, right-click the target folder in the Rules Repository
2. Select "New → Function" from the context menu
3. Enter the function name (camelCase, starting with `fcn`, e.g. `fcnMyNewFunction`)
4. Set the return type in the Blaze Innovator editor
5. Add parameters using the parameter editor — do not edit XML directly
6. Write the function body in the SRL editor using syntax from section 3
7. Add `fcnLogRuleFireEvent` only if the function has side effects (most functions are pure — no logging needed)
8. Save in Eclipse — Blaze Innovator automatically creates both the function file AND the `.innovator_attbs`
9. Run `./gradlew buildAllAdbs`
10. Call from the ruleset: `fcnMyNewFunction(arg1, arg2)`

---

## 18. Common Mistakes to Avoid

| Mistake | Consequence | Correct approach |
|---------|------------|-----------------|
| **Editing Blaze XML files in a text editor** | Corrupts workspace, breaks `.innovator_attbs` pairing, Blaze Innovator can no longer open the file | **Always use Eclipse + Blaze Innovator — no exceptions** |
| Using `.` (period) inside a nested `if` assignment | May cause compile error | Use `;` for assignments inside nested `if` blocks; use `.` for top-level actions and local variable declarations |
| Using `+` for string concatenation | Compile error or wrong output | Use space: `"text " variable " more"` |
| Modifying `.innovator_attbs` manually | Blaze workspace corruption | Never edit — let Blaze Innovator manage it |
| Forgetting to run `buildAllAdbs` after rule change | Runtime uses old compiled rules | Always rebuild after any XML change |
| Adding a rule without `fcnLogRuleFireEvent` | Hard to debug in production | Always log |
| Editing a Decision Table XML directly | Table structure corruption | Use Blaze Innovator UI for Decision Tables |
| Using `return` at end of a rule body (outside a function) | Compile error — `return` is only valid in functions, not rule bodies | Rule bodies use assignment and procedure calls, no `return` |
| Not checking `<> null` before accessing fields | NullPointerException in Blaze at runtime | Always null-check parameters before use |
