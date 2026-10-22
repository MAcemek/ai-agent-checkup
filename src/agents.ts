/**
 * The registry of known AI agents: GitHub Actions that run an agent, and agent CLIs that run in
 * `run:` steps. To add an agent, add an entry here and a test in test/agents.test.ts.
 * Facts were checked against each action's action.yml and source on 2026-10-21.
 */

/** Where a setting is read from: an input in `with:` or a variable in the step's `env:`. */
export type SettingSource = 'with' | 'env';

/**
 * A risky setting.
 * - `matches`: risky when the value matches `pattern`.
 * - `unless`: risky when the value is missing or does not match `pattern` (a risky default).
 * - `claude-tools`: risky when `--allowedTools` (or the v0 `allowed_tools` input) allows any
 *   shell command (`Bash`, `Bash(*)`, `Bash(*:*)` or `Bash(:*)`).
 * - `gemini-tools`: risky when the settings JSON has no `coreTools`/`excludeTools` (or
 *   `tools.core`/`tools.exclude`) list, or allows `run_shell_command` without a command.
 */
export interface SettingRule {
  source: SettingSource;
  name: string;
  test: 'matches' | 'unless' | 'claude-tools' | 'gemini-tools';
  /** For `matches` and `unless`. */
  pattern?: RegExp;
  title: string;
  explanation: string;
  fix: string;
}

/** A risky command-line flag of an agent CLI. */
export interface FlagRule {
  pattern: RegExp;
  title: string;
  explanation: string;
  fix: string;
}

export interface VersionRule {
  /** The first tag with the fix, such as "v1.0.136", or null when every tag is outdated. */
  fixedIn: string | null;
  /** Refs that are always outdated, such as old major tags. */
  outdatedRefs: RegExp | null;
  /** What the fix is, used in the explanation. */
  reason: string;
  fix: string;
}

/** An input that selects the version of the agent CLI, such as `gemini_cli_version`. */
export interface CliVersionRule {
  input: string;
  product: string;
  /** The versions with the fix (see isFixedVersion). */
  fixed: string[];
  reason: string;
}

/** A pinned install of an agent CLI in a `run:` step; group 1 of `pattern` is the version. */
export interface InstallRule {
  pattern: RegExp;
  product: string;
  fixed: string[];
  reason: string;
}

interface AgentBase {
  /** Stable id, used in JSON and SARIF output. */
  id: string;
  name: string;
  /** The file the agent reads its instructions from, such as AGENTS.md. */
  instructionFile: string | null;
  notes: string;
}

export interface ActionAgent extends AgentBase {
  kind: 'action';
  /** Lowercase `owner/repo` or `owner/repo/path` values of `uses:`. */
  uses: string[];
  /** True when the action only runs for users with write access unless an allow-list widens it. */
  actorCheck: boolean;
  /** Inputs where "*" lets any user start the agent. */
  allowListInputs: string[];
  /** An input that must be set for the allow-lists to take effect, or null. */
  allowListRequires: string | null;
  /** Inputs where "*" lets any GitHub App or bot start the agent. */
  botAllowListInputs: string[];
  settings: SettingRule[];
  versions: VersionRule | null;
  cliVersion: CliVersionRule | null;
  /** Inputs that make a run read-only (the run cannot write files), with the values that do it. */
  readOnly: { input: string; pattern: RegExp }[];
  /** Set when the action is archived or replaced: why, and what to use instead. */
  deprecated: { explanation: string; fix: string } | null;
}

export interface CliAgent extends AgentBase {
  kind: 'cli';
  /** Finds a headless run of the agent in a `run:` script. */
  command: RegExp;
  flags: FlagRule[];
  installs: InstallRule[];
}

export type AgentDefinition = ActionAgent | CliAgent;

const CLAUDE_FIXED = '2.1.163';
const GEMINI_FIXED = ['0.39.1', '0.40.0-preview.3'];
const CSA_REASON = 'the fixes from the August 2026 CSA research note';

