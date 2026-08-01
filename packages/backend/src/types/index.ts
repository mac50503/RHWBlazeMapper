/**
 * Core domain types for RHWBlazeMapper.
 * Shared between services, routes, and the API contract.
 */

// ---------------------------------------------------------------------------
// Rule status / recommendations
// ---------------------------------------------------------------------------

export type RuleStatus =
  | 'MATCH'
  | 'MISSING'
  | 'MISMATCH'
  | 'NAME_TYPO'
  | 'REMOVED'
  | 'NOT_IMPLEMENTED';

export type RecommendedAction =
  | 'NO_ACTION'              // MATCH — nothing to do
  | 'UPDATE_RHW'             // Rule is in code — fix the workbook (HIGH confidence)
  | 'VERIFY_WITH_BUSINESS';  // Ambiguous — ask the BA (MEDIUM confidence)

export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface Recommendation {
  action:     RecommendedAction;
  confidence: Confidence;
  reason:     string;   // human-readable explanation, never truncated
}

// ---------------------------------------------------------------------------
// A single rule entry — from Excel OR from the repo index
// ---------------------------------------------------------------------------

export interface RuleEntry {
  /** Rule name exactly as found (Excel cell value or rule name= attribute) */
  name:     string;
  /** Source row index (0-based) when coming from Excel; file path when from repo */
  source:   string;
  /** Section / group label extracted from the workbook (e.g. "Rest Rules") */
  section?: string;
  /** Raw cell context — full row values, used for condition comparison */
  rowData?: string[];
  /** Rule body content (from repo) — used for semantic scoring in PROSE tabs */
  body?: string;
  /**
   * Blaze artifact kind (from glosario prefixes):
   *   rule            — srl:rule inside a ruleset (ruleXxx)
   *   function        — srl:function (fcnXxx)
   *   ruleset         — orchestrator container (rsXxx) — not individually verifiable
   *   decision_table  — Group Template Decision Table (dtXxx)
   *   group_template  — Group Template (rstXxx, grpXxx, ctXxx, rtXxx)
   *   unknown         — could not determine
   */
  kind?: 'rule' | 'function' | 'ruleset' | 'decision_table' | 'group_template' | 'unknown';
}

// ---------------------------------------------------------------------------
// Gap analysis result for one rule
// ---------------------------------------------------------------------------

export interface GapResult {
  excel_name:  string;
  code_name:   string;
  status:      RuleStatus;
  issues:      string[];
  notes:       string;
  row_num:     number;
  section:     string;
  recommendation: Recommendation;
  rule_file:   string | null;
  config_keys: string[];
  hardcoded_dates: string[];
}

// ---------------------------------------------------------------------------
// Tab types (auto-detected from workbook content)
// ---------------------------------------------------------------------------

export type TabType =
  | 'RULE_NAMES'
  | 'LEGALITY_DECISION_TABLE'
  | 'LEGALITY_MASTER'
  | 'LOOKUP_TABLE'
  | 'PROSE_LOGIC'
  | 'REFERENCE';

// ---------------------------------------------------------------------------
// Repo validation result
// ---------------------------------------------------------------------------

export interface RepoValidationResult {
  valid:      boolean;
  engine:     string;
  rule_files: number;
  message?:   string;
}

// ---------------------------------------------------------------------------
// API response types (matching the REST contract)
// ---------------------------------------------------------------------------

export interface ErrorResponse {
  error: string;
}

export interface UploadExcelResponse {
  path: string;
}

export interface ValidateOkResponse {
  ok:          true;
  rule_files?: number;
  message?:    string;
  cache_root?: string;
}

export interface ValidateFailResponse {
  ok:    false;
  error: string;
}

export type ValidateResponse = ValidateOkResponse | ValidateFailResponse;

export interface LoadTabsResponse {
  tabs:             string[];
  tab_types:        Record<string, TabType>;
  groups:           Record<string, string[]>;
  tabs_with_images: string[];
  cache_note?:      string;
}

export interface RunAnalysisResponse {
  counts: {
    MATCH:           number;
    NAME_TYPO:       number;
    MISMATCH:        number;
    MISSING:         number;
    REMOVED:         number;
    NOT_IMPLEMENTED: number;
  };
  undocumented:    number;
  report_url:      string;
  report_path:     string;
  index_written:   boolean;
  index_path:      string | null;
  rule_index:      RuleIndexResult | null;
  annotated_excel: AnnotatedExcelResult | null;
}

export interface RuleIndexResult {
  success:    boolean;
  file_path:  string | null;
  prefix:     string;
  error?:     string;
}

export interface AnnotatedExcelResult {
  success:            boolean;
  path:               string | null;
  annotations_added:  number;
  error?:             string;
}

export interface HomeInfoResponse {
  home:     string;
  sep:      string;
  out_root: string;
  engine:   string;
  platform: string;
}

export interface SuggestReposResponse {
  source:        'gitlab' | 'local';
  filter:        'if' | 'fo' | 'vacancy' | 'ror' | null;
  paths:         string[];
  gitlab_repos?: Array<{
    path:    string;
    name:    string;
    id:      number;
    web_url: string;
  }>;
}

// ---------------------------------------------------------------------------
// SSE stream event types
// ---------------------------------------------------------------------------

export type StreamPhase = 'indexing' | 'forward_check' | 'kiro_verify' | 'report';

export interface ProgressEvent {
  type:    'progress';
  message: string;
  phase:   StreamPhase;
}

export interface RuleEvent {
  type:   'rule';
  result: GapResult;
}

export interface UndocumentedRule {
  name:               string;
  source:             string;
  /** Kiro-found business statement from the Excel that corresponds to this rule */
  business_statement?: string;
  /** Excel sheet name where Kiro found the correspondence */
  sheet_name?:        string;
}

export interface CompleteEvent {
  type:               'complete';
  counts:             RunAnalysisResponse['counts'];
  undocumented:       number;
  undocumented_rules: UndocumentedRule[];
  results:            GapResult[];
  report_url:         string;
  report_path:        string;
  rule_index:         RuleIndexResult | null;
  annotated_excel:    AnnotatedExcelResult | null;
}

export interface StreamErrorEvent {
  type:  'error';
  error: string;
}

export type StreamEvent = ProgressEvent | RuleEvent | CompleteEvent | StreamErrorEvent;
