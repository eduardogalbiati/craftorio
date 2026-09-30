---
name: unit-test-writer-js
description: Writes, updates and runs unit tests for JavaScript/TypeScript (Node, browser, React) with the framework the project already uses (node:test, Vitest, Jest, Mocha). Use to add tests for a change or run the suite of a JS/TS project.
uses: [testing-principles, long-commands]
---

# Unit tests: JavaScript / TypeScript

## Framework and commands (never switch frameworks)

| Signal in the repository | Framework | Whole suite | One file / test |
|---|---|---|---|
| `vitest` in devDependencies | Vitest | `npx vitest run` | `npx vitest run <path> -t "<name>"` |
| `jest` in devDependencies | Jest | `npx jest` | `npx jest <path> -t "<name>"` |
| `mocha` in devDependencies | Mocha | `npx mocha` | `npx mocha <path> --grep "<name>"` |
| none of the above, `"test": "node --test ..."` | node:test | `node --test` | `node --test --test-name-pattern "<name>" <path>` |

- The official suite command is `scripts.test` in `package.json`: use it for the full run.
- Package manager from the lockfile: `package-lock.json` → npm, `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn.
- No framework yet: plain Node → `node:test` + `node:assert/strict`; Vite/TS front end → Vitest.
- Always non-interactive (`vitest run`, never watch mode; set `CI=true` if needed).
- While iterating run single files; run the full suite once at the end.
- Dependencies first: a fresh checkout (each run has its own worktree) has no `node_modules`.
  When it is missing or the lockfile changed, install with the lockfile's manager
  (`npm ci` · `pnpm install --frozen-lockfile` · `yarn install --frozen-lockfile`) before running tests.

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

A program left running from the worktree locks its files: the next `npm ci` fails with EBUSY/EPERM
and the run cannot recover by itself.
- Electron UI checks quit on their own: the script calls `app.quit()` when done **and** after a hard
  timeout (`setTimeout(() => app.exit(1), 60000)`), on errors too, as `scripts/smoke.js` does when the
  project has one.
- UI checks never call real (paid) models: run them through the project's own check scripts
  (`scripts/smoke.js` when it has one), with its simulation-only switch set if it has one
  (`MULTIAGENT_SIMULATION_ONLY=1`) and a scratch workspace; never a hand-written script that launches
  the app's main process directly.
- Run them in the **foreground** with a command timeout (`npx electron check.js`). Never start them in
  the background, and never stop them with TaskStop or by killing `npx`: that kills the launcher and
  leaves `electron.exe` running.
- The same for servers: start them inside the test (and close them in `after`/`afterAll`), not as a
  separate background command.

## Screenshots of UI changes

UI paths: `src/renderer/**`, `src/ui/**`, `src/components/**`, `app/**`, `pages/**`, `public/**`,
`*.css`/`*.scss`, `*.html`, `*.jsx`/`*.tsx`/`*.vue`/`*.svelte` (and whatever the project's docs call UI).
- The command: a `screenshot` script in `package.json` (`npm run screenshot -- <options>`), or the one
  the project's docs (README, CLAUDE.md, AGENTS.md) describe. Read its usage line (the top of the
  script) for the screens and options it has.
- Before = the base without a checkout: use the command's option for a git ref if it has one
  (`--ref origin/<base>`); without one, capture only "after" and say so.
- Example (this orchestrator's own repository; the script writes `screenshots.json` itself):
  1. `npm run screenshot -- --view settings --tab general --ref origin/main --out <run_dir>/screenshots --name settings-before`
  2. `npm run screenshot -- --view settings --tab general --out <run_dir>/screenshots --name settings-after --caption "Settings > General" --before settings-before.png`

## Coverage (only when asked)

`npx vitest run --coverage` · `npx jest --coverage` · `node --test --experimental-test-coverage`
