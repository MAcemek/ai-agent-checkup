# ai-agent-checkup

**Checks GitHub Actions workflows that run AI coding agents for the ways an outside user can turn
a prompt injection into stolen secrets or write access. One checklist, with a severity and a
concrete fix for every problem.**

It knows Claude Code, Codex, Gemini CLI, GitHub Copilot, Qwen Code, opencode, Cursor and Aider,
as GitHub Actions or as commands in `run:` steps. It reads the workflow files only: nothing is
sent over the network.

## Why

In August 2026 a [Cloud Security Alliance research note](https://labs.cloudsecurityalliance.org/research/csa-research-note-ai-coding-agent-cicd-secrets-20260808-csa/)
summarized research presented at Black Hat USA 2026: in the vendors' own repositories for Claude
Code, Gemini CLI and OpenAI Codex, a GitHub issue opened by an account with no repository
privileges was enough to reach CI runner secrets through the default agent workflows, and
comparable default configurations ran unmodified in well over a hundred other public
repositories. Aikido's [PromptPwnd](https://www.aikido.dev/blog/promptpwnd-github-actions-ai-agents)
research found the same class of problem with claude-code-action, codex-action, actions/ai-inference
and run-gemini-cli, and John Stawinski showed how a
[pull request title edited after a maintainer's comment](https://johnstawinski.com/2026/02/05/trusting-claude-with-a-knife-unauthorized-prompt-injection-to-rce-in-anthropics-claude-code-action/)
led to code execution in claude-code-action.

## Usage

```bash
npx ai-agent-checkup                          # check .github/workflows in the current directory
npx ai-agent-checkup path/to/repo
npx ai-agent-checkup .github/workflows/claude.yml
npx ai-agent-checkup --fail-on high           # exit code 1 if a high severity problem is found
npx ai-agent-checkup --format sarif --output ai-agent-checkup.sarif
npx ai-agent-checkup --list-agents            # the agents it recognizes
```

Requires Node.js 22.12 or later. A directory is read as a repository root (its
`.github/workflows/*.yml` and `*.yaml` files); a file is read as one workflow. Formats: `text`
(default), `markdown`, `json` and `sarif` (SARIF 2.1.0).

Exit codes: `0` success, `1` `--fail-on` matched, `2` invalid arguments or path. Without
`--fail-on` the exit code is 0 even when problems are found. `--fail-on medium` matches medium and
high problems; `--fail-on any` also matches info findings.

## Example output

`npx ai-agent-checkup test/fixtures/repos/demo`, the output of `npm run demo`:

```text
ai-agent-checkup 0.1.0
Path: test/fixtures/repos/demo
Scanned 2 workflows with 3 agent steps.

Found 8 problems: 4 high, 1 medium, 3 low, 0 info.

[HIGH] Pull request code checked out before the agent (untrusted-checkout)
  .github/workflows/codex-review.yml:15  job review, step "actions/checkout@v7"
  This pull_request_target workflow checks out the pull request head (ref: ${{
  github.event.pull_request.head.sha }}) into the workspace root before Codex Action runs. The run
  has the repository's secrets, and the agent works in files an outsider controls, including
  instruction files such as AGENTS.md and tool configuration. allow-unsafe-pr-checkout: true turns
  off the protection that actions/checkout v7 has for this.
     4 | pull_request_target:
    13 | - uses: actions/checkout@v7
    15 | ref: ${{ github.event.pull_request.head.sha }}
  Fix: Check out the base branch at the workspace root (no ref:). If the agent needs the pull
       request files, check them out into a subdirectory with path: and treat them as untrusted
       data.

[HIGH] Write access and secrets in reach (write-permissions)
  .github/workflows/issue-triage.yml:9  job triage
  The token can write: issues. The agent's environment has the secrets ANTHROPIC_API_KEY and
  GITHUB_TOKEN. Anyone who can start the agent can try to make it use or leak them.
     9 | issues: write
    22 | anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    23 | github_token: ${{ secrets.GITHUB_TOKEN }}
  Fix: Give the job only the permissions it needs (for example contents: read and issues: write for
       triage) and only the secrets the agent needs. Prefer short-lived credentials such as OIDC,
       and rotate secrets this workflow could reach.

[HIGH] Anyone can start the agent (anyone-can-run)
  .github/workflows/issue-triage.yml:24  job triage, step "Triage with Claude"
  allowed_non_write_users: "*" lets any GitHub user start Claude Code Action, and the workflow runs
  on issues, which any GitHub user can fire. No condition stops them, so anyone can give the agent
  instructions while it has a token with issues write access, and the secrets ANTHROPIC_API_KEY and
  GITHUB_TOKEN.
     4 | issues:
    20 | uses: anthropics/claude-code-action@v1
    24 | allowed_non_write_users: "*"
  Fix: Remove allowed_non_write_users: "*" or list only trusted user names, so that only people with
       write access can start the agent.

[HIGH] Untrusted text in the prompt (untrusted-input)
  .github/workflows/issue-triage.yml:27  job triage, step "Triage with Claude"
  Claude Code Action gets text that outside users write: ${{ github.event.issue.title }} and ${{
  github.event.issue.body }}. A prompt injection in that text can make the agent use its tools for
  the attacker. Moving the text into env: does not help, because the agent still reads it.
    27 | Title: ${{ github.event.issue.title }}
    28 | Body: ${{ github.event.issue.body }}
  Fix: Do not put issue, pull request, comment or commit text into the prompt. Pass the number
       instead, for example ${{ github.event.issue.number }}, let the agent read the text with
       read-only tools, and treat the agent output as untrusted.

[MEDIUM] Agent runs share one checkout (shared-checkout)
  .github/workflows/codex-review.yml:26  job review, step "Write the review"
  Step "Find problems" can write files, and step "Write the review" later runs Codex Action in the
  same checkout, where it reads instruction files such as AGENTS.md. A prompt injection in the first
  run can steer the second. There is no Codex fix for this; the CSA research note recommends
  separate jobs.
    20 | uses: openai/codex-action@0123456789abcdef0123456789abcdef01234567 # v1.13
    26 | uses: openai/codex-action@0123456789abcdef0123456789abcdef01234567 # v1.13
  Fix: Run each agent pass in its own job with a fresh checkout, or make the earlier runs read-only
       (for Codex, sandbox: read-only).

[LOW] Outside users can trigger the workflow (untrusted-trigger)
  .github/workflows/codex-review.yml:20  job review, step "Find problems"
  The workflow runs on pull_request_target, which outside users can fire, and the agent only starts
  for trusted users: Codex Action checks for write access. The agent can still read text that others
  wrote.
     4 | pull_request_target:
    20 | uses: openai/codex-action@0123456789abcdef0123456789abcdef01234567 # v1.13
  Fix: Keep the gate, and keep the permissions and secrets of the job small.

[LOW] Write access and secrets in reach (write-permissions)
  .github/workflows/codex-review.yml:22  job review
  The agent's environment has the secret OPENAI_API_KEY. A prompt injection in text the agent reads
  can try to make it use or leak them.
    22 | openai-api-key: ${{ secrets.OPENAI_API_KEY }}
  Fix: Give the job only the permissions it needs (for example contents: read and issues: write for
       triage) and only the secrets the agent needs. Prefer short-lived credentials such as OIDC,
       and rotate secrets this workflow could reach.

[LOW] Agent action not pinned to a commit (unpinned-agent)
  .github/workflows/issue-triage.yml:20  job triage, step "Triage with Claude"
  anthropics/claude-code-action is used by the ref v1, which can point to different code at any
  time.
    20 | uses: anthropics/claude-code-action@v1
  Fix: Pin the action to a full commit SHA with a version comment, for example uses:
       anthropics/claude-code-action@<commit SHA> # <version>, and let Dependabot update it. GitHub
       workflow lockfiles (public preview since October 2026) can also record the exact commits.

Static analysis of workflow files only. It cannot see repository settings, such as who can open issues or which secrets exist.
```

## Checks

| Check                                          | ID                     | Severity          | Finds                                                                                                                            |
| ---------------------------------------------- | ---------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Anyone can start the agent                     | `anyone-can-run`       | high, medium      | An event that any GitHub user can fire starts the agent with no gate, or an allow-list is set to "*".                            |
| Untrusted text in the prompt                   | `untrusted-input`      | high, medium, low | Issue, pull request, comment or commit text is put into the prompt, its environment or a file that an earlier step writes.       |
| Write access and secrets in reach              | `write-permissions`    | high, medium, low | The agent job can write to the repository (or uses the default token permissions) or has secrets in its environment.             |
| Risky agent settings                           | `dangerous-settings`   | high, medium, low | Unrestricted shell tools, permission checks or sandboxes turned off, a weakened Codex safety strategy, or the GitHub MCP server. |
| Pull request code checked out before the agent | `untrusted-checkout`   | high, medium      | A privileged workflow checks out the pull request head before the agent runs, so the agent works in code that an outsider wrote. |
| Outside users can trigger the workflow         | `untrusted-trigger`    | medium, low, info | The workflow runs on events that outside users can fire; a gate limits who can start the agent.                                  |
| Outdated agent version                         | `outdated-agent`       | medium, low, info | The action, or the agent CLI it installs, is older than the versions with the August 2026 fixes.                                 |
| Agent runs share one checkout                  | `shared-checkout`      | medium, low       | Several agent steps run in one job, so a later run can read instruction files such as AGENTS.md that an earlier run wrote.       |
| Checkout keeps the token on disk               | `checkout-credentials` | medium, low       | actions/checkout runs without persist-credentials: false in a job with an agent.                                                 |
| Agent action not pinned to a commit            | `unpinned-agent`       | low               | The agent action is used by tag or branch instead of a full commit SHA.                                                          |
| Workflow could not be read                     | `parse-error`          | info              | The file is not valid YAML, is not a workflow, or has more than one YAML document.                                               |

The severity depends on who can start the agent:

- **Open:** an outside user can fire an event that has the repository's secrets (`issues`,
  `issue_comment`, `discussion`, `discussion_comment`, `pull_request_target`, or `workflow_run`
  after one of these or a pull request) and nothing stops them. Problems are high.
- **Gated:** such events exist, but something stops outside users: a job or step condition on
  `author_association` (OWNER, MEMBER or COLLABORATOR), on the actor, on a label, on the pull
  request coming from the same repository, a permission check step or job, event types that need
  triage access, or the action's own write-access check (claude-code-action, codex-action,
  opencode). Problems are medium or low, because the agent can still read text that others wrote.
