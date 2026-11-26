// The `type: suite` step (#177): a step without an agent that runs the project's whole test suite
// once per round in the run's worktree, so no agent turn stays open (and no context fills up) while
// it runs. The command is the step's `command` (a template, e.g. "{{ inputs.test_command }}") or,
// when it renders empty, the one the worktree's files give (`detectTestCommand`: package.json's test
// script → `npm test`, go.mod → `go test ./...`, ...). The whole output goes to
// <run_dir>/logs/suite-<round>.log; the failing tests are read from it (`parseFailures`: node:test
// spec and TAP, Jest, pytest, go test, dotnet test, Maven) as { test, file, error } (the error's
// first lines). Failures the run already knows fail on the base too (`preexisting`, the test
// writer's pre-existing failures, #101) are reported apart and never fail the step.
// The step tells pre-existing failures apart by itself (#211): when tests fail, it runs only their
// test files in the base checkout (`base()`, the run's <run_id>-base worktree), same command filtered
// to those files (`filteredCommand`: npm/pnpm/yarn test or run <script>, pytest, node --test), log
// logs/suite-<round>-base.log. A test failing there too is pre-existing (`preexisting_failures` in the
// output: the engine adds them to the run's list and to the project's base-health store, #405); files
// the base does not have are the run's. The base's result per file is cached by base commit + file
// (<workspace>/cache/base-tests/<commit>.json), so the next round and other runs reuse it.
// A step with `base_check: false` (#260, release.yaml: its worktree is the base itself) gets no
// `base`: nothing is checked there, every failing test fails the step.
// The suite runs as from a shell (#210) with the allowlisted environment (#470, child-env.js plus the
// workflow's env.passthrough): `suiteEnv` drops the app's variables (Electron's, npm's, an
// inspector in NODE_OPTIONS that forces node --test to one file at a time, the scratch workspace that
// every test process would share) and gives the suite its own lock folder (CRAFTORIO_LOCKS_DIR,
// <run>/locks), so a test never waits for the machine-wide screenshot slot held by other runs; a
// whole-suite round itself waits for the machine-wide `suite` slot (#455, `slot`). The
// log starts with what the child gets (parallelism, the variables removed). Without a step
// `timeout`, the timeout comes from the project's recent suite durations (<workspace>/cache/
// suite-durations.json: 3× the median, at least 10 min; 30 min with no history; never under the
// largest per-test budget plus a margin, #402 test-timeouts.js); a timeout names the test files still
// running.
// A timed-out round is checked like a failure (#396, `rerunAlone`): each file still running reruns
// alone on the branch, then, when it hangs there too, alone on the base, each run with its own timeout
// (3× the file's recent alone runs, at least 2 min; 5 min without history), logs
// suite-<round>-alone-<n>[-base].log. A file that finishes alone on the branch, or hangs or fails on
// the base too, is a failure outside the change with its reason; one that hangs only on the branch is
// classified like any failure. The failures of the files that had finished are kept. Without the
// still-running files (or a command that cannot take files) it stays one "(the whole suite)" failure.
// In or outside the change (#396): every counted failure gets `class` (in the change | outside the
// change) and `class_reason` from the import graph (affected-tests.js classifyFailures, changedFiles();
// without changedFiles, no class); `in_change` / `outside_change` count them, for a workflow's policy
// on a suite red only outside the change.
// Output: { kind: 'suite', status: pass | fail | blocked | not_run (#71, suite-no-command.js), round, command, log, exit_code, duration_ms,
// timed_out, timeout_ms, running, alone, failures, preexisting, preexisting_failures, base_check,
// in_change, outside_change, reason, message }; `no_command: true` on a `not_run` with test files but
// no command found (#81). `blocked`: the suite could not run (no worktree, a folder git cannot list,
// the command not found, or #400 the shell refused the command line: the log's last
// line is a refusal of SHELL_REFUSALS and the log holds no test result, reason quoting that line).
// It never throws and never calls the supervisor: the transitions route the result (back to the test
// writer or the developer, or a gate).
// Simulation (`mock`): nothing is run; `mockResult` (mockSequences.suite: { <step>: [per visit] },
// default pass) is pass | fail | preexisting (only the run's pre-existing failures fail: a pass) |
// base (the failures fail on the simulated base too: a pass) | mixed (2 failures, one on the base:
// a fail with 1 failure) | outside (#396: a failure in test/simulated-outside.test.js, outside the
// change, passing on the simulated base: a fail) | blocked | not_run, and a simulated log is written. A
// simulated failure is in the change, except those of test/simulated-outside.test.js.
// `isFullSuiteCommand` tells the engine an agent started the whole suite itself (a warn, #177).
// Affected tests (#212): with `files`, only those test files run (`scope: files`, the step's
// `scope: affected` rounds and agents' test requests, see packages/engine/engine/affected-tests.js); the output
// says which files and why (`selection`), and `passed` / `failed` are the runner's counts.
// The command line has a limit (#400, packages/engine/engine/suite-command-line.js: cmd.exe 8,191 characters,
// Linux 128 KiB, macOS 256 KiB, minus a margin): a filtered command over it (wrappers included) gives
// its files through a list file the runner reads (#553), else runs the whole suite instead
// (`selection.why` and the message say so), and the base check of too many files is skipped with
// that reason. A timed-out file reruns alone, always short enough.
// Agent mode (#219): the suite gets CRAFTORIO_AGENT_MODE=1 and CRAFTORIO_TEST_HUMAN_LOG (<log>.human.log);
// a runner that knows them (this project's scripts/test.js) prints one failures-only JSON line,
// which `parseFailures` / `parseCounts` read before any text format (`human_log`, `file_counts`).
// Red check (#220): `redCheck` sorts the test files of a tests-first run into red / green / broken.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { classifyFailures, IN_CHANGE, OUTSIDE_CHANGE } = require('./affected-tests');
const { parseAgentReport } = require('./agent-test-report');
const { childEnv: allowlistedEnv } = require('./child-env');
const { isMissingCode, programMissing } = require('./command-missing'); // #67
const {
  fitsCommandLine,
  listIgnored,
  npmScriptOf,
  overCommandLine,
  takesFileList,
  TEST_FILES_ENV,
  writeFileList,
} = require('./suite-command-line');
const { saveCoverage } = require('../domains/evidence/coverage-summary');
const { parseCounts } = require('./suite-counts');
const { clean, fileOf } = require('./output-lines');
const { suiteSlotRun } = require('./suite-slot');
const { noTests, notRunMessage, suiteWithoutCommand } = require('./suite-no-command'); // #71
const { excusedOnBase } = require('./suite-last-green');
const {
  processTreeCommands,
  stopProcessesIn,
} = require('./processes');
const { killTree, OWN_GROUP } = require('./providers');
const { MAX_TEST_TIMEOUT_MS } = require('./test-timeouts');
const { generatedLines, generatedNote, splitMissingBaselines } = require('./visual-baselines');
const { workerEnv } = require('../domains/machine/machine-profile');
const { e2eSuiteDelay } = require('./simulation'); // #795

const SUITE_TIMEOUT_MS = 30 * 60e3;
const MIN_TIMEOUT_MS = 10 * 60e3;
const MAX_TIMEOUT_MS = 3 * 60 * 60e3;
const TIMEOUT_FACTOR = 3;
// the step's timeout stays this much above the largest per-test budget (#402)
const BACKSTOP_MARGIN_MS = 2 * 60e3;
const HISTORY = 10;
const MAX_FAILURES = 30;
const ERROR_LINES = 3;
const MOCK_BASE_FILE = 'test/simulated-base.test.js';
const MOCK_OUTSIDE_FILE = 'test/simulated-outside.test.js';
const SELECTION_LINES = 20;
// a test file rerun alone after a timed-out round (#396)
const MIN_FILE_TIMEOUT_MS = 2 * 60e3;
const FILE_TIMEOUT_MS = 5 * 60e3;
// what a shell prints when it refuses a command line (#400): no test ran
const SHELL_REFUSALS = [/argument list too long/i, /command line is too long/i, /linha de comando muito longa/i];

const exists = (dir, f) => { try { return fs.existsSync(path.join(dir, f)); } catch { return false; } };
const someFile = (dir, re) => { try { return fs.readdirSync(dir).some((f) => re.test(f)); } catch { return false; } };

