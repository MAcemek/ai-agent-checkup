import { findActionAgent, findCliAgents, usesRef, type AgentDefinition } from '../agents.js';
import {
  blockedByFailingCheck,
  evaluateCondition,
  permissionOutputs,
  type Outcome,
} from '../workflow/gates.js';
import type { Job, KeyValue, Step, Trigger, Workflow } from '../workflow/model.js';

/** Events that outside users can fire, where the run has the repository's secrets. */
export const PRIVILEGED_EVENTS = [
  'issues',
  'issue_comment',
  'discussion',
  'discussion_comment',
  'pull_request_target',
  'workflow_run',
];

/** Events that outside users can fire from a fork, where the run gets no secrets. */
export const FORK_EVENTS = ['pull_request', 'pull_request_review', 'pull_request_review_comment'];

/** Comment events: a maintainer's comment can start the run on text that others wrote. */
export const COMMENT_EVENTS = ['issue_comment', 'discussion_comment'];

/** Event types that need triage or write access. */
const TRIAGE_TYPES = [
  'assigned',
  'unassigned',
  'labeled',
  'unlabeled',
  'milestoned',
  'demilestoned',
  'pinned',
  'unpinned',
  'locked',
  'unlocked',
  'transferred',
];

/** Issue and discussion forms can add labels when they are opened, so labels are no gate there. */
const FORM_LABEL_EVENTS = ['issues', 'discussion'];

export type EventClass = 'privileged' | 'fork';

/** An untrusted event that can start the agent step, and what stops outside users. */
export interface EventReach {
  event: string;
  line: number;
  cls: EventClass;
  /** What stops outside users, such as "job condition (author association)". Empty: nothing. */
  gates: string[];
  /** True when only the action's own check of the actor stops outside users. */
  actionCheckOnly: boolean;
}

/**
 * - open: an outside user can start the agent through an event that has the secrets.
 * - gated: such events exist, but a gate stops outside users.
 * - fork: only fork pull request events, which run without secrets.
 * - none: no events that outside users can fire.
 */
export type Exposure = 'open' | 'gated' | 'fork' | 'none';

export interface AgentStep {
  workflow: Workflow;
  job: Job;
  step: Step;
  agent: AgentDefinition;
  /** Line of `uses:` or of the command in `run:`. */
  line: number;
  /** The ref of `uses:`, or null for CLI agents. */
  ref: string | null;
  events: EventReach[];
  exposure: Exposure;
  /** An allow-list input set to "*" that takes effect, or null. */
  wildcard: KeyValue | null;
  /** A bot allow-list input set to "*", or null. */
  botWildcard: KeyValue | null;
}

export function input(step: Step, name: string): KeyValue | undefined {
  return step.with.find((w) => w.key === name);
}

export function envVar(step: Step, name: string): KeyValue | undefined {
  return step.env.find((e) => e.key === name);
}

/** The first line in [from, to] that contains `needle`, or `from`. */
export function findLine(lines: string[], from: number, to: number, needle: string): number {
  for (let line = from; line <= Math.min(to, lines.length); line++) {
    if ((lines[line - 1] ?? '').includes(needle)) return line;
  }
  return from;
}

function isWildcard(value: string): boolean {
  return value
    .split(',')
    .map((part) => part.trim())
    .includes('*');
}

function wildcardInput(step: Step, names: string[], requires: string | null): KeyValue | null {
  if (requires && !input(step, requires)) return null;
  for (const name of names) {
    const value = input(step, name);
    if (value && isWildcard(value.value)) return value;
  }
  return null;
}

/** Whether a workflow_run trigger can be started by outside users through its upstream runs. */
function upstreamUntrusted(trigger: Trigger, all: Workflow[]): boolean {
  if (trigger.workflows.length === 0) return true;
  return trigger.workflows.some((name) => {
    const upstream = all.filter((w) => (w.name ?? w.file) === name);
    if (upstream.length === 0) return true;
    return upstream.some((w) =>
      w.triggers.some((t) => FORK_EVENTS.includes(t.event) || PRIVILEGED_EVENTS.includes(t.event)),
    );
  });
}

/** The untrusted events of a workflow with their class. */
export function untrustedTriggers(
  workflow: Workflow,
  all: Workflow[],
): { trigger: Trigger; cls: EventClass }[] {
  return workflow.triggers.flatMap((trigger): { trigger: Trigger; cls: EventClass }[] => {
    if (trigger.event === 'workflow_run') {
      return upstreamUntrusted(trigger, all) ? [{ trigger, cls: 'privileged' as const }] : [];
    }
    if (PRIVILEGED_EVENTS.includes(trigger.event)) return [{ trigger, cls: 'privileged' as const }];
    if (FORK_EVENTS.includes(trigger.event)) return [{ trigger, cls: 'fork' as const }];
    return [];
  });
}