const SKIP_PERMISSIONS: FlagRule = {
  pattern: /--dangerously-skip-permissions\b|--permission-mode[=\s]+["']?bypassPermissions\b/,
  title: 'Permission checks turned off',
  explanation:
    'The agent runs with permission checks turned off, so it can run any tool, including any shell command, without asking.',
  fix: 'Remove --dangerously-skip-permissions (or --permission-mode bypassPermissions) and allow only the tools the workflow needs with --allowedTools, for example --allowedTools "Bash(gh issue view:*)".',
};

const CLAUDE_SETTINGS: SettingRule[] = [
  { source: 'with', name: 'claude_args', test: 'matches', ...SKIP_PERMISSIONS },
  {
    source: 'with',
    name: 'claude_args',
    test: 'claude-tools',
    title: 'Unrestricted shell access',
    explanation:
      'The allowed tools include Bash without a command filter, so the agent can run any shell command.',
    fix: 'List only the commands the workflow needs, for example --allowedTools "Bash(gh issue view:*),Bash(gh issue edit:*)".',
  },
  {
    source: 'with',
    name: 'allowed_tools',
    test: 'claude-tools',
    title: 'Unrestricted shell access',
    explanation:
      'The allowed_tools input includes Bash without a command filter, so the agent can run any shell command.',
    fix: 'List only the commands the workflow needs, for example "Bash(gh issue view:*)". Version 1 of the action replaces allowed_tools with --allowedTools in claude_args.',
  },
  {
    source: 'with',
    name: 'settings',
    test: 'matches',
    pattern: /"defaultMode"\s*:\s*"bypassPermissions"|"Bash(\(\s*\*?\s*(:\s*\*)?\s*\))?"/,
    title: 'Broad permissions in settings',
    explanation:
      'The settings turn permission checks off or allow Bash without a command filter, so the agent can run any shell command.',
    fix: 'Remove "defaultMode": "bypassPermissions" and list only the commands the workflow needs, for example "Bash(gh issue view:*)".',
  },
  {
    source: 'with',
    name: 'show_full_output',
    test: 'matches',
    pattern: /^\s*true\s*$/i,
    title: 'Full agent output in the log',
    explanation:
      'show_full_output prints every tool result to the workflow log, which can include secrets. Logs of public repositories are public.',
    fix: 'Remove show_full_output or set it to false.',
  },
];

const GEMINI_TOOLS = {
  test: 'gemini-tools',
  title: 'All tools allowed in yolo mode',
  explanation:
    'The action always runs the CLI with --yolo, so every tool runs without approval. Without a coreTools list in the settings, that includes any shell command.',
  fix: 'Add a coreTools list to the settings with only the commands the workflow needs, for example "coreTools": ["run_shell_command(gh issue edit)"].',
} as const;

const CLAUDE_INSTALLS: InstallRule[] = [
  {
    pattern: /@anthropic-ai\/claude-code@v?(\d+\.\d+\.\d+[0-9A-Za-z.-]*)/,
    product: 'Claude Code',
    fixed: [CLAUDE_FIXED],
    reason: CSA_REASON,
  },
  {
    pattern:
      /claude\.ai\/install\.sh\s*\|\s*(?:ba)?sh\s+-s\s+(?:--\s+)?v?(\d+\.\d+\.\d+[0-9A-Za-z.-]*)/,
    product: 'Claude Code',
    fixed: [CLAUDE_FIXED],
    reason: CSA_REASON,
  },
];

const GEMINI_INSTALLS: InstallRule[] = [
  {
    pattern: /@google\/gemini-cli@v?(\d+\.\d+\.\d+[0-9A-Za-z.-]*)/,
    product: 'Gemini CLI',
    fixed: GEMINI_FIXED,
    reason: CSA_REASON,
  },
];

export const AGENTS: AgentDefinition[] = [
  {
    kind: 'action',
    id: 'claude-code-action',
    name: 'Claude Code Action',
    uses: ['anthropics/claude-code-action'],
    actorCheck: true,
    allowListInputs: ['allowed_non_write_users'],
    allowListRequires: 'github_token',
    botAllowListInputs: ['allowed_bots'],
    settings: [
      ...CLAUDE_SETTINGS,
      {
        source: 'env',
        name: 'CLAUDE_CODE_SUBPROCESS_ENV_SCRUB',
        test: 'matches',
        pattern: /^\s*0\s*$/,
        title: 'Secret scrubbing turned off',
        explanation:
          'When allowed_non_write_users is set, the action removes secrets from the environment of the tools it runs. CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: 0 turns that off.',
        fix: 'Remove CLAUDE_CODE_SUBPROCESS_ENV_SCRUB from env.',
      },
    ],
    versions: {
      fixedIn: 'v1.0.136',
      outdatedRefs: /^(v0(\.\d+){0,2}|beta)$/,
      reason:
        'v1.0.136 is the first release that installs Claude Code 2.1.163, which has the fixes from the August 2026 CSA research note',
      fix: 'Update to anthropics/claude-code-action v1.0.136 or later, or use @v1.',
    },
    cliVersion: null,
    readOnly: [],
    deprecated: null,
    instructionFile: 'CLAUDE.md',
    notes:
      'Checks that the actor has write access unless allowed_non_write_users or allowed_bots widen it.',
  },
  {
    kind: 'action',
    id: 'claude-code-base-action',
    name: 'Claude Code Base Action',
    uses: ['anthropics/claude-code-base-action'],
    actorCheck: false,
    allowListInputs: [],
    allowListRequires: null,
    botAllowListInputs: [],
    settings: CLAUDE_SETTINGS,
    versions: {
      fixedIn: null,
      outdatedRefs: /^(v0(\.\d+){0,2}|beta)$/,
      reason:
        'every release tag of the base action (v0.0.63 and older, and beta) predates Claude Code 2.1.163, which has the fixes from the August 2026 CSA research note',
      fix: 'Use anthropics/claude-code-action, which also checks who started the run, or pin the base action to a recent commit of its main branch.',
    },
    cliVersion: null,
    readOnly: [],
    deprecated: null,
    instructionFile: 'CLAUDE.md',
    notes:
      'No check of who started the run. The repository is a mirror of claude-code-action/base-action.',
  },
  {
    kind: 'action',
    id: 'claude-code-security-review',
    name: 'Claude Code Security Review',
    uses: ['anthropics/claude-code-security-review'],
    actorCheck: false,
    allowListInputs: [],
    allowListRequires: null,
    botAllowListInputs: [],
    settings: [],
    versions: null,
    cliVersion: null,
    readOnly: [],
    deprecated: null,
    instructionFile: 'CLAUDE.md',
    notes:
      'Its README says it is not hardened against prompt injection and should only review trusted pull requests.',
  },
  {
    kind: 'action',
    id: 'run-gemini-cli',
    name: 'Run Gemini CLI',
    uses: ['google-github-actions/run-gemini-cli'],
    actorCheck: false,
    allowListInputs: [],
    allowListRequires: null,
    botAllowListInputs: [],
    settings: [{ source: 'with', name: 'settings', ...GEMINI_TOOLS }],
    versions: {
      fixedIn: 'v0.1.22',
      outdatedRefs: null,
      reason: 'v0.1.22 has the fixes from the August 2026 CSA research note',
      fix: 'Update to google-github-actions/run-gemini-cli v0.1.22 or later, or use @v0.',
    },
    cliVersion: {
      input: 'gemini_cli_version',
      product: 'Gemini CLI',
      fixed: GEMINI_FIXED,
      reason: CSA_REASON,
    },
    readOnly: [],
    deprecated: null,
    instructionFile: 'GEMINI.md',
    notes: 'No check of who started the run. Always runs Gemini CLI with --yolo.',
  },
  {
    kind: 'action',
    id: 'gemini-cli-action',
    name: 'Gemini CLI Action (archived)',
    uses: ['google-gemini/gemini-cli-action'],
    actorCheck: false,
    allowListInputs: [],
    allowListRequires: null,
    botAllowListInputs: [],
    settings: [{ source: 'with', name: 'settings_json', ...GEMINI_TOOLS }],
    versions: null,
    cliVersion: {
      input: 'version',
      product: 'Gemini CLI',
      fixed: GEMINI_FIXED,
      reason: CSA_REASON,
    },
    readOnly: [],
    deprecated: {
      explanation: 'google-gemini/gemini-cli-action is archived and no longer receives fixes.',
      fix: 'Move to google-github-actions/run-gemini-cli v0.1.22 or later.',
    },
    instructionFile: 'GEMINI.md',
    notes: 'Archived predecessor of run-gemini-cli. No check of who started the run.',
  },
  {
    kind: 'action',
    id: 'qwen-code-action',
    name: 'Qwen Code Action',
    uses: ['qwenlm/qwen-code-action'],
    actorCheck: false,
    allowListInputs: [],
    allowListRequires: null,
    botAllowListInputs: [],
    settings: [{ source: 'with', name: 'settings', ...GEMINI_TOOLS }],
    versions: null,
    cliVersion: null,
    readOnly: [],
    deprecated: null,
    instructionFile: 'QWEN.md',
    notes:
      'Based on run-gemini-cli. No check of who started the run. Always runs Qwen Code with --yolo.',
  },
  {
    kind: 'action',
    id: 'codex-action',
    name: 'Codex Action',
    uses: ['openai/codex-action'],
    actorCheck: true,
    allowListInputs: ['allow-users'],
    allowListRequires: null,
    botAllowListInputs: [],
    settings: [
      {
        source: 'with',
        name: 'safety-strategy',
        test: 'matches',
        pattern: /^\s*unsafe\s*$/i,
        title: 'Codex runs without restrictions',
        explanation:
          'safety-strategy: unsafe keeps sudo for Codex, so it can read secrets from memory, including the OpenAI API key.',
        fix: 'Remove safety-strategy to use the default drop-sudo.',
      },
      {
        source: 'with',
        name: 'safety-strategy',
        test: 'matches',
        pattern: /^\s*read-only\s*$/i,
        title: 'Codex keeps sudo',
        explanation:
          'safety-strategy: read-only blocks writes, but Codex still runs as a user with sudo, so it can read the OpenAI API key from memory.',
        fix: 'Use the default safety-strategy drop-sudo, or unprivileged-user.',
      },
      {
        source: 'with',
        name: 'sandbox',
        test: 'matches',
        pattern: /danger-full-access/i,
        title: 'Codex sandbox turned off',
        explanation:
          'sandbox: danger-full-access turns off the Codex sandbox for files and network.',
        fix: 'Use sandbox: read-only or workspace-write, or permission-profile: ":workspace".',
      },
      {
        source: 'with',
        name: 'codex-args',
        test: 'matches',
        pattern: /--dangerously-bypass-approvals-and-sandbox\b|--yolo\b/,
        title: 'Codex sandbox and approvals turned off',
        explanation: 'The Codex arguments turn off both the sandbox and command approvals.',
        fix: 'Remove --dangerously-bypass-approvals-and-sandbox (or --yolo) from codex-args.',
      },
    ],
    versions: null,
    cliVersion: null,
    readOnly: [
      { input: 'sandbox', pattern: /^\s*read-only\s*$/i },
      { input: 'permission-profile', pattern: /^\s*:read-only\s*$/i },
      { input: 'safety-strategy', pattern: /^\s*read-only\s*$/i },
    ],
    deprecated: null,
    instructionFile: 'AGENTS.md',
    notes:
      'Checks that the actor has write access unless allow-users is "*". No fixed version for the shared checkout problem; use separate jobs.',
  },
  {
    kind: 'action',
    id: 'ai-inference',
    name: 'AI Inference',
    uses: ['actions/ai-inference'],
    actorCheck: false,
    allowListInputs: [],
    allowListRequires: null,
    botAllowListInputs: [],
    settings: [
      {
        source: 'with',
        name: 'enable-github-mcp',
        test: 'matches',
        pattern: /^\s*true\s*$/i,
        title: 'GitHub MCP server enabled',
        explanation:
          'enable-github-mcp: true gives the model GitHub tools that act with the token, so a prompt injection can read or change repository data.',
        fix: 'Remove enable-github-mcp. If the model needs GitHub data, fetch it in an earlier step with a read-only token.',
      },
      {
        source: 'with',
        name: 'copilot-allow-tools',
        test: 'matches',
        pattern: /(^|,)\s*shell(\(\s*\*?\s*\))?\s*(,|$)/i,
        title: 'Unrestricted shell access',
        explanation:
          'copilot-allow-tools allows the shell tool without a command filter, so the model can run any shell command.',
        fix: 'List only the commands the workflow needs, for example "shell(gh issue view)".',
      },
    ],
    versions: null,
    cliVersion: null,
    readOnly: [],
    deprecated: null,
    instructionFile: null,
    notes:
      'No check of who started the run. Version 3 runs the GitHub Copilot CLI; version 2 had enable-github-mcp.',
  },
  {
    kind: 'action',
    id: 'copilot-cli-action',
    name: 'Copilot CLI (austenstone/copilot-cli)',
    uses: ['austenstone/copilot-cli'],
    actorCheck: false,
    allowListInputs: [],
    allowListRequires: null,
    botAllowListInputs: [],
    settings: [
      {
        source: 'with',
        name: 'allow-all-tools',
        test: 'unless',
        pattern: /^\s*false\s*$/i,
        title: 'All tools allowed',
        explanation:
          'This action allows every Copilot CLI tool without approval by default (allow-all-tools: true), including any shell command.',
        fix: 'Set allow-all-tools: false and list the tools the workflow needs in allowed-tools.',
      },
      {
        source: 'with',
        name: 'enable-all-github-mcp-tools',
        test: 'matches',
        pattern: /^\s*true\s*$/i,
        title: 'All GitHub MCP tools enabled',
        explanation:
          'enable-all-github-mcp-tools: true gives the model every GitHub tool, including tools that change repository data.',
        fix: 'Remove enable-all-github-mcp-tools and add only the toolsets the workflow needs.',
      },
    ],
    versions: null,
    cliVersion: null,
    readOnly: [],
    deprecated: null,
    instructionFile: 'AGENTS.md',
    notes: 'Community action. No check of who started the run.',
  },
  {
    kind: 'action',
    id: 'opencode-action',
    name: 'opencode GitHub Action',
    uses: ['anomalyco/opencode/github', 'sst/opencode/github'],
    actorCheck: true,
    allowListInputs: [],
    allowListRequires: null,
    botAllowListInputs: [],
    settings: [],
    versions: null,
    cliVersion: null,
    readOnly: [],
    deprecated: null,
    instructionFile: 'AGENTS.md',
    notes: 'Checks that the actor has write access.',
  },
  {
    kind: 'cli',
    id: 'claude-cli',
    name: 'Claude Code CLI',
    command:
      /(?:^|[\s;&|(`])(?:npx\s+(?:-y\s+|--yes\s+)?@anthropic-ai\/claude-code(?:@\S+)?|claude)\s+(?:[^\n]*\s)?(?:-p|--print)(?=\s|$)/m,
    flags: [SKIP_PERMISSIONS],
    installs: CLAUDE_INSTALLS,
    instructionFile: 'CLAUDE.md',
    notes: 'claude -p (or --print) in a run: step.',
  },
  {
    kind: 'cli',
    id: 'codex-cli',
    name: 'Codex CLI',
    command:
      /(?:^|[\s;&|(`])(?:npx\s+(?:-y\s+|--yes\s+)?@openai\/codex(?:@\S+)?|codex)\s+(?:[^\n]*\s)?exec(?=\s|$)/m,
    flags: [
      {
        pattern:
          /--dangerously-bypass-approvals-and-sandbox\b|--yolo\b|(?:--sandbox|-s)[=\s]+["']?danger-full-access\b/,
        title: 'Codex sandbox turned off',
        explanation:
          'Codex runs without its sandbox, so it can change any file and use the network.',
        fix: 'Remove --dangerously-bypass-approvals-and-sandbox (or --yolo, or --sandbox danger-full-access) and use --sandbox read-only or workspace-write.',
      },
    ],
    installs: [],
    instructionFile: 'AGENTS.md',
    notes: 'codex exec in a run: step.',
  },
  {
    kind: 'cli',
    id: 'gemini-cli',
    name: 'Gemini CLI',
    command:
      /(?:^|[\s;&|(`])(?:npx\s+(?:-y\s+|--yes\s+)?@google\/gemini-cli(?:@\S+)?|gemini)\s+(?:[^\n]*\s)?(?:-p|--prompt)(?=[\s=]|$)/m,
    flags: [
      {
        pattern: /(?:^|\s)(?:--yolo|-y)(?=\s|$)|--approval-mode[=\s]+["']?yolo\b/m,
        title: 'All tools allowed in yolo mode',
        explanation:
          'Gemini CLI runs in yolo mode, so every tool runs without approval, including any shell command.',
        fix: 'Remove --yolo and allow only the tools the workflow needs with coreTools in .gemini/settings.json.',
      },
    ],
    installs: GEMINI_INSTALLS,
    instructionFile: 'GEMINI.md',
    notes: 'gemini -p (or --prompt) in a run: step.',
  },
  {
    kind: 'cli',
    id: 'copilot-cli',
    name: 'GitHub Copilot CLI',
    command:
      /(?:^|[\s;&|(`])(?:npx\s+(?:-y\s+|--yes\s+)?@github\/copilot(?:@\S+)?|copilot)\s+(?:[^\n]*\s)?(?:-p|--prompt)(?=[\s=]|$)/m,
    flags: [
      {
        pattern: /--allow-all-tools\b|--allow-all\b|--yolo\b/,
        title: 'All tools allowed',
        explanation:
          'Copilot CLI runs with every tool allowed without approval, including any shell command.',
        fix: 'Replace --allow-all-tools (or --allow-all, --yolo) with --allow-tool for each command the workflow needs.',
      },
    ],
    installs: [],
    instructionFile: 'AGENTS.md',
    notes: 'copilot -p (or --prompt) in a run: step.',
  },
  {
    kind: 'cli',
    id: 'cursor-cli',
    name: 'Cursor CLI',
    command: /(?:^|[\s;&|(`])cursor-agent\s+(?:[^\n]*\s)?(?:-p|--print)(?=\s|$)/m,
    flags: [
      {
        pattern: /(?:^|\s)(?:--force|-f|--yolo)(?=\s|$)/m,
        title: 'Commands allowed without approval',
        explanation:
          'cursor-agent runs with --force, so it runs commands and writes files without approval.',
        fix: 'Remove --force and let later workflow steps apply the changes the agent proposes.',
      },
    ],
    installs: [],
    instructionFile: 'AGENTS.md',
    notes: 'cursor-agent -p (or --print) in a run: step.',
  },
  {
    kind: 'cli',
    id: 'aider',
    name: 'Aider',
    command: /(?:^|[\s;&|(`])aider\s+(?:[^\n]*\s)?(?:--message|-m|--message-file)(?=[\s=]|$)/m,
    flags: [
      {
        pattern: /--yes-always\b/,
        title: 'Every question answered with yes',
        explanation:
          'aider runs with --yes-always, so it confirms every action, including running shell commands.',
        fix: 'Remove --yes-always.',
      },
    ],
    installs: [],
    instructionFile: null,
    notes: 'aider --message in a run: step.',
  },
  {
    kind: 'cli',
    id: 'qwen-cli',
    name: 'Qwen Code CLI',
    command: /(?:^|[\s;&|(`])qwen\s+(?:[^\n]*\s)?(?:-p|--prompt)(?=[\s=]|$)/m,
    flags: [
      {
        pattern: /(?:^|\s)(?:--yolo|-y)(?=\s|$)|--approval-mode[=\s]+["']?yolo\b/m,
        title: 'All tools allowed in yolo mode',
        explanation:
          'Qwen Code runs in yolo mode, so every tool runs without approval, including any shell command.',
        fix: 'Remove --yolo and allow only the tools the workflow needs in .qwen/settings.json.',
      },
    ],
    installs: [],
    instructionFile: 'QWEN.md',
    notes: 'qwen -p (or --prompt) in a run: step.',
  },
  {
    kind: 'cli',
    id: 'opencode-cli',
    name: 'opencode CLI',
    command: /(?:^|[\s;&|(`])opencode\s+run(?=\s|$)/m,
    flags: [],
    installs: [],
    instructionFile: 'AGENTS.md',
    notes: 'opencode run in a run: step.',
  },
];

/** The action agent for a `uses:` value ("owner/repo[/path]@ref"), or undefined. */
export function findActionAgent(uses: string): ActionAgent | undefined {
  const at = uses.indexOf('@');
  if (at <= 0 || uses.startsWith('./') || uses.startsWith('docker://')) return undefined;
  const slug = uses.slice(0, at).trim().toLowerCase();
  return AGENTS.find(
    (agent): agent is ActionAgent => agent.kind === 'action' && agent.uses.includes(slug),
  );
}

/** The ref of a `uses:` value: "anthropics/claude-code-action@v1" gives "v1". */
export function usesRef(uses: string): string {
  const at = uses.indexOf('@');
  return at < 0 ? '' : uses.slice(at + 1).trim();
}

/** The CLI agents that a `run:` script starts. */
export function findCliAgents(script: string): CliAgent[] {
  return AGENTS.filter(
    (agent): agent is CliAgent => agent.kind === 'cli' && agent.command.test(script),
  );
}
