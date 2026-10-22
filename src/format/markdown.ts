import type { Report } from '../types.js';
import { locationText, placeText, scannedText, SEVERITY_LABELS, totalText } from './shared.js';

/** Escapes < and > so that GitHub does not read them as HTML. */
export function escapeHtml(text: string): string {
  return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escapes text for a Markdown table cell. */
export function cell(text: string): string {
  return escapeHtml(text)
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\s*\n\s*/g, ' ');
}

const code = (text: string): string => `\`${text.replace(/`/g, "'")}\``;

export function formatMarkdown(report: Report): string {
  const lines: string[] = [];
  lines.push('## AI agent workflow checkup', '');
  lines.push(`- Path: ${code(report.path)}`);
  lines.push(`- ${scannedText(report)}`);
  lines.push(`- ai-agent-checkup ${report.tool.version}`);
  lines.push('', `**${totalText(report)}**`);
  if (report.findings.length > 0) {
    lines.push('', '| Severity | Problem | Location | Details |', '| --- | --- | --- | --- |');
    for (const f of report.findings) {
      const place = placeText(f);
      lines.push(
        `| ${SEVERITY_LABELS[f.severity]} | ${cell(f.title)} (${code(f.id)}) | ${code(locationText(f))}${place ? ` ${cell(place)}` : ''} | ${cell(f.explanation)} |`,
      );
    }
    lines.push('', '### How to fix', '');
    for (const f of report.findings) {
      lines.push(`- **${f.title}** (${code(locationText(f))}): ${escapeHtml(f.fix)}`);
    }
  }
  lines.push('', `_${report.note}_`);
  return `${lines.join('\n')}\n`;
}