// The files that make a folder a Gradle or a Python project (#82: the rule check's "Looked for" uses them too)
const GRADLE_BUILD_FILES = ['build.gradle', 'build.gradle.kts'];
const PYTHON_PROJECT_FILES = ['pyproject.toml', 'pytest.ini', 'setup.cfg', 'tox.ini', 'setup.py', 'requirements.txt'];

// The project's whole-suite command from the files of its folder, or null.
function detectTestCommand(dir) {
  if (!dir || !fs.existsSync(dir)) return null;
  try {
    const test = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).scripts?.test;
    // npm init's placeholder is not a suite
    if (typeof test === 'string' && test.trim() && !/no test specified/.test(test)) return 'npm test';
  } catch { /* no package.json */ }
  if (exists(dir, 'go.mod')) return 'go test ./...';
  if (exists(dir, 'Cargo.toml')) return 'cargo test'; // #735: a Rust crate
  if (exists(dir, 'pom.xml')) {
    if (process.platform === 'win32' && exists(dir, 'mvnw.cmd')) return 'mvnw.cmd -B test';
    return exists(dir, 'mvnw') ? './mvnw -B test' : 'mvn -B test';
  }
  if (GRADLE_BUILD_FILES.some((f) => exists(dir, f))) {
    if (process.platform === 'win32' && exists(dir, 'gradlew.bat')) return 'gradlew.bat test';
    return exists(dir, 'gradlew') ? './gradlew test' : 'gradle test';
  }
  if (someFile(dir, /\.(sln|csproj)$/i)) return 'dotnet test';
  if (PYTHON_PROJECT_FILES.some((f) => exists(dir, f))) return 'python -m pytest';
  return null;
}

const firstLines = (lines) => lines.map((l) => l.trim()).filter(Boolean).slice(0, ERROR_LINES).join('\n').slice(0, 400);
// The failing tests of a suite's output: [{ test, file, error }], at most MAX_FAILURES, deduplicated.
// The agent reporter's JSON (#219) is read as is, with the failure's `line` and `kind` (file: a test
// file that could not run); the runners' text formats are scraped otherwise.
function parseFailures(text, { cwd } = {}) {
  const report = parseAgentReport(clean(text));
  if (report) {
    return report.failures.slice(0, MAX_FAILURES).map((f) => ({
      test: String(f.test || ''),
      file: f.file ? fileOf(f.file, cwd) : '',
      error: [f.error, f.expected !== undefined ? `expected: ${f.expected}, actual: ${f.actual}` : ''].filter(Boolean).join('\n'),
      line: f.line ?? null,
      kind: f.kind || 'test',
    }));
  }
  const lines = clean(text).split(/\r?\n/);
  const out = [];
  const add = (test, file, error, extra = {}) => {
    test = String(test || '').trim();
    if (!test || out.some((f) => f.test === test && f.file === file)) return;
    out.push({ test, file: file || '', error: error || '', ...extra });
  };
  // node:test, spec reporter: "✖ failing tests:", then "test at <file>:<l>:<c>" / "✖ <name> (<ms>)" / the error
  const spec = lines.findIndex((l) => /^\s*✖ failing tests:/.test(l));
  if (spec >= 0) {
    let file = '';
    for (let i = spec + 1; i < lines.length; i++) {
      const at = /^\s*test at (.+)$/.exec(lines[i]);
      if (at) { file = fileOf(at[1], cwd); continue; }
      const name = /^(\s*)✖ (.+?)(?: \([\d.]+m?s\))?$/.exec(lines[i]);
      if (!name) continue;
      const err = [];
      for (let j = i + 1; j < lines.length && !/^\s*(test at |✖ )/.test(lines[j]); j++) err.push(lines[j]);
      // a suite whose subtests failed repeats them: only the tests with their own error
      if (!/^\s*\d+ subtests? failed/.test(err.find((l) => l.trim()) || '')) add(name[2], file, firstLines(err));
    }
  }
  // node:test, TAP: "not ok N - name" + a YAML block with location / error / failureType
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)not ok \d+ - (.+?)(?:\s+#.*)?$/.exec(lines[i]);
    if (!m) continue;
    let file = '';
    let error = '';
    let subtests = false;
    if (/^\s*---\s*$/.test(lines[i + 1] || '')) {
      for (let j = i + 2; j < lines.length && !/^\s*\.\.\.\s*$/.test(lines[j]); j++) {
        const kv = /^\s*(location|error|failureType):\s*(.*)$/.exec(lines[j]);
        if (!kv) continue;
        if (kv[1] === 'location') file = fileOf(kv[2], cwd);
        if (kv[1] === 'failureType') subtests = /subtestsFailed/.test(kv[2]);
        if (kv[1] === 'error') {
          const v = kv[2].replace(/^['"]|['"]$/g, '');
          const block = /^[|>]-?$/.test(v) ? [] : [v];
          for (let k = j + 1; block.length < ERROR_LINES && k < lines.length && /^\s{4,}\S/.test(lines[k]) && !/^\s*\w+:\s/.test(lines[k]); k++) block.push(lines[k]);
          error = firstLines(block);
        }
      }
    }
    if (!subtests) add(m[2], file, error);
  }
  // Jest: "FAIL <file>" then "● Suite › test" and the error
  let jestFile = '';
  for (let i = 0; i < lines.length; i++) {
    const f = /^\s*FAIL\s+(\S+\.\w+)\s*/.exec(lines[i]);
    if (f) { jestFile = f[1]; continue; }
    const t = /^\s*● (.+)$/.exec(lines[i]);
    if (t && jestFile && !/Console$/.test(t[1])) add(t[1], jestFile, firstLines(lines.slice(i + 1, i + 6)));
  }
  // pytest: "FAILED tests/test_x.py::test_name - AssertionError: ..."
  for (const l of lines) {
    const m = /^FAILED (\S+?)::(\S+)(?: - (.*))?$/.exec(l.trim());
    if (m) add(m[2], m[1], m[3] || '');
  }
  // go test: "--- FAIL: TestName (0.00s)" then "    file_test.go:12: message"
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*--- FAIL: (\S+)/.exec(lines[i]);
    if (!m) continue;
    const loc = /^\s+(\S+\.go):\d+: (.*)$/.exec(lines[i + 1] || '');
    add(m[1], loc ? loc[1] : '', loc ? loc[2] : '');
  }
  // dotnet test: "  Failed Name [12 ms]" then "  Error Message:" and the message
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*Failed (\S+) \[[^\]]+\]\s*$/.exec(lines[i]);
    if (!m) continue;
    const at = lines.slice(i + 1, i + 4).findIndex((l) => /Error Message:/.test(l));
    add(m[1], '', at >= 0 ? firstLines(lines.slice(i + 2 + at, i + 2 + at + ERROR_LINES)) : '');
  }
  // Maven surefire: "[ERROR]   ClassTest.method:12 message"
  for (const l of lines) {
    const m = /^\[ERROR\]\s+([\w.$]+)\.(\w+):(\d+)\s+(.*)$/.exec(l);
    if (m) add(m[2], m[1], m[4]);
  }
  // Playwright (playwright-bdd, #223): "  1) <spec>:7:7 › Feature › Scenario @tag", the error, then the
  // attachments; the trace kept for the failure is the "trace.zip" line. The generated spec
  // (.features-gen/features/x.feature.spec.js) is reported as its feature file (features/x.feature).
  // A config with projects prefixes the file with the project: "1) [chromium] › <spec>:7:7 › ...".
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*\d+\) (?:\[[^\]]+\] › )?(\S+?):\d+:\d+ › (.+)$/.exec(lines[i]);
    if (!m) continue;
    const block = [];
    for (let j = i + 1; j < lines.length && !/^\s*\d+\) (?:\[[^\]]+\] › )?\S+?:\d+:\d+ › /.test(lines[j]) && !/^\s*\d+ (failed|passed|flaky|skipped|interrupted)\b/.test(lines[j]); j++) block.push(lines[j]);
    const end = block.findIndex((l) => /^\s*attachment #\d+:/.test(l));
    const trace = block.map((l) => l.trim()).find((l) => /trace\.zip$/.test(l) && !/^npx /.test(l));
    const file = fileOf(m[1].split('\\').join('/'), cwd).replace(/^\.features-gen\//, '').replace(/\.spec\.[cm]?[jt]s$/, '');
    add(m[2], file, firstLines(end >= 0 ? block.slice(0, end) : block), trace ? { trace: trace.split('\\').join('/') } : {});
  }
  return out.slice(0, MAX_FAILURES);
}