- **Fork:** only `pull_request`, `pull_request_review` or `pull_request_review_comment`, which
  GitHub runs without secrets for forks. Info or low.
- **Trusted:** `push`, `schedule`, `workflow_dispatch` and similar. Only version, pinning, settings
  and shared checkout problems are reported, at low severity.

Version checks use the fixes named in the CSA research note: Claude Code 2.1.163
(claude-code-action v1.0.136 is the first release that installs it), Gemini CLI 0.39.1 or
0.40.0-preview.3, and run-gemini-cli v0.1.22. A moving major tag such as `@v1` is not reported as
outdated. For an action pinned to a commit SHA the version is read from a comment such as
`# v1.0.200`; without one it is reported as info. Codex has no fix for the shared checkout
problem; the note recommends separate jobs.

## Fixes and hardening checklist

- Start agents only for trusted users: keep the action's write-access check (do not set
  `allowed_non_write_users: "*"` or `allow-users: "*"`), or add a condition such as
  `if: contains(fromJSON('["OWNER", "MEMBER", "COLLABORATOR"]'), github.event.comment.author_association)`.
- Do not put issue, pull request or comment text into the prompt, not even through `env:`. Pass
  the number and let the agent read the text with read-only tools.
- Give the job the smallest `permissions:` it needs and only the secrets the agent needs. Prefer
  short-lived credentials such as OIDC, and rotate secrets that a vulnerable workflow could reach.
