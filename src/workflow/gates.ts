import { conditionExpression, type Expr } from './expr.js';
import type { Job, Step } from './model.js';

/**
 * Evaluates `if:` conditions from the point of view of an outside user who fires an event: can
 * the condition be true for them? "no" means a gate stops them; "maybe" means it depends on
 * values they control.
 */
export type Truth = 'yes' | 'no' | 'maybe';

export type GateKind =
  | 'author association'
  | 'actor'
  | 'same repository'
  | 'label'
  | 'upstream event'
  | 'permission check';

export interface Outcome {
  truth: Truth;
  /** The gates that make the outcome "no". */
  gates: GateKind[];
}

export interface EvalContext {
  /** The event being evaluated, such as "issue_comment". */
  event: string;
  /** Output prefixes of permission-check steps and jobs, such as "steps.check.outputs". */
  permissionOutputs: string[];
}

/** Roles that only people with write or triage access have. */
export const TRUSTED_ROLES = ['OWNER', 'MEMBER', 'COLLABORATOR'];

/** Events that outside users cannot start. */
export const TRUSTED_EVENTS = ['push', 'schedule', 'workflow_dispatch', 'release', 'merge_group'];

const ACTOR_PATHS = new Set([
  'github.actor',
  'github.triggering_actor',
  'github.event.sender.login',
  'github.event.comment.user.login',
  'github.event.issue.user.login',
  'github.event.pull_request.user.login',
  'github.event.review.user.login',
  'github.event.discussion.user.login',
]);

const HEAD_REPO_NAME = new Set([
  'github.event.pull_request.head.repo.full_name',
  'github.event.workflow_run.head_repository.full_name',
]);

const HEAD_REPO_FORK = new Set([
  'github.event.pull_request.head.repo.fork',
  'github.event.workflow_run.head_repository.fork',
]);

/** Known actions that check the permission of the actor. */
export const PERMISSION_CHECK_ACTIONS = [
  'actions-cool/check-user-permission',
  'prince-chrismc/check-actor-permissions-action',
  'lannonbr/repo-permission-check-action',
  'sushichop/action-repository-permission',
  'tspascoal/get-user-teams-membership',
];

type Side =
  | { kind: 'literal'; value: string | number | boolean | null }
  | {
      kind:
        | 'event-name'
        | 'association'
        | 'actor'
        | 'repository'
        | 'repository-owner'
        | 'head-repo-name'
        | 'head-repo-fork'
        | 'label-name'
        | 'labels'
        | 'workflow-run-event'
        | 'permission-output'
        | 'other';
    };

function classify(expr: Expr, ctx: EvalContext): Side {
  if (expr.kind === 'literal') return { kind: 'literal', value: expr.value };
  if (expr.kind === 'call' && expr.name === 'fromjson' && expr.args[0]?.kind === 'literal') {
    return { kind: 'literal', value: expr.args[0].value };
  }
  if (expr.kind !== 'context') return { kind: 'other' };
  const path = expr.path;
  if (path === 'github.event_name') return { kind: 'event-name' };
  if (path.startsWith('github.event.') && path.endsWith('.author_association')) {
    return { kind: 'association' };
  }
  if (ACTOR_PATHS.has(path)) return { kind: 'actor' };
  if (path === 'github.repository') return { kind: 'repository' };
  if (path === 'github.repository_owner') return { kind: 'repository-owner' };
  if (HEAD_REPO_NAME.has(path)) return { kind: 'head-repo-name' };
  if (HEAD_REPO_FORK.has(path)) return { kind: 'head-repo-fork' };
  if (path === 'github.event.label.name') return { kind: 'label-name' };
  if (path.startsWith('github.event.') && path.endsWith('.labels.*.name'))
    return { kind: 'labels' };
  if (path === 'github.event.workflow_run.event') return { kind: 'workflow-run-event' };
  if (ctx.permissionOutputs.some((prefix) => path.startsWith(`${prefix}.`))) {
    return { kind: 'permission-output' };
  }
  return { kind: 'other' };
}