const sameTest = (a, b) => {
  const base = (f) => String(f || '').split(/[\\/]/).pop();
  return String(a.test).trim() === String(b.test).trim() && (!a.file || !b.file || base(a.file) === base(b.file));
};

// Is this command an agent ran the whole suite? `npm test`, `npm run test`, `pytest`, `go test ./...`,
// `dotnet test`, `mvn test`, `gradle test` with no file, filter or pattern, or the suite's own command.
function isFullSuiteCommand(cmd, suiteCommand) {
  const c = String(cmd || '').trim().replace(/\s+2>&1.*$|\s*[|>].*$/, '').replace(/^cd\s+\S+\s*&&\s*/, '').trim();
  if (!c) return false;
  if (suiteCommand && c === String(suiteCommand).trim()) return true;
  if (/^npm (test|t|run test)$/.test(c) || /^(pnpm|yarn) (run )?test$/.test(c)) return true;
  if (/^((uv|poetry) run )?(python3? -m )?pytest(\s+-q)?$/.test(c)) return true;
  if (/^(go test(\s+-\w+)* \.\/\.\.\.(\s+-\w+)*|go test \.\/\.\.\.)$/.test(c)) return true;
  if (/^dotnet test$/.test(c)) return true;
  if (/^(mvn|\.\/mvnw|mvnw\.cmd)(\s+-[qB])* test$/.test(c)) return true;
  if (/^(gradle|\.\/gradlew|gradlew\.bat) test$/.test(c)) return true;
  return false;
}

// The suite's environment from the engine's (#210): what a shell would give it. Removed: Electron's
// and Chromium's variables, npm's (the app started with `npm start`), the agents' CLI marker, a test
// runner context, the app's own CRAFTORIO_* and their old names MULTIAGENT_* (the scratch workspace and user data every test process
// would share, an inherited screenshot slot); inspector flags are cut from NODE_OPTIONS (node --test
// runs one file at a time under an inspector). Set: CRAFTORIO_SIMULATION_ONLY=1, CRAFTORIO_AGENT_MODE=1
// (#219: a runner that knows it prints the failures-only JSON, packages/engine/engine/agent-test-report.js) and,
// with locksDir, CRAFTORIO_LOCKS_DIR (the suite's own screenshot slot); with testWorkers, the run's
// test workers (#367, packages/engine/domains/machine/machine-profile.js workerEnv), never an inherited value; with tmpDir, TMP,
// TEMP and TMPDIR (#414: the run's temp folder over the user's). #470 (SEC-5): only the allowlisted
// variables reach the repository's scripts (packages/engine/engine/child-env.js, no platform tokens), plus the
// workflow's env.passthrough names; `removed` still names only the ones above. → { env, removed: [names] }
const DROP_ENV = /^(ELECTRON_|CHROME_CRASHPAD|NPM_|CLAUDECODE$|NODE_TEST_CONTEXT$|VSCODE_INSPECTOR_OPTIONS$|CRAFTORIO_|MULTIAGENT_)/i;
function suiteEnv(env = {}, { locksDir, testWorkers, tmpDir, passthrough = [] } = {}) {
  const out = {};
  const removed = [];
  const allowed = allowlistedEnv(env, { passthrough });
  for (const [k, v] of Object.entries(env)) {
    if (DROP_ENV.test(k) && v != null) { removed.push(k); continue; }
    if (!Object.hasOwn(allowed, k)) continue;
    if (/^NODE_OPTIONS$/i.test(k)) {
      const opts = String(v).split(/\s+/).filter((o) => o && !/^--(inspect|debug)/.test(o)).join(' ');
      if (opts !== String(v).trim()) removed.push(`${k} (inspector flags)`);
      if (opts) out[k] = opts;
      continue;
    }
    out[k] = v;
  }
  out.CRAFTORIO_SIMULATION_ONLY = '1';
  out.CRAFTORIO_AGENT_MODE = '1';
  if (locksDir) out.CRAFTORIO_LOCKS_DIR = locksDir;
  if (testWorkers) Object.assign(out, workerEnv({ testWorkers }));
  if (tmpDir) Object.assign(out, { TMP: tmpDir, TEMP: tmpDir, TMPDIR: tmpDir });
  const replaced = (k) => /^CRAFTORIO_(SIMULATION_ONLY|AGENT_MODE|LOCKS_DIR)$/i.test(k) || (!!testWorkers && /^CRAFTORIO_(TEST|E2E)_WORKERS$/i.test(k));
  return { env: out, removed: removed.filter((k) => !replaced(k)).sort() };
}

// The suite's command with the run's test workers (#367) when it calls a runner that takes them
// directly and does not set them already: `playwright test` → --workers, `jest` → --maxWorkers.
// Anything else (npm test, pytest, go test…) gets them through the environment only.
function withWorkers(command, testWorkers) {
  const cmd = String(command || '');
  if (!testWorkers || /\s&&\s|\|\||[;|]/.test(cmd)) return cmd;
  if (/\bplaywright\s+test\b/.test(cmd) && !/\s(--workers|-j)\b/.test(cmd)) return `${cmd} --workers=${testWorkers}`;
  if (/(^|[\s/\\])jest(\.js)?(\s|$)/.test(cmd) && !/\s(--maxWorkers|-w|--runInBand|-i)\b/.test(cmd)) return `${cmd} --maxWorkers=${testWorkers}`;
  return cmd;
}

// The test files a list of processes runs, one per process (a runner listing many files is not one):
// what a timed-out suite had not finished.
const TEST_FILE = /[^\s"']*(?:\.(?:test|spec)\.[cm]?[jt]sx?|(?:^|[\\/])test_[^\s"'\\/]+\.py|_test\.(?:py|go))(?=["'\s]|$)/g;
function runningTestFiles(procs, cwd) {
  const files = new Set();
  for (const p of procs) {
    const found = String(p.cmd || '').match(TEST_FILE) || [];
    if (found.length === 1) files.add(fileOf(found[0], cwd));
  }
  return [...files].sort();
}

