import { describe, expect, it } from 'vitest';
import {
  allowsAnyBash,
  commentVersion,
  geminiToolsProblem,
  toolTokens,
  untrustedExpressions,
} from '../src/checks/rules.js';
import { checkText, checkTexts, ids, only } from './helpers/files.js';

/** A workflow with one job and the given trigger, job lines and steps (indented by the caller). */
function workflow(on: string, steps: string, job = '', top = ''): string {
  return `name: Test\non:\n${on}\n${top}jobs:\n  agent:\n    runs-on: ubuntu-latest\n${job}    steps:\n${steps}`;
}

const ISSUES = '  issues:\n    types: [opened]';
const COMMENTS = '  issue_comment:\n    types: [created]';
const READ = 'permissions:\n  contents: read\n';
const READ_ISSUES = 'permissions:\n  contents: read\n  issues: write\n';

const GEMINI = (extra = '') =>
  `      - uses: google-github-actions/run-gemini-cli@v0
        with:
          gemini_api_key: \${{ secrets.GEMINI_API_KEY }}
          settings: '{"coreTools": ["run_shell_command(gh issue edit)"]}'
${extra}`;

const CLAUDE = (extra = '') =>
  `      - uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: \${{ secrets.ANTHROPIC_API_KEY }}
${extra}`;

describe('anyone-can-run', () => {
  it('is high when allowed_non_write_users is "*" with a github_token', () => {
    const report = checkText(
      workflow(
        ISSUES,
        CLAUDE(
          `          github_token: \${{ secrets.GITHUB_TOKEN }}\n          allowed_non_write_users: "*"\n`,
        ),
        '',
        READ_ISSUES,
      ),
    );
    const [finding] = only(report, 'anyone-can-run');
    expect(finding).toMatchObject({
      severity: 'high',
      line: 16,
      job: 'agent',
      agent: 'claude-code-action',
    });
    expect(finding?.explanation).toBe(
      'allowed_non_write_users: "*" lets any GitHub user start Claude Code Action, and the workflow runs on issues, which any GitHub user can fire. No condition stops them, so anyone can give the agent instructions while it has a token with issues write access, and the secrets ANTHROPIC_API_KEY and GITHUB_TOKEN.',
    );
    expect(finding?.evidence.map((e) => e.line)).toEqual([3, 12, 16]);
  });

  it('ignores the wildcard without github_token, which the action needs for it', () => {
    const report = checkText(
      workflow(ISSUES, CLAUDE('          allowed_non_write_users: "*"\n'), '', READ_ISSUES),
    );
    expect(only(report, 'anyone-can-run')).toEqual([]);
    expect(ids(only(report, 'untrusted-trigger'))).toEqual(['untrusted-trigger:low']);
  });

  it('is high for an action without its own check, and medium with nothing in reach', () => {
    expect(ids(only(checkText(workflow(ISSUES, GEMINI(), '', READ)), 'anyone-can-run'))).toEqual([
      'anyone-can-run:high',
    ]);
    const bare = workflow(
      ISSUES,
      '      - uses: actions/ai-inference@v3\n        with:\n          prompt: Hello\n',
      '',
      'permissions: {}\n',
    );
    expect(ids(only(checkText(bare), 'anyone-can-run'))).toEqual(['anyone-can-run:medium']);
  });

  it('suggests an author association condition for the first open event', () => {
    const [finding] = only(checkText(workflow(COMMENTS, GEMINI(), '', READ)), 'anyone-can-run');
    expect(finding?.fix).toContain('github.event.comment.author_association');
  });

  it('is medium when allowed_bots is "*"', () => {
    const report = checkText(
      workflow(ISSUES, CLAUDE("          allowed_bots: '*'\n"), '', READ_ISSUES),
    );
    const [finding] = only(report, 'anyone-can-run');
    expect(finding).toMatchObject({ severity: 'medium', line: 15 });
    expect(finding?.fix).toBe('List only the bots you trust in allowed_bots.');
  });

  it('is not reported when a condition stops outside users', () => {
    const gated = workflow(
      COMMENTS,
      GEMINI(),
      "    if: github.event.comment.author_association == 'OWNER'\n",
      READ,
    );
    expect(only(checkText(gated), 'anyone-can-run')).toEqual([]);
  });
});

