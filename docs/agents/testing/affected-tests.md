# Affected tests and session streams

The affected tests, the slow suite and who runs what (#212); reading a session stream (#574).

## Affected tests, the slow suite, who runs what (#212)

- **Affected tests**: `packages/engine/engine/affected-tests.js` (no model) builds the import graph from
  `require` / `import` and lists the test files that import, directly or transitively, a file
  changed since the base (merge-base, uncommitted and untracked files included), plus the test
  files changed themselves. A changed file nothing imports (a workflow YAML, a renderer script a
  test reads with `fs`) reaches the test files whose code names its path. A test is also selected
  when a path it reads from disk changes (#695, `packages/engine/engine/test-reads.js`), whatever
  imports the changed file: the first argument of an `fs` read (`readFileSync`, `readdirSync`,
  `existsSync`, …) given as a literal (relative to the repository root), a `path.join` of
  `__dirname` (or a constant built from it) and literals, a template literal or `+` of literal
  constants (`${DIR}/spec.md`), or a constant holding one; a local helper that reads its parameter
  (`const read = (rel) => fs.readFileSync(path.join(ROOT, rel))`) reads what each call passes. A read path
  reaches the file at it and every file under it (a listed folder); a non-literal argument before a
  literal stands for any folders (`path.join(ROOT, dir, 'views')` → `**/views`, so a screen folder
  added under `fronts/plan/views/` selects `apps/desktop/test/view-folders.test.js`); a read that
  cannot be resolved (a temp folder, an environment variable) adds nothing. A test that reads a
  folder through a helper makes the read visible in its own code. A shared root
  (`package.json`, a lockfile, `scripts/test.js`) or a project without a JS/TS graph selects the
  whole suite. `node scripts/affected-tests.js --base main` prints the files and why each was
  chosen (`imports packages/engine/domains/roadmap/roadmap.js`); `--files` prints only the paths, for `npm test -- <files>`.
- **Slow tests**: files under `packages/engine/test/slow/` or named `*.slow.test.js` (whole simulated runs) never
  join the affected set; they run with the full suite only. Put a test that simulates a whole run
  there, and keep big files split by area so `node --test` runs them in parallel (one file's tests
  run in sequence). See "Whole simulated runs" below.
- **Who runs what**: the suite step with `scope: affected` (software-development and the local
  hero) runs the affected files every round, and the whole suite at most once per run, when the
  affected files first pass (log `suite-<round>-full.log`); the files that failed in a round join
  the next rounds' set. After that whole suite, pass or fail, the next rounds select the files
  affected by the changes since its commit (slow ones included) plus the files that failed, never
  the whole suite again (#553); only a round whose changes touch a shared root runs a second whole
  suite, and its `selection.why` says so. A whole suite that timed out or failed outside a known
  file does not count: the next round runs it again. A selection too long for the command line
  (#400) reaches `scripts/test.js` as a list file named by `MULTIAGENT_TEST_FILES` (one path per
  line) and still runs filtered (`scope: files`, no suite slot); a runner that cannot read the list
  (its npm script is not `node <file>` naming the variable) runs the whole suite, and the message
  says why; a runner whose own counts show it ignored the list (files outside it, or as many tests
  as the run's whole suite) is reported as a whole run (`list_ignored`). Without `scope` (test-batch, E2E release) a suite step runs the whole suite.
  Inside `scripts/test.js` no test file is on a child's command line (#597): the whole suite, a
  selection in its arguments, a `MULTIAGENT_TEST_FILES` list and `--workspace` alike, each time-budget
  group's files, concurrency, timeout and reporters go to a JSON file in its temp folder, and the
  group's child (`node scripts/test.js --child <file>`) starts them with node:test's `run()`, so the
  32,767-character limit of a Windows command line no longer bounds the number of test files.
  Agents never run suites in their turn: they end a turn with a ```` ```run-tests ```` block (one
  test file per line, or `affected`), the engine runs them like the suite step (log
  `logs/tests-<step>-<n>.log`) and resumes the agent with a summary only (counts, each failure's
  test, file and first 3 lines, the log's path), at most 3 times per turn. One focused test file
  inside a turn stays allowed, with a timeout.
- **One whole suite at a time per machine** (#455): the per-test budgets (#402) were measured
  with one suite on the machine, so a whole-suite round (not a focused list of files, not the
  simulated suite) takes the machine-wide `suite` slot (`packages/engine/engine/machine-slot.js`,
  `<os tmp>/multiagent-orchestrator/locks/suite.slot`) before its command, and frees it when the
  command ends, however it ends. An agent's own whole `npm test` (agent mode, no file list) takes
  the same slot (agents get `MULTIAGENT_LOCKS_DIR` set to that folder); the suite step's child
  inherits it through `MULTIAGENT_SUITE_SLOT`. While another run holds it, the round waits and
  the run logs `kind: suite_slot` "suite: waiting for the suite slot (run …, pid …)"; the wait is
  not counted in the round's timeout or duration. A holder whose process is gone, or a hold older
  than `SUITE_MAX_HOLD_MS` (the largest suite timeout plus a margin), is taken over. The base
  check (#405) takes the same slot for its whole suite (#527) and waits for it the same way.
- **Agent mode** (#219): `npm test` detects an agent (`isAgentMode` in
  `packages/engine/engine/agent-test-report.js`: `MULTIAGENT_AGENT_MODE=1/0` wins, then CI or a terminal stays
  human, then `MULTIAGENT_SIMULATION_ONLY` or an agent CLI's variable) and prints one failures-only
  JSON line (`scripts/test-reporter-agent.js`: counts, per failure the test, file, line, 3 lines of
  error, expected/actual; `kind: file` for a file that could not run; per-file counts on focused
  runs) plus the full flow's result; the spec report goes to `MULTIAGENT_TEST_HUMAN_LOG` (default
  `.test-output/human.log`). The suite step and test requests set both variables and read the JSON
  first (`parseFailures`, `parseCounts`), the human report next to the log (`<log>.human.log`).
- **Code → tests map** (#219): `docs/agents/test-map.md` (derived, gitignored, `npm run docs`)
  lists for every source file its direct tests, then those reaching it through other files (the
  affected-tests graph, `testMap`). A step with `test_map: true` gets the same map of its checkout
  as `{{ test_map }}` (`<run_dir>/test-map.md`).
- **Tests first** (AI Development, local hero, #220): the test writer writes acceptance tests before
  the code; the suite step `red_check` (`files` + `expect: red`) runs them once; the developer has
  `protect_files` on them. There the rule of #47 reads: **the developer never edits the acceptance
  tests written before it, and may add internal tests**. Every other workflow keeps "the developer
  never writes tests" (`edits_tests: false`).
- **Mock runs in tests**: a test that runs the mock provider sets `MULTIAGENT_MOCK_DELAY_SCALE`
  (0.05 or less) and waits on events (`workflow.finished`, `approval.requested`), not on timers.

## Reading a session stream (#574)

A script that counts what agents did reads each run with `readRunRecord(runDir)` (storage/files.md, "Old
runs"), so an older run shape is upgraded first (#350), and walks its `events`: `session.opened`
gives the session's `agent` and `cwd`, and each `session.stream` event whose `item.kind` is
`tool_call` is one tool call, `item.name` (`Read`, `Edit`, `Write`, `Bash`, ...) with its
`item.input` (`file_path`, `command`). Paths are absolute in the session's worktree, with either
slash: make them relative to `cwd`. `sessions/<id>.jsonl` holds the same events per session; read
`events.jsonl` so the upgrade applies. `scripts/docs-usage.js` does this (`npm run docs:usage`);
its tests build fixture run folders (`test/docs-usage.test.js`).