const yes: Outcome = { truth: 'yes', gates: [] };
const no: Outcome = { truth: 'no', gates: [] };
const maybe: Outcome = { truth: 'maybe', gates: [] };
const gate = (kind: GateKind): Outcome => ({ truth: 'no', gates: [kind] });

function truthy(value: string | number | boolean | null): Outcome {
  return value === null || value === false || value === 0 || value === '' ? no : yes;
}

/** Negation. A "yes" that comes from a gate value (such as a fork) keeps its gate kinds. */
function not(outcome: Outcome): Outcome {
  if (outcome.truth === 'maybe') return maybe;
  return outcome.truth === 'yes' ? { truth: 'no', gates: outcome.gates } : yes;
}

/** "yes" for a value that is true for every outside user, such as a fork flag. */
const forkYes: Outcome = { truth: 'yes', gates: ['same repository'] };

/** The role names in a literal list such as '["OWNER", "MEMBER"]' or 'OWNER,MEMBER'. */
function roleNames(value: string | number | boolean | null): string[] {
  return (
    String(value)
      .toUpperCase()
      .match(/[A-Z_]+/g) ?? []
  );
}

function onlyTrustedRoles(value: string | number | boolean | null): boolean {
  const roles = roleNames(value);
  return roles.length > 0 && roles.every((role) => TRUSTED_ROLES.includes(role));
}

function equals(a: Side, b: Side, ctx: EvalContext): Outcome {
  for (const [x, y] of [
    [a, b],
    [b, a],
  ] as const) {
    if (x.kind === 'event-name' && y.kind === 'literal') {
      return String(y.value).toLowerCase() === ctx.event ? yes : no;
    }
    if (x.kind === 'association' && y.kind === 'literal') {
      return onlyTrustedRoles(y.value) ? gate('author association') : maybe;
    }
    if (x.kind === 'actor' && y.kind === 'literal' && String(y.value) !== '') return gate('actor');
    if (x.kind === 'actor' && y.kind === 'repository-owner') return gate('actor');
    if (x.kind === 'head-repo-name' && y.kind === 'repository') return gate('same repository');
    if (x.kind === 'head-repo-fork' && y.kind === 'literal') {
      return y.value === false || String(y.value) === 'false' ? gate('same repository') : forkYes;
    }
    if (x.kind === 'label-name' && y.kind === 'literal') return gate('label');
    if (x.kind === 'workflow-run-event' && y.kind === 'literal') {
      return TRUSTED_EVENTS.includes(String(y.value).toLowerCase())
        ? gate('upstream event')
        : maybe;
    }
    if (x.kind === 'permission-output' && y.kind === 'literal') return gate('permission check');
  }
  return maybe;
}

function contains(args: Expr[], ctx: EvalContext): Outcome {
  const [first, second] = args;
  if (!first || !second) return maybe;
  const haystack = classify(first, ctx);
  const needle = classify(second, ctx);
  if (haystack.kind === 'literal' && needle.kind === 'association') {
    return onlyTrustedRoles(haystack.value) ? gate('author association') : maybe;
  }
  if (haystack.kind === 'literal' && needle.kind === 'actor') return gate('actor');
  if (haystack.kind === 'labels' && needle.kind === 'literal') return gate('label');
  if (haystack.kind === 'event-name' && needle.kind === 'literal') {
    return ctx.event.includes(String(needle.value).toLowerCase()) ? yes : no;
  }
  return maybe;
}

