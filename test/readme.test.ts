import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AGENTS } from '../src/agents.js';
import { CHECK_DEFINITIONS } from '../src/checks/definitions.js';
import { runDemo } from './helpers/demo.js';
import { Capture } from './helpers/files.js';

const README = readFileSync('README.md', 'utf8');

function firstTextBlock(markdown: string): string {
  const match = /```text\n([\s\S]*?)```/.exec(markdown);
  if (!match?.[1]) throw new Error('README.md has no ```text block');
  return match[1];
}

describe('README', () => {
  it('shows the exact output of npm run demo', async () => {
    const stdout = new Capture();
    const code = await runDemo([], { stdout, stderr: new Capture(), env: {} });
    expect(code).toBe(0);
    expect(firstTextBlock(README)).toBe(stdout.text);
  });

  it('lists every check with its id, severities and summary', () => {
    for (const check of CHECK_DEFINITIONS) {
      const row = README.split('\n').find((line) => line.startsWith(`| ${check.title} `));
      expect(row, check.title).toBeDefined();
      const cells = (row ?? '').split('|').map((c) => c.trim());
      expect(cells[2]).toBe(`\`${check.id}\``);
      expect(cells[3]).toBe(check.severities.join(', '));
      expect(cells[4]).toBe(check.summary);
    }
  });

  it('cites the evidence it is based on', () => {
    for (const url of [
      'https://labs.cloudsecurityalliance.org/research/csa-research-note-ai-coding-agent-cicd-secrets-20260808-csa/',
      'https://www.aikido.dev/blog/promptpwnd-github-actions-ai-agents',
      'https://johnstawinski.com/2026/02/05/trusting-claude-with-a-knife-unauthorized-prompt-injection-to-rce-in-anthropics-claude-code-action/',
      'https://github.com/zizmorcore/zizmor/issues/1605',
      'https://github.com/AikidoSec/opengrep-rules',
    ]) {
      expect(README).toContain(url);
    }
  });

  it('documents every Action input and output', () => {
    const action = readFileSync('action.yml', 'utf8');
    const names = [...action.matchAll(/^ {2}([a-z-]+):$/gm)].map((m) => m[1] ?? '');
    expect(names.length).toBeGreaterThan(5);
    for (const name of names) expect(README, name).toContain(`| \`${name}\``);
  });

  it('names a fixed version for each agent that has one', () => {
    for (const agent of AGENTS) {
      if (agent.kind === 'action' && agent.versions?.fixedIn) {
        expect(README, agent.id).toContain(agent.versions.fixedIn);
      }
    }
  });
});
