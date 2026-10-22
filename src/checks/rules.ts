import { AGENTS, type ActionAgent, type SettingRule } from '../agents.js';
import { isFixedVersion, parseVersion, compareVersions } from '../semver.js';
import type { CheckId, Evidence, Finding, Severity } from '../types.js';
import { stepLabel, type Job, type KeyValue, type Step, type Workflow } from '../workflow/model.js';
import {
  COMMENT_EVENTS,
  envVar,
  findLine,
  input,
  maxExposure,
  untrustedTriggers,
  type AgentStep,
  type EventReach,
  type Exposure,
} from './context.js';
import { definition } from './definitions.js';

/** Expressions with text that outside users write. */
export const UNTRUSTED_EXPRESSIONS: RegExp[] = [
  /\bgithub\.event\.(issue|pull_request|comment|review|review_comment|discussion|discussion_comment)\.(title|body)\b/i,
  /\bgithub\.event\.pull_request\.head\.(ref|label)\b/i,
  /\bgithub\.head_ref\b/i,
  /\bgithub\.event\.(commits\[\*\]|commits\.\*|head_commit)\.(message|author\.name|author\.email)\b/i,
  /\bgithub\.event\.workflow_run\.(head_branch|display_title|head_commit\.message|head_commit\.author\.(name|email))\b/i,
  /\btoJSON\(\s*github\.event(\.(issue|pull_request|comment|review|review_comment|discussion|discussion_comment))?\s*\)/i,
];

const MAX_EVIDENCE_TEXT = 80;

export function shorten(text: string): string {
  return text.length <= MAX_EVIDENCE_TEXT ? text : `${text.slice(0, MAX_EVIDENCE_TEXT - 3)}...`;
}