describe('untrusted-input', () => {
  it('finds untrusted expressions in with:, env:, job env and workflow env', () => {
    const text = workflow(
      ISSUES,
      GEMINI(
        '          prompt: Label ${{ github.event.issue.title }}\n        env:\n          BODY: ${{ github.event.issue.body }}\n',
      ),
      '    env:\n      ALL: ${{ toJSON(github.event) }}\n',
      `${READ}env:\n  HEAD: \${{ github.head_ref }}\n`,
    );
    const [finding] = only(checkText(text), 'untrusted-input');
    expect(finding?.severity).toBe('high');
    expect(finding?.explanation).toBe(
      'Run Gemini CLI gets text that outside users write: ${{ github.event.issue.title }}, ${{ github.event.issue.body }}, ${{ toJSON(github.event) }} and 1 more. A prompt injection in that text can make the agent use its tools for the attacker. Moving the text into env: does not help, because the agent still reads it.',
    );
    expect(finding?.evidence.map((e) => e.line)).toEqual([8, 13, 19, 21]);
  });

  it('follows text that an earlier step writes to a file', () => {
    const text = workflow(
      ISSUES,
      `      - name: Save
        run: echo "\${{ github.event.issue.body }}" > prompt.txt
${GEMINI('          prompt-file: prompt.txt\n')}`,
      '',
      READ,
    );
    const [finding] = only(checkText(text), 'untrusted-input');
    expect(finding?.line).toBe(12);
    expect(finding?.explanation).toContain(
      ', partly through a file or variable that step "Save" writes.',
    );
  });

  it('ignores numbers and safe fields', () => {
    const text = workflow(
      ISSUES,
      GEMINI(
        '          prompt: Issue ${{ github.event.issue.number }} by ${{ github.event.issue.user.login }}\n',
      ),
      '',
      READ,
    );
    expect(only(checkText(text), 'untrusted-input')).toEqual([]);
  });

  it('scales with exposure', () => {
    const gated = (perms: string) =>
      workflow(COMMENTS, CLAUDE('          prompt: ${{ github.event.comment.body }}\n'), '', perms);
    expect(ids(only(checkText(gated(READ_ISSUES)), 'untrusted-input'))).toEqual([
      'untrusted-input:medium',
    ]);
    expect(ids(only(checkText(gated(READ)), 'untrusted-input'))).toEqual(['untrusted-input:low']);
    const fork = workflow(
      '  pull_request:',
      CLAUDE('          prompt: ${{ github.event.pull_request.title }}\n'),
      '',
      READ,
    );
    expect(ids(only(checkText(fork), 'untrusted-input'))).toEqual(['untrusted-input:low']);
    const trusted = workflow(
      '  workflow_dispatch:',
      GEMINI('          prompt: ${{ github.event.issue.body }}\n'),
      '',
      READ,
    );
    expect(only(checkText(trusted), 'untrusted-input')).toEqual([]);
  });

  it('recognizes the untrusted expressions', () => {
    expect(
      untrustedExpressions(
        '${{ github.event.review.body }} ${{github.event.pull_request.head.ref}} ${{ github.event.commits[*].message }} ${{ github.event.workflow_run.head_commit.message }} ${{ github.event.issue.number }}',
      ),
    ).toEqual([
      '${{ github.event.review.body }}',
      '${{ github.event.pull_request.head.ref }}',
      '${{ github.event.commits[*].message }}',
      '${{ github.event.workflow_run.head_commit.message }}',
    ]);
  });
});

describe('write-permissions', () => {
  it('reports the default token permissions when there is no permissions block', () => {
    const [finding] = only(checkText(workflow(ISSUES, GEMINI())), 'write-permissions');
    expect(finding).toMatchObject({ severity: 'high', line: 6, step: null });
    expect(finding?.explanation).toBe(
      "The job has no permissions block, so the token gets the default permissions of the repository, which can include write access (read and write was the default for repositories created before February 2023). The agent's environment has the secret GEMINI_API_KEY. Anyone who can start the agent can try to make it use or leak them.",
    );
  });

  it('prefers job permissions over workflow permissions', () => {
    const text = workflow(
      ISSUES,
      GEMINI(),
      '    permissions:\n      contents: read\n',
      'permissions: write-all\n',
    );
    expect(ids(only(checkText(text), 'write-permissions'))).toEqual(['write-permissions:medium']);
  });

  it('is medium for a gated job that can write and low with secrets only', () => {
    const gate = "    if: github.event.comment.author_association == 'MEMBER'\n";
    expect(
      ids(only(checkText(workflow(COMMENTS, GEMINI(), gate, READ_ISSUES)), 'write-permissions')),
    ).toEqual(['write-permissions:medium']);
    expect(
      ids(only(checkText(workflow(COMMENTS, GEMINI(), gate, READ)), 'write-permissions')),
    ).toEqual(['write-permissions:low']);
  });

  it('is not reported for fork pull requests or trusted triggers', () => {
    expect(only(checkText(workflow('  pull_request:', GEMINI())), 'write-permissions')).toEqual([]);
    expect(only(checkText(workflow('  push:', GEMINI())), 'write-permissions')).toEqual([]);
  });
});

