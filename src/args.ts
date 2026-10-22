import { parseArgs } from 'node:util';
import { errorMessage, UsageError } from './errors.js';
import { FAIL_ON_VALUES, OUTPUT_FORMATS, type FailOn, type OutputFormat } from './types.js';

export const HELP_TEXT = `Usage: ai-agent-checkup [path] [options]

Checks GitHub Actions workflows that run AI coding agents (Claude Code, Codex,
Gemini CLI, Copilot and others) for ways an outside user can use prompt
injection to reach secrets or write access. Prints one checklist with a
severity and a fix for every problem.

Arguments:
  path                    Repository directory (reads .github/workflows/*.yml
                          and *.yaml) or one workflow file (default: .)

Options:
  --format <format>       text, markdown, json or sarif (default: text)
  --fail-on <severity>    Exit with code 1 if a problem has this severity or
                          higher: high, medium, low or any
  -o, --output <file>     Write the report to a file instead of stdout
  --no-color              Disable colors
  --list-agents           List the AI agents it recognizes
  -h, --help              Show this help
  -v, --version           Show the version

Nothing is sent over the network.

Exit codes: 0 success, 1 --fail-on matched, 2 usage error.
`;

export interface CliOptions {
  path: string;
  format: OutputFormat;
  failOn: FailOn | null;
  output: string | null;
  noColor: boolean;
}

export type ParsedArgs =
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'list-agents' }
  | { kind: 'run'; options: CliOptions };

/** Parses a fail-on value. An empty string means never fail. */
export function parseFailOn(value: string): FailOn | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === '') return null;
  if (!(FAIL_ON_VALUES as readonly string[]).includes(normalized)) {
    throw new UsageError(`Unknown fail-on value "${value.trim()}". Use high, medium, low or any.`);
  }
  return normalized as FailOn;
}

export function parseCliArgs(argv: string[]): ParsedArgs {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        format: { type: 'string' },
        'fail-on': { type: 'string' },
        output: { type: 'string', short: 'o' },
        'no-color': { type: 'boolean' },
        'list-agents': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (error) {
    throw new UsageError(errorMessage(error));
  }
  const { values, positionals } = parsed;
  if (values.help) return { kind: 'help' };
  if (values.version) return { kind: 'version' };
  if (values['list-agents']) return { kind: 'list-agents' };
  if (positionals.length > 1) throw new UsageError('Only one path can be checked at a time.');

  const format = values.format ?? 'text';
  if (!(OUTPUT_FORMATS as readonly string[]).includes(format)) {
    throw new UsageError(`Unknown format "${format}". Use text, markdown, json or sarif.`);
  }
  if (values.output === '') throw new UsageError('--output needs a file name.');

  return {
    kind: 'run',
    options: {
      path: positionals[0] ?? '.',
      format: format as OutputFormat,
      failOn: parseFailOn(values['fail-on'] ?? ''),
      output: values.output ?? null,
      noColor: values['no-color'] ?? false,
    },
  };
}
