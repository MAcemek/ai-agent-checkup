import { describe, expect, it } from 'vitest';
import { AGENTS, findActionAgent, findCliAgents, usesRef } from '../src/agents.js';
import { parseVersion } from '../src/semver.js';

const actions = AGENTS.filter((a) => a.kind === 'action');
const clis = AGENTS.filter((a) => a.kind === 'cli');

describe('agent registry', () => {
  it('has unique ids and uses values', () => {
    const ids = AGENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    const uses = actions.flatMap((a) => a.uses);
    expect(new Set(uses).size).toBe(uses.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it('lists the known agent actions', () => {
    expect(actions.flatMap((a) => a.uses)).toEqual([
      'anthropics/claude-code-action',
      'anthropics/claude-code-base-action',
      'anthropics/claude-code-security-review',
      'google-github-actions/run-gemini-cli',
      'google-gemini/gemini-cli-action',
      'qwenlm/qwen-code-action',
      'openai/codex-action',
      'actions/ai-inference',
      'austenstone/copilot-cli',
      'anomalyco/opencode/github',
      'sst/opencode/github',
    ]);
    expect(clis.map((a) => a.id)).toEqual([
      'claude-cli',
      'codex-cli',
      'gemini-cli',
      'copilot-cli',
      'cursor-cli',
      'aider',
      'qwen-cli',
      'opencode-cli',
    ]);
  });

  it('keeps every entry complete and consistent', () => {
    for (const agent of AGENTS) {
      expect(agent.name, agent.id).not.toBe('');
      expect(agent.notes.endsWith('.'), agent.id).toBe(true);
      if (agent.kind === 'action') {
        for (const slug of agent.uses) expect(slug).toBe(slug.toLowerCase());
        if (agent.allowListRequires !== null)
          expect(agent.allowListInputs.length).toBeGreaterThan(0);
        for (const rule of agent.settings) {
          if (rule.test === 'matches' || rule.test === 'unless')
            expect(rule.pattern, rule.title).toBeDefined();
          expect(rule.fix.endsWith('.'), rule.title).toBe(true);
        }
        if (agent.versions?.fixedIn) expect(parseVersion(agent.versions.fixedIn)).not.toBeNull();
        for (const v of agent.cliVersion?.fixed ?? []) expect(parseVersion(v), v).not.toBeNull();
      } else {
        for (const install of agent.installs) {
          for (const v of install.fixed) expect(parseVersion(v), v).not.toBeNull();
        }
      }
    }
  });

  it('records the fixed versions from the CSA research note', () => {
    const byId = (id: string) => AGENTS.find((a) => a.id === id);
    const claude = byId('claude-code-action');
    expect(claude?.kind === 'action' && claude.versions?.fixedIn).toBe('v1.0.136');
    const gemini = byId('run-gemini-cli');
    expect(gemini?.kind === 'action' && gemini.versions?.fixedIn).toBe('v0.1.22');
    expect(gemini?.kind === 'action' && gemini.cliVersion?.fixed).toEqual([
      '0.39.1',
      '0.40.0-preview.3',
    ]);
    const claudeCli = byId('claude-cli');
    expect(claudeCli?.kind === 'cli' && claudeCli.installs.map((i) => i.fixed)).toEqual([
      ['2.1.163'],
      ['2.1.163'],
    ]);
  });
});

describe('findActionAgent', () => {
  it('matches owner/repo and owner/repo/path, ignoring case and the ref', () => {
    expect(findActionAgent('anthropics/claude-code-action@v1')?.id).toBe('claude-code-action');
    expect(findActionAgent('OpenAI/Codex-Action@main')?.id).toBe('codex-action');
    expect(findActionAgent('anomalyco/opencode/github@latest')?.id).toBe('opencode-action');
    expect(findActionAgent('QwenLM/qwen-code-action@v1')?.id).toBe('qwen-code-action');
  });

  it('ignores other actions, local actions, docker images and missing refs', () => {
    for (const uses of [
      'actions/checkout@v7',
      './.github/actions/claude',
      'docker://anthropics/claude-code-action:1',
      'anthropics/claude-code-action',
      'anthropics/claude-code-action-fork@v1',
    ]) {
      expect(findActionAgent(uses), uses).toBeUndefined();
    }
  });

  it('reads the ref', () => {
    expect(usesRef('a/b@v1.2.3')).toBe('v1.2.3');
    expect(usesRef('a/b')).toBe('');
  });
});

describe('findCliAgents', () => {
  it.each([
    ['claude -p "fix it"', 'claude-cli'],
    ['npx -y @anthropic-ai/claude-code@2.1.200 --print "x"', 'claude-cli'],
    ['echo start; claude --model x -p "$PROMPT"', 'claude-cli'],
    ['codex exec --full-auto "x"', 'codex-cli'],
    ['npx @openai/codex exec "x"', 'codex-cli'],
    ['gemini --yolo -p "x"', 'gemini-cli'],
    ['gemini --prompt="x"', 'gemini-cli'],
    ['copilot -p "x" --allow-all-tools', 'copilot-cli'],
    ['cursor-agent -p "x" --force', 'cursor-cli'],
    ['aider --yes-always --message "x"', 'aider'],
    ['qwen -p "x"', 'qwen-cli'],
    ['opencode run "x"', 'opencode-cli'],
  ])('finds %s', (script, id) => {
    expect(findCliAgents(script).map((a) => a.id)).toEqual([id]);
  });

  it.each([
    'echo "ask claude later"',
    'npm install -g @anthropic-ai/claude-code',
    'claude --version',
    'codex login',
    'gemini --version',
    'my-claude -p x',
    'agent -p "x"',
  ])('ignores %s', (script) => {
    expect(findCliAgents(script)).toEqual([]);
  });
});