describe('dangerous-settings', () => {
  const titles = (text: string) =>
    only(checkText(text), 'dangerous-settings').map((f) => `${f.title}:${f.severity}:${f.line}`);

  it('finds risky Claude settings', () => {
    const text = workflow(
      COMMENTS,
      CLAUDE(`          claude_args: |
            --model x
            --dangerously-skip-permissions
            --allowedTools "Bash,Read"
          settings: '{"permissions": {"defaultMode": "bypassPermissions"}}'
          show_full_output: true
        env:
          CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: 0
`),
      '',
      READ,
    );
    expect(titles(text)).toEqual([
      'Permission checks turned off:medium:16',
      'Unrestricted shell access:medium:17',
      'Broad permissions in settings:medium:18',
      'Full agent output in the log:medium:19',
      'Secret scrubbing turned off:medium:21',
    ]);
  });

  it('accepts filtered Bash tools', () => {
    expect(
      allowsAnyBash('--allowedTools "Bash(gh issue view:*),Bash(gh issue edit:*)"', true),
    ).toBe(false);
    expect(allowsAnyBash('--allowed-tools=Bash(*)', true)).toBe(true);
    expect(allowsAnyBash('--allowedTools Read Bash(:*) --model x', true)).toBe(true);
    expect(allowsAnyBash('--disallowedTools Bash --allowedTools Read', true)).toBe(false);
    expect(allowsAnyBash('Bash(git diff:*),Bash', false)).toBe(true);
    expect(toolTokens('"Bash(gh issue view:*)", Read')).toEqual(['Bash(gh issue view:*)', 'Read']);
  });

  it('finds risky Codex settings', () => {
    const codex = (inputs: string) =>
      workflow(
        '  push:',
        `      - uses: openai/codex-action@v1\n        with:\n          prompt: x\n${inputs}`,
        '',
        READ,
      );
    expect(titles(codex('          safety-strategy: unsafe\n'))).toEqual([
      'Codex runs without restrictions:low:13',
    ]);
    expect(titles(codex('          safety-strategy: read-only\n'))).toEqual([
      'Codex keeps sudo:low:13',
    ]);
    expect(titles(codex('          sandbox: danger-full-access\n'))).toEqual([
      'Codex sandbox turned off:low:13',
    ]);
    expect(titles(codex('          codex-args: \'["--yolo"]\'\n'))).toEqual([
      'Codex sandbox and approvals turned off:low:13',
    ]);
    expect(titles(codex('          safety-strategy: drop-sudo\n'))).toEqual([]);
  });

  it('checks Gemini tool lists', () => {
    expect(geminiToolsProblem(undefined)).toBe('missing');
    expect(geminiToolsProblem('{"model": {"maxSessionTurns": 25}}')).toBe('missing');
    expect(geminiToolsProblem('{"coreTools": ["run_shell_command"]}')).toBe('shell');
    expect(geminiToolsProblem('{"tools": {"core": ["ShellTool(*)"]}}')).toBe('shell');
    expect(geminiToolsProblem('{"coreTools": ["run_shell_command(gh issue edit)"]}')).toBeNull();
    expect(geminiToolsProblem('{"excludeTools": ["run_shell_command"]}')).toBe('shell');
    expect(geminiToolsProblem('{"tools": {"exclude": ["write_file"]}}')).toBeNull();
    const text = workflow(
      ISSUES,
      '      - uses: google-github-actions/run-gemini-cli@v0\n        with:\n          prompt: x\n',
      '',
      READ,
    );
    expect(titles(text)).toEqual(['All tools allowed in yolo mode:high:11']);
  });

  it('finds risky AI Inference and Copilot CLI action settings', () => {
    const inference = workflow(
      '  push:',
      "      - uses: actions/ai-inference@v2\n        with:\n          enable-github-mcp: true\n          copilot-allow-tools: 'write,shell'\n",
      '',
      READ,
    );
    expect(titles(inference)).toEqual([
      'GitHub MCP server enabled:low:12',
      'Unrestricted shell access:low:13',
    ]);
    const copilot = (inputs: string) =>
      workflow(
        '  push:',
        `      - uses: austenstone/copilot-cli@v4\n        with:\n          prompt: x\n${inputs}`,
        '',
        READ,
      );
    expect(titles(copilot(''))).toEqual(['All tools allowed:low:10']);
    expect(titles(copilot('          allow-all-tools: false\n'))).toEqual([]);
    expect(
      titles(
        copilot('          allow-all-tools: false\n          enable-all-github-mcp-tools: true\n'),
      ),
    ).toEqual(['All GitHub MCP tools enabled:low:14']);
  });

  it('finds risky flags of agent CLIs in run: steps', () => {
    const run = (script: string) =>
      workflow('  push:', `      - run: |\n          echo start\n          ${script}\n`, '', READ);
    expect(titles(run('gemini -p "x" --yolo'))).toEqual(['All tools allowed in yolo mode:low:12']);
    expect(titles(run('codex exec --dangerously-bypass-approvals-and-sandbox "x"'))).toEqual([
      'Codex sandbox turned off:low:12',
    ]);
    expect(titles(run('cursor-agent -p "x" --force'))).toEqual([
      'Commands allowed without approval:low:12',
    ]);
    expect(titles(run('copilot -p "x" --allow-all-tools'))).toEqual(['All tools allowed:low:12']);
    expect(titles(run('aider --yes-always --message "x"'))).toEqual([
      'Every question answered with yes:low:12',
    ]);
    expect(titles(run('claude -p "x" --permission-mode bypassPermissions'))).toEqual([
      'Permission checks turned off:low:12',
    ]);
    expect(titles(run('gemini -p "x"'))).toEqual([]);
  });

  it('is high when anyone can start the agent', () => {
    const text = workflow(
      ISSUES,
      `      - run: gemini -y -p "\${{ github.event.issue.title }}"\n`,
      '',
      READ,
    );
    expect(ids(checkText(text))).toEqual([
      'dangerous-settings:high',
      'anyone-can-run:medium',
      'untrusted-input:medium',
    ]);
  });
});

