# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-10-22

### Added

- First release of ai-agent-checkup, a CLI (`npx ai-agent-checkup`) and GitHub Action that check
  workflows running AI coding agents for prompt injection paths to secrets and write access.
- Eleven checks: anyone can start the agent, untrusted text in the prompt, write access and
  secrets in reach, risky agent settings, pull request code checked out before the agent,
  outside users can trigger the workflow, outdated agent version, agent runs sharing one
  checkout, checkout keeping the token on disk, agent action not pinned to a commit, and
  workflows that could not be read.
- A registry of agent actions (claude-code-action, claude-code-base-action,
  claude-code-security-review, run-gemini-cli, gemini-cli-action, qwen-code-action,
  codex-action, ai-inference, copilot-cli, opencode) and agent CLIs in `run:` steps, shown with
  `--list-agents`.
- Severities that depend on who can start the agent, with recognition of common gates:
  `author_association`, actor and label conditions, same-repository checks, permission check
  steps and jobs, event types that need triage access, and the actions' own write-access checks.
- Version checks for the fixes named in the August 2026 CSA research note.
- Text, Markdown, JSON and SARIF 2.1.0 output, `--fail-on high|medium|low|any` and `--output`.
- Offline `npm run demo` against example workflows.
