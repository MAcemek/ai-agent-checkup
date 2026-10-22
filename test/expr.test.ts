import { describe, expect, it } from 'vitest';
import { conditionExpression, ExprError, parseExpression, tokenize } from '../src/workflow/expr.js';
import { evaluateCondition, type EvalContext } from '../src/workflow/gates.js';

const on = (event: string, permissionOutputs: string[] = []): EvalContext => ({
  event,
  permissionOutputs,
});

describe('parseExpression', () => {
  it('parses contexts, literals, calls and operators with precedence', () => {
    expect(parseExpression("github.event_name == 'issues' || !a && b")).toEqual({
      kind: 'or',
      left: {
        kind: 'compare',
        op: '==',
        left: { kind: 'context', path: 'github.event_name' },
        right: { kind: 'literal', value: 'issues' },
      },
      right: {
        kind: 'and',
        left: { kind: 'not', expr: { kind: 'context', path: 'a' } },
        right: { kind: 'context', path: 'b' },
      },
    });
  });

  it('normalizes property access and indexes', () => {
    expect(parseExpression("github.event['pull_request'].labels.*.name")).toEqual({
      kind: 'context',
      path: 'github.event.pull_request.labels.*.name',
    });
    expect(parseExpression('needs.check.outputs.allowed-user')).toEqual({
      kind: 'context',
      path: 'needs.check.outputs.allowed-user',
    });
    expect(parseExpression('contains(fromJSON(\'["OWNER"]\'), x)')).toEqual({
      kind: 'call',
      name: 'contains',
      args: [
        { kind: 'call', name: 'fromjson', args: [{ kind: 'literal', value: '["OWNER"]' }] },
        { kind: 'context', path: 'x' },
      ],
    });
  });

  it('reads strings with doubled quotes, numbers and keywords', () => {
    expect(tokenize("'it''s' 42 -1.5 0xff true NULL")).toEqual([
      { type: 'string', value: "it's" },
      { type: 'number', value: 42 },
      { type: 'number', value: -1.5 },
      { type: 'number', value: 255 },
      { type: 'ident', value: 'true' },
      { type: 'ident', value: 'NULL' },
    ]);
    expect(parseExpression('NULL')).toEqual({ kind: 'literal', value: null });
  });

  it('throws on invalid expressions', () => {
    for (const text of ["'open", 'a ==', '(a', 'a b', 'a.', '#']) {
      expect(() => parseExpression(text), text).toThrow(ExprError);
    }
  });
});

describe('conditionExpression', () => {
  it('unwraps one ${{ }} block', () => {
    expect(conditionExpression("${{ github.actor == 'a' }}")).toEqual(
      parseExpression("github.actor == 'a'"),
    );
  });

  it('treats text mixed with ${{ }} as a non-empty string', () => {
    expect(conditionExpression('${{ a }} && ${{ b }}')).toEqual({
      kind: 'literal',
      value: '${{ a }} && ${{ b }}',
    });
  });
});

describe('evaluateCondition', () => {
  it.each([
    ["github.event_name == 'issues'", 'issues', 'yes', []],
    ["github.event_name == 'issues'", 'issue_comment', 'no', []],
    ["github.event_name != 'issues'", 'issue_comment', 'yes', []],
    ["contains(github.event.comment.body, '@claude')", 'issue_comment', 'maybe', []],
    [
      "github.event.comment.author_association == 'OWNER'",
      'issue_comment',
      'no',
      ['author association'],
    ],
    ["github.event.comment.author_association == 'CONTRIBUTOR'", 'issue_comment', 'maybe', []],
    ["github.event.comment.author_association != 'NONE'", 'issue_comment', 'maybe', []],
    [
      'contains(fromJSON(\'["OWNER","MEMBER","COLLABORATOR"]\'), github.event.comment.author_association)',
      'issue_comment',
      'no',
      ['author association'],
    ],
    [
      'contains(fromJSON(\'["OWNER","CONTRIBUTOR"]\'), github.event.comment.author_association)',
      'issue_comment',
      'maybe',
      [],
    ],
    [
      "contains('OWNER,MEMBER', github.event.issue.author_association)",
      'issues',
      'no',
      ['author association'],
    ],
    ["github.actor == 'octocat'", 'issues', 'no', ['actor']],
    ["github.actor != 'dependabot[bot]'", 'issues', 'yes', []],
    ['github.triggering_actor == github.repository_owner', 'issues', 'no', ['actor']],
    ['contains(fromJSON(\'["a","b"]\'), github.actor)', 'issues', 'no', ['actor']],
    [
      'github.event.pull_request.head.repo.full_name == github.repository',
      'pull_request_target',
      'no',
      ['same repository'],
    ],
    ['!github.event.pull_request.head.repo.fork', 'pull_request_target', 'no', ['same repository']],
    [
      'github.event.pull_request.head.repo.fork != true',
      'pull_request_target',
      'no',
      ['same repository'],
    ],
    ['github.event.pull_request.head.repo.fork', 'pull_request_target', 'yes', ['same repository']],
    [
      'github.event.pull_request.head.repo.fork == false',
      'pull_request_target',
      'no',
      ['same repository'],
    ],
    ["github.event.label.name == 'ai'", 'pull_request_target', 'no', ['label']],
    [
      "contains(github.event.pull_request.labels.*.name, 'ai')",
      'pull_request_target',
      'no',
      ['label'],
    ],
    ["github.event.workflow_run.event == 'push'", 'workflow_run', 'no', ['upstream event']],
    ["github.event.workflow_run.event == 'pull_request'", 'workflow_run', 'maybe', []],
    [
      "github.event_name == 'issues' || (github.event_name == 'issue_comment' && github.event.comment.author_association == 'MEMBER')",
      'issues',
      'yes',
      [],
    ],
    [
      "github.event_name == 'issues' || (github.event_name == 'issue_comment' && github.event.comment.author_association == 'MEMBER')",
      'issue_comment',
      'no',
      ['author association'],
    ],
    ["always() && github.actor == 'a'", 'issues', 'no', ['actor']],
    ['success()', 'issues', 'yes', []],
    ["startsWith(github.event_name, 'pull_request')", 'pull_request_target', 'yes', []],
    ["endsWith(github.event_name, 'comment')", 'issues', 'no', []],
    ["contains(github.event_name, 'issue')", 'issue_comment', 'yes', []],
    ['true', 'issues', 'yes', []],
    ['false', 'issues', 'no', []],
    ["''", 'issues', 'no', []],
    ["${{ github.actor == 'a' }} && ${{ true }}", 'issues', 'yes', []],
    ['github.event.issue.pull_request', 'issue_comment', 'maybe', []],
    ['a ==', 'issues', 'maybe', []],
    ['1 < 2', 'issues', 'maybe', []],
  ])('%s on %s is %s', (text, event, truth, gates) => {
    expect(evaluateCondition(text, on(event))).toEqual({ truth, gates });
  });

  it('treats comparisons with permission-check outputs as gates', () => {
    expect(
      evaluateCondition(
        "needs.check.outputs.allowed == 'true'",
        on('issues', ['needs.check.outputs']),
      ),
    ).toEqual({ truth: 'no', gates: ['permission check'] });
    expect(evaluateCondition("needs.check.outputs.allowed == 'true'", on('issues'))).toEqual({
      truth: 'maybe',
      gates: [],
    });
  });
});
