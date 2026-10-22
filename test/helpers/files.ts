import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach } from 'vitest';
import { checkFiles } from '../../src/scan.js';
import type { Finding, Report } from '../../src/types.js';

/** Collects what the CLI writes. */
export class Capture {
  text = '';
  constructor(public isTTY = false) {}
  write(chunk: string): boolean {
    this.text += chunk;
    return true;
  }
}

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A new empty directory that is removed after the test. */
export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ai-agent-checkup-test-'));
  tempDirs.push(dir);
  return dir;
}

/** Creates files below root. Keys are relative paths with forward slashes. */
export function writeFiles(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, 'utf8');
  }
}

/** Checks workflow texts as if they were .github/workflows/<name> files of one repository. */
export function checkTexts(files: Record<string, string>): Report {
  return checkFiles(
    'repo',
    'directory',
    Object.entries(files).map(([name, text]) => ({ file: `.github/workflows/${name}`, text })),
  );
}

/** Checks one workflow text. */
export function checkText(text: string): Report {
  return checkTexts({ 'test.yml': text });
}

/** "id:severity" for each finding, in report order. */
export function ids(report: Report | Finding[]): string[] {
  const findings = Array.isArray(report) ? report : report.findings;
  return findings.map((f) => `${f.id}:${f.severity}`);
}

/** The findings with the given check id. */
export function only(report: Report, id: Finding['id']): Finding[] {
  return report.findings.filter((f) => f.id === id);
}
