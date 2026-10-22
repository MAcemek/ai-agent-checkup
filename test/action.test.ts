import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readActionInputs, runAction, type ActionDeps } from '../src/action-main.js';
import type { Report } from '../src/types.js';
import { tempDir } from './helpers/files.js';

function setup(inputs: Record<string, string>, cwd = process.cwd()) {
  const dir = tempDir();
  const result = {
    logs: [] as string[],
    summaries: [] as string[],
    outputs: {} as Record<string, string>,
    failures: [] as string[],
  };
  const deps: ActionDeps = {
    getInput: (name) => inputs[name] ?? '',
    cwd,
    tempDir: dir,
    info: (message) => result.logs.push(message),
    writeSummary: async (markdown) => {
      result.summaries.push(markdown);
    },
    setOutput: (name, value) => {
      result.outputs[name] = value;
    },
    setFailed: (message) => result.failures.push(message),
  };
  return { deps, result, dir };
}

describe('readActionInputs', () => {
  it('applies defaults for empty inputs', () => {
    expect(readActionInputs(() => '')).toEqual({ path: '.', failOn: null, sarifFile: null });
  });

  it('rejects an invalid fail-on value', () => {
    expect(() => readActionInputs((name) => (name === 'fail-on' ? 'yes' : ''))).toThrow(
      'Unknown fail-on value "yes". Use high, medium, low or any.',
    );
  });
});

describe('runAction', () => {
  it('logs the report, writes the summary and JSON, and sets outputs', async () => {
    const { deps, result, dir } = setup({ path: 'test/fixtures/repos/demo' });
    await runAction(deps);
    expect(result.failures).toEqual([]);
    expect(result.logs[0]).toMatch(
      /^ai-agent-checkup 0\.1\.0\nPath: test\/fixtures\/repos\/demo\n/,
    );
    expect(result.summaries[0]).toMatch(/^## AI agent workflow checkup\n/);
    const reportPath = join(dir, 'ai-agent-checkup-report.json');
    expect(result.outputs).toEqual({
      'high-count': '4',
      'medium-count': '1',
      'low-count': '3',
      'info-count': '0',
      'total-count': '8',
      'agent-steps': '3',
      'report-json': reportPath,
      'sarif-file': '',
    });
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as Report;
    expect(report.summary.total).toBe(8);
  });

  it('writes a SARIF file and creates its directory', async () => {
    const workspace = tempDir();
    const { deps, result } = setup(
      {
        path: join(process.cwd(), 'test/fixtures/repos/demo'),
        'sarif-file': 'results/checkup.sarif',
      },
      workspace,
    );
    await runAction(deps);
    const sarifPath = join(workspace, 'results', 'checkup.sarif');
    expect(result.outputs['sarif-file']).toBe(sarifPath);
    expect((JSON.parse(readFileSync(sarifPath, 'utf8')) as { version: string }).version).toBe(
      '2.1.0',
    );
  });

  it('fails the run when fail-on matches', async () => {
    const { deps, result } = setup({ path: 'test/fixtures/repos/demo', 'fail-on': 'medium' });
    await runAction(deps);
    expect(result.failures).toEqual([
      'fail-on medium matched: 5 problems with medium severity or higher.',
    ]);
    expect(result.outputs['total-count']).toBe('8');
  });

  it('does not fail for a clean repository', async () => {
    const { deps, result } = setup({ path: 'test/fixtures/repos/safe', 'fail-on': 'low' });
    await runAction(deps);
    expect(result.failures).toEqual([]);
    expect(result.outputs['info-count']).toBe('1');
  });

  it('fails the run for invalid inputs and paths', async () => {
    const invalid = setup({ 'fail-on': 'nope' });
    await runAction(invalid.deps);
    expect(invalid.result.failures).toEqual([
      'Unknown fail-on value "nope". Use high, medium, low or any.',
    ]);
    const missing = setup({ path: 'nowhere' });
    await runAction(missing.deps);
    expect(missing.result.failures).toEqual(['Path not found: nowhere']);
    expect(missing.result.outputs).toEqual({});
  });
});
