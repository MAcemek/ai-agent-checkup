## AI agent workflow checkup

- Path: `test/fixtures/repos/demo`
- Scanned 2 workflows with 3 agent steps.
- ai-agent-checkup 0.1.0

**Found 8 problems: 4 high, 1 medium, 3 low, 0 info.**

| Severity | Problem | Location | Details |
| --- | --- | --- | --- |
| High | Pull request code checked out before the agent (`untrusted-checkout`) | `.github/workflows/codex-review.yml:15` job review, step "actions/checkout@v7" | This pull_request_target workflow checks out the pull request head (ref: ${{ github.event.pull_request.head.sha }}) into the workspace root before Codex Action runs. The run has the repository's secrets, and the agent works in files an outsider controls, including instruction files such as AGENTS.md and tool configuration. allow-unsafe-pr-checkout: true turns off the protection that actions/checkout v7 has for this. |
| High | Write access and secrets in reach (`write-permissions`) | `.github/workflows/issue-triage.yml:9` job triage | The token can write: issues. The agent's environment has the secrets ANTHROPIC_API_KEY and GITHUB_TOKEN. Anyone who can start the agent can try to make it use or leak them. |
| High | Anyone can start the agent (`anyone-can-run`) | `.github/workflows/issue-triage.yml:24` job triage, step "Triage with Claude" | allowed_non_write_users: "*" lets any GitHub user start Claude Code Action, and the workflow runs on issues, which any GitHub user can fire. No condition stops them, so anyone can give the agent instructions while it has a token with issues write access, and the secrets ANTHROPIC_API_KEY and GITHUB_TOKEN. |
| High | Untrusted text in the prompt (`untrusted-input`) | `.github/workflows/issue-triage.yml:27` job triage, step "Triage with Claude" | Claude Code Action gets text that outside users write: ${{ github.event.issue.title }} and ${{ github.event.issue.body }}. A prompt injection in that text can make the agent use its tools for the attacker. Moving the text into env: does not help, because the agent still reads it. |
| Medium | Agent runs share one checkout (`shared-checkout`) | `.github/workflows/codex-review.yml:26` job review, step "Write the review" | Step "Find problems" can write files, and step "Write the review" later runs Codex Action in the same checkout, where it reads instruction files such as AGENTS.md. A prompt injection in the first run can steer the second. There is no Codex fix for this; the CSA research note recommends separate jobs. |
| Low | Outside users can trigger the workflow (`untrusted-trigger`) | `.github/workflows/codex-review.yml:20` job review, step "Find problems" | The workflow runs on pull_request_target, which outside users can fire, and the agent only starts for trusted users: Codex Action checks for write access. The agent can still read text that others wrote. |
| Low | Write access and secrets in reach (`write-permissions`) | `.github/workflows/codex-review.yml:22` job review | The agent's environment has the secret OPENAI_API_KEY. A prompt injection in text the agent reads can try to make it use or leak them. |
| Low | Agent action not pinned to a commit (`unpinned-agent`) | `.github/workflows/issue-triage.yml:20` job triage, step "Triage with Claude" | anthropics/claude-code-action is used by the ref v1, which can point to different code at any time. |

### How to fix

- **Pull request code checked out before the agent** (`.github/workflows/codex-review.yml:15`): Check out the base branch at the workspace root (no ref:). If the agent needs the pull request files, check them out into a subdirectory with path: and treat them as untrusted data.
- **Write access and secrets in reach** (`.github/workflows/issue-triage.yml:9`): Give the job only the permissions it needs (for example contents: read and issues: write for triage) and only the secrets the agent needs. Prefer short-lived credentials such as OIDC, and rotate secrets this workflow could reach.
- **Anyone can start the agent** (`.github/workflows/issue-triage.yml:24`): Remove allowed_non_write_users: "*" or list only trusted user names, so that only people with write access can start the agent.
- **Untrusted text in the prompt** (`.github/workflows/issue-triage.yml:27`): Do not put issue, pull request, comment or commit text into the prompt. Pass the number instead, for example ${{ github.event.issue.number }}, let the agent read the text with read-only tools, and treat the agent output as untrusted.
- **Agent runs share one checkout** (`.github/workflows/codex-review.yml:26`): Run each agent pass in its own job with a fresh checkout, or make the earlier runs read-only (for Codex, sandbox: read-only).
- **Outside users can trigger the workflow** (`.github/workflows/codex-review.yml:20`): Keep the gate, and keep the permissions and secrets of the job small.
- **Write access and secrets in reach** (`.github/workflows/codex-review.yml:22`): Give the job only the permissions it needs (for example contents: read and issues: write for triage) and only the secrets the agent needs. Prefer short-lived credentials such as OIDC, and rotate secrets this workflow could reach.
- **Agent action not pinned to a commit** (`.github/workflows/issue-triage.yml:20`): Pin the action to a full commit SHA with a version comment, for example uses: anthropics/claude-code-action@&lt;commit SHA&gt; # &lt;version&gt;, and let Dependabot update it. GitHub workflow lockfiles (public preview since October 2026) can also record the exact commits.

_Static analysis of workflow files only. It cannot see repository settings, such as who can open issues or which secrets exist._