- Allow only the commands the agent needs (`--allowedTools "Bash(gh issue edit:*)"` for Claude
  Code, `coreTools` for Gemini CLI). Do not use `--dangerously-skip-permissions`, `--yolo` or
  `safety-strategy: unsafe` in workflows that outside users can start.
- Do not check out pull request code at the workspace root in `pull_request_target`,
  `issue_comment` or `workflow_run` workflows. `actions/checkout` v7 refuses fork code in
  `pull_request_target` and `workflow_run` unless `allow-unsafe-pr-checkout: true` is set; it
  does not protect `issue_comment` workflows.
- Add `persist-credentials: false` to `actions/checkout` in agent jobs.
- Run each agent pass in its own job with a fresh checkout.
- Update to the fixed versions, and pin agent actions to a full commit SHA with a version
  comment.
- Treat the agent's output as untrusted: do not run it in a shell or use it in later `${{ }}`
  expressions.

## GitHub Action

```yaml
name: AI agent checkup

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  checkup:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: MAcemek/ai-agent-checkup@v0
        with:
          fail-on: high
          sarif-file: ai-agent-checkup.sarif
      - uses: github/codeql-action/upload-sarif@v4
        if: always()
        with:
          sarif_file: ai-agent-checkup.sarif
          category: ai-agent-checkup
```

