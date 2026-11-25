# JSDoc or `.ts`: comparison for the owner (#52, 2026-11-25)

Not decided here: this is the input to the decision, and no file became `.ts`. Measured on
`packages/shared` (51 modules, 537 KiB, 64 test files with 448 tests), on copies outside the
repository, with Node 24.22.2 and TypeScript 6.0.3 on Linux (WSL2); medians of 5 to 9 runs.

| | JavaScript with JSDoc (today) | `.ts` |
| --- | --- | --- |
| Build step | none | none for Node (it strips the types); one for the pages, whose 51 `<script>` tags read `packages/shared` as is: 0.4 s to transpile the package, 1.8 s with `tsc` (emit and source maps) |
| Type check | `npm run typecheck`, whole repository: 5.5 s (two runs of `tsc`: the engine, then the pages) | about the same checker and options |
| Loading the 51 modules, Node | 19 ms | 82 ms (types stripped at load) |
| Loading the 51 modules, Electron as Node | 17 ms | 89 ms |
| `npm start`: before Electron (`prestart`) | 5.2 s | 5.2 s, plus the build of the pages' copy (0.4 s or 1.8 s, above) |
| `npm start`: Electron's launch to Home on screen | 2.05 s (2.04 to 2.06) | 2.12 s (2.10 to 2.29), the types stripped at load in the main process; the pages read JavaScript in both |
| Tests of the package | 0.58 s | 0.86 s (modules redirected to the `.ts` copy; one test that reads a source by path fails under the redirect, for both copies) |
| Packaging | the sources as they are | built first: Node refuses to strip types under `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), where the packaged app holds the `@craftorio/*` copies |
| Source maps | not needed | 526 KiB for the package when built; stripping keeps line numbers and needs none |
| `require` | `require('./x')` | `require('./x.ts')`: an extensionless `require` of a `.ts` is `MODULE_NOT_FOUND`, so every specifier changes, also in the engine, the tests and the fronts |
| Conversion | a file opts in with comments only | renamed with no annotation, the package has 2,408 errors (this checker's `checkJs` options were not applied: plain `tsc`, not `strict`) |

## What was not measured

- **`npm start` as one command**: its two parts were timed apart. The launch is
  `scripts/smoke.js --startup-budget` (simulated, scratch workspace; it includes seeding 300 runs and
  2,000 transcripts, the same in both), 5 runs each, alternated, with the main process's requires of
  the package redirected to a copy. The sum of `prestart` and a build is added up, not run.
- **What agents write better**: it needs real runs of the same tasks in both forms, which cost money.
  What this issue shows is only the JSDoc side: the 20 files most changed and fixed opted in (610 type
  errors at the start) with comments and casts alone, the parsed code of every touched file identical
  before and after.

## Reading

- JSDoc costs nothing to run or package and lets a file enter by itself; its price is verbose casts
  (an event target, a `querySelector`) and globals declared by hand (`packages/contract/page-globals.js`).
- `.ts` reads better and types globals and class members directly, but a package that the pages load
  needs a build in `start`, `build` and the tests, and one for the packaged app.
- **Recommendation**: stay with JSDoc and the ratchet until most of the engine is checked; if `.ts` is
  wanted, try it first on a package no page loads, with a build for the packaged app.
