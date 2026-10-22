import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HELP_TEXT, parseCliArgs, type CliOptions } from '../src/args.js';
import { runCli, shouldUseColor, type CliDeps } from '../src/cli-main.js';
import { formatAgentList } from '../src/format/agents.js';
import type { Report } from '../src/types.js';
import { VERSION } from '../src/version.js';
import { Capture, tempDir } from './helpers/files.js';

function setup(overrides: Partial<CliDeps> = {}) {
  const stdout = new Capture();
  const stderr = new Capture();
  const deps: CliDeps = { cwd: process.cwd(), env: {}, stdout, stderr, ...overrides };
  return { deps, stdout, stderr };
}

const DEMO = 'test/fixtures/repos/demo';

describe('runCli', () => {
  it('prints help, the version and the agent list', async () => {
    const help = setup();
    expect(await runCli(['--help'], help.deps)).toBe(0);
    expect(help.stdout.text).toBe(HELP_TEXT);
    const version = setup();
    expect(await runCli(['-v'], version.deps)).toBe(0);
    expect(version.stdout.text).toBe(`${VERSION}\n`);
    const agents = setup();
    expect(await runCli(['--list-agents'], agents.deps)).toBe(0);
    expect(agents.stdout.text).toBe(formatAgentList());
  });

  it('keeps VERSION in sync with package.json', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });

  it.each([
    [['--format', 'html'], 'Unknown format "html". Use text, markdown, json or sarif.'],
    [['--fail-on', 'critical'], 'Unknown fail-on value "critical". Use high, medium, low or any.'],
    [['a', 'b'], 'Only one path can be checked at a time.'],
    [['--output', ''], '--output needs a file name.'],
  ])('exits 2 for %j', async (argv, message) => {
    const { deps, stdout, stderr } = setup();
    expect(await runCli(argv, deps)).toBe(2);
    expect(stdout.text).toBe('');
    expect(stderr.text).toBe(
      `ai-agent-checkup: ${message}\nRun "ai-agent-checkup --help" for usage.\n`,
    );
  });

  it('exits 2 for unknown options', async () => {
    const { deps, stderr } = setup();
    expect(await runCli(['--bogus'], deps)).toBe(2);
    expect(stderr.text).toMatch(/^ai-agent-checkup: Unknown option '--bogus'/);
    expect(stderr.text.endsWith('\nRun "ai-agent-checkup --help" for usage.\n')).toBe(true);
  });

  it('exits 2 for a missing path or a file that is not YAML, without the usage hint', async () => {
    const missing = setup();
    expect(await runCli(['does/not/exist'], missing.deps)).toBe(2);
    expect(missing.stderr.text).toBe('ai-agent-checkup: Path not found: does/not/exist\n');
    const file = setup();
    expect(await runCli(['package.json'], file.deps)).toBe(2);
    expect(file.stderr.text).toBe(
      'ai-agent-checkup: Not a workflow file: package.json. Give a repository directory or a .yml or .yaml file.\n',
    );
  });

  it('exits 0 without --fail-on, even with problems', async () => {
    const { deps, stdout, stderr } = setup();
    expect(await runCli([DEMO], deps)).toBe(0);
    expect(stdout.text).toContain('Found 8 problems: 4 high, 1 medium, 3 low, 0 info.');
    expect(stderr.text).toBe('');
  });

  it('exits 1 when fail-on matches', async () => {
    const high = setup();
    expect(await runCli([DEMO, '--fail-on', 'high'], high.deps)).toBe(1);
    expect(high.stderr.text).toBe(
      'ai-agent-checkup: fail-on high matched: 4 problems with high severity.\n',
    );
    const medium = setup();
    expect(await runCli([DEMO, '--fail-on', 'MEDIUM'], medium.deps)).toBe(1);
    expect(medium.stderr.text).toBe(
      'ai-agent-checkup: fail-on medium matched: 5 problems with medium severity or higher.\n',
    );
    const any = setup();
    expect(await runCli(['test/fixtures/repos/safe', '--fail-on', 'any'], any.deps)).toBe(1);
    expect(any.stderr.text).toBe('ai-agent-checkup: fail-on any matched: 1 problem.\n');
    const low = setup();
    expect(await runCli(['test/fixtures/repos/safe', '--fail-on', 'low'], low.deps)).toBe(0);
  });

  it('writes the report to --output', async () => {
    const file = join(tempDir(), 'report.sarif');
    const { deps, stdout, stderr } = setup();
    expect(await runCli([DEMO, '--format', 'sarif', '-o', file], deps)).toBe(0);
    expect(stdout.text).toBe('');
    expect(stderr.text).toBe(`Report written to ${file}\n`);
    expect((JSON.parse(readFileSync(file, 'utf8')) as { version: string }).version).toBe('2.1.0');
  });

  it('reports an output file it cannot write', async () => {
    const { deps, stderr } = setup();
    expect(await runCli([DEMO, '-o', join(tempDir(), 'missing', 'report.txt')], deps)).toBe(2);
    expect(stderr.text).toMatch(/^ai-agent-checkup: Could not write /);
  });

  it('prints JSON with the report', async () => {
    const { deps, stdout } = setup();
    expect(await runCli([DEMO, '--format', 'json'], deps)).toBe(0);
    const report = JSON.parse(stdout.text) as Report;
    expect(report.tool).toEqual({
      name: 'ai-agent-checkup',
      version: VERSION,
      homepage: 'https://github.com/MAcemek/ai-agent-checkup',
    });
    expect(report.summary).toEqual({
      high: 4,
      medium: 1,
      low: 3,
      info: 0,
      total: 8,
      workflows: 2,
      agentSteps: 3,
    });
  });
});

describe('parseCliArgs', () => {
  it('applies defaults', () => {
    expect(parseCliArgs([])).toEqual({
      kind: 'run',
      options: { path: '.', format: 'text', failOn: null, output: null, noColor: false },
    });
  });
});

describe('shouldUseColor', () => {
  const options: CliOptions = {
    path: '.',
    format: 'text',
    failOn: null,
    output: null,
    noColor: false,
  };

  it('uses color only for text on a terminal', () => {
    expect(shouldUseColor(options, setup({ stdout: new Capture(true) }).deps)).toBe(true);
    expect(shouldUseColor(options, setup({ stdout: new Capture(false) }).deps)).toBe(false);
    expect(
      shouldUseColor(options, setup({ stdout: new Capture(true), env: { NO_COLOR: '1' } }).deps),
    ).toBe(false);
    expect(
      shouldUseColor(options, setup({ stdout: new Capture(true), env: { TERM: 'dumb' } }).deps),
    ).toBe(false);
    expect(
      shouldUseColor({ ...options, noColor: true }, setup({ stdout: new Capture(true) }).deps),
    ).toBe(false);
    expect(
      shouldUseColor({ ...options, format: 'json' }, setup({ stdout: new Capture(true) }).deps),
    ).toBe(false);
    expect(
      shouldUseColor({ ...options, output: 'x' }, setup({ stdout: new Capture(true) }).deps),
    ).toBe(false);
  });
});