describe('untrusted-checkout', () => {
  const target = (checkout: string, on = '  pull_request_target:', version = 'v6') =>
    workflow(
      on,
      `      - uses: actions/checkout@${version}\n        with:\n${checkout}          persist-credentials: false\n${GEMINI()}`,
      '',
      READ,
    );
  const HEAD = '          ref: ${{ github.event.pull_request.head.sha }}\n';
  const found = (text: string) => ids(only(checkText(text), 'untrusted-checkout'));

  it('is high for the pull request head in the workspace root', () => {
    const [finding] = only(checkText(target(HEAD)), 'untrusted-checkout');
    expect(finding).toMatchObject({ severity: 'high', line: 12, step: 'actions/checkout@v6' });
    expect(finding?.explanation).toBe(
      "This pull_request_target workflow checks out the pull request head (ref: ${{ github.event.pull_request.head.sha }}) into the workspace root before Run Gemini CLI runs. The run has the repository's secrets, and the agent works in files an outsider controls, including instruction files such as GEMINI.md and tool configuration.",
    );
  });

  it('is medium in a subdirectory, and finds other ways to name the head', () => {
    expect(found(target(`${HEAD}          path: pr\n`))).toEqual(['untrusted-checkout:medium']);
    expect(
      found(target('          ref: refs/pull/${{ github.event.issue.number }}/head\n', COMMENTS)),
    ).toEqual(['untrusted-checkout:high']);
    expect(
      found(target('          repository: ${{ github.event.pull_request.head.repo.full_name }}\n')),
    ).toEqual(['untrusted-checkout:high']);
  });

  it('trusts the fork protection of actions/checkout v7 unless it is turned off', () => {
    expect(found(target(HEAD, '  pull_request_target:', 'v7'))).toEqual([]);
    expect(
      found(
        target(HEAD, '  pull_request_target:', '0123456789abcdef0123456789abcdef01234567 # v7.0.1'),
      ),
    ).toEqual([]);
    const [unsafe] = only(
      checkText(
        target(`${HEAD}          allow-unsafe-pr-checkout: true\n`, '  pull_request_target:', 'v7'),
      ),
      'untrusted-checkout',
    );
    expect(unsafe?.severity).toBe('high');
    expect(unsafe?.explanation).toContain(
      'allow-unsafe-pr-checkout: true turns off the protection that actions/checkout v7 has for this.',
    );
    expect(
      found(
        target('          ref: refs/pull/${{ github.event.issue.number }}/head\n', COMMENTS, 'v7'),
      ),
    ).toEqual(['untrusted-checkout:high']);
  });

  it('is not reported for the base branch or for pull_request', () => {
    expect(found(target(''))).toEqual([]);
    expect(found(target(HEAD, '  pull_request:'))).toEqual([]);
  });
});
describe('untrusted-trigger', () => {
  it('is medium for comments that only the action check stops', () => {
    const [finding] = only(checkText(workflow(COMMENTS, CLAUDE(), '', READ)), 'untrusted-trigger');
    expect(finding?.severity).toBe('medium');
    expect(finding?.explanation).toBe(
      'Claude Code Action runs on issue_comment. Only people with write access can start it, but it reads issue and pull request text that others wrote, and that text can change after a maintainer starts the run.',
    );
  });

  it('is low behind a condition and names the gate', () => {
    const text = workflow(
      COMMENTS,
      CLAUDE(),
      "    if: github.event.comment.author_association == 'OWNER'\n",
      READ,
    );
    const [finding] = only(checkText(text), 'untrusted-trigger');
    expect(finding?.severity).toBe('low');
    expect(finding?.explanation).toBe(
      'The workflow runs on issue_comment, which outside users can fire, and the agent only starts for trusted users: job condition (author association) and Claude Code Action checks for write access. The agent can still read text that others wrote.',
    );
  });

  it('treats event types that need triage access as a gate, except labels on issues', () => {
    const labeled = workflow('  pull_request_target:\n    types: [labeled]', GEMINI(), '', READ);
    expect(only(checkText(labeled), 'untrusted-trigger')[0]?.explanation).toContain(
      'event types (labeled)',
    );
    const issueLabel = workflow('  issues:\n    types: [labeled]', GEMINI(), '', READ);
    expect(ids(only(checkText(issueLabel), 'anyone-can-run'))).toEqual(['anyone-can-run:high']);
  });

  it('is info for fork pull requests', () => {
    expect(ids(checkText(workflow('  pull_request:', GEMINI(), '', READ)))).toEqual([
      'unpinned-agent:low',
      'untrusted-trigger:info',
    ]);
  });

  it('skips events that a condition excludes', () => {
    const text = workflow(
      `${ISSUES}\n  push:`,
      GEMINI(),
      "    if: github.event_name == 'push'\n",
      READ,
    );
    expect(ids(checkText(text))).toEqual(['unpinned-agent:low']);
  });
});