/** "a", "a and b", "a, b and c". */
export function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`;
}

function evidenceAt(workflow: Workflow, lines: number[]): Evidence[] {
  return [...new Set(lines)]
    .sort((a, b) => a - b)
    .map((line) => ({
      file: workflow.file,
      line,
      text: shorten((workflow.lines[line - 1] ?? '').trim()),
    }));
}

interface FindingInput {
  id: CheckId;
  severity: Severity;
  title?: string;
  explanation: string;
  fix: string;
  workflow: Workflow;
  line: number;
  job: Job | null;
  step: Step | null;
  agent: string | null;
  lines: number[];
}

function finding(input: FindingInput): Finding {
  return {
    id: input.id,
    severity: input.severity,
    title: input.title ?? definition(input.id).title,
    explanation: input.explanation,
    fix: input.fix,
    file: input.workflow.file,
    line: input.line,
    job: input.job?.id ?? null,
    step: input.step ? stepLabel(input.step) : null,
    agent: input.agent,
    evidence: evidenceAt(input.workflow, [input.line, ...input.lines]),
  };
}

/** The `${{ }}` blocks in a value that contain text outside users write. */
export function untrustedExpressions(value: string): string[] {
  const found: string[] = [];
  for (const match of value.matchAll(/\$\{\{([\s\S]*?)\}\}/g)) {
    const inner = match[1] ?? '';
    if (UNTRUSTED_EXPRESSIONS.some((pattern) => pattern.test(inner))) {
      found.push(`\${{ ${inner.trim().replace(/\s+/g, ' ')} }}`);
    }
  }
  return found;
}

interface Located {
  text: string;
  line: number;
}

/** Untrusted expressions in key-values, with the line of each. */
function locate(workflow: Workflow, values: KeyValue[]): Located[] {
  return values.flatMap((kv) =>
    untrustedExpressions(kv.value).map((text) => {
      const needle = text.slice(4, -3).trim().split(/[\s(]/)[0] ?? text;
      return { text, line: findLine(workflow.lines, kv.line, kv.endLine, needle) };
    }),
  );
}

// ----- shared facts -----

export interface Reach {
  /** Write scopes of the token, "write-all", or "default" when there is no permissions block. */
  writes: string[];
  writeLines: number[];
  /** Secret names (and github.token) in the agent's environment. */
  secrets: string[];
  secretLines: number[];
}

/** The token permissions of a job and the secrets in the environment of the given steps. */
export function reachOf(workflow: Workflow, job: Job, steps: AgentStep[]): Reach {
  const permissions = job.permissions ?? workflow.permissions;
  let writes: string[] = [];
  let writeLines: number[] = [];
  if (permissions === null) {
    writes = ['default'];
    writeLines = [job.line];
  } else if (permissions.kind === 'all') {
    if (permissions.access.trim().toLowerCase() === 'write-all') {
      writes = ['write-all'];
      writeLines = [permissions.line];
    }
  } else {
    const scopes = permissions.scopes.filter((s) => s.access.trim().toLowerCase() === 'write');
    writes = scopes.map((s) => s.scope);
    writeLines = scopes.map((s) => s.line);
  }
  const secrets = new Map<string, number>();
  const values = [
    ...steps.flatMap((s) => [...s.step.with, ...s.step.env, ...(s.step.run ? [s.step.run] : [])]),
    ...job.env,
    ...workflow.env,
  ];
  for (const kv of values) {
    for (const match of kv.value.matchAll(/\$\{\{([\s\S]*?)\}\}/g)) {
      for (const name of (match[1] ?? '').matchAll(/\b(secrets\.[A-Za-z0-9_]+|github\.token)\b/g)) {
        const ref = name[1] ?? '';
        const key = ref === 'github.token' ? 'GITHUB_TOKEN' : ref.slice('secrets.'.length);
        if (!secrets.has(key)) secrets.set(key, findLine(workflow.lines, kv.line, kv.endLine, ref));
      }
    }
  }
  return {
    writes,
    writeLines,
    secrets: [...secrets.keys()],
    secretLines: [...secrets.values()],
  };
}

function hasReach(reach: Reach): boolean {
  return reach.writes.length > 0 || reach.secrets.length > 0;
}

/** "the secret A" or "the secrets A and B". */
function secretsText(names: string[]): string {
  return `${names.length === 1 ? 'the secret' : 'the secrets'} ${joinList(names)}`;
}

function reachText(reach: Reach): string {
  const token = reach.writes.includes('default')
    ? 'the default token permissions'
    : reach.writes.length > 0
      ? `a token with ${joinList(reach.writes)} write access`
      : '';
  const secrets = reach.secrets.length > 0 ? secretsText(reach.secrets) : '';
  return token && secrets ? `${token}, and ${secrets}` : token || secrets;
}

function eventList(events: EventReach[]): string {
  return joinList([...new Set(events.map((e) => e.event))]);
}

// ----- anyone-can-run -----

const ASSOCIATION_FIELD: Record<string, string> = {
  issues: 'github.event.issue.author_association',
  issue_comment: 'github.event.comment.author_association',
  discussion: 'github.event.discussion.author_association',
  discussion_comment: 'github.event.comment.author_association',
  pull_request_target: 'github.event.pull_request.author_association',
};

export function anyoneCanRun(s: AgentStep, reach: Reach): Finding[] {
  const common = {
    id: 'anyone-can-run' as const,
    workflow: s.workflow,
    job: s.job,
    step: s.step,
    agent: s.agent.id,
  };
  if (s.exposure === 'open') {
    const open = s.events.filter((e) => e.cls === 'privileged' && e.gates.length === 0);
    const reason = s.wildcard
      ? `${s.wildcard.key}: "*" lets any GitHub user start ${s.agent.name}`
      : s.agent.kind === 'action'
        ? `${s.agent.name} does not check who started the run`
        : `${s.agent.name} runs in a run: step, which does not check who started the run`;
    const access = hasReach(reach) ? ` while it has ${reachText(reach)}` : '';
    const field = ASSOCIATION_FIELD[open[0]?.event ?? ''];
    const fix = s.wildcard
      ? `Remove ${s.wildcard.key}: "*" or list only trusted user names, so that only people with write access can start the agent.`
      : field
        ? `Add a condition that only lets trusted users start the agent, for example if: contains(fromJSON('["OWNER", "MEMBER", "COLLABORATOR"]'), ${field}), or start it with a label that only maintainers can add.`
        : `Add a condition that only lets trusted users start the agent, for example a check of github.triggering_actor, or start it with workflow_dispatch.`;
    return [
      finding({
        ...common,
        severity: hasReach(reach) ? 'high' : 'medium',
        explanation: `${reason}, and the workflow runs on ${eventList(open)}, which any GitHub user can fire. No condition stops them, so anyone can give the agent instructions${access}.`,
        fix,
        line: s.wildcard?.line ?? s.line,
        lines: [s.line, ...open.map((e) => e.line)],
      }),
    ];
  }
  if (s.botWildcard && s.events.some((e) => e.cls === 'privileged')) {
    return [
      finding({
        ...common,
        severity: 'medium',
        explanation: `${s.botWildcard.key}: "*" lets any GitHub App or bot start ${s.agent.name}, without a check of its access. Anyone can create an App and use it to open issues or comment on a public repository.`,
        fix: `List only the bots you trust in ${s.botWildcard.key}.`,
        line: s.botWildcard.line,
        lines: [s.line],
      }),
    ];
  }
  return [];
}

// ----- untrusted-input -----

function writesFiles(script: string): boolean {
  return />|\btee\b|GITHUB_ENV|GITHUB_OUTPUT/.test(script);
}

export function untrustedInput(s: AgentStep, reach: Reach): Finding[] {
  if (s.exposure === 'none') return [];
  const direct = locate(s.workflow, [
    ...s.step.with,
    ...s.step.env,
    ...(s.agent.kind === 'cli' && s.step.run ? [s.step.run] : []),
    ...s.job.env,
    ...s.workflow.env,
  ]);
  const writers = s.job.steps
    .slice(0, s.step.index)
    .filter((step) => step.run && writesFiles(step.run.value))
    .map((step) => ({
      step,
      found: locate(s.workflow, [...(step.run ? [step.run] : []), ...step.env]),
    }))
    .filter((w) => w.found.length > 0);
  const all = [...direct, ...writers.flatMap((w) => w.found)];
  if (all.length === 0) return [];
  const severity: Severity =
    s.exposure === 'open'
      ? hasReach(reach)
        ? 'high'
        : 'medium'
      : s.exposure === 'gated'
        ? reach.writes.length > 0
          ? 'medium'
          : 'low'
        : 'low';
  const texts = [...new Set(all.map((a) => a.text))];
  const shown = texts.length > 3 ? [...texts.slice(0, 3), `${texts.length - 3} more`] : texts;
  const through =
    writers.length > 0
      ? `, partly through a file or variable that ${joinList(writers.map((w) => `step "${stepLabel(w.step)}"`))} writes`
      : '';
  return [
    finding({
      id: 'untrusted-input',
      severity,
      explanation: `${s.agent.name} gets text that outside users write: ${joinList(shown)}${through}. A prompt injection in that text can make the agent use its tools for the attacker. Moving the text into env: does not help, because the agent still reads it.`,
      fix: 'Do not put issue, pull request, comment or commit text into the prompt. Pass the number instead, for example ${{ github.event.issue.number }}, let the agent read the text with read-only tools, and treat the agent output as untrusted.',
      workflow: s.workflow,
      line: all[0]?.line ?? s.line,
      job: s.job,
      step: s.step,
      agent: s.agent.id,
      lines: all.map((a) => a.line),
    }),
  ];
}

// ----- write-permissions -----

export function writePermissions(workflow: Workflow, job: Job, steps: AgentStep[]): Finding[] {
  const exposure = maxExposure(steps);
  if (exposure !== 'open' && exposure !== 'gated') return [];
  const reach = reachOf(workflow, job, steps);
  const writes = reach.writes.length > 0;
  if (!writes && reach.secrets.length === 0) return [];
  const severity: Severity =
    exposure === 'open' ? (writes ? 'high' : 'medium') : writes ? 'medium' : 'low';
  const parts: string[] = [];
  if (reach.writes.includes('default')) {
    parts.push(
      'The job has no permissions block, so the token gets the default permissions of the repository, which can include write access (read and write was the default for repositories created before February 2023).',
    );
  } else if (writes) {
    parts.push(`The token can write: ${joinList(reach.writes)}.`);
  }
  if (reach.secrets.length > 0) {
    parts.push(`The agent's environment has ${secretsText(reach.secrets)}.`);
  }
  parts.push(
    exposure === 'open'
      ? 'Anyone who can start the agent can try to make it use or leak them.'
      : 'A prompt injection in text the agent reads can try to make it use or leak them.',
  );
  return [
    finding({
      id: 'write-permissions',
      severity,
      explanation: parts.join(' '),
      fix: 'Give the job only the permissions it needs (for example contents: read and issues: write for triage) and only the secrets the agent needs. Prefer short-lived credentials such as OIDC, and rotate secrets this workflow could reach.',
      workflow,
      line: reach.writeLines[0] ?? reach.secretLines[0] ?? job.line,
      job,
      step: null,
      agent: steps[0]?.agent.id ?? null,
      lines: [...reach.writeLines, ...reach.secretLines],
    }),
  ];
}

