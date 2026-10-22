import { readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scan } from '../src/scan.js';

/** Generated or installed directories that are not checked. */
const SKIPPED_DIRS = new Set(['.git', 'node_modules', 'dist', 'lib', 'coverage']);

function repoFiles(dir = '.'): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = dir === '.' ? name : `${dir}/${name}`;
      if (statSync(path).isDirectory()) return SKIPPED_DIRS.has(name) ? [] : repoFiles(path);
      return [path];
    });
}

/**
 * Phrases that mark generated authorship; built from parts so this file does not contain them.
 * Agent and vendor names are allowed, because the tool is about them.
 */
const TRAILERS = [
  ['co', 'authored-by'].join('-'),
  ['generated', 'with'].join(' '),
  ['noreply', 'anthropic.com'].join('@'),
];

describe('repository rules', () => {
  const files = repoFiles();

  it('finds the repository files', () => {
    expect(files).toContain('README.md');
    expect(files).toContain('src/cli.ts');
    expect(files).toContain('test/fixtures/repos/demo/.github/workflows/issue-triage.yml');
  });

  it('keeps every text file printable ASCII', () => {
    const NON_ASCII = /[^\t\n\r\x20-\x7e]/;
    expect(NON_ASCII.test(`caf${String.fromCharCode(233)}`)).toBe(true);
    expect(NON_ASCII.test(String.fromCharCode(0x2014))).toBe(true);
    expect(NON_ASCII.test(String.fromCodePoint(0x1f916))).toBe(true);
    const bad = files.filter((file) => NON_ASCII.test(readFileSync(file, 'utf8')));
    expect(bad).toEqual([]);
  });

  it('contains no authorship trailers', () => {
    const bad = files.filter((file) => {
      const text = readFileSync(file, 'utf8').toLowerCase();
      return TRAILERS.some((phrase) => text.includes(phrase));
    });
    expect(bad).toEqual([]);
  });

  it('has the MIT license for the contributors', () => {
    const license = readFileSync('LICENSE', 'utf8');
    expect(
      license.startsWith('MIT License\n\nCopyright (c) 2026 The ai-agent-checkup contributors\n'),
    ).toBe(true);
  });

  it('has a package.json for npm without an author', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as Record<string, unknown>;
    expect(pkg.name).toBe('ai-agent-checkup');
    expect(pkg.author).toBeUndefined();
    expect(pkg.license).toBe('MIT');
    expect(pkg.bin).toEqual({ 'ai-agent-checkup': 'lib/index.js' });
    expect(pkg.files).toEqual(['lib/']);
    expect(pkg.engines).toEqual({ node: '>=22.12' });
    expect(pkg.dependencies).toBeUndefined();
  });

  it('has an action.yml that runs dist/index.js on node24', () => {
    const action = readFileSync('action.yml', 'utf8');
    expect(action).toMatch(/^name: 'AI agent workflow checkup'\n/);
    expect(action).toContain("runs:\n  using: 'node24'\n  main: 'dist/index.js'\n");
    for (const input of ['path', 'fail-on', 'sarif-file'])
      expect(action).toContain(`  ${input}:\n`);
    expect(action).not.toContain('token');
  });

  it('has a changelog entry for the current version', () => {
    expect(readFileSync('CHANGELOG.md', 'utf8')).toMatch(
      /## \[0\.1\.0\] - (Unreleased|\d{4}-\d{2}-\d{2})\n/,
    );
  });

  it('finds no agents in its own workflows', async () => {
    const report = await scan('.', process.cwd());
    expect(report.workflows.map((w) => w.file)).toEqual([
      '.github/workflows/ci.yml',
      '.github/workflows/self-test.yml',
    ]);
    expect(report.summary.agentSteps).toBe(0);
    expect(report.findings).toEqual([]);
  });
});
