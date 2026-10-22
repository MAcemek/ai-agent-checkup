import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { checkWorkflow, sortFindings } from './checks/index.js';
import { definition } from './checks/definitions.js';
import { shorten } from './checks/rules.js';
import { UsageError } from './errors.js';
import type { Finding, Report, ScannedWorkflow, Summary } from './types.js';
import { NOTE, HOMEPAGE, VERSION } from './version.js';
import { loadWorkflow, type Workflow } from './workflow/model.js';

export interface WorkflowFile {
  /** Path shown in findings, with forward slashes. */
  file: string;
  text: string;
}

const WORKFLOW_FILE = /\.ya?ml$/i;

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function workflowFiles(dir: string, prefix: string): Promise<WorkflowFile[]> {
  const names = (await readdir(dir, { withFileTypes: true }))
    .filter((e) => e.isFile() && WORKFLOW_FILE.test(e.name))
    .map((e) => e.name)
    .sort();
  return Promise.all(
    names.map(async (name) => ({
      file: `${prefix}${name}`,
      text: await readFile(join(dir, name), 'utf8'),
    })),
  );
}

/**
 * Reads the workflow files to scan. A directory is a repository root: its
 * .github/workflows/*.yml and *.yaml files are read (or the directory itself when it is named
 * "workflows"). A file is read as one workflow.
 */
export async function readTarget(
  path: string,
  cwd: string,
): Promise<{ target: 'directory' | 'file'; files: WorkflowFile[] }> {
  const root = resolve(cwd, path);
  let info;
  try {
    info = await stat(root);
  } catch {
    throw new UsageError(`Path not found: ${path}`);
  }
  if (info.isFile()) {
    if (!WORKFLOW_FILE.test(root)) {
      throw new UsageError(
        `Not a workflow file: ${path}. Give a repository directory or a .yml or .yaml file.`,
      );
    }
    return {
      target: 'file',
      files: [{ file: path.replace(/\\/g, '/'), text: await readFile(root, 'utf8') }],
    };
  }
  const nested = join(root, '.github', 'workflows');
  if (await isDirectory(nested)) {
    return { target: 'directory', files: await workflowFiles(nested, '.github/workflows/') };
  }
  if (basename(root) === 'workflows') {
    return { target: 'directory', files: await workflowFiles(root, '') };
  }
  return { target: 'directory', files: [] };
}

function parseFinding(file: WorkflowFile, explanation: string, fix: string, line: number): Finding {
  const lines = file.text.split(/\r?\n/);
  return {
    id: 'parse-error',
    severity: 'info',
    title: definition('parse-error').title,
    explanation,
    fix,
    file: file.file,
    line,
    job: null,
    step: null,
    agent: null,
    evidence: [{ file: file.file, line, text: shorten((lines[line - 1] ?? '').trim()) }],
  };
}

export function summarize(findings: Finding[], workflows: ScannedWorkflow[]): Summary {
  const count = (severity: Finding['severity']) =>
    findings.filter((f) => f.severity === severity).length;
  return {
    high: count('high'),
    medium: count('medium'),
    low: count('low'),
    info: count('info'),
    total: findings.length,
    workflows: workflows.length,
    agentSteps: workflows.reduce((sum, w) => sum + w.agentSteps, 0),
  };
}

/** Checks workflow files and builds the report. */
export function checkFiles(
  path: string,
  target: 'directory' | 'file',
  files: WorkflowFile[],
): Report {
  const findings: Finding[] = [];
  const loaded: Workflow[] = [];
  for (const file of files) {
    const result = loadWorkflow(file.file, file.text);
    if (!result.ok) {
      findings.push(
        parseFinding(
          file,
          result.message,
          'Fix the file so that GitHub can run it, then run the check again.',
          result.line,
        ),
      );
      continue;
    }
    if (result.documents > 1) {
      findings.push(
        parseFinding(
          file,
          `The file has ${result.documents} YAML documents. GitHub reads one workflow per file; only the first document was checked.`,
          'Keep one workflow per file.',
          1,
        ),
      );
    }
    loaded.push(result.workflow);
  }
  const workflows: ScannedWorkflow[] = files.map((f) => ({ file: f.file, agentSteps: 0 }));
  for (const workflow of loaded) {
    const result = checkWorkflow(workflow, loaded);
    findings.push(...result.findings);
    const entry = workflows.find((w) => w.file === workflow.file);
    if (entry) entry.agentSteps = result.agentSteps.length;
  }
  const sorted = sortFindings(findings);
  return {
    tool: { name: 'ai-agent-checkup', version: VERSION, homepage: HOMEPAGE },
    path: path.replace(/\\/g, '/'),
    target,
    workflows,
    summary: summarize(sorted, workflows),
    findings: sorted,
    note: NOTE,
  };
}

/** Reads and checks the path. */
export async function scan(path: string, cwd: string): Promise<Report> {
  const { target, files } = await readTarget(path, cwd);
  return checkFiles(path, target, files);
}