// ----- dangerous-settings -----

/** Splits a tool list at commas and spaces outside parentheses. */
export function toolTokens(text: string): string[] {
  const tokens: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && /[,\s"']/.test(ch)) {
      if (current !== '') tokens.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current !== '') tokens.push(current);
  return tokens;
}

const UNRESTRICTED_BASH = /^Bash(\(\s*(\*|\*\s*:\s*\*|:\s*\*)?\s*\))?$/;

/** True when a tool list (or the --allowedTools flags in claude_args) allows any Bash command. */
export function allowsAnyBash(value: string, fromArgs: boolean): boolean {
  if (!fromArgs) return toolTokens(value).some((t) => UNRESTRICTED_BASH.test(t));
  const tokens = toolTokens(value.replace(/=/g, ' '));
  let inList = false;
  for (const token of tokens) {
    if (token === '--allowedTools' || token === '--allowed-tools') {
      inList = true;
      continue;
    }
    if (token.startsWith('-')) {
      inList = false;
      continue;
    }
    if (inList && UNRESTRICTED_BASH.test(token)) return true;
  }
  return false;
}

const GEMINI_RESTRICTION = /"(coreTools|excludeTools|core|exclude)"\s*:/;
const GEMINI_BARE_SHELL = /"(run_shell_command|ShellTool)(\(\s*\*?\s*\))?"/;

