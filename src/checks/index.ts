import { CHECK_IDS, SEVERITIES, type Finding } from '../types.js';
import type { Workflow } from '../workflow/model.js';
import { findAgentSteps, type AgentStep } from './context.js';
import {
  anyoneCanRun,
  checkoutCredentials,
  dangerousSettings,
  outdatedAction,
  outdatedInstalls,
  reachOf,
  sharedCheckout,
  unpinnedAgent,
  untrustedCheckout,
  untrustedInput,
  untrustedTrigger,
  writePermissions,
} from './rules.js';

export interface WorkflowResult {
  agentSteps: AgentStep[];
  findings: Finding[];
}

/** Runs every check on one workflow. `all` is every workflow of the repository. */
export function checkWorkflow(workflow: Workflow, all: Workflow[]): WorkflowResult {
  const agentSteps = findAgentSteps(workflow, all);
  const findings: Finding[] = [];
  for (const job of workflow.jobs) {
    const steps = agentSteps.filter((s) => s.job === job);
    if (steps.length === 0) continue;
    for (const s of steps) {
      const reach = reachOf(workflow, job, [s]);
      findings.push(
        ...anyoneCanRun(s, reach),
        ...untrustedInput(s, reach),
        ...dangerousSettings(s),
        ...untrustedTrigger(s),
        ...outdatedAction(s),
        ...unpinnedAgent(s),
      );
    }
    findings.push(
      ...writePermissions(workflow, job, steps),
      ...untrustedCheckout(workflow, job, steps, all),
      ...outdatedInstalls(workflow, job, steps),
      ...sharedCheckout(workflow, job, steps),
      ...checkoutCredentials(workflow, job, steps),
    );
  }
  return { agentSteps, findings: dedupe(findings) };
}

/** Drops repeated findings: the same check, job, title and explanation in one file. */
export function dedupe(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = JSON.stringify([f.id, f.file, f.job, f.title, f.explanation]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Sorts findings: severity (high first), file, line, then check order. */
export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) ||
      (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) ||
      a.line - b.line ||
      CHECK_IDS.indexOf(a.id) - CHECK_IDS.indexOf(b.id),
  );
}