describe('permission checks', () => {
  const check = `      - name: Check
        run: |
          gh api repos/o/r/collaborators/\${{ github.actor }}/permission --jq .permission | grep -q write || exit 1
`;

  it('counts an earlier failing permission check in the job as a gate', () => {
    const report = checkText(workflow(ISSUES, `${check}${GEMINI()}`, '', READ));
    expect(only(report, 'untrusted-trigger')[0]?.explanation).toContain('permission check');
    expect(only(report, 'anyone-can-run')).toEqual([]);
  });

  it('counts a needed job with a failing permission check, unless always() runs the job anyway', () => {
    const text = (cond: string) =>
      `name: Test\non:\n${ISSUES}\n${READ}jobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n${check}  agent:\n    needs: check\n${cond}    runs-on: ubuntu-latest\n    steps:\n${GEMINI()}`;
    expect(only(checkText(text('')), 'anyone-can-run')).toEqual([]);
    expect(ids(only(checkText(text('    if: always()\n')), 'anyone-can-run'))).toEqual([
      'anyone-can-run:high',
    ]);
  });

  it('counts conditions on the outputs of a permission check action', () => {
    const steps = `      - id: perm
        uses: actions-cool/check-user-permission@v2
        with:
          require: write
      - if: steps.perm.outputs.require-result == 'true'
${GEMINI().replace('      - uses', '        uses')}`;
    const report = checkText(workflow(ISSUES, steps, '', READ));
    expect(only(report, 'untrusted-trigger')[0]?.explanation).toContain(
      'step condition (permission check)',
    );
  });
});

describe('workflow_run', () => {
  const downstream = workflow(
    "  workflow_run:\n    workflows: ['Build']\n    types: [completed]",
    GEMINI(),
    '',
    READ,
  );

  it('is untrusted when the upstream workflow is unknown or runs on pull requests', () => {
    expect(ids(only(checkTexts({ 'agent.yml': downstream }), 'anyone-can-run'))).toEqual([
      'anyone-can-run:high',
    ]);
    const upstream = 'name: Build\non: pull_request\njobs: {}\n';
    expect(
      ids(only(checkTexts({ 'agent.yml': downstream, 'build.yml': upstream }), 'anyone-can-run')),
    ).toEqual(['anyone-can-run:high']);
  });

  it('is trusted when every upstream workflow has trusted triggers', () => {
    const upstream = 'name: Build\non:\n  push:\n    branches: [main]\njobs: {}\n';
    expect(ids(checkTexts({ 'agent.yml': downstream, 'build.yml': upstream }))).toEqual([
      'unpinned-agent:low',
    ]);
  });
});

