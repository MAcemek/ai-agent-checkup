import * as core from '@actions/core';
import { tmpdir } from 'node:os';
import { runAction } from './action-main.js';

await runAction({
  getInput: (name) => core.getInput(name),
  cwd: process.cwd(),
  tempDir: process.env.RUNNER_TEMP || tmpdir(),
  info: (message) => core.info(message),
  writeSummary: async (markdown) => {
    try {
      await core.summary.addRaw(markdown).write();
    } catch (error) {
      core.warning(`Could not write the job summary: ${String(error)}`);
    }
  },
  setOutput: (name, value) => core.setOutput(name, value),
  setFailed: (message) => core.setFailed(message),
});