/** Why Gemini or Qwen settings allow any shell command, or null when they do not. */
export function geminiToolsProblem(settings: string | undefined): 'missing' | 'shell' | null {
  if (settings === undefined || !GEMINI_RESTRICTION.test(settings)) return 'missing';
  return GEMINI_BARE_SHELL.test(settings) ? 'shell' : null;
}

function exposureSeverity(exposure: Exposure): Severity {
  if (exposure === 'open') return 'high';
  if (exposure === 'gated') return 'medium';
  return 'low';
}

function settingValue(s: AgentStep, rule: SettingRule): KeyValue | undefined {
  if (rule.source === 'with') return input(s.step, rule.name);
  return (
    envVar(s.step, rule.name) ??
    s.job.env.find((e) => e.key === rule.name) ??
    s.workflow.env.find((e) => e.key === rule.name)
  );
}

function actionSetting(
  s: AgentStep,
  rule: SettingRule,
): { line: number; explanation: string } | null {
  const kv = settingValue(s, rule);
  const at = (needle: string) =>
    kv ? findLine(s.workflow.lines, kv.line, kv.endLine, needle) : s.line;
  switch (rule.test) {
    case 'matches': {
      if (!kv || !rule.pattern) return null;
      const match = rule.pattern.exec(kv.value);
      return match
        ? { line: at(match[0].trim() || rule.name), explanation: rule.explanation }
        : null;
    }
    case 'unless':
      if (kv && rule.pattern?.test(kv.value)) return null;
      return { line: kv?.line ?? s.line, explanation: rule.explanation };
    case 'claude-tools':
      if (!kv || !allowsAnyBash(kv.value, rule.name === 'claude_args')) return null;
      return { line: at('Bash'), explanation: rule.explanation };
    case 'gemini-tools': {
      const problem = geminiToolsProblem(kv?.value);
      if (problem === null) return null;
      if (problem === 'missing') return { line: kv?.line ?? s.line, explanation: rule.explanation };
      return {
        line: at('run_shell_command'),
        explanation:
          'The action always runs the CLI with --yolo, and the coreTools list allows run_shell_command without a command, so the agent can run any shell command.',
      };
    }
  }
}

