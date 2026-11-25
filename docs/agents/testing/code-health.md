# File size, code health and type checking

The file size ratchet (#334), the code health check (#344) and type checking (#346).

## File size ratchet (#334)

- **The rule**: every source `.js` file (`packages/`, `apps/`, `scripts/`: `scripts/source-tree.js`) has at most 1,000 lines (counted the
  same on every OS, CRLF normalized). `scripts/file-size-ratchet.js` checks it
  (`test/file-size-ratchet-334.test.js`; `node scripts/file-size-ratchet.js` reports by hand).
- **Exceptions only shrink**: the files over the cap when the rule came are in its `EXCEPTIONS`,
  each with its line count then. A listed file that grows past its count fails: split it, never
  raise the count. A lower count may replace the recorded one. A listed file at 1,000 lines or
  fewer (or gone) fails until it leaves the list.
- **No new exception by default**: adding a file to `EXCEPTIONS` needs the owner's ok written in
  its issue; code review checks it.
- **How to split** a file near the cap, the usual ways: a screen into its view's folder
  (its front's `views/<view>/`, one file per part, #154); the service into one file per area
  (`packages/engine/service/areas/`, `packages/engine/service/channels/`, #155); the run into its modules
  (`packages/engine/engine/run/`, methods on `WorkflowRun.prototype`, #250). Each new file documents itself
  in its header comment (the code map is built from it).

## Code health (#344)

`scripts/code-health.js` measures every function of the sources (`packages/`, `apps/`, `scripts/`) with a real parser
(`acorn`, a pinned dependency: the app measures JavaScript with it too, #385): lines, cyclomatic complexity (1 + each `if`, `else if`,
ternary, `&&`, `||`, `??`, `case`, `catch` and loop; a nested function counts on its own), max
nesting and parameter count. `test/code-health-344.test.js` holds both ratchets; the line ratchet
above stays as it is.

- **Complexity limit 25**: a function above 25 fails. The functions above it when the rule came
  are in `COMPLEXITY_EXCEPTIONS` as `'<file>:<function name>': value`: a listed function may not
  grow (lower the value when it shrinks), and one at 25 or below (or gone) fails until it leaves
  the list. A callback is named after its call and its enclosing function
  (`startWorkflowRun/on(event) callback`); a name repeated in a file gets ` #2`. No new exception
  without the owner's ok in its issue.
- **Duplication**: a block of 8 or more lines (trimmed, blank lines dropped) found in two places is
  a duplicated block; `DUPLICATION_BASELINE` holds the count per file. A new duplicate fails: call
  the existing code or move it to a shared helper. A file with fewer than its baseline fails until
  the baseline is lowered. `node scripts/code-health.js --duplicates` shows where each block sits.
- **Reading the report**: `node scripts/code-health.js` prints the distribution (median, p90,
  p99, max per area) and the top 20 functions; `--json` prints every function. `--check` runs both
  ratchets. `--hotspots` ranks by complexity x churn (#356, after ToolSeeds' `turbulence`): churn
  is the commits that touched a file, without merges, the commit that created it and the commits
  of `.git-blame-ignore-revs` (mass moves and reformats: add one there), following renames. Each
  file has its total complexity and its worst function; files sit in four quadrants on `log1p`
  axes split at the medians: **Danger Zone** (complex and often changed: refactor these first),
  Cowboy Code (complex, rarely changed), Fertile Ground (simple, often changed), Healthy Closure.
  The Danger Zone comes first, ranked by `sqrt(u² + v²)`, u and v each axis's `log1p` divided by
  its maximum (files against files, functions against functions; the pure core shared with the
  Architecture tab, `packages/shared/architecture-model.js`, #356); a function's churn is its file's. The
  output is deterministic (sorted keys, dates from the commits); churn git cannot read (a shallow
  clone) is `null` and listed under `missing`, never 0.
- **How to split a function** that is over the limit or grew: pull each branch body that does its
  own job into a named function (one per `case` or per kind of event, often a lookup table of
  handlers instead of a long `switch`/`if` chain); return early instead of nesting; move a derived
  value (a label, a status, a cost) into a small helper next to the data it reads, and call the
  existing helper when one already computes it (#347). Keep the new functions in the same file or
  module unless the file nears the line cap.
- **Literal defaults count as branches** (`x || []`, `x ?? {}`): in a file that is type checked
  (below), drop the default of a field the types say is always present (e.g. `roadmap.stages`), and
  keep the ones for what can really be missing (an old file, an optional field, a caller outside
  the checked files). Each removal needs a test that reaches it.

## Type checking (#346, #52)

TypeScript's checker on the JavaScript, with JSDoc types, file by file: no file is converted.
`typescript` is a dev dependency; `jsconfig.json` keeps `checkJs` off (strict null checks on;
implicit `any`, `this` and catch variables allowed, so a file opts in without a rewrite).

- **A new file starts checked** (#52): a source file that is in none of `CHECKED`, `NEXT` and
  `UNCHECKED` (the files older than the rule) must have `// @ts-check`; `npm run check` names the one
  that does not. A moved file is new. Generated and vendored files (a `generated/` or `vendor/`
  folder) and tests are out. No file enters `UNCHECKED`; one that opts in or is deleted leaves it.
- **Opt a file in**: put `// @ts-check` in its leading comments (first line, or after a `/* global */` line), annotate what the
  checker cannot infer (`/** @param {...} */`, a `/** @type {...} */ (x)` cast for a local set in a
  callback), and add the file to `CHECKED` in `scripts/typecheck.js` (removing it from `NEXT`
  or `UNCHECKED`). An option whose default is `null` or `{}` is typed where it is declared
  (`/** @type {{ mock?: boolean }} */ { mock } = {}`), also when the function is in another file. Change code only where the checker finds a real bug, and say so in the PR.
- **The types** live in `packages/shared/types.js`: `RunSummary`, `RunEvent` (a union by `type`),
  `Roadmap`, `RoadmapStage`, `RoadmapItem`, `Workflow`, `WorkflowStep`, `SessionRecord`, matching
  what the code writes (a field that can be missing is optional). Import them with
  `/** @param {import('./shared/types').Roadmap} roadmap */` (the path relative to the file). A
  shape changes: change its typedef in the same commit.
- **The next files** (#52): `node scripts/typecheck.js --next` ranks the files that did not opt in by
  the commits of the last 60 days that fixed them (a subject that starts with "Fix"), then by those that
  changed them, with the errors tsc would report on each.
- **No silencing** (#52): in an opted-in file a `@ts-ignore`, a `@ts-nocheck` or a cast to `any` has its
  reason on the line (`// @ts-ignore: why`, `/** @type {any} */ (x) // why`), and `SILENCED` in
  `scripts/typecheck.js` holds the count per file: it only goes down. Type the value instead.
- **Screens** (#52): `packages/contract/page-globals.js` (types only, no page loads it) declares the
  globals the page scripts share (`t`, `api`, `window.X`); add the one a screen needs there. jsconfig.json
  has the browser's `dom` types for every checked file, so the checker does not say that an engine file
  uses a name Node lacks.
- **Run it**: `npm run typecheck` (`tsc --noEmit -p jsconfig.json`), or `node scripts/typecheck.js`
  for the checker, the ratchet and the coverage (`49 of 551 files checked`). `npm test` runs both through `test/typecheck-346.test.js` on
  every OS (a few seconds).
- **The ratchet** (`scripts/typecheck.js`): every opted-in file passes with no error; `CHECKED` is
  exactly the files that opted in, so a file that opted in cannot opt out (dropping its
  `// @ts-check` fails); `NEXT` is the owner's list of files to check next and only shrinks (a file
  of it that opted in fails until it leaves the list). The lists are sorted, one file per line.