describe('outdated-agent', () => {
  const uses = (ref: string, on = COMMENTS) =>
    workflow(
      on,
      `      - uses: anthropics/claude-code-action@${ref}\n        with:\n          prompt: x\n`,
      '',
      READ,
    );
  const outdated = (text: string) =>
    only(checkText(text), 'outdated-agent').map((f) => `${f.severity}:${f.explanation}`);

  it('compares release tags with the first fixed release', () => {
    expect(outdated(uses('v1.0.135'))).toEqual([
      'medium:anthropics/claude-code-action is used at v1.0.135, which is older than the fixed release: v1.0.136 is the first release that installs Claude Code 2.1.163, which has the fixes from the August 2026 CSA research note.',
    ]);
    expect(outdated(uses('v1.0.136'))).toEqual([]);
    expect(outdated(uses('v1'))).toEqual([]);
    expect(outdated(uses('main'))).toEqual([]);
    expect(outdated(uses('v0'))).toHaveLength(1);
    expect(outdated(uses('beta'))).toHaveLength(1);
    expect(outdated(uses('v1.0.100', '  push:'))[0]).toMatch(/^low:/);
  });

  it('reads the version comment of a SHA pin, or says it cannot tell', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    expect(outdated(uses(`${sha} # v1.0.100`))[0]).toContain(
      'is used at v1.0.100 (from the version comment)',
    );
    expect(outdated(uses(`${sha} # v1.0.200`))).toEqual([]);
    expect(outdated(uses(sha))).toEqual([
      'info:anthropics/claude-code-action is pinned to commit 0123456789ab without a version comment, so its version cannot be determined offline. Make sure it is a release where v1.0.136 is the first release that installs Claude Code 2.1.163, which has the fixes from the August 2026 CSA research note.',
    ]);
    expect(commentVersion('ratchet:owner/repo@v1.2.3')).toBe('v1.2.3');
    expect(commentVersion('tag=v2')).toBe('v2');
    expect(commentVersion('pin')).toBeNull();
  });

  it('checks the base action, run-gemini-cli and the archived Gemini action', () => {
    const one = (step: string) => outdated(workflow(COMMENTS, step, '', READ));
    expect(one('      - uses: anthropics/claude-code-base-action@v0.0.63\n')).toHaveLength(1);
    expect(one('      - uses: anthropics/claude-code-base-action@main\n')).toEqual([]);
    expect(one('      - uses: google-github-actions/run-gemini-cli@v0.1.21\n')).toHaveLength(1);
    expect(one('      - uses: google-github-actions/run-gemini-cli@v0.1.22\n')).toEqual([]);
    expect(one('      - uses: google-gemini/gemini-cli-action@main\n')).toEqual([
      'medium:google-gemini/gemini-cli-action is archived and no longer receives fixes.',
    ]);
  });

  it('checks gemini_cli_version', () => {
    const gemini = (version: string) =>
      outdated(
        workflow(COMMENTS, GEMINI(`          gemini_cli_version: '${version}'\n`), '', READ),
      );
    expect(gemini('0.39.0')).toEqual([
      'medium:gemini_cli_version: 0.39.0 installs Gemini CLI 0.39.0, which is older than 0.39.1 and 0.40.0-preview.3 with the fixes from the August 2026 CSA research note.',
    ]);
    expect(gemini('0.39.1')).toEqual([]);
    expect(gemini('0.40.0-preview.2')).toHaveLength(1);
    expect(gemini('latest')).toEqual([]);
    expect(gemini('${{ vars.GEMINI_CLI_VERSION }}')).toEqual([]);
  });

  it('checks pinned installs of agent CLIs in jobs with agents', () => {
    const install = (script: string) =>
      outdated(
        workflow(COMMENTS, `      - run: ${script}\n      - run: claude -p "x"\n`, '', READ),
      );
    expect(install('npm i -g @anthropic-ai/claude-code@2.1.162')).toEqual([
      'medium:This step installs Claude Code 2.1.162, which is older than 2.1.163 with the fixes from the August 2026 CSA research note.',
    ]);
    expect(install('npm i -g @anthropic-ai/claude-code@2.1.163')).toEqual([]);
    expect(install('curl -fsSL https://claude.ai/install.sh | bash -s -- 2.1.150')).toHaveLength(1);
    expect(install('npm i -g @google/gemini-cli@0.38.2')).toHaveLength(1);
    expect(install('npm i -g @anthropic-ai/claude-code')).toEqual([]);
  });
});

