import { AGENTS } from '../agents.js';
import { wrap } from './shared.js';

const ID_WIDTH = 30;
const PAD = ' '.repeat(ID_WIDTH + 2);

/** The text printed by --list-agents. */
export function formatAgentList(): string {
  const lines: string[] = ['ai-agent-checkup recognizes these AI agents.', '', 'GitHub Actions'];
  for (const agent of AGENTS) {
    if (agent.kind !== 'action') continue;
    lines.push(`  ${agent.id.padEnd(ID_WIDTH)}${agent.uses.join(', ')}`);
    lines.push(...wrap(agent.notes, 100, PAD, PAD));
  }
  lines.push('', 'Agent CLIs in run: steps');
  for (const agent of AGENTS) {
    if (agent.kind !== 'cli') continue;
    lines.push(`  ${agent.id.padEnd(ID_WIDTH)}${agent.name}`);
    lines.push(...wrap(agent.notes, 100, PAD, PAD));
  }
  return `${lines.join('\n')}\n`;
}
