import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHECK_DEFINITIONS } from '../src/checks/definitions.js';
import { formatAgentList } from '../src/format/agents.js';
import { formatJson, formatReport } from '../src/format/index.js';
import { cell, formatMarkdown } from '../src/format/markdown.js';
import { artifactUri, formatSarif, SARIF_SCHEMA } from '../src/format/sarif.js';
import { formatText } from '../src/format/text.js';
import { scan } from '../src/scan.js';
import { CHECK_IDS, type Report } from '../src/types.js';
import { checkTexts } from './helpers/files.js';

const expected = (name: string) => readFileSync(`test/fixtures/expected/${name}`, 'utf8');

async function demo(): Promise<Report> {
  return scan('test/fixtures/repos/demo', process.cwd());
}

describe('output formats', () => {
  it('prints the expected text, Markdown, JSON and SARIF for the demo', async () => {
    const report = await demo();
    expect(formatText(report, { color: false })).toBe(expected('demo.txt'));
    expect(formatMarkdown(report)).toBe(expected('demo.md'));
    expect(formatJson(report)).toBe(expected('demo.json'));
    expect(formatSarif(report)).toBe(expected('demo.sarif.json'));
    expect(formatReport(report, 'sarif', { color: false })).toBe(expected('demo.sarif.json'));
  });

  it('colors the severity tags only when asked', async () => {
    const report = await demo();
    const ESC = String.fromCharCode(27);
    const colored = formatText(report, { color: true });
    expect(colored).toContain(`${ESC}[1m${ESC}[31m[HIGH]${ESC}[0m`);
    expect(colored).toContain(`${ESC}[33m[MEDIUM]${ESC}[0m`);
    expect(formatText(report, { color: false })).not.toContain(ESC);
  });

  it('says when there is nothing to report', () => {
    const none = checkTexts({});
    expect(formatText(none, { color: false })).toBe(
      'ai-agent-checkup 0.1.0\nPath: repo\nNo workflow files found in .github/workflows.\n\nNo AI agent steps found.\n\nStatic analysis of workflow files only. It cannot see repository settings, such as who can open issues or which secrets exist.\n',
    );
    const clean = checkTexts({
      'a.yml': 'on: push\njobs:\n  a:\n    steps:\n      - run: claude -p "x"\n',
    });
    expect(formatText(clean, { color: false })).toContain(
      'Scanned 1 workflow with 1 agent step.\n\nNo problems found.\n',
    );
    expect(formatMarkdown(clean)).toContain('**No problems found.**\n\n_Static analysis');
  });

  it('escapes Markdown table cells and HTML', () => {
    expect(cell('a|b\\c <x>\nnext')).toBe('a\\|b\\\\c &lt;x&gt; next');
  });
});

describe('SARIF', () => {
  it('is valid SARIF 2.1.0 for GitHub code scanning', async () => {
    const report = await scan('test/fixtures/repos/vulnerable', process.cwd());
    const sarif = JSON.parse(formatSarif(report)) as {
      $schema: string;
      version: string;
      runs: {
        tool: {
          driver: {
            name: string;
            version: string;
            informationUri: string;
            rules: {
              id: string;
              name: string;
              shortDescription: { text: string };
              fullDescription: { text: string };
              help: { text: string };
              helpUri: string;
            }[];
          };
        };
        results: {
          ruleId: string;
          ruleIndex: number;
          level: string;
          message: { text: string };
          locations: {
            physicalLocation: { artifactLocation: { uri: string }; region: { startLine: number } };
          }[];
        }[];
      }[];
    };
    expect(sarif.$schema).toBe(SARIF_SCHEMA);
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs).toHaveLength(1);
    const run = sarif.runs[0]!;
    expect(run.tool.driver).toMatchObject({ name: 'ai-agent-checkup', version: '0.1.0' });
    expect(run.tool.driver.rules.map((r) => r.id)).toEqual([...CHECK_IDS]);
    for (const rule of run.tool.driver.rules) {
      expect(rule.name).toMatch(/^[A-Z][A-Za-z]+$/);
      expect(rule.shortDescription.text).not.toBe('');
      expect(rule.helpUri).toBe('https://github.com/MAcemek/ai-agent-checkup#checks');
    }
    expect(run.results).toHaveLength(report.findings.length);
    for (const [i, result] of run.results.entries()) {
      const finding = report.findings[i]!;
      expect(run.tool.driver.rules[result.ruleIndex]?.id).toBe(result.ruleId);
      expect(['error', 'warning', 'note']).toContain(result.level);
      expect(result.message.text.startsWith(`${finding.title}: `)).toBe(true);
      const location = result.locations[0]!.physicalLocation;
      expect(location.artifactLocation.uri).toBe(`test/fixtures/repos/vulnerable/${finding.file}`);
      expect(location.region.startLine).toBe(finding.line);
    }
    expect(run.results.map((r) => r.level)).toContain('error');
    expect(CHECK_DEFINITIONS.map((d) => d.id)).toEqual([...CHECK_IDS]);
  });

  it('makes paths relative to the repository root', async () => {
    const report = await demo();
    const finding = report.findings[0]!;
    expect(artifactUri(report, finding)).toBe(
      'test/fixtures/repos/demo/.github/workflows/codex-review.yml',
    );
    expect(artifactUri({ ...report, path: '.' }, finding)).toBe(
      '.github/workflows/codex-review.yml',
    );
    expect(artifactUri({ ...report, path: './sub/' }, finding)).toBe(
      'sub/.github/workflows/codex-review.yml',
    );
    expect(
      artifactUri({ ...report, target: 'file', path: 'x.yml' }, { ...finding, file: 'x.yml' }),
    ).toBe('x.yml');
  });
});

describe('formatAgentList', () => {
  it('lists every agent', () => {
    const text = formatAgentList();
    expect(
      text.startsWith(
        'ai-agent-checkup recognizes these AI agents.\n\nGitHub Actions\n  claude-code-action',
      ),
    ).toBe(true);
    expect(text).toContain('\n  codex-action                  openai/codex-action\n');
    expect(text).toContain(
      '\nAgent CLIs in run: steps\n  claude-cli                    Claude Code CLI\n',
    );
    for (const line of text.split('\n')) expect(line.length).toBeLessThanOrEqual(100);
  });
});