export function dangerousSettings(s: AgentStep): Finding[] {
  const severity = exposureSeverity(s.exposure);
  const common = {
    id: 'dangerous-settings' as const,
    severity,
    workflow: s.workflow,
    job: s.job,
    step: s.step,
    agent: s.agent.id,
  };
  const findings: Finding[] = [];
  if (s.agent.kind === 'action') {
    const seen = new Set<string>();
    for (const rule of s.agent.settings) {
      const hit = actionSetting(s, rule);
      if (!hit || seen.has(rule.title)) continue;
      seen.add(rule.title);
      findings.push(
        finding({
          ...common,
          title: rule.title,
          explanation: hit.explanation,
          fix: rule.fix,
          line: hit.line,
          lines: [s.line],
        }),
      );
    }
  } else if (s.step.run) {
    const run = s.step.run;
    for (const flag of s.agent.flags) {
      const match = flag.pattern.exec(run.value);
      if (!match) continue;
      findings.push(
        finding({
          ...common,
          title: flag.title,
          explanation: flag.explanation,
          fix: flag.fix,
          line: findLine(s.workflow.lines, run.line, run.endLine, match[0].trim()),
          lines: [s.line],
        }),
      );
    }
  }
  return findings;
}

// ----- untrusted-checkout -----

const PR_HEAD_REF =
  /github\.event\.pull_request\.head\.(sha|ref)|github\.head_ref|refs\/pull\/|github\.event\.workflow_run\.head_(sha|branch)|github\.event\.issue\.number|steps\.[^}]*\.outputs\.[^}]*head/i;
const PR_HEAD_REPO =
  /github\.event\.pull_request\.head\.repo\.full_name|github\.event\.workflow_run\.head_repository\.full_name/i;
const HEAD_CHECKOUT_EVENTS = ['pull_request_target', 'issue_comment', 'workflow_run'];

export function isCheckout(step: Step): boolean {
  return (step.uses?.value.toLowerCase() ?? '').startsWith('actions/checkout@');
}

/** Events where actions/checkout v7 and later refuse fork pull request code by default. */
const CHECKOUT_PROTECTED_EVENTS = ['pull_request_target', 'workflow_run'];

/** The major version of actions/checkout from its ref or version comment, or null. */
export function checkoutMajor(step: Step): number | null {
  const uses = step.uses;
  if (!uses) return null;
  const ref = uses.value.slice(uses.value.indexOf('@') + 1);
  const version = SHA.test(ref) ? commentVersion(uses.comment) : ref;
  const match = /^v?(\d+)/.exec(version ?? '');
  return match ? Number(match[1]) : null;
}