describe('shared-checkout', () => {
  const codex = (inputs = '') =>
    `      - uses: openai/codex-action@v1\n        with:\n          prompt: x\n${inputs}`;

  it('is reported when a later agent run follows one that can write', () => {
    const [finding] = only(
      checkText(workflow(COMMENTS, `${codex()}${codex()}`, '', READ)),
      'shared-checkout',
    );
    expect(finding).toMatchObject({ severity: 'medium', line: 14 });
    expect(finding?.explanation).toBe(
      'Step "openai/codex-action@v1" can write files, and step "openai/codex-action@v1" later runs Codex Action in the same checkout, where it reads instruction files such as AGENTS.md. A prompt injection in the first run can steer the second. There is no Codex fix for this; the CSA research note recommends separate jobs.',
    );
  });

  it('is not reported when the earlier runs are read-only or there is one run', () => {
    expect(
      only(
        checkText(
          workflow(COMMENTS, `${codex('          sandbox: read-only\n')}${codex()}`, '', READ),
        ),
        'shared-checkout',
      ),
    ).toEqual([]);
    expect(only(checkText(workflow(COMMENTS, codex(), '', READ)), 'shared-checkout')).toEqual([]);
  });

  it('is low without untrusted triggers and covers mixed agents', () => {
    const [finding] = only(
      checkText(workflow('  push:', `${CLAUDE()}${GEMINI()}`, '', READ)),
      'shared-checkout',
    );
    expect(finding?.severity).toBe('low');
    expect(finding?.explanation).toContain(
      'runs Run Gemini CLI in the same checkout, where it reads instruction files such as GEMINI.md.',
    );
    expect(finding?.explanation).not.toContain('Codex');
  });
});

describe('checkout-credentials', () => {
  const steps = (persist: string) =>
    `      - uses: actions/checkout@v7\n${persist}${GEMINI()}      - uses: actions/checkout@v7\n`;

  it('is medium when anyone can start the agent and low when gated', () => {
    expect(
      ids(only(checkText(workflow(ISSUES, steps(''), '', READ)), 'checkout-credentials')),
    ).toEqual(['checkout-credentials:medium']);
    const gate = "    if: github.event.issue.author_association == 'OWNER'\n";
    expect(
      ids(only(checkText(workflow(ISSUES, steps(''), gate, READ)), 'checkout-credentials')),
    ).toEqual(['checkout-credentials:low']);
  });

  it('is not reported with persist-credentials: false or without untrusted triggers', () => {
    const off = '        with:\n          persist-credentials: false\n';
    expect(only(checkText(workflow(ISSUES, steps(off), '', READ)), 'checkout-credentials')).toEqual(
      [],
    );
    expect(
      only(checkText(workflow('  push:', steps(''), '', READ)), 'checkout-credentials'),
    ).toEqual([]);
  });
});

describe('unpinned-agent', () => {
  it('is low for tags and branches and not reported for SHAs or CLIs', () => {
    expect(ids(only(checkText(workflow('  push:', GEMINI(), '', READ)), 'unpinned-agent'))).toEqual(
      ['unpinned-agent:low'],
    );
    const sha = workflow(
      '  push:',
      '      - uses: openai/codex-action@0123456789abcdef0123456789abcdef01234567\n',
      '',
      READ,
    );
    expect(only(checkText(sha), 'unpinned-agent')).toEqual([]);
    expect(
      only(
        checkText(workflow('  push:', '      - run: claude -p x\n', '', READ)),
        'unpinned-agent',
      ),
    ).toEqual([]);
  });
});

