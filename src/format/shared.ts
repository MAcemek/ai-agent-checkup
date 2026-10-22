import type { Finding, Report, Severity } from '../types.js';

export const SEVERITY_LABELS: Record<Severity, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'Info',
};

/** Wraps text at width. The first line starts with `first`, the others with `rest`. */
export function wrap(text: string, width: number, first: string, rest: string): string[] {
  const lines: string[] = [];
  let line = first;
  let empty = true;
  for (const word of text.split(/\s+/).filter((w) => w !== '')) {
    if (!empty && line.length + 1 + word.length > width) {
      lines.push(line);
      line = rest + word;
    } else {
      line = empty ? line + word : `${line} ${word}`;
    }
    empty = false;
  }
  lines.push(line);
  return lines;
}

/** "Scanned 3 workflows with 4 agent steps." */
export function scannedText(report: Report): string {
  const { workflows, agentSteps } = report.summary;
  if (workflows === 0) {
    return report.target === 'file'
      ? 'No workflow found.'
      : 'No workflow files found in .github/workflows.';
  }
  const files = workflows === 1 ? '1 workflow' : `${workflows} workflows`;
  const steps = agentSteps === 1 ? '1 agent step' : `${agentSteps} agent steps`;
  return `Scanned ${files} with ${steps}.`;
}

/** "Found 2 problems: 1 high, 1 medium, 0 low, 0 info." or "No problems found." */
export function totalText(report: Report): string {
  const { high, medium, low, info, total, agentSteps } = report.summary;
  if (total === 0) return agentSteps === 0 ? 'No AI agent steps found.' : 'No problems found.';
  const noun = total === 1 ? 'problem' : 'problems';
  return `Found ${total} ${noun}: ${high} high, ${medium} medium, ${low} low, ${info} info.`;
}

/** "job triage, step "Run Claude"" or "" for file-level findings. */
export function placeText(finding: Finding): string {
  const parts: string[] = [];
  if (finding.job !== null) parts.push(`job ${finding.job}`);
  if (finding.step !== null) parts.push(`step "${finding.step}"`);
  return parts.join(', ');
}

export function locationText(finding: Finding): string {
  return `${finding.file}:${finding.line}`;
}
