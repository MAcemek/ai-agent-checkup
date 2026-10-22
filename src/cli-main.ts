import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { HELP_TEXT, parseCliArgs, type CliOptions } from './args.js';
import { errorMessage, UsageError } from './errors.js';
import { formatAgentList } from './format/agents.js';
import { formatReport } from './format/index.js';
import { failOnMessage, matchFailOn } from './report.js';
import { scan } from './scan.js';
import { VERSION } from './version.js';

export const EXIT_OK = 0;
export const EXIT_FAIL_ON = 1;
export const EXIT_USAGE = 2;

export interface OutputStream {
  write(chunk: string): unknown;
  isTTY?: boolean;
}

export interface CliDeps {
  cwd: string;
  env: Record<string, string | undefined>;
  stdout: OutputStream;
  stderr: OutputStream;
}

export function shouldUseColor(options: CliOptions, deps: CliDeps): boolean {
  if (options.format !== 'text' || options.noColor || options.output !== null) return false;
  if (deps.stdout.isTTY !== true) return false;
  const noColor = deps.env.NO_COLOR;
  if (noColor !== undefined && noColor !== '') return false;
  return deps.env.TERM !== 'dumb';
}

/** Runs the CLI and returns the exit code. Never throws. */
export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  let fromArgs = true;
  try {
    const parsed = parseCliArgs(argv);
    if (parsed.kind === 'help') {
      deps.stdout.write(HELP_TEXT);
      return EXIT_OK;
    }
    if (parsed.kind === 'version') {
      deps.stdout.write(`${VERSION}\n`);
      return EXIT_OK;
    }
    if (parsed.kind === 'list-agents') {
      deps.stdout.write(formatAgentList());
      return EXIT_OK;
    }
    fromArgs = false;
    const options = parsed.options;
    const report = await scan(options.path, deps.cwd);
    const output = formatReport(report, options.format, { color: shouldUseColor(options, deps) });
    if (options.output !== null) {
      try {
        await writeFile(resolve(deps.cwd, options.output), output, 'utf8');
      } catch (error) {
        throw new UsageError(`Could not write ${options.output}: ${errorMessage(error)}`);
      }
      deps.stderr.write(`Report written to ${options.output}\n`);
    } else {
      deps.stdout.write(output);
    }
    const matched = matchFailOn(report.findings, options.failOn);
    if (options.failOn !== null && matched.length > 0) {
      deps.stderr.write(`ai-agent-checkup: ${failOnMessage(options.failOn, matched)}\n`);
      return EXIT_FAIL_ON;
    }
    return EXIT_OK;
  } catch (error) {
    if (error instanceof UsageError) {
      deps.stderr.write(`ai-agent-checkup: ${error.message}\n`);
      if (fromArgs) deps.stderr.write('Run "ai-agent-checkup --help" for usage.\n');
      return EXIT_USAGE;
    }
    const detail = error instanceof Error && error.stack ? error.stack : String(error);
    deps.stderr.write(`ai-agent-checkup: internal error: ${detail}\n`);
    return EXIT_USAGE;
  }
}
