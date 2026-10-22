export const SEVERITIES = ['high', 'medium', 'low', 'info'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const CHECK_IDS = [
  'anyone-can-run',
  'untrusted-input',
  'write-permissions',
  'dangerous-settings',
  'untrusted-checkout',
  'untrusted-trigger',
  'outdated-agent',
  'shared-checkout',
  'checkout-credentials',
  'unpinned-agent',
  'parse-error',
] as const;
export type CheckId = (typeof CHECK_IDS)[number];

export const OUTPUT_FORMATS = ['text', 'markdown', 'json', 'sarif'] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export const FAIL_ON_VALUES = ['high', 'medium', 'low', 'any'] as const;
export type FailOn = (typeof FAIL_ON_VALUES)[number];

/** A source line that a finding is based on. */
export interface Evidence {
  /** Path relative to the scanned directory, with forward slashes. */
  file: string;
  /** 1-based line number. */
  line: number;
  /** The trimmed source line, shortened to 80 characters. */
  text: string;
}

export interface Finding {
  id: CheckId;
  severity: Severity;
  title: string;
  /** What was found and why it matters, in one to three sentences. */
  explanation: string;
  /** How to fix it. */
  fix: string;
  file: string;
  line: number;
  /** Job id, or null for findings about the whole file. */
  job: string | null;
  /** Step name, id or "step <n>", or null. */
  step: string | null;
  /** Registry id of the agent, or null. */
  agent: string | null;
  evidence: Evidence[];
}

export interface Summary {
  high: number;
  medium: number;
  low: number;
  info: number;
  total: number;
  workflows: number;
  agentSteps: number;
}

export interface ScannedWorkflow {
  file: string;
  agentSteps: number;
}

export interface Report {
  tool: { name: 'ai-agent-checkup'; version: string; homepage: string };
  /** The scanned path as given, with forward slashes. */
  path: string;
  /** "directory": path is a repository root; "file": path is one workflow file. */
  target: 'directory' | 'file';
  workflows: ScannedWorkflow[];
  summary: Summary;
  findings: Finding[];
  note: string;
}