export function evaluate(expr: Expr, ctx: EvalContext): Outcome {
  switch (expr.kind) {
    case 'literal':
      return truthy(expr.value);
    case 'context': {
      const side = classify(expr, ctx);
      if (side.kind === 'head-repo-fork') return forkYes;
      if (side.kind === 'event-name') return yes;
      return maybe;
    }
    case 'not':
      return not(evaluate(expr.expr, ctx));
    case 'and': {
      const left = evaluate(expr.left, ctx);
      const right = evaluate(expr.right, ctx);
      if (left.truth === 'no' || right.truth === 'no') {
        return {
          truth: 'no',
          gates: [
            ...(left.truth === 'no' ? left.gates : []),
            ...(right.truth === 'no' ? right.gates : []),
          ],
        };
      }
      return left.truth === 'yes' && right.truth === 'yes' ? yes : maybe;
    }
    case 'or': {
      const left = evaluate(expr.left, ctx);
      const right = evaluate(expr.right, ctx);
      if (left.truth === 'yes' || right.truth === 'yes') return yes;
      if (left.truth === 'no' && right.truth === 'no') {
        return { truth: 'no', gates: [...left.gates, ...right.gates] };
      }
      return maybe;
    }
    case 'compare': {
      if (expr.op !== '==' && expr.op !== '!=') return maybe;
      const result = equals(classify(expr.left, ctx), classify(expr.right, ctx), ctx);
      return expr.op === '==' ? result : not(result);
    }
    case 'call': {
      switch (expr.name) {
        case 'always':
        case 'success':
          return yes;
        case 'contains':
          return contains(expr.args, ctx);
        case 'startswith':
        case 'endswith': {
          const [first, second] = expr.args;
          if (
            first &&
            second &&
            classify(first, ctx).kind === 'event-name' &&
            second.kind === 'literal'
          ) {
            const value = String(second.value).toLowerCase();
            const hit =
              expr.name === 'startswith' ? ctx.event.startsWith(value) : ctx.event.endsWith(value);
            return hit ? yes : no;
          }
          return maybe;
        }
        default:
          return maybe;
      }
    }
  }
}

/** Evaluates an `if:` value. Text that cannot be parsed counts as "maybe". */
export function evaluateCondition(text: string, ctx: EvalContext): Outcome {
  try {
    return evaluate(conditionExpression(text), ctx);
  } catch {
    return maybe;
  }
}

/** True when the condition text calls always(), failure() or cancelled(). */
export function runsAfterFailure(text: string | undefined): boolean {
  return text !== undefined && /\b(always|failure|cancelled)\s*\(/i.test(text);
}

function stepText(step: Step): string {
  return [step.run?.value ?? '', ...step.with.map((w) => w.value)].join('\n');
}

/** True when the step checks the permission or team of the actor. */
export function isPermissionCheck(step: Step): boolean {
  const uses = step.uses?.value.toLowerCase() ?? '';
  if (PERMISSION_CHECK_ACTIONS.some((action) => uses.startsWith(`${action}@`))) return true;
  const text = stepText(step);
  return (
    /getCollaboratorPermissionLevel|checkCollaborator/.test(text) ||
    (/\/collaborators\//.test(text) && /permission/i.test(text))
  );
}

/** True when the step is a permission check that fails the job when the check fails. */
export function failsClosed(step: Step): boolean {
  return isPermissionCheck(step) && /\bexit\s+1\b|setFailed\s*\(/.test(stepText(step));
}

/** Output prefixes of permission checks that a step can see: earlier steps and needed jobs. */
export function permissionOutputs(job: Job, stepIndex: number, jobs: Job[]): string[] {
  const prefixes: string[] = [];
  for (const step of job.steps.slice(0, stepIndex)) {
    if (step.id && isPermissionCheck(step)) prefixes.push(`steps.${step.id.toLowerCase()}.outputs`);
  }
  for (const needed of job.needs) {
    const other = jobs.find((j) => j.id === needed);
    if (other?.steps.some(isPermissionCheck))
      prefixes.push(`needs.${needed.toLowerCase()}.outputs`);
  }
  return prefixes;
}

/**
 * True when a permission check that fails closed runs before the step: an earlier step of the
 * same job, or a step of a job in `needs:`, and the step does not run after failures.
 */
export function blockedByFailingCheck(job: Job, stepIndex: number, jobs: Job[]): boolean {
  const step = job.steps[stepIndex];
  if (runsAfterFailure(job.if?.text) || runsAfterFailure(step?.if?.text)) return false;
  if (job.steps.slice(0, stepIndex).some(failsClosed)) return true;
  return job.needs.some((needed) => jobs.find((j) => j.id === needed)?.steps.some(failsClosed));
}
