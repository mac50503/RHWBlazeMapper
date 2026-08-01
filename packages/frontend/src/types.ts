// ─── Shared API types ────────────────────────────────────────────────────────

export type RuleStatus =
  | 'MATCH'
  | 'MISSING'
  | 'MISMATCH'
  | 'NAME_TYPO'
  | 'REMOVED'
  | 'NOT_IMPLEMENTED';

export type RecommendedAction =
  | 'NO_ACTION'
  | 'UPDATE_RHW'
  | 'VERIFY_WITH_BUSINESS';

export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface Recommendation {
  action: RecommendedAction;
  confidence: Confidence;
  reason: string;
}

export interface RuleResult {
  excel_name: string;
  code_name: string;
  status: RuleStatus;
  issues: string[];
  notes: string;
  row_num: number;
  section: string;
  recommendation: Recommendation;
  rule_file: string | null;
  config_keys: string[];
  hardcoded_dates: string[];
}

// ─── Endpoint response shapes ────────────────────────────────────────────────

export interface UploadExcelResponse {
  path: string;
}

export interface ValidateOkResponse {
  ok: true;
  rule_files?: number;
  message?: string;
  cache_root?: string;
}

export interface ValidateFailResponse {
  ok: false;
  error: string;
}

export type ValidateResponse = ValidateOkResponse | ValidateFailResponse;

export type TabType =
  | 'RULE_NAMES'
  | 'LEGALITY_DECISION_TABLE'
  | 'LEGALITY_MASTER'
  | 'LOOKUP_TABLE'
  | 'PROSE_LOGIC'
  | 'REFERENCE';

export interface LoadTabsResponse {
  tabs: string[];
  tab_types: Record<string, TabType>;
  groups: Record<string, string[]>;
  tabs_with_images: string[];
  cache_note?: string;
  error?: string;
}

export interface RunAnalysisCounts {
  MATCH: number;
  NAME_TYPO: number;
  MISMATCH: number;
  MISSING: number;
  REMOVED: number;
  NOT_IMPLEMENTED: number;
}

export interface RunAnalysisResponse {
  counts: RunAnalysisCounts;
  undocumented: number;
  report_url: string;
  report_path: string;
  index_written: boolean;
  index_path: string | null;
  rule_index: {
    success: boolean;
    file_path: string | null;
    prefix: string;
    error?: string;
  } | null;
  annotated_excel: {
    success: boolean;
    path: string | null;
    annotations_added: number;
    error?: string;
  } | null;
}

// ─── SSE stream event types ───────────────────────────────────────────────────

export interface ProgressEvent {
  type: 'progress';
  message: string;
  phase: 'indexing' | 'forward_check' | 'kiro_verify' | 'report';
}

export interface RuleEvent {
  type: 'rule';
  result: RuleResult;
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
  counts:             RunAnalysisCounts;
  undocumented:       number;
  undocumented_rules: UndocumentedRule[];
  results:            RuleResult[];
  report_url:         string;
  report_path:        string;
  rule_index:         RunAnalysisResponse['rule_index'];
  annotated_excel:    RunAnalysisResponse['annotated_excel'];
}

export interface StreamErrorEvent {
  type: 'error';
  error: string;
}

export type StreamEvent = ProgressEvent | RuleEvent | CompleteEvent | StreamErrorEvent;

export interface ErrorResponse {
  error: string;
}