describe('fixture repositories', () => {
  it('reports nothing above info for the safe fixture', async () => {
    const { scan } = await import('../src/scan.js');
    const report = await scan('test/fixtures/repos/safe', process.cwd());
    expect(ids(report)).toEqual(['untrusted-trigger:info']);
    expect(report.summary).toMatchObject({ workflows: 3, agentSteps: 2 });
  });

  it('reports only gated findings for the gated fixture', async () => {
    const { scan } = await import('../src/scan.js');
    const report = await scan('test/fixtures/repos/gated', process.cwd());
    expect(
      report.findings.map((f) => `${f.id}:${f.severity}:${f.file.slice(18)}:${f.line}`),
    ).toEqual([
      'write-permissions:medium:association.yml:9',
      'write-permissions:medium:same-repo.yml:8',
      'untrusted-trigger:low:association.yml:18',
      'unpinned-agent:low:association.yml:18',
      'untrusted-trigger:low:label.yml:19',
      'write-permissions:low:label.yml:21',
      'write-permissions:low:maintainer.yml:17',
      'untrusted-trigger:low:maintainer.yml:18',
      'untrusted-trigger:low:permission-job.yml:24',
      'unpinned-agent:low:permission-job.yml:24',
      'write-permissions:low:permission-job.yml:26',
      'untrusted-trigger:low:same-repo.yml:15',
    ]);
  });

  it('reports every problem in the vulnerable fixture', async () => {
    const { scan } = await import('../src/scan.js');
    const report = await scan('test/fixtures/repos/vulnerable', process.cwd());
    expect(
      report.findings.map((f) => `${f.id}:${f.severity}:${f.file.slice(18)}:${f.line}`),
    ).toEqual([
      'anyone-can-run:high:after-ci.yml:22',
      'dangerous-settings:high:after-ci.yml:22',
      'write-permissions:high:cli-agent.yml:7',
      'untrusted-input:high:cli-agent.yml:22',
      'anyone-can-run:high:cli-agent.yml:24',
      'dangerous-settings:high:cli-agent.yml:24',
      'write-permissions:high:codex-issues.yml:8',
      'anyone-can-run:high:codex-issues.yml:16',
      'dangerous-settings:high:codex-issues.yml:17',
      'untrusted-input:high:codex-issues.yml:19',
      'write-permissions:high:gemini-triage.yml:11',
      'anyone-can-run:high:gemini-triage.yml:18',
      'dangerous-settings:high:gemini-triage.yml:18',
      'untrusted-input:high:gemini-triage.yml:21',
      'write-permissions:high:inference.yml:9',
      'anyone-can-run:high:inference.yml:16',
      'untrusted-input:high:inference.yml:18',
      'dangerous-settings:high:inference.yml:19',
      'write-permissions:high:pr-target.yml:9',
      'untrusted-checkout:high:pr-target.yml:17',
      'anyone-can-run:high:pr-target.yml:19',
      'checkout-credentials:medium:after-ci.yml:16',
      'untrusted-checkout:medium:after-ci.yml:18',
      'write-permissions:medium:after-ci.yml:24',
      'write-permissions:medium:bots.yml:9',
      'anyone-can-run:medium:bots.yml:18',
      'checkout-credentials:medium:cli-agent.yml:14',
      'outdated-agent:medium:cli-agent.yml:17',
      'checkout-credentials:medium:codex-issues.yml:11',
      'outdated-agent:medium:gemini-triage.yml:18',
      'outdated-agent:medium:gemini-triage.yml:25',
      'checkout-credentials:medium:pr-target.yml:15',
      'outdated-agent:medium:pr-target.yml:19',
      'unpinned-agent:low:after-ci.yml:22',
      'untrusted-trigger:low:bots.yml:15',
      'unpinned-agent:low:bots.yml:15',
      'unpinned-agent:low:codex-issues.yml:13',
      'unpinned-agent:low:gemini-triage.yml:18',
      'unpinned-agent:low:inference.yml:16',
      'unpinned-agent:low:pr-target.yml:19',
    ]);
  });

  it('handles anchors, multiple documents, broken files and mixed conditions', async () => {
    const { scan } = await import('../src/scan.js');
    const report = await scan('test/fixtures/repos/tricky', process.cwd());
    expect(
      report.findings.map((f) => `${f.id}:${f.severity}:${f.file.slice(18)}:${f.line}`),
    ).toEqual([
      'write-permissions:high:anchors.yml:10',
      'write-permissions:high:anchors.yml:10',
      'anyone-can-run:high:anchors.yml:14',
      'anyone-can-run:high:anchors.yml:14',
      'dangerous-settings:high:anchors.yml:14',
      'dangerous-settings:high:anchors.yml:14',
      'untrusted-input:high:anchors.yml:17',
      'untrusted-input:high:anchors.yml:17',
      'write-permissions:high:gemini-run.yaml:9',
      'untrusted-input:high:gemini-run.yaml:19',
      'anyone-can-run:high:gemini-run.yaml:24',
      'dangerous-settings:high:gemini-run.yaml:24',
      'anyone-can-run:high:mixed-if.yml:15',
      'dangerous-settings:high:mixed-if.yml:18',
      'outdated-agent:medium:gemini-run.yaml:16',
      'write-permissions:medium:mixed-if.yml:17',
      'untrusted-trigger:medium:multi-doc.yml:12',
      'unpinned-agent:low:anchors.yml:14',
      'unpinned-agent:low:anchors.yml:14',
      'unpinned-agent:low:mixed-if.yml:15',
      'write-permissions:low:multi-doc.yml:14',
      'unpinned-agent:low:release-notes.yml:15',
      'parse-error:info:broken.yml:11',
      'parse-error:info:empty.yml:1',
      'parse-error:info:multi-doc.yml:1',
    ]);
    expect(report.findings.filter((f) => f.file.endsWith('anchors.yml')).map((f) => f.job)).toEqual(
      [
        'first',
        'second',
        'first',
        'second',
        'first',
        'second',
        'first',
        'second',
        'first',
        'second',
      ],
    );
  });

  it('reports the comment bot fixture', async () => {
    const { scan } = await import('../src/scan.js');
    const report = await scan('test/fixtures/repos/comment-bot', process.cwd());
    expect(ids(report)).toEqual([
      'write-permissions:medium',
      'untrusted-trigger:medium',
      'outdated-agent:medium',
      'checkout-credentials:low',
      'unpinned-agent:low',
    ]);
  });
});
