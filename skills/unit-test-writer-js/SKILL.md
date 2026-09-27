---
name: unit-test-writer-js
description: Writes, updates and runs unit tests for JavaScript/TypeScript (Node, browser, React) with the framework the project already uses (node:test, Vitest, Jest, Mocha). Use to add tests for a change or run the suite of a JS/TS project.
uses: [testing-principles]
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

## Idioms

- Follow the existing layout: `test/`, `__tests__/` or `*.test.ts` next to the code, same naming and imports as neighbouring tests.
- Expected errors: `await assert.rejects(...)`, `await expect(p).rejects.toThrow(...)`.
- Every async test `await`s (or returns) its promise; otherwise it passes without testing anything.
- Time: fake timers (`vi.useFakeTimers()`, `jest.useFakeTimers()`, `mock.timers.enable()` in node:test).
- HTTP boundaries: msw or nock if the project has them, or a stubbed `fetch`. Files: `fs.mkdtempSync(path.join(os.tmpdir(), 'x-'))`.
- Restore mocks and env vars in `afterEach` (`vi.restoreAllMocks()`, `jest.restoreAllMocks()`, `mock.restoreAll()`).
- TypeScript: typed tests; no `any`/`as` to silence the compiler. For partial fixtures use `@total-typescript/shoehorn` (`fromPartial`) if the project already has it.
- React: Testing Library queries by role/label (`getByRole`, `getByLabelText`), `userEvent` for interaction, `findBy*` for async; assert what the user sees.

## Coverage (only when asked)

`npx vitest run --coverage` · `npx jest --coverage` · `node --test --experimental-test-coverage`
