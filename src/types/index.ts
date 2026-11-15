export type RuleCategory =
  | 'architecture'
  | 'naming'
  | 'error-handling'
  | 'testing'
  | 'security'
  | 'typing'
  | 'performance'
  | 'formatting'
  | 'documentation'
  | 'other';

export type RuleSeverity = 'error' | 'warning' | 'info';

export interface RuleEvidence {
  prNumber: number;
  prUrl?: string;
  commentId: string | number;
  commentUrl?: string;
  author: string;
  commentBody: string;
  diffHunk?: string;
  path?: string;
  resolved?: boolean;
  createdAt: string;
}

export interface Rule {
  id: string; // unique slug e.g. "prefer-async-await-over-promises"
  title: string;
  category: RuleCategory;
  description: string;
  guidelines: string[];
  positiveExamples: string[];
  negativeExamples: string[];
  applicableGlobs: string[];
  severity: RuleSeverity;
  confidence: number; // 0.0 to 1.0
  occurrenceCount: number;
  evidence: RuleEvidence[];
  embedding?: number[];
  createdAt: string;
  updatedAt: string;
}

export interface RuleViolation {
  ruleId: string;
  ruleTitle: string;
  category: RuleCategory;
  severity: RuleSeverity;
  confidence: number;
  file: string;
  line: number; // line in the new file
  startLine?: number; // for multiline comments
  hunkHeader?: string;
  violatingCode: string;
  suggestedFix?: string;
  message: string;
  citations: {
    prNumber: number;
    prUrl?: string;
    author?: string;
    commentQuote?: string;
  }[];
}

export interface PRReviewSummary {
  prNumber: number;
  repository: string;
  analyzedFiles: number;
  analyzedHunks: number;
  matchedRules: number;
  violations: RuleViolation[];
  decision: 'APPROVE' | 'COMMENT' | 'REQUEST_CHANGES';
  summaryComment: string;
  reviewDurationMs: number;
}

export interface MinedPRComment {
  id: string | number;
  prNumber: number;
  prTitle: string;
  prUrl: string;
  author: string;
  path: string;
  diffHunk: string;
  body: string;
  inReplyToId?: string | number;
  createdAt: string;
  isResolved?: boolean;
}

export interface MiningStats {
  scannedPRs: number;
  scannedComments: number;
  filteredNoiseComments: number;
  extractedRawRules: number;
  synthesizedRulesCount: number;
  durationMs: number;
}

export interface SearchRulesQuery {
  text?: string;
  category?: RuleCategory;
  filePath?: string;
  minConfidence?: number;
  limit?: number;
  embedding?: number[];
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMCompletionOptions {
  temperature?: number;
  maxTokens?: number;
  jsonSchema?: Record<string, unknown>;
}

export interface ILLMProvider {
  readonly name: string;
  generateText(messages: LLMMessage[], options?: LLMCompletionOptions): Promise<string>;
  generateStructured<T>(messages: LLMMessage[], schemaDescription: string, options?: LLMCompletionOptions): Promise<T>;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}