// Runs `command` in a shell in cwd, its whole output into logFile → { code, timedOut, error, running };
// running: on a timeout, the test files still running. Never rejects.
// onSpawn(pid): the shell's process, for the memory guard (#276).
// It leaves nothing behind (#390): once the command has ended, timed out or been stopped, what its
// process group still holds is stopped and, unless `sweep` is false (a folder the run does not own),
// every process still running from cwd (packages/engine/engine/processes.js: test workers orphaned when their
// runner ended, which taskkill /T can no longer find from the dead shell), named in the log.
function runCommand({ command, cwd, env, timeoutMs, signal, logFile, onSpawn, sweep = true }) {
  const childEnv = { ...env };
  // the engine may run inside Electron as node: the suite's own Electron children must not
  delete childEnv.ELECTRON_RUN_AS_NODE;
  delete childEnv.CLAUDECODE;
  return new Promise((resolve) => {
    const out = fs.createWriteStream(logFile, { flags: 'a' });
    let child;
    try {
      child = spawn(command, { cwd, env: childEnv, shell: true, windowsHide: true, ...OWN_GROUP });
    } catch (e) {
      out.end(`${e.message}\n`);
      resolve({ code: null, timedOut: false, error: e.message });
      return;
    }
    if (child.pid) onSpawn?.(child.pid);
    let timedOut = false;
    let running = [];
    child.stdout?.on('data', (d) => out.write(d));
    child.stderr?.on('data', (d) => out.write(d));
    const stop = () => killTree(child);
    const timer = setTimeout(async () => {
      timedOut = true;
      try { running = runningTestFiles(await processTreeCommands(child.pid), cwd); } catch { /* best effort */ }
      stop();
    }, timeoutMs);
    signal?.addEventListener('abort', stop, { once: true });
    let finished = false;
    const done = async (code, err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      // the group outlives its leader while a member runs (never on Windows: a dead pid may be reused)
      if (process.platform !== 'win32') killTree(child);
      const left = sweep ? await stopProcessesIn(cwd).catch(() => []) : [];
      const named = left.map((p) => `pid ${p.pid}${p.stopped ? '' : ` (not stopped: ${p.error})`}: ${p.cmd || p.exe || '?'}`);
      const note = named.length ? `\nStopped ${named.length} process(es) the command left running in ${cwd}:\n${named.join('\n')}\n` : '';
      out.end(`${err ? `\n${err.message}\n` : ''}${note}`, () => resolve({ code, timedOut, error: err?.message || null, running }));
    };
    child.on('error', (e) => done(null, e));
    child.on('close', (code) => done(code));
  });
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
// where a runner in agent mode writes its human-readable report (#219): next to the suite's log
const humanLog = (logFile) => String(logFile || '').replace(/(\.log)?$/, '.human.log');

// The simulated suite of a mock run: the log and its result
function mockSuite(result, preexisting) {
  const pre = preexisting.length ? preexisting : [{ test: 'simulated pre-existing failure', file: 'test/simulated-base.test.js', reason: 'fails on the base too' }];
  if (result === 'fail') {
    return { code: 1, text: '✖ failing tests:\n\ntest at test/simulated.test.js:12:3\n✖ simulated failing test (3.1ms)\n  AssertionError [ERR_ASSERTION]: simulated failure\n    expected: 1\n    actual: 2\n\nℹ pass 41\nℹ fail 1\n' };
  }
  if (result === 'preexisting') {
    return { code: 1, text: `✖ failing tests:\n\n${pre.map((f) => `test at ${f.file}:1:1\n✖ ${f.test} (1ms)\n  Error: ${f.reason || 'fails on the base too'}\n`).join('\n')}\nℹ pass 41\nℹ fail ${pre.length}\n` };
  }
  // the simulated base fails the tests of MOCK_BASE_FILE only (checkOnBase)
  const onBase = `test at ${MOCK_BASE_FILE}:7:3\n✖ simulated failure already on the base (2.4ms)\n  AssertionError [ERR_ASSERTION]: fails on main too\n`;
  if (result === 'base') return { code: 1, text: `✖ failing tests:\n\n${onBase}\nℹ pass 41\nℹ fail 1\n` };
  if (result === 'outside') {
    return { code: 1, text: `✖ failing tests:\n\ntest at ${MOCK_OUTSIDE_FILE}:9:3\n✖ simulated failure outside the change (2.2ms)\n  AssertionError [ERR_ASSERTION]: a flaky test the change does not reach\n\nℹ pass 41\nℹ fail 1\n` };
  }
  if (result === 'mixed') {
    return { code: 1, text: `✖ failing tests:\n\ntest at test/simulated.test.js:12:3\n✖ simulated failing test (3.1ms)\n  AssertionError [ERR_ASSERTION]: simulated failure\n\n${onBase}\nℹ pass 40\nℹ fail 2\n` };
  }
  return { code: 0, text: 'ℹ tests 42\nℹ pass 42\nℹ fail 0\n' };
}

// The step's timeout from the project's recent suite durations (ms): TIMEOUT_FACTOR × their median,
// between `min` (MIN_TIMEOUT_MS) and MAX_TIMEOUT_MS; `fallback` without history.
// A backstop (#402): never under the largest per-test budget plus BACKSTOP_MARGIN_MS, so a hung test
// fails by name (its own budget) before the step's timeout could kill the whole round. #396's alone
// rerun of one file passes `floor` 0: its own timeouts are unchanged.
function suiteTimeout(durations, fallback = SUITE_TIMEOUT_MS, min = MIN_TIMEOUT_MS, floor = MAX_TEST_TIMEOUT_MS + BACKSTOP_MARGIN_MS) {
  const d = (durations || []).filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!d.length) return Math.max(floor, fallback);
  const mid = d.length >> 1;
  const median = d.length % 2 ? d[mid] : (d[mid - 1] + d[mid]) / 2;
  return Math.round(Math.min(MAX_TIMEOUT_MS, Math.max(floor, min, TIMEOUT_FACTOR * median)));
}

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { return {}; } };
// written whole then renamed: another run reading it never sees half a file
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

// history: { file, key } (cache/suite-durations.json, { <key>: [ms, ...] }, the last HISTORY runs)
const suiteDurations = (history) => (history?.file && history.key ? readJson(history.file)[history.key] || [] : []);
function recordDuration(history, ms) {
  if (!history?.file || !history.key) return;
  try {
    const all = readJson(history.file);
    all[history.key] = [...(Array.isArray(all[history.key]) ? all[history.key] : []), ms].slice(-HISTORY);
    writeJson(history.file, all);
  } catch { /* a cache: the next run measures again */ }
}

