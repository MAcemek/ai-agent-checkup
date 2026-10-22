/**
 * Runs the ai-agent-checkup CLI against the example workflows in test/fixtures/repos/demo.
 *
 *   npm run demo
 *   npm run demo -- --format markdown
 *
 * Nothing leaves the machine. The example output in README.md is this script's output.
 */
import { runDemo } from '../test/helpers/demo.js';

process.exitCode = await runDemo(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  env: process.env,
});