export function untrustedCheckout(
  workflow: Workflow,
  job: Job,
  steps: AgentStep[],
  all: Workflow[],
): Finding[] {
  const events = untrustedTriggers(workflow, all)
    .map((t) => t.trigger)
    .filter((t) => HEAD_CHECKOUT_EVENTS.includes(t.event));
  if (events.length === 0) return [];
  const exposure = maxExposure(steps);
  if (exposure !== 'open' && exposure !== 'gated') return [];
  const lastAgent = Math.max(...steps.map((s) => s.step.index));
  const findings: Finding[] = [];
  for (const step of job.steps.slice(0, lastAgent)) {
    if (!isCheckout(step)) continue;
    const ref = input(step, 'ref');
    const repo = input(step, 'repository');
    const head =
      ref && PR_HEAD_REF.test(ref.value)
        ? ref
        : repo && PR_HEAD_REPO.test(repo.value)
          ? repo
          : null;
    if (!head) continue;
    const unsafe = /^\s*true\s*$/i.test(input(step, 'allow-unsafe-pr-checkout')?.value ?? '');
    const protectedByCheckout = (checkoutMajor(step) ?? 0) >= 7 && !unsafe;
    const reached = protectedByCheckout
      ? events.filter((e) => !CHECKOUT_PROTECTED_EVENTS.includes(e.event))
      : events;
    if (reached.length === 0) continue;
    const optOut = unsafe
      ? ' allow-unsafe-pr-checkout: true turns off the protection that actions/checkout v7 has for this.'
      : '';
    const path = input(step, 'path');
    const atRoot = !path || path.value.trim() === '' || path.value.trim() === '.';
    const agent = steps.find((s) => s.step.index > step.index) ?? steps[0];
    const file = agent?.agent.instructionFile ?? 'AGENTS.md';
    findings.push(
      finding({
        id: 'untrusted-checkout',
        severity: atRoot ? 'high' : 'medium',
        explanation: `This ${joinList(reached.map((e) => e.event))} workflow checks out the pull request head (${head.key}: ${shorten(head.value.trim())}) ${atRoot ? 'into the workspace root' : `into ${path?.value.trim() ?? ''}`} before ${agent?.agent.name ?? 'the agent'} runs. The run has the repository's secrets, and the agent works in files an outsider controls, including instruction files such as ${file} and tool configuration.${optOut}`,
        fix: 'Check out the base branch at the workspace root (no ref:). If the agent needs the pull request files, check them out into a subdirectory with path: and treat them as untrusted data.',
        workflow,
        line: head.line,
        job,
        step,
        agent: agent?.agent.id ?? null,
        lines: [step.line, ...reached.map((e) => e.line)],
      }),
    );
  }
  return findings;
}

// ----- untrusted-trigger -----

export function untrustedTrigger(s: AgentStep): Finding[] {
  const common = {
    id: 'untrusted-trigger' as const,
    workflow: s.workflow,
    job: s.job,
    step: s.step,
    agent: s.agent.id,
    line: s.line,
    lines: s.events.map((e) => e.line),
  };
  if (s.exposure === 'gated') {
    const privileged = s.events.filter((e) => e.cls === 'privileged');
    const comments = privileged.filter(
      (e) => COMMENT_EVENTS.includes(e.event) && e.actionCheckOnly,
    );
    if (comments.length > 0) {
      return [
        finding({
          ...common,
          severity: 'medium',
          explanation: `${s.agent.name} runs on ${eventList(comments)}. Only people with write access can start it, but it reads issue and pull request text that others wrote, and that text can change after a maintainer starts the run.`,
          fix: 'Keep the permissions and secrets of the job small. Give the agent the issue or pull request number instead of its text, and prefer starting it from a label or workflow_dispatch.',
        }),
      ];
    }
    const gates = [...new Set(privileged.flatMap((e) => e.gates))];
    return [
      finding({
        ...common,
        severity: 'low',
        explanation: `The workflow runs on ${eventList(privileged)}, which outside users can fire, and the agent only starts for trusted users: ${joinList(gates)}. The agent can still read text that others wrote.`,
        fix: 'Keep the gate, and keep the permissions and secrets of the job small.',
      }),
    ];
  }
  if (s.exposure === 'fork') {
    return [
      finding({
        ...common,
        severity: 'info',
        explanation: `The workflow runs on ${eventList(s.events)}. GitHub gives runs for pull requests from forks no secrets and a read-only token, so outside users cannot reach secrets through this agent.`,
        fix: 'Keep it that way: do not move an agent that reads pull request content to pull_request_target.',
      }),
    ];
  }
  return [];
}

// ----- outdated-agent -----

const SHA = /^[0-9a-f]{40}$/i;

/** The version in a comment such as "v1.2.3", "tag=v1.2.3" or "ratchet:owner/repo@v1.2.3". */
export function commentVersion(comment: string | null): string | null {
  if (!comment) return null;
  const match = /(?:^|[\s@=:])(v?\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.-]+)?)(?=$|[\s,;)])/.exec(comment);
  return match?.[1] ?? null;
}