// The suite's command restricted to `files`, or null when it cannot be: npm/pnpm/yarn test (the
// files after `--`, the project's runner gets them), a package script without arguments of its own
// (#324: `npm run test:e2e -- <feature files>` reaches `playwright test` after `bddgen`; pnpm and
// yarn pass them on without `--`), pytest, node --test without files of its own.
function filteredCommand(command, files) {
  const c = String(command || '').trim();
  if (!c || !files.length) return null;
  const list = files.map((f) => (/[\s"&|<>^()]/.test(f) ? `"${f}"` : f)).join(' ');
  if (/^(npm|pnpm|yarn)( run)? (test|t)$/.test(c)) return `${c} -- ${list}`;
  if (/^npm run(-script)? [\w:.-]+$/.test(c)) return `${c} -- ${list}`;
  if (/^(pnpm|yarn)( run)? [\w:.-]+$/.test(c)) return `${c} ${list}`;
  if (/^((uv|poetry) run )?(python3? -m )?pytest\b/.test(c)) return `${c} ${list}`;
  if (/^node\b.*\s--test\b/.test(c) && !new RegExp(TEST_FILE.source).test(c)) return `${c} ${list}`;
  return null;
}

// Why the base check cannot run `files` on its own command line, or null: the command cannot take
// single files, or (#400) too many of them for the platform's command line.
function baseFilesSkip(command, files, platform) {
  const filtered = filteredCommand(command, files);
  if (!filtered) return `\`${command}\` cannot run single test files`;
  return fitsCommandLine(filtered, platform) ? null : `${overCommandLine(files.length, platform)}: not checked on the base`;
}

// Narrows a suite round to `files` (#212): out.scope and out.command when the filtered command fits
// the command line with its coverage and workers wrappers (#400), else the whole suite runs and
// out.selection.why says why. #553: files that do not fit go through a list file (TEST_FILES_ENV)
// when the runner reads it (takesFileList): the command stays without files and the round stays
// `scope: files`. → { measure, tooLong, list }: whether the round measures the whole suite's
// duration, why its files did not fit (null when they did or went through the list), and whether
// they go through the list.
function narrowToFiles(out, { files, mock, coverage, cwd, testWorkers, platform, log }) {
  const filtered = filteredCommand(out.command, files);
  if (!filtered) {
    if (out.selection) out.selection = { ...out.selection, why: `${out.selection.why}; \`${out.command}\` cannot run single test files: the whole suite ran` };
    return { measure: true, tooLong: null, list: false };
  }
  // #400: measured as it will run, with the coverage and workers wrappers
  const wrapped = mock ? filtered : withWorkers(coverage ? coverageCommand(filtered, cwd) : filtered, testWorkers);
  if (fitsCommandLine(wrapped, platform)) {
    out.scope = 'files';
    out.command = filtered;
    return { measure: false, tooLong: null, list: false };
  }
  const tooLong = overCommandLine(files.length, platform);
  if (takesFileList(out.command, cwd, coverage)) {
    out.scope = 'files';
    log('info', `suite: ${tooLong}: they go through the list file named by ${TEST_FILES_ENV}`);
    return { measure: false, tooLong: null, list: true };
  }
  out.selection = { ...(out.selection || { files }), why: `${out.selection?.why ? `${out.selection.why}; ` : ''}${tooLong}, and \`${out.command}\` cannot read the list of ${TEST_FILES_ENV}: the whole suite ran` };
  log('warn', `suite: ${tooLong}: the whole suite runs`);
  return { measure: true, tooLong, list: false };
}

// Whether the output shows that tests ran: the runner's counts, or a failure
const testsRan = (text, cwd) => Object.values(parseCounts(text)).some((n) => n != null) || parseFailures(text, { cwd }).length > 0;

// #400: why the shell refused the command line (its last log line) when no test ran, or null: not a failure an agent can fix.
function shellRefusal(r, text, report, cwd) {
  if (r.code === 0 || r.timedOut || report) return null;
  const last = clean(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop() || '';
  if (!SHELL_REFUSALS.some((re) => re.test(last))) return null;
  if (testsRan(text, cwd)) return null;
  return `the shell refused the command, no test ran (exit ${r.code ?? '?'}): ${last}`;
}

// Base results cached per base commit + file: <cacheDir>/<commit>.json, { <file>: { failing: [test names], at } }
const baseCacheFile = (cacheDir, commit) => (cacheDir && commit ? path.join(cacheDir, `${String(commit).replace(/[^\w.-]/g, '')}.json`) : null);
const sameFile = (a, b) => String(a || '').split(/[\\/]/).pop() === String(b || '').split(/[\\/]/).pop();

// Which of `failures` also fail on the base (#211): their test files run in the base checkout (cached
// per commit + file). → { onBase: [failure], info: { status: done | skipped, commit, files, cached,
// ran, log, reason } }; never throws. Too many files for the platform's command line (#400): skipped,
// like a command that cannot run single files.
async function checkOnBase({ command, failures, base, mock, env, timeoutMs, signal, run = runCommand, logFile, runDir, cacheDir, log = () => {}, platform = process.platform, onLog }) {
  const info = { status: 'skipped', commit: null, files: [], cached: [], ran: [], log: null, reason: null };
  const files = [...new Set(failures.map((f) => f.file).filter(Boolean))].sort();
  info.files = files;
  if (!files.length) { info.reason = 'the failures name no test file'; return { onBase: [], info }; }
  if (mock) {
    Object.assign(info, { status: 'done', commit: '(simulated)', ran: files });
    return { onBase: failures.filter((f) => f.file === MOCK_BASE_FILE), info };
  }
  if (typeof base !== 'function') { info.reason = 'the run has no base checkout'; return { onBase: [], info }; }
  info.reason = baseFilesSkip(command, files, platform);
  if (info.reason) return { onBase: [], info };
  let b = null;
  try { b = await base(); } catch (e) { info.reason = `the base checkout could not be prepared: ${e.message}`; return { onBase: [], info }; }
  if (!b?.dir || !fs.existsSync(b.dir)) { info.reason = 'the run has no base checkout'; return { onBase: [], info }; }
  info.commit = b.commit || null;
  // a test file the base does not have is the run's
  const present = files.filter((f) => exists(b.dir, f));
  const cacheFile = baseCacheFile(cacheDir, info.commit);
  const cache = cacheFile ? readJson(cacheFile) : {};
  info.cached = present.filter((f) => Array.isArray(cache[f]?.failing));
  const baseFailing = info.cached.flatMap((f) => cache[f].failing.map((test) => ({ test, file: f })));
  const toRun = present.filter((f) => !info.cached.includes(f));
  if (toRun.length) {
    const cmd = filteredCommand(command, toRun);
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.writeFileSync(logFile, `$ ${cmd}\n# in the base checkout ${b.dir}${info.commit ? ` (${String(info.commit).slice(0, 8)})` : ''}: are these failures already there?\n`);
    if (runDir) {
      info.log = path.relative(runDir, logFile).split(path.sep).join('/');
      onLog?.({ path: info.log, command: cmd, base: true });
    }
    log('info', `suite: checking ${toRun.length} failing test file(s) on the base (log ${info.log || logFile})`);
    const r = await run({ command: cmd, cwd: b.dir, env, timeoutMs, signal, logFile });
    let text = '';
    try { text = fs.readFileSync(logFile, 'utf8'); } catch { /* no log */ }
    const found = parseFailures(text, { cwd: b.dir });
    baseFailing.push(...found);
    info.ran = toRun;
    // cached only when the base run ended and every failure it found belongs to one of its files
    const complete = !r.timedOut && r.code != null && (r.code === 0 || found.length > 0) && found.every((f) => f.file && toRun.some((t) => sameFile(t, f.file)));
    if (r.timedOut) info.reason = 'the base run timed out';
    else if (r.code !== 0 && !found.length) info.reason = `the base run failed without a recognizable failure (exit ${r.code ?? '?'})`;
    if (complete && cacheFile) {
      try {
        const now = new Date().toISOString();
        const all = readJson(cacheFile);
        for (const f of toRun) all[f] = { failing: found.filter((x) => sameFile(x.file, f)).map((x) => x.test), at: now };
        writeJson(cacheFile, all);
      } catch { /* a cache: the next round runs them again */ }
    }
  }
  info.status = 'done';
  return { onBase: failures.filter((f) => present.some((p) => sameFile(p, f.file)) && baseFailing.some((x) => sameTest(f, x))), info };
}

// `node --test …` → `node --test --experimental-test-coverage …` (#225). An npm script (`npm test`,
// `npm run <name>`, optionally `-- <files>`; cwd: where its package.json is): its `<name>:coverage`
// script when there is one (this project's `test:coverage`), else a script that is a plain
// `node --test …` runs inlined with the flag. Any other command, or one that already asks for
// coverage, unchanged.
function coverageCommand(command, cwd = null) {
  const c = String(command || '');
  if (/--experimental-test-coverage\b/.test(c)) return c;
  const withFlag = (s) => s.replace(/\bnode(\.exe)?(\s+)--test\b/, (m, exe, sp) => `node${exe || ''}${sp}--test --experimental-test-coverage`);
  const npm = npmScriptOf(c, cwd);
  if (!npm) return withFlag(c);
  if (!npm.scripts) return c;
  if (npm.coverageName) return `npm run ${npm.coverageName}${npm.rest}`;
  if (/^node(\.exe)?\s+--test\b/.test(npm.script) && !/[&|;<>]/.test(npm.script)) return `${withFlag(npm.script)}${npm.args ? ` ${npm.args}` : ''}`;
  return c;
}

// runCommand's optional arguments, only when they differ from its defaults
const optionalRunArgs = ({ onSpawn, sweep }) => ({ ...(onSpawn ? { onSpawn } : {}), ...(sweep ? {} : { sweep: false }) });

// One test file run alone (#396), its log written whole → { status: pass | fail | hang, ms, timeout_ms,
// failures, log }; never throws. why: the log header's reason (#527: the base check's re-run of a timeout).
async function runFileAlone({ command, file, cwd, where, env, timeoutMs, signal, run, logFile, runDir, cmdArgs = {}, why = 'it was still running when the round timed out' }) {
  const cmd = filteredCommand(command, [file]);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(logFile, `$ ${cmd}\n# ${file} alone ${where} (${cwd}), timeout ${Math.round(timeoutMs / 60e3)} min: ${why}\n`);
  const t0 = Date.now();
  const r = await run({ command: cmd, cwd, env: env ? { ...env, CRAFTORIO_TEST_HUMAN_LOG: humanLog(logFile) } : env, timeoutMs, signal, logFile, ...cmdArgs });
  const ms = Date.now() - t0;
  let text = '';
  try { text = fs.readFileSync(logFile, 'utf8'); } catch { /* no log */ }
  const status = r.timedOut ? 'hang' : r.code === 0 ? 'pass' : 'fail';
  const failures = status === 'fail' ? parseFailures(text, { cwd }) : [];
  if (status === 'fail' && !failures.length) failures.push({ test: '(unrecognized failure)', file, error: `exit ${r.code ?? '?'}${r.error ? `: ${r.error}` : ''} when run alone` });
  return { status, ms, timeout_ms: timeoutMs, failures, log: runDir ? path.relative(runDir, logFile).split(path.sep).join('/') : logFile };
}

// A timed-out round (#396): each file still running reruns alone on the branch and, when it hangs
// there too, alone on the base. → { failures (of the files that failed alone on the branch), entries
// (one per file: outside the change with its reason, or a hang to classify), files: [{ file, branch,
// base }] }. history: { file, project } (the files' alone durations, their timeouts).
async function rerunAlone({ files, command, cwd, env, base, signal, run, runDir, stem, history, log, cmdArgs }) {
  const out = { failures: [], entries: [], files: [] };
  const sec = (ms) => `${(ms / 1e3).toFixed(1)} s`;
  const min = (ms) => `${Math.round(ms / 60e3)} min`;
  let b;
  const baseDir = async () => {
    if (b !== undefined) return b;
    b = null;
    if (typeof base !== 'function') return b;
    try { const r = await base(); if (r?.dir && fs.existsSync(r.dir)) b = r; } catch { /* reported as no base */ }
    return b;
  };
  for (const [i, file] of files.entries()) {
    if (signal?.aborted) break;
    const hist = history?.file && history.project ? { file: history.file, key: `${history.project}\n${file} (alone)` } : null;
    const timeoutMs = suiteTimeout(suiteDurations(hist), FILE_TIMEOUT_MS, MIN_FILE_TIMEOUT_MS, 0);
    const logFile = path.join(runDir, 'logs', `${stem}-alone-${i + 1}.log`);
    log('info', `suite: ${file} was still running when the round timed out: rerunning it alone (log ${path.basename(logFile)})`);
    const onBranch = await runFileAlone({ command, file, cwd, where: 'on the branch', env, timeoutMs, signal, run, logFile, runDir, cmdArgs });
    const record = { file, branch: onBranch, base: null };
    out.files.push(record);
    if (onBranch.status !== 'hang') {
      recordDuration(hist, onBranch.ms);
      out.failures.push(...onBranch.failures.map((f) => ({ ...f, file: f.file || file })));
      const how = onBranch.status === 'pass' ? 'passes' : 'finishes (failing, its failures are listed apart)';
      out.entries.push({ test: '(timed out in the whole suite)', file, error: `${how} alone on the branch in ${sec(onBranch.ms)}: it hung only in the whole suite`, class: OUTSIDE_CHANGE, class_reason: `finishes alone on the branch (${onBranch.status === 'pass' ? 'passes' : 'fails'})` });
      continue;
    }
    const hang = `hangs alone on the branch too (timed out after ${min(timeoutMs)})`;
    const b2 = await baseDir();
    const why = !b2 ? 'the run has no base checkout' : !exists(b2.dir, file) ? 'the base does not have it' : null;
    if (why || signal?.aborted) {
      out.entries.push({ test: '(timed out)', file, error: `${hang}; not checked on the base: ${why || 'cancelled'}` });
      continue;
    }
    const at = b2.commit ? ` (${String(b2.commit).slice(0, 8)})` : '';
    const onBase = await runFileAlone({ command, file, cwd: b2.dir, where: `in the base checkout${at}`, env, timeoutMs, signal, run, logFile: path.join(runDir, 'logs', `${stem}-alone-${i + 1}-base.log`), runDir });
    record.base = onBase;
    if (onBase.status === 'pass') {
      out.entries.push({ test: '(timed out)', file, error: `${hang} and passes alone on the base${at} in ${sec(onBase.ms)}` });
    } else {
      const reason = onBase.status === 'hang' ? `hangs alone on the base too${at}` : `fails alone on the base too${at}`;
      out.entries.push({ test: '(timed out)', file, error: `${hang}; ${reason}${onBase.failures[0] ? `: ${onBase.failures[0].test}` : ''}`, class: OUTSIDE_CHANGE, class_reason: reason });
    }
  }
  return out;
}

// The counted failures with their class (#396): in mock runs the simulated import graph (every
// simulated test file reaches the change but MOCK_OUTSIDE_FILE), else classifyFailures from cwd and
// the run's changed files (when they cannot be listed, every failure counts as in the change).
function classify(failures, { mock, cwd, changedFiles }) {
  if (mock) {
    return failures.map((f) => (f.class ? f : f.file === MOCK_OUTSIDE_FILE
      ? { ...f, class: OUTSIDE_CHANGE, class_reason: '(simulated) reaches none of the changed files' }
      : { ...f, class: IN_CHANGE, class_reason: '(simulated) imports src/simulated.js' }));
  }
  let changed = null;
  try { changed = typeof changedFiles === 'function' ? changedFiles() : changedFiles; } catch { changed = null; }
  return classifyFailures({ root: cwd, changed: Array.isArray(changed) ? changed : null, failures });
}

// runSuite's failures with their class and `in_change` / `outside_change` (#396), when the caller
// gives the run's changed files (the engine does).
function classifyOutput(out, { mock, cwd, changedFiles }) {
  if (!out.failures.length || changedFiles == null) return;
  out.failures = classify(out.failures, { mock, cwd, changedFiles });
  out.in_change = out.failures.filter((f) => f.class === IN_CHANGE).length;
  out.outside_change = out.failures.length - out.in_change;
}

// A timed-out round of runSuite (#396): the files still running rerun alone on the branch (and on the
// base); `out.alone` lists them and their failures join out.failures (out.preexisting when the run
// knows them) → rerunAlone's result, or null when there is nothing to rerun.
async function rerunTimedOut(out, { preexisting, signal, logName, round, ...args }) {
  if (!out.timed_out || !out.running.length || !filteredCommand(out.command, out.running) || signal?.aborted) return null;
  const alone = await rerunAlone({ ...args, files: out.running, command: out.command, signal, stem: logName || `suite-${round}` });
  out.alone = alone.files.map((r) => ({ file: r.file, branch: r.branch.status, base: r.base?.status || null, timeout_ms: r.branch.timeout_ms, log: r.branch.log, base_log: r.base?.log || null }));
  const known = alone.failures.filter((f) => preexisting.some((p) => sameTest(f, p)));
  out.preexisting.push(...known);
  out.failures.push(...alone.failures.filter((f) => !known.includes(f)));
  return alone;
}

// The suite log's header: the command, and what the suite gets, so a slow round can be compared with
// a shell (#210), and the base commit the round tests on (#403).
// logPrefix (#465): lines the log already holds (a wait written before the round), kept first.
function writeLogHeader(logFile, out, { mock, childEnv, timeoutWhy, baseCommit, logPrefix = '' }) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const about = mock ? '' : `# engine: os.availableParallelism()=${os.availableParallelism()}, cpus=${os.cpus().length}; timeout ${Math.round(out.timeout_ms / 60e3)} min (${timeoutWhy})\n`
    + `# env: removed ${childEnv.removed.join(', ') || 'nothing'}; set CRAFTORIO_SIMULATION_ONLY=1, CRAFTORIO_AGENT_MODE=1, CRAFTORIO_LOCKS_DIR=${childEnv.env.CRAFTORIO_LOCKS_DIR}, CRAFTORIO_TEST_HUMAN_LOG=${humanLog(logFile)}\n`;
  const onBase = baseCommit ? `# base: tested on top of ${baseCommit}\n` : '';
  fs.writeFileSync(logFile, `${logPrefix}$ ${out.command}${mock ? '   (simulated: nothing was run)' : ''}\n${about}${onBase}`);
}

// command: rendered (empty: detected); cwd: the worktree; runDir: the run folder (log under logs/);
// round: the step's visit; env: the engine's environment (suiteEnv cleans it);
// preexisting: the run's known pre-existing failures [{ test, file, reason }]; mockResult: see above;
// timeoutMs: the step's own timeout, else from history ({ file, project }: the recent durations of
// the project's command); base: async () => { dir, commit } | null, the base checkout (#211);
// baseCacheDir: the base results' cache; run: runCommand (replaceable).
// files (#212): only these test files (the affected tests, or the files an agent asked for), with
// the command filtered to them (`filteredCommand`); an empty list passes without running anything,
// and a command that cannot take files runs whole. selection: why these files (affected-tests.js),
// kept in the output; logName: the log's name (default suite-<round>). Only whole-suite runs
// measure the history the timeouts come from. Output adds scope (full | files), selection, passed, failed.
// coverage (#225): the command runs with node's coverage (coverageCommand); whenever the output
// has node's coverage report, <run_dir>/coverage/coverage-summary.md (the totals and the changed files',
// changedFiles(): the files the run changed) is written and `coverage` added to the output.
// onSpawn(pid): the command's process, watched by the memory guard (#276).
// testWorkers (#367): the run's test workers per run, in the env and on the command (withWorkers).
// sweep (#390): false when cwd is not a folder the run owns (no worktree): runCommand then stops only
// the command's own tree, not every process running from cwd.
// platform (#400): whose command-line limit the filtered command (with its wrappers) must fit; #553:
// else the files go through a list file (TEST_FILES_ENV, output `files_list`) when the runner reads
// it, else the whole suite runs and `selection.why` and the message say why. A list round whose own
// counts show more than the list (ignoredList; wholeTests: the run's whole suite's test count, 0
// unknown) is reported as a whole run: scope `full`, `list_ignored`, and the why.
// baseCommit (#403): the base commit the round tests on, named in the log's header.
// slot (#455, suite-slot.js): { dir, holder, onWait(holder), pollMs }, the machine-wide `suite` slot of
// a whole-suite round (not focused, not simulated); without `slot`, nothing is taken.
// onLog({ path, command, base? }) (#465): the log the command writes to (relative to runDir), called
// once the log exists and before anything waits or runs, and again for the base check's log (base: true);
// logPrefix: lines already in the log (a wait for memory), kept before the header.
// confirmedOnBase (#527): the failures the base check confirmed red alone since its last green check
// (base-health-store confirmedFailures); as a list, a failure that fails on the base too is pre-existing
// only when it is listed there, else it counts as the run's own. null: every one is pre-existing (#211).
// lastGreenBase (#736): async () => { dir, commit }, the base's last green commit: a failure red there too stays pre-existing.
async function runSuite({ command, cwd, runDir, round, env, mock, mockResult = 'pass', preexisting = [], signal, timeoutMs, history, base, lastGreenBase = null, baseCacheDir, run = runCommand, log = () => {}, files = null, selection = null, logName = null, coverage = false, changedFiles = null, onSpawn = null, testWorkers = null, sweep = true, platform = process.platform, baseCommit = null, slot = null, onLog = null, logPrefix = '', passthrough = [], confirmedOnBase = null, wholeTests, stepId = null, testsPaths = undefined }) {
  const logFile = runDir ? path.join(runDir, 'logs', `${logName || `suite-${round}`}.log`) : null;
  const out = {
    kind: 'suite', status: 'blocked', round, scope: 'full', command: null, log: logFile ? path.relative(runDir, logFile).split(path.sep).join('/') : null,
    exit_code: null, duration_ms: 0, timed_out: false, timeout_ms: null, running: [], passed: null, failed: null, failures: [], preexisting: [], preexisting_failures: [], new_baselines: [], base_check: null, selection, reason: null, message: '',
  };
  let tooLong = null;
  const what = () => (out.scope === 'files' ? `The selected tests (${plural(out.selection?.files?.length ?? files.length, 'test file')})` : tooLong ? `The whole suite (${tooLong})` : 'The suite');
  const finish = () => {
    const pre = `${out.preexisting.length ? ` (${plural(out.preexisting.length, 'pre-existing failure')} not counted: they fail on the base too)` : ''}${generatedNote(out.new_baselines)}`;
    const classes = out.in_change != null ? ` (${[out.in_change ? `${out.in_change} ${IN_CHANGE}` : '', out.outside_change ? `${out.outside_change} ${OUTSIDE_CHANGE}` : ''].filter(Boolean).join(', ')})` : '';
    out.message = out.status === 'pass' ? `${what()} passed in round ${round}${out.command ? ` (\`${out.command}\`)` : ''}${pre}.`
      : out.status === 'fail' ? `${what()} failed in round ${round} (\`${out.command}\`): ${plural(out.failures.length, 'failing test')}${classes}${out.timed_out ? ', timed out' : ''}${pre}. Log: ${out.log}`
        : notRunMessage(out);
    return out;
  };
  out.command = String(command || '').trim() || (mock ? 'npm test' : detectTestCommand(cwd));
  if (!mock) {
    if (!runDir) out.reason = 'the run has no folder';
    else if (!cwd || !fs.existsSync(cwd)) out.reason = 'the run has no worktree to test';
    else if (!out.command) Object.assign(out, await suiteWithoutCommand(cwd, testsPaths));
    if (out.reason) return finish();
  }
  const hist = history?.file && history.project ? { file: history.file, key: `${history.project}\n${out.command}` } : null;
  let measure = true;
  let list = false;
  if (Array.isArray(files)) {
    if (!files.length) {
      out.scope = 'files';
      out.status = 'pass';
      out.message = `No test file to run in round ${round}: ${selection?.why || 'none selected'}.`;
      return out;
    }
    ({ measure, tooLong, list } = narrowToFiles(out, { files, mock, coverage, cwd, testWorkers, platform, log }));
  }
  if (!mock) out.command = withWorkers(coverage ? coverageCommand(out.command, cwd) : out.command, testWorkers);
  const recent = mock ? [] : suiteDurations(hist);
  out.timeout_ms = timeoutMs || suiteTimeout(recent);
  const timeoutWhy = timeoutMs ? 'the step\'s timeout' : recent.length ? `${TIMEOUT_FACTOR}× the median of the last ${plural(recent.length, 'suite run')}` : 'the default, no suite run measured yet';
  // #414: the suite's temp files go to the run's temp folder, removed when the run ends
  const tmpDir = mock ? null : path.join(runDir, 'tmp');
  if (tmpDir) fs.mkdirSync(tmpDir, { recursive: true });
  // #553: the selection over the command-line limit, for this command only
  const listEnv = writeFileList(out, { list, tmpDir, files, logName, round, runDir });
  const childEnv = mock ? null : suiteEnv(env || process.env, { locksDir: path.join(runDir, 'locks'), testWorkers, tmpDir, passthrough });
  if (logFile) {
    writeLogHeader(logFile, out, { mock, childEnv, timeoutWhy, baseCommit, logPrefix });
    onLog?.({ path: out.log, command: out.command, timeout_ms: out.timeout_ms });
  }
  // #455: a whole-suite round waits for the machine-wide suite slot; the wait is not the round's time
  const runRound = await suiteSlotRun({ slot, mock, scope: out.scope, signal, logFile, run });
  const t0 = Date.now();
  let text = '';
  if (mock) {
    if (mockResult === 'not_run') { Object.assign(out, noTests()); return finish(); }
    if (mockResult === 'blocked') { out.reason = '(simulated) the test command was not found'; return finish(); }
    await e2eSuiteDelay(stepId, signal);
    const r = mockSuite(mockResult, preexisting);
    out.exit_code = r.code;
    text = r.text;
    if (logFile) fs.appendFileSync(logFile, text);
  } else {
    log('info', `suite: ${out.command} (round ${round}, timeout ${Math.round(out.timeout_ms / 60e3)} min, log ${out.log})`);
    const r = await runRound({ command: out.command, cwd, env: { ...childEnv.env, CRAFTORIO_TEST_HUMAN_LOG: humanLog(logFile), ...listEnv }, timeoutMs: out.timeout_ms, signal, logFile, ...optionalRunArgs({ onSpawn, sweep }) });
    out.exit_code = r.code;
    out.timed_out = r.timedOut;
    out.running = r.running || [];
    try { text = fs.readFileSync(logFile, 'utf8'); } catch { text = ''; }
    // agent mode (#219): the log holds the JSON, the human-readable report is next to it
    const report = parseAgentReport(clean(text));
    if (report?.files) out.file_counts = report.files;
    if (report && fs.existsSync(humanLog(logFile))) out.human_log = path.relative(runDir, humanLog(logFile)).split(path.sep).join('/');
    // the command itself is missing: the shell's exit code, or on Windows (any language, #67) its program exists nowhere
    if (r.code == null && r.error && !r.timedOut) { out.reason = `the command could not start: ${r.error}`; out.duration_ms = Date.now() - t0; return finish(); }
    if (isMissingCode(r.code, platform) ? !parseFailures(text, { cwd }).length : !testsRan(text, cwd) && programMissing(out.command, { ...r, cwd, env: childEnv.env, platform })) {
      out.reason = `the command was not found (\`${out.command}\`, exit ${r.code})`;
      out.duration_ms = Date.now() - t0;
      return finish();
    }
    out.reason = shellRefusal(r, text, report, cwd);
    if (out.reason) { out.duration_ms = Date.now() - t0; return finish(); }
  }
  out.duration_ms = Date.now() - t0;
  // a run that ended (not cut by the timeout, not cancelled) measures the suite for the next timeouts
  if (!mock && measure && !out.timed_out && !signal?.aborted) recordDuration(hist, out.duration_ms);
  Object.assign(out, parseCounts(text));
  tooLong = listIgnored(out, { list, files, wholeTests, log, tooLong });
  // agent mode (#219): the coverage table is in the human-readable report
  let human = '';
  if (out.human_log) { try { human = fs.readFileSync(path.join(runDir, out.human_log), 'utf8'); } catch { human = ''; } }
  const cov = saveCoverage(`${clean(text)}\n${clean(human)}`, runDir, changedFiles);
  if (cov) out.coverage = cov;
  if (out.exit_code === 0 && !out.timed_out) { out.status = 'pass'; return finish(); }
  const parsed = parseFailures(text, { cwd }); // #696: a baseline Playwright had to write is not a failure
  const { failures, generated } = splitMissingBaselines(parsed, (p) => fileOf(p, cwd));
  out.new_baselines = generated;
  out.preexisting = failures.filter((f) => preexisting.some((p) => sameTest(f, p)));
  out.failures = failures.filter((f) => !out.preexisting.includes(f));
  // a timed-out round (#396): the files still running, rerun alone on the branch (and on the base)
  const alone = await rerunTimedOut(out, {
    preexisting, cwd, env: childEnv?.env, base, signal, run, runDir, logName, round, history, log, cmdArgs: optionalRunArgs({ onSpawn, sweep }),
  });
  // the failures the run does not know yet: do they fail on the base too? (#211)
  if (out.failures.length && (base || mock) && !signal?.aborted) {
    const where = (name) => ({ command: out.command, mock, signal, run, timeoutMs: out.timeout_ms, runDir, cacheDir: baseCacheDir, log, platform, onLog, logFile: logFile ? path.join(runDir, 'logs', `${name}.log`) : null,
      env: childEnv ? { ...childEnv.env, CRAFTORIO_TEST_HUMAN_LOG: humanLog(path.join(runDir, 'logs', `${name}.log`)) } : undefined });
    const { onBase: redOnBase, info } = await checkOnBase({ ...where(`suite-${round}-base`), failures: out.failures, base });
    out.base_check = info;
    // #527: confirmed alone by a base check; #736: and red on the base's last green commit too (suite-last-green.js)
    const onBase = await excusedOnBase({ redOnBase, confirmedOnBase, lastGreenBase, sameTest, out, log, recheck: (failures, green) => checkOnBase({ ...where(`suite-${round}-last-green`), failures, base: green }) });
    if (onBase.length) {
      const where = info.commit && !String(info.commit).startsWith('(') ? ` (${String(info.commit).slice(0, 8)})` : '';
      out.preexisting.push(...onBase);
      out.failures = out.failures.filter((f) => !onBase.includes(f));
      out.preexisting_failures = onBase.map((f) => ({ test: f.test, file: f.file, reason: `fails on the base too${where}: ${String(f.error || '').split('\n')[0]}`.replace(/: $/, '') }));
    }
  }
  if (alone) out.failures.push(...alone.entries);
  else if (out.timed_out) {
    const still = out.running.length ? ` Still running: ${out.running.join(', ')}.` : '';
    out.failures.push({ test: '(the whole suite)', file: '', error: `timed out after ${Math.round(out.timeout_ms / 60e3)} min (${timeoutWhy}): a test hangs or the suite is too slow.${still}` });
  } else if (!parsed.length) {
    // failed with nothing the parser knows: the end of the log says why
    const tail = clean(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-ERROR_LINES).join('\n');
    out.failures.push({ test: '(unrecognized failure)', file: '', error: `exit ${out.exit_code ?? '?'}${tail ? `: ${tail}` : ''}`.slice(0, 400) });
  }
  classifyOutput(out, { mock, cwd, changedFiles });
  out.status = out.failures.length ? 'fail' : 'pass';
  return finish();
}

// How one round of a suite step ran (#324), e.g. "focused on 2 files: 12 scenarios (12 passed, 0
// failed), 1.5 min; then whole: 193 scenarios (193 passed, 0 failed), 44.0 min" or "whole: …",
// with the commit the round tested (#364, "; at abc1234") and, for a focused round that completed
// without a whole rerun, the whole run its result rests on; '' when the output is not a suite's.
function suiteScope(output, noun = 'test') {
  if (output?.kind !== 'suite') return '';
  const part = (o, what) => {
    const counts = o.passed == null && o.failed == null ? `${noun}s unknown` : `${plural((o.passed || 0) + (o.failed || 0), noun)} (${o.passed || 0} passed, ${o.failed || 0} failed)`;
    return `${what}: ${counts}, ${(Number(o.duration_ms || 0) / 60e3).toFixed(1)} min`;
  };
  const focused = (files) => `focused on ${plural((files || []).length, 'file')}`;
  const short = (sha) => String(sha).slice(0, 7);
  let text = output.whole_run?.commit
    ? `${part(output.affected || output, focused(output.affected?.files || output.selection?.files))}; no whole rerun, round ${output.whole_run.round}'s whole run (${short(output.whole_run.commit)}) stands for the other files`
    : output.affected
      ? `${part(output.affected, focused(output.affected.files))}; then ${part(output, 'whole')}`
      : part(output, output.scope === 'files' ? focused(output.selection?.files) : 'whole');
  if (output.commit) text += `; at ${short(output.commit)}`;
  return text;
}

// A suite output for a prompt or a gate's message: the result, the log and one line per failing
// test (file, error's first line); '' when the output is not a suite's.
function suiteMessage(output) {
  if (output?.kind !== 'suite') return '';
  const lines = [output.message];
  if (output.passed != null) lines.push(`Passed: ${output.passed}, failed: ${output.failed}.`);
  // which files ran and why (#212: "test/a.test.js: imports src/a.js"), at most SELECTION_LINES
  const sel = output.selection;
  if (sel && output.scope === 'files') {
    lines.push(`Chosen: ${sel.why}`);
    for (const f of (sel.files || []).slice(0, SELECTION_LINES)) lines.push(`- ${f}${sel.reasons?.[f] ? `: ${sel.reasons[f]}` : ''}`);
    if ((sel.files || []).length > SELECTION_LINES) lines.push(`- … and ${sel.files.length - SELECTION_LINES} more`);
  } else if (sel?.why) lines.push(`Whole suite: ${sel.why}`);
  if (output.failures?.length) lines.push('Failures:');
  for (const f of output.failures || []) lines.push(`- ${f.test}${f.file ? ` (${f.file}${f.line ? `:${f.line}` : ''})` : ''}${f.error ? `: ${String(f.error).split('\n')[0]}` : ''}${f.trace ? ` [trace: ${f.trace}]` : ''}${f.class ? ` [${f.class}: ${f.class_reason}]` : ''}`);
  if (output.human_log && output.failures?.length) lines.push(`Human-readable report (read only the lines you need): ${output.human_log}`);
  if (output.preexisting?.length) {
    lines.push('Also failing on the base (reported, not chased):');
    for (const f of output.preexisting) lines.push(`- ${f.test}${f.file ? ` (${f.file})` : ''}`);
  }
  lines.push(...generatedLines(output.new_baselines)); // #696: the baselines Playwright wrote, for the UI review
  return lines.join('\n');
}

// The red check of tests written before the code (#220, a suite step's `files` + `expect: red`):
// of the test `files` that ran, which fail as they should (red), which already pass (green: they
// guard existing behaviour or are wrong; partly_green: a red file with some tests passing, from
// the agent reporter's per-file counts) and which could not run (broken: a syntax error, a crash
// before their tests, a run nothing could be read from). Simulation: mockResult pass = all green,
// broken = all broken, anything else = all red. → { red, green, partly_green, broken: [{ file, error }] }
function redCheck(output, files, { mock, mockResult } = {}) {
  const out = { red: [], green: [], partly_green: [], broken: [] };
  if (mock) {
    if (mockResult === 'pass') out.green = [...files];
    else if (mockResult === 'broken') out.broken = files.map((file) => ({ file, error: '(simulated) SyntaxError: Unexpected token' }));
    else out.red = [...files];
    return out;
  }
  const all = [...(output?.failures || []), ...(output?.preexisting || [])];
  const unreadable = all.some((f) => /^\((unrecognized failure|the whole suite|the test runner)\)$/.test(f.test));
  const countsOf = (file) => Object.entries(output?.file_counts || {}).find(([f]) => sameFile(f, file))?.[1];
  for (const file of files) {
    const fails = all.filter((f) => sameFile(f.file, file));
    const crash = fails.find((f) => f.kind === 'file' || sameFile(f.test, file));
    if (crash || (unreadable && !fails.length)) {
      out.broken.push({ file, error: String(crash?.error || all[0]?.error || 'the run failed without a recognizable failure').split('\n')[0] });
    } else if (!fails.length) out.green.push(file);
    else {
      out.red.push(file);
      const c = countsOf(file);
      if (c?.passed) out.partly_green.push({ file, passed: c.passed, failed: c.failed });
    }
  }
  return out;
}

module.exports = {
  checkOnBase,
  coverageCommand,
  detectTestCommand,
  FILE_TIMEOUT_MS,
  filteredCommand,
  GRADLE_BUILD_FILES,
  isFullSuiteCommand,
  parseCounts,
  parseFailures,
  PYTHON_PROJECT_FILES,
  redCheck,
  runCommand,
  runFileAlone,
  runningTestFiles,
  runSuite,
  saveCoverage,
  SUITE_TIMEOUT_MS,
  suiteDurations,
  suiteEnv,
  suiteMessage,
  suiteScope,
  suiteTimeout,
  withWorkers,
};
