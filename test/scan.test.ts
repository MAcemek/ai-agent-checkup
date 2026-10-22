import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UsageError } from '../src/errors.js';
import { readTarget, scan } from '../src/scan.js';
import { tempDir, writeFiles } from './helpers/files.js';

describe('readTarget', () => {
  it('reads .github/workflows/*.yml and *.yaml of a directory, sorted', async () => {
    const root = tempDir();
    writeFiles(root, {
      '.github/workflows/b.yaml': 'on: push\n',
      '.github/workflows/a.yml': 'on: push\n',
      '.github/workflows/notes.txt': 'x',
      '.github/workflows/nested/c.yml': 'on: push\n',
      'other.yml': 'on: push\n',
    });
    const target = await readTarget(root, process.cwd());
    expect(target.target).toBe('directory');
    expect(target.files.map((f) => f.file)).toEqual([
      '.github/workflows/a.yml',
      '.github/workflows/b.yaml',
    ]);
  });

  it('reads a directory named workflows directly, and one file', async () => {
    const root = tempDir();
    writeFiles(root, { 'workflows/a.yml': 'on: push\n', 'single.yml': 'on: push\n' });
    expect(
      (await readTarget(join(root, 'workflows'), process.cwd())).files.map((f) => f.file),
    ).toEqual(['a.yml']);
    const single = await readTarget('single.yml', root);
    expect(single).toEqual({ target: 'file', files: [{ file: 'single.yml', text: 'on: push\n' }] });
  });

  it('finds no files in a directory without workflows', async () => {
    expect((await readTarget(tempDir(), process.cwd())).files).toEqual([]);
  });

  it('rejects missing paths and files that are not YAML', async () => {
    await expect(readTarget('does/not/exist', process.cwd())).rejects.toThrow(
      new UsageError('Path not found: does/not/exist'),
    );
    await expect(readTarget('package.json', process.cwd())).rejects.toThrow(
      'Not a workflow file: package.json. Give a repository directory or a .yml or .yaml file.',
    );
  });
});

describe('scan', () => {
  it('reports files it cannot read as info findings and keeps going', async () => {
    const report = await scan('test/fixtures/repos/tricky', process.cwd());
    const errors = report.findings.filter((f) => f.id === 'parse-error');
    expect(errors.map((f) => [f.file, f.line, f.explanation, f.fix])).toEqual([
      [
        '.github/workflows/broken.yml',
        11,
        'The YAML could not be parsed (line 11: Missing closing "quote).',
        'Fix the file so that GitHub can run it, then run the check again.',
      ],
      [
        '.github/workflows/empty.yml',
        1,
        'The file is not a YAML mapping, so it is not a workflow.',
        'Fix the file so that GitHub can run it, then run the check again.',
      ],
      [
        '.github/workflows/multi-doc.yml',
        1,
        'The file has 2 YAML documents. GitHub reads one workflow per file; only the first document was checked.',
        'Keep one workflow per file.',
      ],
    ]);
    expect(report.workflows).toEqual([
      { file: '.github/workflows/anchors.yml', agentSteps: 2 },
      { file: '.github/workflows/broken.yml', agentSteps: 0 },
      { file: '.github/workflows/empty.yml', agentSteps: 0 },
      { file: '.github/workflows/gemini-run.yaml', agentSteps: 1 },
      { file: '.github/workflows/mixed-if.yml', agentSteps: 1 },
      { file: '.github/workflows/multi-doc.yml', agentSteps: 1 },
      { file: '.github/workflows/release-notes.yml', agentSteps: 1 },
      { file: '.github/workflows/release.yml', agentSteps: 0 },
    ]);
    expect(report.summary).toEqual({
      high: 14,
      medium: 3,
      low: 5,
      info: 3,
      total: 25,
      workflows: 8,
      agentSteps: 6,
    });
  });

  it('scans one workflow file', async () => {
    const report = await scan(
      'test/fixtures/repos/demo/.github/workflows/codex-review.yml',
      process.cwd(),
    );
    expect(report.target).toBe('file');
    expect(report.path).toBe('test/fixtures/repos/demo/.github/workflows/codex-review.yml');
    expect(new Set(report.findings.map((f) => f.file))).toEqual(
      new Set(['test/fixtures/repos/demo/.github/workflows/codex-review.yml']),
    );
  });
});
