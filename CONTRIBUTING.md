# Contributing to ai-agent-checkup

Thanks for contributing. Please be respectful in issues, reviews and code.

## Setup

You need Node.js 24 (see `.nvmrc`).

```bash
npm ci
npm run all
```

`npm run all` runs the format check, lint, type check, tests and build, which is the same as CI.

| Script              | What it does                                                              |
| ------------------- | ------------------------------------------------------------------------- |
| `npm test`          | Runs the tests with Vitest. They never use the network.                   |
| `npm run lint`      | Runs ESLint.                                                              |
| `npm run format`    | Formats everything with Prettier.                                         |
| `npm run typecheck` | Type-checks with `tsc` (no output files).                                 |
| `npm run build`     | Bundles the Action into `dist/` and the CLI into `lib/`.                  |
| `npm run demo`      | Runs the CLI against the example workflows in `test/fixtures/repos/demo`. |

## Committing `dist/`

GitHub runs the bundled `dist/index.js`, so it is committed. After changing anything in `src/`,
run `npm run build` and commit `dist/` together with your change. CI fails if `dist/` is out
of date. `lib/` is the npm package bundle; it is built by `npm pack` and is not committed.

## Adding an agent

The agents are listed in `src/agents.ts`. Read the action's `action.yml` and documentation, add
an entry with its inputs and defaults, and add tests to `test/agents.test.ts` and
`test/rules.test.ts`. Name the source of every fixed version in the entry.

## Changing a check

Every finding needs a severity, an explanation and a concrete fix. Add a fixture workflow for new
cases under `test/fixtures/repos/`. Fixtures are made-up workflows; do not copy workflows from
other projects or name other projects as vulnerable.

The example output in `README.md` must match `npm run demo` exactly, and a test checks this. All
text files must be ASCII.

## Pull requests

Fill in the PR template, link the issue you are fixing, and include tests.
