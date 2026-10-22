import { endLine, entry, get, parseYaml, str, strList, type YNode } from './yaml.js';

/** A key with a scalar value, such as one entry of `with:` or `env:`. */
export interface KeyValue {
  key: string;
  value: string;
  /** Line of the key. */
  line: number;
  /** Last line of the value. */
  endLine: number;
}

export interface Trigger {
  event: string;
  line: number;
  /** The `types:` filter, or null when there is none. */
  types: string[] | null;
  /** For workflow_run: the names in `workflows:`. */
  workflows: string[];
}

export interface PermissionScope {
  scope: string;
  access: string;
  line: number;
}

/** A `permissions:` block. `all` is read-all or write-all; `map` lists scopes ({} is empty). */
export type Permissions =
  | { kind: 'all'; access: string; line: number }
  | { kind: 'map'; scopes: PermissionScope[]; line: number };

export interface Condition {
  /** The `if:` value as text (true and false for YAML booleans). */
  text: string;
  line: number;
}

export interface StepUses {
  /** The full value, such as "actions/checkout@v7". */
  value: string;
  line: number;
  /** The comment after the value on the same line, without "#", or null. */
  comment: string | null;
}

export interface Step {
  /** 0-based position in the job. */
  index: number;
  id: string | null;
  name: string | null;
  line: number;
  if: Condition | null;
  uses: StepUses | null;
  run: KeyValue | null;
  with: KeyValue[];
  env: KeyValue[];
}

export interface Job {
  id: string;
  line: number;
  if: Condition | null;
  permissions: Permissions | null;
  env: KeyValue[];
  needs: string[];
  steps: Step[];
}

export interface Workflow {
  /** Path relative to the scanned directory, with forward slashes. */
  file: string;
  /** The `name:` of the workflow, or null. */
  name: string | null;
  /** The source split into lines (index 0 is line 1). */
  lines: string[];
  triggers: Trigger[];
  /** Line of the `on:` key. */
  onLine: number;
  permissions: Permissions | null;
  env: KeyValue[];
  jobs: Job[];
}

export type LoadResult =
  | { ok: true; workflow: Workflow; documents: number }
  | { ok: false; message: string; line: number };

function keyValues(node: YNode | undefined): KeyValue[] {
  if (node?.kind !== 'map') return [];
  return node.entries.map((e) => ({
    key: e.key,
    value: str(e.value) ?? '',
    line: e.keyLine,
    endLine: endLine(e.value),
  }));
}

function condition(node: YNode | undefined): Condition | null {
  const text = str(node);
  if (node === undefined || text === undefined) return null;
  return { text, line: node.line };
}

function permissions(node: YNode | undefined): Permissions | null {
  if (node === undefined) return null;
  if (node.kind === 'scalar') return { kind: 'all', access: str(node) ?? '', line: node.line };
  if (node.kind === 'map') {
    return {
      kind: 'map',
      line: node.line,
      scopes: node.entries.map((e) => ({
        scope: e.key,
        access: str(e.value) ?? '',
        line: e.keyLine,
      })),
    };
  }
  return null;
}

function triggers(node: YNode | undefined): Trigger[] {
  if (node === undefined) return [];
  if (node.kind === 'scalar') {
    const event = str(node) ?? '';
    return event === '' ? [] : [{ event, line: node.line, types: null, workflows: [] }];
  }
  if (node.kind === 'seq') {
    return node.items.flatMap((item) => {
      const event = str(item);
      return event ? [{ event, line: item.line, types: null, workflows: [] }] : [];
    });
  }
  return node.entries.map((e) => {
    const types = get(e.value, 'types');
    return {
      event: e.key,
      line: e.keyLine,
      types: types === undefined ? null : strList(types),
      workflows: strList(get(e.value, 'workflows')),
    };
  });
}

/** The comment after `uses:` on its line: "uses: a/b@sha # v1.2.3" gives "v1.2.3". */
function trailingComment(line: string | undefined): string | null {
  if (line === undefined) return null;
  const match = /\s#\s*(.*?)\s*$/.exec(line.replace(/^\s*(-\s+)?uses:\s*/, ' '));
  return match?.[1] ? match[1] : null;
}

function step(node: YNode, index: number, lines: string[]): Step {
  const uses = get(node, 'uses');
  const usesValue = str(uses);
  const run = entry(node, 'run');
  const runValue = str(run?.value);
  return {
    index,
    id: str(get(node, 'id')) ?? null,
    name: str(get(node, 'name')) ?? null,
    line: node.line,
    if: condition(get(node, 'if')),
    uses:
      uses && usesValue !== undefined
        ? {
            value: usesValue.trim(),
            line: uses.line,
            comment: trailingComment(lines[uses.line - 1]),
          }
        : null,
    run:
      run && runValue !== undefined
        ? { key: 'run', value: runValue, line: run.keyLine, endLine: endLine(run.value) }
        : null,
    with: keyValues(get(node, 'with')),
    env: keyValues(get(node, 'env')),
  };
}

function job(id: string, line: number, node: YNode, lines: string[]): Job {
  const steps = get(node, 'steps');
  return {
    id,
    line,
    if: condition(get(node, 'if')),
    permissions: permissions(get(node, 'permissions')),
    env: keyValues(get(node, 'env')),
    needs: strList(get(node, 'needs')),
    steps: steps?.kind === 'seq' ? steps.items.map((item, i) => step(item, i, lines)) : [],
  };
}

/** Reads a workflow file. `file` is the path shown in findings. */
export function loadWorkflow(file: string, text: string): LoadResult {
  const parsed = parseYaml(text);
  if (parsed.errors.length > 0) {
    const first = parsed.errors[0] ?? 'line 1: unknown error';
    const line = Number(/^line (\d+)/.exec(first)?.[1] ?? '1');
    return { ok: false, message: `The YAML could not be parsed (${first}).`, line };
  }
  const root = parsed.root;
  if (root?.kind !== 'map') {
    return {
      ok: false,
      message: 'The file is not a YAML mapping, so it is not a workflow.',
      line: 1,
    };
  }
  const lines = text.split(/\r?\n/);
  const on = entry(root, 'on');
  const jobs = get(root, 'jobs');
  return {
    ok: true,
    documents: parsed.documents,
    workflow: {
      file,
      name: str(get(root, 'name')) ?? null,
      lines,
      triggers: triggers(on?.value),
      onLine: on?.keyLine ?? 1,
      permissions: permissions(get(root, 'permissions')),
      env: keyValues(get(root, 'env')),
      jobs:
        jobs?.kind === 'map' ? jobs.entries.map((e) => job(e.key, e.keyLine, e.value, lines)) : [],
    },
  };
}

/** A display name for a step: its name, its id, its uses: value, or "step <n>" (1-based). */
export function stepLabel(s: Step): string {
  return s.name ?? s.id ?? s.uses?.value ?? `step ${s.index + 1}`;
}