/** Whether a tag ref of an action is older than its fix. */
export function isOutdatedRef(agent: ActionAgent, ref: string): boolean {
  const rule = agent.versions;
  if (!rule) return false;
  if (rule.outdatedRefs?.test(ref)) return true;
  if (!rule.fixedIn) return false;
  const version = parseVersion(ref);
  const fixed = parseVersion(rule.fixedIn);
  return version !== null && fixed !== null && compareVersions(version, fixed) < 0;
}

function outdatedSeverity(exposure: Exposure): Severity {
  return exposure === 'open' || exposure === 'gated' ? 'medium' : 'low';
}

export function outdatedAction(s: AgentStep): Finding[] {
  if (s.agent.kind !== 'action' || !s.step.uses) return [];
  const agent = s.agent;
  const uses = s.step.uses;
  const common = {
    id: 'outdated-agent' as const,
    workflow: s.workflow,
    job: s.job,
    step: s.step,
    agent: agent.id,
    lines: [],
  };
  const findings: Finding[] = [];
  const slug = uses.value.slice(0, uses.value.indexOf('@'));
  if (agent.deprecated) {
    findings.push(
      finding({
        ...common,
        severity: outdatedSeverity(s.exposure),
        explanation: agent.deprecated.explanation,
        fix: agent.deprecated.fix,
        line: uses.line,
      }),
    );
  } else if (agent.versions && s.ref) {
    const pinned = SHA.test(s.ref);
    const version = pinned ? commentVersion(uses.comment) : s.ref;
    if (version === null) {
      findings.push(
        finding({
          ...common,
          severity: 'info',
          explanation: `${slug} is pinned to commit ${s.ref.slice(0, 12)} without a version comment, so its version cannot be determined offline. Make sure it is a release where ${agent.versions.reason}.`,
          fix: `Add the version as a comment after the SHA, for example # ${agent.versions.fixedIn ?? 'v1.2.3'}. ${agent.versions.fix}`,
          line: uses.line,
        }),
      );
    } else if (isOutdatedRef(agent, version)) {
      findings.push(
        finding({
          ...common,
          severity: outdatedSeverity(s.exposure),
          explanation: `${slug} is used at ${version}${pinned ? ' (from the version comment)' : ''}, which is older than the fixed release: ${agent.versions.reason}.`,
          fix: agent.versions.fix,
          line: uses.line,
        }),
      );
    }
  }
  if (agent.cliVersion) {
    const kv = input(s.step, agent.cliVersion.input);
    const version = kv && !kv.value.includes('${{') ? parseVersion(kv.value) : null;
    const fixed = agent.cliVersion.fixed.map((v) => parseVersion(v)).filter((v) => v !== null);
    if (kv && version && !isFixedVersion(version, fixed)) {
      findings.push(
        finding({
          ...common,
          severity: outdatedSeverity(s.exposure),
          explanation: `${agent.cliVersion.input}: ${kv.value.trim()} installs ${agent.cliVersion.product} ${kv.value.trim()}, which is older than ${joinList(agent.cliVersion.fixed)} with ${agent.cliVersion.reason}.`,
          fix: `Set ${agent.cliVersion.input} to ${agent.cliVersion.fixed[0] ?? 'latest'} or later, or remove it to use the latest release.`,
          line: kv.line,
        }),
      );
    }
  }
  return findings;
}

const INSTALL_RULES = AGENTS.flatMap((agent) => (agent.kind === 'cli' ? agent.installs : []));

/** Pinned installs of outdated agent CLIs in the run: steps of a job with agents. */
export function outdatedInstalls(workflow: Workflow, job: Job, steps: AgentStep[]): Finding[] {
  const findings: Finding[] = [];
  const severity = outdatedSeverity(maxExposure(steps));
  for (const step of job.steps) {
    if (!step.run) continue;
    for (const rule of INSTALL_RULES) {
      const match = rule.pattern.exec(step.run.value);
      const version = match?.[1] ? parseVersion(match[1]) : null;
      const fixed = rule.fixed.map((v) => parseVersion(v)).filter((v) => v !== null);
      if (!match || !version || isFixedVersion(version, fixed)) continue;
      findings.push(
        finding({
          id: 'outdated-agent',
          severity,
          explanation: `This step installs ${rule.product} ${match[1] ?? ''}, which is older than ${joinList(rule.fixed)} with ${rule.reason}.`,
          fix: `Install ${rule.product} ${rule.fixed[0] ?? ''} or later.`,
          workflow,
          line: findLine(workflow.lines, step.run.line, step.run.endLine, match[0]),
          job,
          step,
          agent: null,
          lines: [],
        }),
      );
    }
  }
  return findings;
}

