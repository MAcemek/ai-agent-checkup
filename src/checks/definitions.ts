import type { CheckId, Severity } from '../types.js';

export interface CheckDefinition {
  id: CheckId;
  title: string;
  /** The severities this check can report, highest first. */
  severities: Severity[];
  /** One sentence: what the check looks for. */
  summary: string;
}

/** The checks in report order. The README checks table must list them (a test checks this). */
export const CHECK_DEFINITIONS: CheckDefinition[] = [
  {
    id: 'anyone-can-run',
    title: 'Anyone can start the agent',
    severities: ['high', 'medium'],
    summary:
      'An event that any GitHub user can fire starts the agent with no gate, or an allow-list is set to "*".',
  },
  {
    id: 'untrusted-input',
    title: 'Untrusted text in the prompt',
    severities: ['high', 'medium', 'low'],
    summary:
      'Issue, pull request, comment or commit text is put into the prompt, its environment or a file that an earlier step writes.',
  },
  {
    id: 'write-permissions',
    title: 'Write access and secrets in reach',
    severities: ['high', 'medium', 'low'],
    summary:
      'The agent job can write to the repository (or uses the default token permissions) or has secrets in its environment.',
  },
  {
    id: 'dangerous-settings',
    title: 'Risky agent settings',
    severities: ['high', 'medium', 'low'],
    summary:
      'Unrestricted shell tools, permission checks or sandboxes turned off, a weakened Codex safety strategy, or the GitHub MCP server.',
  },
  {
    id: 'untrusted-checkout',
    title: 'Pull request code checked out before the agent',
    severities: ['high', 'medium'],
    summary:
      'A privileged workflow checks out the pull request head before the agent runs, so the agent works in code that an outsider wrote.',
  },
  {
    id: 'untrusted-trigger',
    title: 'Outside users can trigger the workflow',
    severities: ['medium', 'low', 'info'],
    summary:
      'The workflow runs on events that outside users can fire; a gate limits who can start the agent.',
  },
  {
    id: 'outdated-agent',
    title: 'Outdated agent version',
    severities: ['medium', 'low', 'info'],
    summary:
      'The action, or the agent CLI it installs, is older than the versions with the August 2026 fixes.',
  },
  {
    id: 'shared-checkout',
    title: 'Agent runs share one checkout',
    severities: ['medium', 'low'],
    summary:
      'Several agent steps run in one job, so a later run can read instruction files such as AGENTS.md that an earlier run wrote.',
  },
  {
    id: 'checkout-credentials',
    title: 'Checkout keeps the token on disk',
    severities: ['medium', 'low'],
    summary: 'actions/checkout runs without persist-credentials: false in a job with an agent.',
  },
  {
    id: 'unpinned-agent',
    title: 'Agent action not pinned to a commit',
    severities: ['low'],
    summary: 'The agent action is used by tag or branch instead of a full commit SHA.',
  },
  {
    id: 'parse-error',
    title: 'Workflow could not be read',
    severities: ['info'],
    summary: 'The file is not valid YAML, is not a workflow, or has more than one YAML document.',
  },
];

export function definition(id: CheckId): CheckDefinition {
  const found = CHECK_DEFINITIONS.find((d) => d.id === id);
  if (!found) throw new Error(`Unknown check ${id}`);
  return found;
}