function typesGate(trigger: Trigger): boolean {
  if (!trigger.types || trigger.types.length === 0) return false;
  const allowed = FORM_LABEL_EVENTS.includes(trigger.event)
    ? TRIAGE_TYPES.filter((t) => t !== 'labeled' && t !== 'unlabeled')
    : TRIAGE_TYPES;
  return trigger.types.every((type) => allowed.includes(type));
}

function conditionGate(label: string, outcome: Outcome): string {
  const kinds = [...new Set(outcome.gates)];
  return kinds.length > 0 ? `${label} (${kinds.join(', ')})` : label;
}

function reach(
  workflow: Workflow,
  job: Job,
  step: Step,
  agent: AgentDefinition,
  actorCheck: boolean,
  all: Workflow[],
): EventReach[] {
  const result: EventReach[] = [];
  for (const { trigger, cls } of untrustedTriggers(workflow, all)) {
    const ctx = {
      event: trigger.event,
      permissionOutputs: permissionOutputs(job, step.index, workflow.jobs),
    };
    const jobOutcome = job.if ? evaluateCondition(job.if.text, ctx) : null;
    const stepOutcome = step.if ? evaluateCondition(step.if.text, ctx) : null;
    const excluded = [jobOutcome, stepOutcome].some(
      (o) => o?.truth === 'no' && o.gates.length === 0,
    );
    if (excluded) continue;
    const gates: string[] = [];
    if (typesGate(trigger)) gates.push(`event types (${(trigger.types ?? []).join(', ')})`);
    if (jobOutcome?.truth === 'no') gates.push(conditionGate('job condition', jobOutcome));
    if (stepOutcome?.truth === 'no') gates.push(conditionGate('step condition', stepOutcome));
    if (blockedByFailingCheck(job, step.index, workflow.jobs)) gates.push('permission check');
    const actionCheckOnly = gates.length === 0 && actorCheck;
    if (actorCheck) gates.push(`${agent.name} checks for write access`);
    result.push({ event: trigger.event, line: trigger.line, cls, gates, actionCheckOnly });
  }
  return result;
}

export function exposureOf(events: EventReach[]): Exposure {
  if (events.some((e) => e.cls === 'privileged' && e.gates.length === 0)) return 'open';
  if (events.some((e) => e.cls === 'privileged')) return 'gated';
  if (events.length > 0) return 'fork';
  return 'none';
}

/** Every agent step in the workflow: steps that use a known agent action or run an agent CLI. */
export function findAgentSteps(workflow: Workflow, all: Workflow[]): AgentStep[] {
  const found: AgentStep[] = [];
  for (const job of workflow.jobs) {
    for (const step of job.steps) {
      const action = step.uses ? findActionAgent(step.uses.value) : undefined;
      if (step.uses && action) {
        const wildcard = wildcardInput(step, action.allowListInputs, action.allowListRequires);
        const botWildcard = wildcardInput(step, action.botAllowListInputs, null);
        const events = reach(workflow, job, step, action, action.actorCheck && !wildcard, all);
        found.push({
          workflow,
          job,
          step,
          agent: action,
          line: step.uses.line,
          ref: usesRef(step.uses.value),
          events,
          exposure: exposureOf(events),
          wildcard,
          botWildcard,
        });
      }
      if (step.run) {
        for (const cli of findCliAgents(step.run.value)) {
          const match = cli.command.exec(step.run.value);
          const needle = ((match?.[0] ?? '').trim().split('\n')[0] ?? '').slice(0, 40);
          const events = reach(workflow, job, step, cli, false, all);
          found.push({
            workflow,
            job,
            step,
            agent: cli,
            line: findLine(workflow.lines, step.run.line, step.run.endLine, needle),
            ref: null,
            events,
            exposure: exposureOf(events),
            wildcard: null,
            botWildcard: null,
          });
        }
      }
    }
  }
  return found;
}

const EXPOSURE_ORDER: Exposure[] = ['none', 'fork', 'gated', 'open'];

/** The highest exposure of several agent steps. */
export function maxExposure(steps: AgentStep[]): Exposure {
  return steps.reduce<Exposure>(
    (max, s) =>
      EXPOSURE_ORDER.indexOf(s.exposure) > EXPOSURE_ORDER.indexOf(max) ? s.exposure : max,
    'none',
  );
}
