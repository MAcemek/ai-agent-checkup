import type { Finding, Report, Severity } from '../types.js';
import { locationText, placeText, scannedText, totalText, wrap } from './shared.js';

const ESC = String.fromCharCode(27);
const BOLD = `${ESC}[1m`;
const DIM = `${ESC}[2m`;
const RED = `${ESC}[31m`;
const YELLOW = `${ESC}[33m`;
const CYAN = `${ESC}[36m`;
const RESET = `${ESC}[0m`;

/** Width that explanations and fixes are wrapped at. */
export const WRAP_WIDTH = 100;

const INDENT = '  ';

const TAGS: Record<Severity, string> = {
  high: '[HIGH]',
  medium: '[MEDIUM]',
  low: '[LOW]',
  info: '[INFO]',
};

const COLORS: Record<Severity, string> = {
  high: `${BOLD}${RED}`,
  medium: YELLOW,
  low: CYAN,
  info: DIM,
};

function findingLines(finding: Finding, paint: (code: string, text: string) => string): string[] {
  const lines: string[] = [];
  lines.push(
    `${paint(COLORS[finding.severity], TAGS[finding.severity])} ${finding.title} (${finding.id})`,
  );
  const place = placeText(finding);
  lines.push(`${INDENT}${locationText(finding)}${place ? `  ${place}` : ''}`);
  lines.push(...wrap(finding.explanation, WRAP_WIDTH, INDENT, INDENT));
  const width = Math.max(...finding.evidence.map((e) => String(e.line).length));
  for (const e of finding.evidence) {
    lines.push(paint(DIM, `${INDENT}  ${String(e.line).padStart(width)} | ${e.text}`));
  }
  lines.push(...wrap(finding.fix, WRAP_WIDTH, `${INDENT}Fix: `, `${INDENT}     `));
  return lines;
}

export function formatText(report: Report, options: { color: boolean }): string {
  const paint = (code: string, text: string): string =>
    options.color ? `${code}${text}${RESET}` : text;
  const lines: string[] = [];
  lines.push(paint(BOLD, `ai-agent-checkup ${report.tool.version}`));
  lines.push(`Path: ${report.path}`);
  lines.push(scannedText(report));
  lines.push('', totalText(report));
  for (const finding of report.findings) lines.push('', ...findingLines(finding, paint));
  lines.push('', report.note);
  return `${lines.join('\n')}\n`;
}
