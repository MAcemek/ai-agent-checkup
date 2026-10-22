import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadWorkflow, stepLabel, type Workflow } from '../src/workflow/model.js';
import { get, parseYaml, str } from '../src/workflow/yaml.js';

function load(text: string): Workflow {
  const result = loadWorkflow('.github/workflows/test.yml', text);
  if (!result.ok) throw new Error(result.message);
  return result.workflow;
}

describe('parseYaml', () => {
  it('keeps line numbers of keys and values', () => {
    const parsed = parseYaml('a: 1\nb:\n  c: |\n    one\n    two\n  d: x\n');
    expect(parsed.errors).toEqual([]);
    const b = get(parsed.root ?? undefined, 'b');
    expect(b?.kind).toBe('map');
    const c = get(b, 'c');
    expect(c).toMatchObject({ kind: 'scalar', line: 3, endLine: 5, value: 'one\ntwo\n' });
    expect(str(get(b, 'd'))).toBe('x');
  });

  it('resolves aliases and merge keys, with own keys first', () => {
    const parsed = parseYaml('base: &b\n  x: 1\n  y: 2\nuse:\n  <<: *b\n  y: 3\ncopy: *b\n');
    const use = get(parsed.root ?? undefined, 'use');
    expect(use?.kind === 'map' ? use.entries.map((e) => `${e.key}=${str(e.value)}`) : []).toEqual([
      'y=3',
      'x=1',
    ]);
    expect(str(get(get(parsed.root ?? undefined, 'copy'), 'y'))).toBe('2');
  });

  it('does not treat a quoted "<<" key as a merge key', () => {
    const parsed = parseYaml("m:\n  '<<': plain\n");
    expect(str(get(get(parsed.root ?? undefined, 'm'), '<<'))).toBe('plain');
  });

  it('reports errors with a line and counts documents', () => {
    expect(parseYaml('a: [1, 2\n').errors[0]).toMatch(/^line \d+: /);
    expect(parseYaml('a: 1\n---\nb: 2\n').documents).toBe(2);
    expect(parseYaml('').root).toBeNull();
  });
});

describe('loadWorkflow', () => {
  it('reads triggers in all three forms', () => {
    expect(load('on: push\njobs: {}\n').triggers.map((t) => t.event)).toEqual(['push']);
    expect(load('on: [issues, push]\njobs: {}\n').triggers.map((t) => t.event)).toEqual([
      'issues',
      'push',
    ]);
    const map = load(
      'on:\n  issues:\n    types: [opened]\n  issue_comment:\n  workflow_run:\n    workflows: [CI]\n    types: completed\njobs: {}\n',
    );
    expect(map.triggers).toEqual([
      { event: 'issues', line: 2, types: ['opened'], workflows: [] },
      { event: 'issue_comment', line: 4, types: null, workflows: [] },
      { event: 'workflow_run', line: 5, types: ['completed'], workflows: ['CI'] },
    ]);
  });

  it('reads permissions, env, steps and the comment after uses', () => {
    const workflow = load(
      [
        'name: Test',
        'on: issues',
        'permissions: write-all',
        'env:',
        '  A: b',
        'jobs:',
        '  one:',
        '    if: github.actor == x',
        '    needs: [zero]',
        '    permissions:',
        '      contents: read',
        '      issues: write',
        '    steps:',
        '      - uses: actions/checkout@0123456789abcdef0123456789abcdef01234567 # v7.0.1',
        '      - id: two',
        '        name: Two',
        '        run: echo hi',
        '        with:',
        '          k: v',
        '        env:',
        '          E: f',
        '',
      ].join('\n'),
    );
    expect(workflow.name).toBe('Test');
    expect(workflow.permissions).toEqual({ kind: 'all', access: 'write-all', line: 3 });
    expect(workflow.env).toEqual([{ key: 'A', value: 'b', line: 5, endLine: 5 }]);
    const job = workflow.jobs[0];
    expect(job?.if).toEqual({ text: 'github.actor == x', line: 8 });
    expect(job?.needs).toEqual(['zero']);
    expect(job?.permissions).toEqual({
      kind: 'map',
      line: 11,
      scopes: [
        { scope: 'contents', access: 'read', line: 11 },
        { scope: 'issues', access: 'write', line: 12 },
      ],
    });
    expect(job?.steps[0]?.uses).toEqual({
      value: 'actions/checkout@0123456789abcdef0123456789abcdef01234567',
      line: 14,
      comment: 'v7.0.1',
    });
    const two = job?.steps[1];
    expect(two).toMatchObject({ index: 1, id: 'two', name: 'Two', line: 15 });
    expect(two?.run).toEqual({ key: 'run', value: 'echo hi', line: 17, endLine: 17 });
    expect(two?.with).toEqual([{ key: 'k', value: 'v', line: 19, endLine: 19 }]);
    expect(two?.env).toEqual([{ key: 'E', value: 'f', line: 21, endLine: 21 }]);
    expect(stepLabel(two ?? job!.steps[0]!)).toBe('Two');
    expect(stepLabel(job!.steps[0]!)).toBe(
      'actions/checkout@0123456789abcdef0123456789abcdef01234567',
    );
  });

  it('turns YAML booleans in if: into text', () => {
    const workflow = load('on: issues\njobs:\n  a:\n    if: false\n    steps: []\n');
    expect(workflow.jobs[0]?.if).toEqual({ text: 'false', line: 4 });
  });

  it('rejects files that are not workflows', () => {
    expect(loadWorkflow('x.yml', '- a\n- b\n')).toEqual({
      ok: false,
      message: 'The file is not a YAML mapping, so it is not a workflow.',
      line: 1,
    });
    const broken = loadWorkflow('x.yml', 'on: [\n');
    expect(broken.ok).toBe(false);
  });

  it('reads the anchors fixture with aliases resolved', () => {
    const text = readFileSync('test/fixtures/repos/tricky/.github/workflows/anchors.yml', 'utf8');
    const workflow = load(text);
    const second = workflow.jobs[1];
    expect(second?.permissions).toMatchObject({ kind: 'map', line: 9 });
    expect(second?.steps[0]?.name).toBe('Gemini again');
    expect(second?.steps[0]?.uses?.value).toBe('google-github-actions/run-gemini-cli@v0');
    expect(second?.steps[0]?.with.map((w) => w.key)).toEqual(['gemini_api_key', 'prompt']);
  });
});