// ----- shared-checkout -----

function readOnly(s: AgentStep): boolean {
  if (s.agent.kind === 'action') {
    return s.agent.readOnly.some((r) => {
      const kv = input(s.step, r.input);
      return kv !== undefined && r.pattern.test(kv.value);
    });
  }
  return (
    s.agent.id === 'codex-cli' &&
    /(?:--sandbox|-s)[=\s]+["']?read-only\b/.test(s.step.run?.value ?? '')
  );
}

export function sharedCheckout(workflow: Workflow, job: Job, steps: AgentStep[]): Finding[] {
  const ordered = [...steps].sort((a, b) => a.step.index - b.step.index);
  const writer = ordered.find((s) => !readOnly(s));
  if (!writer) return [];
  const later = ordered.find((s) => s.step.index > writer.step.index);
  if (!later) return [];
  const codex = [writer, later].some(
    (s) => s.agent.id === 'codex-action' || s.agent.id === 'codex-cli',
  );
  const file = later.agent.instructionFile ?? 'AGENTS.md';
  return [
    finding({
      id: 'shared-checkout',
      severity: outdatedSeverity(maxExposure(steps)),
      explanation: `Step "${stepLabel(writer.step)}" can write files, and step "${stepLabel(later.step)}" later runs ${later.agent.name} in the same checkout, where it reads instruction files such as ${file}. A prompt injection in the first run can steer the second.${codex ? ' There is no Codex fix for this; the CSA research note recommends separate jobs.' : ''}`,
      fix: 'Run each agent pass in its own job with a fresh checkout, or make the earlier runs read-only (for Codex, sandbox: read-only).',
      workflow,
      line: later.line,
      job,
      step: later.step,
      agent: later.agent.id,
      lines: [writer.line],
    }),
  ];
}

// ----- checkout-credentials -----

export function checkoutCredentials(workflow: Workflow, job: Job, steps: AgentStep[]): Finding[] {
  const exposure = maxExposure(steps);
  if (exposure !== 'open' && exposure !== 'gated') return [];
  const lastAgent = Math.max(...steps.map((s) => s.step.index));
  return job.steps
    .slice(0, lastAgent)
    .filter((step) => isCheckout(step))
    .filter((step) => !/^\s*false\s*$/i.test(input(step, 'persist-credentials')?.value ?? ''))
    .map((step) =>
      finding({
        id: 'checkout-credentials',
        severity: exposure === 'open' ? 'medium' : 'low',
        explanation:
          'actions/checkout keeps the token in the git configuration of the checkout by default, where the agent can read it with a shell command or a file read.',
        fix: 'Add persist-credentials: false to the checkout step. If a later step has to push, give that step its own token.',
        workflow,
        line: step.uses?.line ?? step.line,
        job,
        step,
        agent: null,
        lines: [],
      }),
    );
}

// ----- unpinned-agent -----

export function unpinnedAgent(s: AgentStep): Finding[] {
  if (s.agent.kind !== 'action' || !s.step.uses || s.ref === null || SHA.test(s.ref)) return [];
  const uses = s.step.uses.value;
  const slug = uses.slice(0, uses.indexOf('@'));
  return [
    finding({
      id: 'unpinned-agent',
      severity: 'low',
      explanation: `${slug} is used by the ref ${s.ref || '(empty)'}, which can point to different code at any time.`,
      fix: `Pin the action to a full commit SHA with a version comment, for example uses: ${slug}@<commit SHA> # <version>, and let Dependabot update it. GitHub workflow lockfiles (public preview since October 2026) can also record the exact commits.`,
      workflow: s.workflow,
      line: s.step.uses.line,
      job: s.job,
      step: s.step,
      agent: s.agent.id,
      lines: [],
    }),
  ];
}
