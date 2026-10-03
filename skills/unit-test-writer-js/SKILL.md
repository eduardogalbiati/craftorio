---
name: unit-test-writer-js
description: Writes, updates and runs unit tests for JavaScript/TypeScript (Node, browser, React) with the framework the project already uses (node:test, Vitest, Jest, Mocha). Use to add tests for a change or run the suite of a JS/TS project.
uses: [testing-principles, long-commands]
summary: "Framework detection, commands, idioms per language"
used_by: "test writer"
---

# Unit tests: JavaScript / TypeScript

## Framework and commands (never switch frameworks)

| Signal in the repository | Framework | Whole suite | One file / test |
|---|---|---|---|
| `vitest` in devDependencies | Vitest | `npx vitest run` | `npx vitest run <path> -t "<name>"` |
| `jest` in devDependencies | Jest | `npx jest` | `npx jest <path> -t "<name>"` |
| `mocha` in devDependencies | Mocha | `npx mocha` | `npx mocha <path> --grep "<name>"` |
| none of the above, `"test": "node --test ..."` | node:test | `node --test` | `node --test --test-name-pattern "<name>" <path>` |

- The official suite command is `scripts.test` in `package.json`: the orchestrator's suite step
  runs it after your step (never run it yourself then); only without a suite step, use it for the full run.
- Package manager from the lockfile: `package-lock.json` → npm, `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn.
- No framework yet: plain Node → `node:test` + `node:assert/strict`; Vite/TS front end → Vitest.
- Always non-interactive (`vitest run`, never watch mode; set `CI=true` if needed).
- While iterating run single files, filtered to the tests you write (`--test-name-pattern`, `-t`,
  `--grep`), a slow file at most once per round; the whole suite is the orchestrator's (see
  testing-principles: time budget, pre-existing failures).
- Which files: the code → tests map when the project has one (`docs/agents/test-map.md` here; see
  testing-principles). Output for an agent: this orchestrator's `npm test -- <files>` prints one
  failures-only JSON line in agent mode (`scripts/test-reporter-agent.js`, usable by hand with
  `node --test --test-reporter=./scripts/test-reporter-agent.js <path>`); Vitest has its own
  `--reporter=agent`; Jest: `--silent` and read only the `●` failures.
- Dependencies are ready: the engine links each run's `node_modules` from a shared cache,
  installed once per lockfile. Never run `npm ci` (or a frozen pnpm/yarn install) and never delete
  `node_modules`: through the link it would empty the cache for every run. Adding a test
  dependency with the package manager (`npm install -D <pkg>`) is fine: the engine installs the
  new lockfile into the cache after your turn. Only when your prompt says the dependencies are not
  cached for this project, install them yourself with the lockfile's manager when missing.

## Running the tests: timeouts and turns

- Pass the Bash tool's `timeout` on **every** test or build command (e.g. `timeout: 300000` for
  one focused file in this orchestrator, the suite's budget for the whole suite), never the default
  120 s: a command cut there returns no result and the turn is lost (long-commands). Never start a
  test command in the background and wait for its log in a loop: run it in the foreground.
- Measure your first focused run (the runner's duration line). A file that takes more than a
  minute is a slow file: from then on run it with a narrower filter (`--test-name-pattern "<name>"`, `-t "<name>"`, `--grep "<name>"`, one file; e.g. the Electron-based screenshot tests),
  at most once per round; a command that may take longer than the tool's maximum goes to the
  orchestrator's suite step or runs with a narrower filter.
- Fewer, bigger turns: write all the tests of a behaviour in one edit, then run them once; never
  one assertion per edit-and-run cycle. Each turn re-reads your whole context.

## Idioms

- Follow the existing layout: `test/`, `__tests__/` or `*.test.ts` next to the code, same naming and imports as neighbouring tests.
- Expected errors: `await assert.rejects(...)`, `await expect(p).rejects.toThrow(...)`.
- Every async test `await`s (or returns) its promise; otherwise it passes without testing anything.
- Time: fake timers (`vi.useFakeTimers()`, `jest.useFakeTimers()`, `mock.timers.enable()` in node:test).
- HTTP boundaries: msw or nock if the project has them, or a stubbed `fetch`. Files: `fs.mkdtempSync(path.join(os.tmpdir(), 'x-'))`.
- Restore mocks and env vars in `afterEach` (`vi.restoreAllMocks()`, `jest.restoreAllMocks()`, `mock.restoreAll()`).
- TypeScript: typed tests; no `any`/`as` to silence the compiler. For partial fixtures use `@total-typescript/shoehorn` (`fromPartial`) if the project already has it.
- React: Testing Library queries by role/label (`getByRole`, `getByLabelText`), `userEvent` for interaction, `findBy*` for async; assert what the user sees.

## UI checks and long-running programs (Electron, dev servers)

A program left running from the worktree locks its files (EBUSY/EPERM for the next install or
build) and the run cannot recover by itself. `npm run screenshot` waits for the machine's
screenshot slot (one Electron screenshot at a time across all runs): waiting is normal.
- Electron UI checks quit on their own: the script calls `app.quit()` when done **and** after a hard
  timeout (`setTimeout(() => app.exit(1), 60000)`), on errors too, as `scripts/smoke.js` does when the
  project has one.
- UI checks never call real (paid) models: run them through the project's own check scripts
  (`scripts/smoke.js` when it has one), with its simulation-only switch set if it has one
  (`MULTIAGENT_SIMULATION_ONLY=1`: set in the environment, never as a `VAR=` prefix, which headless
  CLIs refuse) and a scratch workspace (this orchestrator: the run's own, `MULTIAGENT_WORKSPACE`,
  already set; never a path under the owner's workspace `runs/`); never a hand-written script that
  launches the app's main process directly.
- Run them in the **foreground** with a command timeout (`npx electron check.js`). Never start them in
  the background, and never stop them with TaskStop or by killing `npx`: that kills the launcher and
  leaves `electron.exe` running.
- The same for servers: start them inside the test (and close them in `after`/`afterAll`), not as a
  separate background command.

## Coverage (only when asked)

`npx vitest run --coverage` · `npx jest --coverage` · `node --test --experimental-test-coverage`