The Action writes the Markdown report to the job summary and the text report to the log. It
needs no token and does not change any file except the SARIF file you ask for. The last step
uploads the SARIF file to code scanning, which shows the problems as alerts on the lines they
are about (code scanning needs `security-events: write`). Use `path: .` (the default) when you
upload SARIF, so that the file paths match the repository.

| Input        | Default | Description                                                                      |
| ------------ | ------- | -------------------------------------------------------------------------------- |
| `path`       | `.`     | Repository directory (or one workflow file) to check, relative to the workspace. |
| `fail-on`    | `''`    | `high`, `medium`, `low` or `any`. Empty means the run never fails.               |
| `sarif-file` | `''`    | Write a SARIF 2.1.0 file to this path. Empty means no file.                      |

| Output         | Description                                                            |
| -------------- | ---------------------------------------------------------------------- |
| `high-count`   | Number of high severity problems.                                      |
| `medium-count` | Number of medium severity problems.                                    |
| `low-count`    | Number of low severity problems.                                       |
| `info-count`   | Number of info findings.                                               |
| `total-count`  | Number of problems of any severity.                                    |
| `agent-steps`  | Number of AI agent steps found.                                        |
| `report-json`  | Path to the JSON report (`$RUNNER_TEMP/ai-agent-checkup-report.json`). |
| `sarif-file`   | Path to the SARIF file, or empty.                                      |

## How it compares

- [zizmor](https://github.com/zizmorcore/zizmor) is a broad static analyzer for GitHub Actions
  workflows. A dedicated audit for AI agent actions is proposed in
  [issue #1605](https://github.com/zizmorcore/zizmor/issues/1605) but is not part of a release as
  of October 2026 (v1.31.1).
- [Aikido's Opengrep rules](https://github.com/AikidoSec/opengrep-rules) include a rule for
  untrusted expressions in `prompt:` inputs and for claude-code-action with
  `allowed_non_write_users: "*"`. They are rules only and need Opengrep to run.
- Scanners for local agent configuration check files such as `.claude/settings.json` and
  `.mcp.json` on developer machines, not CI workflows.

## Limitations

- Static analysis of workflow files only. It cannot see repository settings: who can open issues
  or discussions, whether fork pull requests need approval, the default token permissions, which
  secrets exist, or rulesets and environment protection.
- The checks are heuristics. Conditions are evaluated for an outside user; a condition it does not
  understand counts as no gate. Shell scripts are not parsed, so an agent command inside a quoted
  string can be reported.
- Untrusted text is traced through `${{ }}` expressions in the agent step, the job and workflow
  `env:` and earlier `run:` steps that write files or outputs. An agent that fetches issue text
  with its own tools is covered by the trigger and permission checks, not by `untrusted-input`.
- Reusable workflows (`workflow_call`) are checked with their own triggers, and composite actions
  are not followed.
- Version checks only know the fixes listed in `src/agents.ts`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). To report a vulnerability, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
