import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseFailOn } from './args.js';
import { errorMessage } from './errors.js';
import { formatJson } from './format/index.js';
import { formatMarkdown } from './format/markdown.js';
import { formatSarif } from './format/sarif.js';
import { formatText } from './format/text.js';
import { failOnMessage, matchFailOn } from './report.js';
import { scan } from './scan.js';
import type { FailOn } from './types.js';

export const REPORT_FILE_NAME = 'ai-agent-checkup-report.json';

export interface ActionInputs {
  path: string;
  failOn: FailOn | null;
  /** Where to write the SARIF file, relative to the workspace, or null. */
  sarifFile: string | null;
}

export interface ActionDeps {
  getInput: (name: string) => string;
  cwd: string;
  tempDir: string;
  info: (message: string) => void;
  writeSummary: (markdown: string) => Promise<void>;
  setOutput: (name: string, value: string) => void;
  setFailed: (message: string) => void;
}

export function readActionInputs(getInput: (name: string) => string): ActionInputs {
  const sarif = getInput('sarif-file').trim();
  return {
    path: getInput('path').trim() || '.',
    failOn: parseFailOn(getInput('fail-on')),
    sarifFile: sarif === '' ? null : sarif,
  };
}

/** Runs the GitHub Action. Problems go to setFailed; never throws. */
export async function runAction(deps: ActionDeps): Promise<void> {
  try {
    const inputs = readActionInputs(deps.getInput);
    const report = await scan(inputs.path, deps.cwd);
    deps.info(formatText(report, { color: false }));
    await deps.writeSummary(formatMarkdown(report));

    const reportPath = join(deps.tempDir, REPORT_FILE_NAME);
    await writeFile(reportPath, formatJson(report), 'utf8');
    let sarifPath = '';
    if (inputs.sarifFile !== null) {
      sarifPath = resolve(deps.cwd, inputs.sarifFile);
      await mkdir(dirname(sarifPath), { recursive: true });
      await writeFile(sarifPath, formatSarif(report), 'utf8');
    }

    const { summary } = report;
    deps.setOutput('high-count', String(summary.high));
    deps.setOutput('medium-count', String(summary.medium));
    deps.setOutput('low-count', String(summary.low));
    deps.setOutput('info-count', String(summary.info));
    deps.setOutput('total-count', String(summary.total));
    deps.setOutput('agent-steps', String(summary.agentSteps));
    deps.setOutput('report-json', reportPath);
    deps.setOutput('sarif-file', sarifPath);

    const matched = matchFailOn(report.findings, inputs.failOn);
    if (inputs.failOn !== null && matched.length > 0) {
      deps.setFailed(failOnMessage(inputs.failOn, matched));
    }
  } catch (error) {
    deps.setFailed(errorMessage(error));
  }
}
