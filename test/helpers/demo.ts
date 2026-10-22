import { runCli, type CliDeps } from '../../src/cli-main.js';

export const DEMO_PATH = 'test/fixtures/repos/demo';

/** Runs the real CLI against test/fixtures/repos/demo. Must run from the repository root. */
export async function runDemo(
  extraArgs: string[],
  io: Pick<CliDeps, 'stdout' | 'stderr' | 'env'>,
): Promise<number> {
  return runCli([DEMO_PATH, ...extraArgs], {
    cwd: process.cwd(),
    stdout: io.stdout,
    stderr: io.stderr,
    env: io.env,
  });
}
