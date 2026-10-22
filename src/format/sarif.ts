import { isAbsolute, posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CHECK_DEFINITIONS } from '../checks/definitions.js';
import type { Finding, Report, Severity } from '../types.js';

export const SARIF_SCHEMA = 'https://json.schemastore.org/sarif-2.1.0.json';

const LEVELS: Record<Severity, 'error' | 'warning' | 'note'> = {
  high: 'error',
  medium: 'warning',
  low: 'note',
  info: 'note',
};

/** "anyone-can-run" gives "AnyoneCanRun". */
function ruleName(id: string): string {
  return id
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/**
 * The location of a finding for code scanning: relative to the repository root (the working
 * directory), with forward slashes. An absolute scanned path gives a file:// URI.
 */
export function artifactUri(report: Report, finding: Finding): string {
  if (report.target === 'file') {
    return isAbsolute(report.path)
      ? pathToFileURL(report.path).href
      : posix.normalize(finding.file);
  }
  if (isAbsolute(report.path)) {
    return pathToFileURL(posix.join(report.path, finding.file)).href;
  }
  return posix.normalize(posix.join(report.path, finding.file));
}

export function formatSarif(report: Report): string {
  const rules = CHECK_DEFINITIONS.map((d) => ({
    id: d.id,
    name: ruleName(d.id),
    shortDescription: { text: d.title },
    fullDescription: { text: d.summary },
    helpUri: `${report.tool.homepage}#checks`,
    help: { text: d.summary },
    properties: { tags: ['security', 'github-actions', 'ai-agents'] },
  }));
  const results = report.findings.map((f) => ({
    ruleId: f.id,
    ruleIndex: CHECK_DEFINITIONS.findIndex((d) => d.id === f.id),
    level: LEVELS[f.severity],
    message: { text: `${f.title}: ${f.explanation} Fix: ${f.fix}` },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: artifactUri(report, f) },
          region: { startLine: f.line },
        },
      },
    ],
    properties: { severity: f.severity, job: f.job, step: f.step, agent: f.agent },
  }));
  const sarif = {
    $schema: SARIF_SCHEMA,
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: report.tool.name,
            version: report.tool.version,
            informationUri: report.tool.homepage,
            rules,
          },
        },
        results,
      },
    ],
  };
  return `${JSON.stringify(sarif, null, 2)}\n`;
}
