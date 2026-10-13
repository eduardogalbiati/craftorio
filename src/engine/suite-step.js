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
// output: the engine adds them to the run's list and to the workspace's failing-on-main.json); files
// the base does not have are the run's. The base's result per file is cached by base commit + file
// (<workspace>/cache/base-tests/<commit>.json), so the next round and other runs reuse it.
// A step with `base_check: false` (#260, release.yaml: its worktree is the base itself) gets no
// `base`: nothing is checked there, every failing test fails the step.
// The suite runs as from a shell (#210): `suiteEnv` drops the app's variables (Electron's, npm's, an
// inspector in NODE_OPTIONS that forces node --test to one file at a time, the scratch workspace that
// every test process would share) and gives the suite its own lock folder (MULTIAGENT_LOCKS_DIR,
// <run>/locks), so a test never waits for the machine-wide screenshot slot held by other runs. The
// log starts with what the child gets (parallelism, the variables removed). Without a step
// `timeout`, the timeout comes from the project's recent suite durations (<workspace>/cache/
// suite-durations.json: 3× the median, at least 10 min; 30 min with no history); a timeout names the
// test files still running.
// Output: { kind: 'suite', status: pass | fail | blocked, round, command, log, exit_code, duration_ms,
// timed_out, timeout_ms, running, failures, preexisting, preexisting_failures, base_check, reason,
// message }. `blocked`: the suite could not run (no worktree, no command found, the command not found).
// It never throws and never calls the supervisor: the transitions route the result (back to the test
// writer or the developer, or a gate).
// Simulation (`mock`): nothing is run; `mockResult` (mockSequences.suite: { <step>: [per visit] },
// default pass) is pass | fail | preexisting (only the run's pre-existing failures fail: a pass) |
// base (the failures fail on the simulated base too: a pass) | mixed (2 failures, one on the base:
// a fail with 1 failure) | blocked, and a simulated log is written.
// `isFullSuiteCommand` tells the engine an agent started the whole suite itself (a warn, #177).
// Affected tests (#212): with `files`, only those test files run (`scope: files`, the step's
// `scope: affected` rounds and agents' test requests, see src/engine/affected-tests.js); the output
// says which files and why (`selection`), and `passed` / `failed` are the runner's counts.
// Agent mode (#219): the suite gets MULTIAGENT_AGENT_MODE=1 and MULTIAGENT_TEST_HUMAN_LOG (<log>.human.log);
// a runner that knows them (this project's scripts/test.js) prints one failures-only JSON line,
// which `parseFailures` / `parseCounts` read before any text format (`human_log`, `file_counts`).
// Red check (#220): `redCheck` sorts the test files of a tests-first run into red / green / broken.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { parseAgentReport } = require('./agent-test-report');
const { parseNodeCoverage, renderCoverageSummary } = require('../coverage-summary');
const { processTreeCommands } = require('./processes');
const { killTree, OWN_GROUP } = require('./providers');
const { workerEnv } = require('../machine-profile');

const SUITE_TIMEOUT_MS = 30 * 60e3;
const MIN_TIMEOUT_MS = 10 * 60e3;
const MAX_TIMEOUT_MS = 3 * 60 * 60e3;
const TIMEOUT_FACTOR = 3;
const HISTORY = 10;
const MAX_FAILURES = 30;
const ERROR_LINES = 3;
const MOCK_BASE_FILE = 'test/simulated-base.test.js';
const SELECTION_LINES = 20;

const exists = (dir, f) => { try { return fs.existsSync(path.join(dir, f)); } catch { return false; } };
const someFile = (dir, re) => { try { return fs.readdirSync(dir).some((f) => re.test(f)); } catch { return false; } };

// The project's whole-suite command from the files of its folder, or null.
function detectTestCommand(dir) {
  if (!dir || !fs.existsSync(dir)) return null;
  try {
    const test = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).scripts?.test;
    // npm init's placeholder is not a suite
    if (typeof test === 'string' && test.trim() && !/no test specified/.test(test)) return 'npm test';
  } catch { /* no package.json */ }
  if (exists(dir, 'go.mod')) return 'go test ./...';
  if (exists(dir, 'pom.xml')) {
    if (process.platform === 'win32' && exists(dir, 'mvnw.cmd')) return 'mvnw.cmd -B test';
    return exists(dir, 'mvnw') ? './mvnw -B test' : 'mvn -B test';
  }
  if (exists(dir, 'build.gradle') || exists(dir, 'build.gradle.kts')) {
    if (process.platform === 'win32' && exists(dir, 'gradlew.bat')) return 'gradlew.bat test';
    return exists(dir, 'gradlew') ? './gradlew test' : 'gradle test';
  }
  if (someFile(dir, /\.(sln|csproj)$/i)) return 'dotnet test';
  if (['pyproject.toml', 'pytest.ini', 'setup.cfg', 'tox.ini', 'setup.py', 'requirements.txt'].some((f) => exists(dir, f))) return 'python -m pytest';
  return null;
}

const clean = (s) => String(s || '').replace(/\x1b\[[0-9;]*m/g, '');
const firstLines = (lines) => lines.map((l) => l.trim()).filter(Boolean).slice(0, ERROR_LINES).join('\n').slice(0, 400);
// 'C:\\x\\test\\a.test.js:12:3' / 'file:///x/a.test.js:12:3' → the file, relative to cwd when inside it
function fileOf(loc, cwd) {
  let f = String(loc || '').trim().replace(/^'|'$/g, '').replace(/\\\\/g, '\\').replace(/^file:\/\/\/?/, '').replace(/:\d+(?::\d+)?$/, '');
  if (cwd && path.isAbsolute(f)) {
    const rel = path.relative(cwd, f);
    if (!rel.startsWith('..')) f = rel;
  }
  return f.split(path.sep).join('/');
}

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
// runner context, the app's own MULTIAGENT_* (the scratch workspace and user data every test process
// would share, an inherited screenshot slot); inspector flags are cut from NODE_OPTIONS (node --test
// runs one file at a time under an inspector). Set: MULTIAGENT_SIMULATION_ONLY=1, MULTIAGENT_AGENT_MODE=1
// (#219: a runner that knows it prints the failures-only JSON, src/engine/agent-test-report.js) and,
// with locksDir, MULTIAGENT_LOCKS_DIR (the suite's own screenshot slot); with testWorkers, the run's
// test workers (#367, src/machine-profile.js workerEnv), never an inherited value. → { env, removed: [names] }
const DROP_ENV = /^(ELECTRON_|CHROME_CRASHPAD|NPM_|CLAUDECODE$|NODE_TEST_CONTEXT$|VSCODE_INSPECTOR_OPTIONS$|MULTIAGENT_)/i;
function suiteEnv(env = {}, { locksDir, testWorkers } = {}) {
  const out = {};
  const removed = [];
  for (const [k, v] of Object.entries(env)) {
    if (v == null) continue;
    if (DROP_ENV.test(k)) { removed.push(k); continue; }
    if (/^NODE_OPTIONS$/i.test(k)) {
      const opts = String(v).split(/\s+/).filter((o) => o && !/^--(inspect|debug)/.test(o)).join(' ');
      if (opts !== String(v).trim()) removed.push(`${k} (inspector flags)`);
      if (opts) out[k] = opts;
      continue;
    }
    out[k] = v;
  }
  out.MULTIAGENT_SIMULATION_ONLY = '1';
  out.MULTIAGENT_AGENT_MODE = '1';
  if (locksDir) out.MULTIAGENT_LOCKS_DIR = locksDir;
  if (testWorkers) Object.assign(out, workerEnv({ testWorkers }));
  const replaced = (k) => /^MULTIAGENT_(SIMULATION_ONLY|AGENT_MODE|LOCKS_DIR)$/i.test(k) || (!!testWorkers && /^MULTIAGENT_(TEST|E2E)_WORKERS$/i.test(k));
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
function runCommand({ command, cwd, env, timeoutMs, signal, logFile, onSpawn }) {
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
    const done = (code, err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      out.end(err ? `\n${err.message}\n` : '', () => resolve({ code, timedOut, error: err?.message || null, running }));
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
  if (result === 'mixed') {
    return { code: 1, text: `✖ failing tests:\n\ntest at test/simulated.test.js:12:3\n✖ simulated failing test (3.1ms)\n  AssertionError [ERR_ASSERTION]: simulated failure\n\n${onBase}\nℹ pass 40\nℹ fail 2\n` };
  }
  return { code: 0, text: 'ℹ tests 42\nℹ pass 42\nℹ fail 0\n' };
}

// The step's timeout from the project's recent suite durations (ms): TIMEOUT_FACTOR × their median,
// between MIN_TIMEOUT_MS and MAX_TIMEOUT_MS; `fallback` without history.
function suiteTimeout(durations, fallback = SUITE_TIMEOUT_MS) {
  const d = (durations || []).filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!d.length) return fallback;
  const mid = d.length >> 1;
  const median = d.length % 2 ? d[mid] : (d[mid - 1] + d[mid]) / 2;
  return Math.round(Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, TIMEOUT_FACTOR * median)));
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

// Base results cached per base commit + file: <cacheDir>/<commit>.json, { <file>: { failing: [test names], at } }
const baseCacheFile = (cacheDir, commit) => (cacheDir && commit ? path.join(cacheDir, `${String(commit).replace(/[^\w.-]/g, '')}.json`) : null);
const sameFile = (a, b) => String(a || '').split(/[\\/]/).pop() === String(b || '').split(/[\\/]/).pop();

// Which of `failures` also fail on the base (#211): their test files run in the base checkout (cached
// per commit + file). → { onBase: [failure], info: { status: done | skipped, commit, files, cached,
// ran, log, reason } }; never throws.
async function checkOnBase({ command, failures, base, mock, env, timeoutMs, signal, run = runCommand, logFile, runDir, cacheDir, log = () => {} }) {
  const info = { status: 'skipped', commit: null, files: [], cached: [], ran: [], log: null, reason: null };
  const files = [...new Set(failures.map((f) => f.file).filter(Boolean))].sort();
  info.files = files;
  if (!files.length) { info.reason = 'the failures name no test file'; return { onBase: [], info }; }
  if (mock) {
    Object.assign(info, { status: 'done', commit: '(simulated)', ran: files });
    return { onBase: failures.filter((f) => f.file === MOCK_BASE_FILE), info };
  }
  if (typeof base !== 'function') { info.reason = 'the run has no base checkout'; return { onBase: [], info }; }
  if (!filteredCommand(command, files)) { info.reason = `\`${command}\` cannot run single test files`; return { onBase: [], info }; }
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
    if (runDir) info.log = path.relative(runDir, logFile).split(path.sep).join('/');
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

// The workspace's list of tests failing on the base (#211), <workspace>/failing-on-main.json:
// { updated_at, failures: [{ project, base, commit, test, file, error, first_seen, last_seen, runs }] },
// one entry per project + file + test, so a follow-up issue (#186) can take them instead of every run.
function noteFailingOnMain(file, { project, base, commit, runId, failures }) {
  if (!file || !failures?.length) return;
  try {
    const data = readJson(file);
    const list = Array.isArray(data.failures) ? data.failures : [];
    const now = new Date().toISOString();
    for (const f of failures) {
      let e = list.find((x) => x.project === project && x.file === f.file && x.test === f.test);
      if (!e) list.push(e = { project, base: base || null, commit: null, test: f.test, file: f.file, error: '', first_seen: now, last_seen: now, runs: [] });
      Object.assign(e, { base: base || e.base, commit: commit || e.commit, error: String(f.error || e.error || '').split('\n')[0], last_seen: now });
      if (runId && !e.runs.includes(runId)) e.runs = [...e.runs, runId].slice(-HISTORY);
    }
    writeJson(file, { updated_at: now, failures: list });
  } catch { /* reported in the run anyway */ }
}

// The passed / failed counts a runner prints at the end (node:test, TAP, Jest, pytest), null when
// none is recognized.
function parseCounts(text) {
  const t = clean(text);
  const report = parseAgentReport(t);
  if (report) return { passed: report.passed ?? 0, failed: report.failed ?? 0 };
  const last = (re) => { const all = [...t.matchAll(re)]; return all.length ? Number(all[all.length - 1][1]) : null; };
  const node = { passed: last(/^\s*(?:ℹ|#) pass (\d+)/gm), failed: last(/^\s*(?:ℹ|#) fail (\d+)/gm) };
  if (node.passed != null || node.failed != null) return { passed: node.passed ?? 0, failed: node.failed ?? 0 };
  const jest = t.match(/^Tests:\s+(.*)$/m)?.[1];
  if (jest) return { passed: Number(jest.match(/(\d+) passed/)?.[1] || 0), failed: Number(jest.match(/(\d+) failed/)?.[1] || 0) };
  const py = [...t.matchAll(/=+ (.*\b(?:passed|failed)\b.*) in [\d.]+s/g)].pop()?.[1];
  if (py) return { passed: Number(py.match(/(\d+) passed/)?.[1] || 0), failed: Number(py.match(/(\d+) failed/)?.[1] || 0) };
  // Playwright: "  1 failed" (then the failed tests' lines), "  2 passed (15.4s)"
  const pw = { passed: last(/^\s*(\d+) passed(?: \([^)]*\))?\s*$/gm), failed: last(/^\s*(\d+) failed\s*$/gm) };
  if (pw.passed != null || pw.failed != null) return { passed: pw.passed ?? 0, failed: pw.failed ?? 0 };
  return { passed: null, failed: null };
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
  const npm = /^npm\s+(?:(test|t)|run(?:-script)?\s+([\w:.-]+))(\s+--\s+(.*))?$/.exec(c.trim());
  if (!npm || !cwd) return withFlag(c);
  let scripts = {};
  try { scripts = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')).scripts || {}; } catch { return c; }
  const name = npm[2] || 'test';
  const rest = npm[3] || '';
  if (scripts[`${name}:coverage`]) return `npm run ${name}:coverage${rest}`;
  const script = String(scripts[name] || '').trim();
  if (/^node(\.exe)?\s+--test\b/.test(script) && !/[&|;<>]/.test(script)) return `${withFlag(script)}${npm[4] ? ` ${npm[4]}` : ''}`;
  return c;
}

// The coverage report of a suite's output → <run_dir>/coverage/coverage-summary.md and its numbers
// ({ lines, branches, functions, files, path }), or null without a report. No model call.
function saveCoverage(text, runDir, changedFiles) {
  const head = parseNodeCoverage(text);
  if (!head || !runDir) return null;
  let changed = [];
  try { changed = (typeof changedFiles === 'function' ? changedFiles() : changedFiles) || []; } catch { changed = []; }
  const summary = parseNodeCoverage(text, { changedFiles: changed });
  const rel = 'coverage/coverage-summary.md';
  try {
    fs.mkdirSync(path.join(runDir, 'coverage'), { recursive: true });
    fs.writeFileSync(path.join(runDir, rel), renderCoverageSummary(summary));
  } catch { return null; }
  return { ...summary.totals, files: summary.files.length, path: rel };
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
async function runSuite({ command, cwd, runDir, round, env, mock, mockResult = 'pass', preexisting = [], signal, timeoutMs, history, base, baseCacheDir, run = runCommand, log = () => {}, files = null, selection = null, logName = null, coverage = false, changedFiles = null, onSpawn = null, testWorkers = null }) {
  const logFile = runDir ? path.join(runDir, 'logs', `${logName || `suite-${round}`}.log`) : null;
  const out = {
    kind: 'suite', status: 'blocked', round, scope: 'full', command: null, log: logFile ? path.relative(runDir, logFile).split(path.sep).join('/') : null,
    exit_code: null, duration_ms: 0, timed_out: false, timeout_ms: null, running: [], passed: null, failed: null, failures: [], preexisting: [], preexisting_failures: [], base_check: null, selection, reason: null, message: '',
  };
  const what = () => (out.scope === 'files' ? `The selected tests (${plural(out.selection?.files?.length ?? files.length, 'test file')})` : 'The suite');
  const finish = () => {
    const pre = out.preexisting.length ? ` (${plural(out.preexisting.length, 'pre-existing failure')} not counted: they fail on the base too)` : '';
    out.message = out.status === 'pass' ? `${what()} passed in round ${round}${out.command ? ` (\`${out.command}\`)` : ''}${pre}.`
      : out.status === 'fail' ? `${what()} failed in round ${round} (\`${out.command}\`): ${plural(out.failures.length, 'failing test')}${out.timed_out ? ', timed out' : ''}${pre}. Log: ${out.log}`
        : `The suite could not run: ${out.reason}`;
    return out;
  };
  out.command = String(command || '').trim() || (mock ? 'npm test' : detectTestCommand(cwd));
  if (!mock) {
    if (!runDir) out.reason = 'the run has no folder';
    else if (!cwd || !fs.existsSync(cwd)) out.reason = 'the run has no worktree to test';
    else if (!out.command) out.reason = 'no test command: set the workflow\'s test_command input (none found in package.json, go.mod, pom.xml, build.gradle, *.csproj, pyproject.toml)';
    if (out.reason) return finish();
  }
  const hist = history?.file && history.project ? { file: history.file, key: `${history.project}\n${out.command}` } : null;
  let measure = true;
  if (Array.isArray(files)) {
    if (!files.length) {
      out.scope = 'files';
      out.status = 'pass';
      out.message = `No test file to run in round ${round}: ${selection?.why || 'none selected'}.`;
      return out;
    }
    const filtered = filteredCommand(out.command, files);
    if (filtered) { out.scope = 'files'; out.command = filtered; measure = false; }
    else if (out.selection) out.selection = { ...out.selection, why: `${out.selection.why}; \`${out.command}\` cannot run single test files: the whole suite ran` };
  }
  if (coverage && !mock) out.command = coverageCommand(out.command, cwd);
  if (!mock) out.command = withWorkers(out.command, testWorkers);
  const recent = mock ? [] : suiteDurations(hist);
  out.timeout_ms = timeoutMs || suiteTimeout(recent);
  const timeoutWhy = timeoutMs ? 'the step\'s timeout' : recent.length ? `${TIMEOUT_FACTOR}× the median of the last ${plural(recent.length, 'suite run')}` : 'the default, no suite run measured yet';
  const childEnv = mock ? null : suiteEnv(env || process.env, { locksDir: path.join(runDir, 'locks'), testWorkers });
  if (logFile) {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    // what the suite gets, so a slow round can be compared with a shell (#210)
    const about = mock ? '' : `# engine: os.availableParallelism()=${os.availableParallelism()}, cpus=${os.cpus().length}; timeout ${Math.round(out.timeout_ms / 60e3)} min (${timeoutWhy})\n`
      + `# env: removed ${childEnv.removed.join(', ') || 'nothing'}; set MULTIAGENT_SIMULATION_ONLY=1, MULTIAGENT_AGENT_MODE=1, MULTIAGENT_LOCKS_DIR=${childEnv.env.MULTIAGENT_LOCKS_DIR}, MULTIAGENT_TEST_HUMAN_LOG=${humanLog(logFile)}\n`;
    fs.writeFileSync(logFile, `$ ${out.command}${mock ? '   (simulated: nothing was run)' : ''}\n${about}`);
  }
  const t0 = Date.now();
  let text = '';
  if (mock) {
    if (mockResult === 'blocked') { out.reason = '(simulated) the test command was not found'; return finish(); }
    const r = mockSuite(mockResult, preexisting);
    out.exit_code = r.code;
    text = r.text;
    if (logFile) fs.appendFileSync(logFile, text);
  } else {
    log('info', `suite: ${out.command} (round ${round}, timeout ${Math.round(out.timeout_ms / 60e3)} min, log ${out.log})`);
    const r = await run({ command: out.command, cwd, env: { ...childEnv.env, MULTIAGENT_TEST_HUMAN_LOG: humanLog(logFile) }, timeoutMs: out.timeout_ms, signal, logFile, ...(onSpawn ? { onSpawn } : {}) });
    out.exit_code = r.code;
    out.timed_out = r.timedOut;
    out.running = r.running || [];
    try { text = fs.readFileSync(logFile, 'utf8'); } catch { text = ''; }
    // agent mode (#219): the log holds the JSON, the human-readable report is next to it
    const report = parseAgentReport(clean(text));
    if (report?.files) out.file_counts = report.files;
    if (report && fs.existsSync(humanLog(logFile))) out.human_log = path.relative(runDir, humanLog(logFile)).split(path.sep).join('/');
    // the shell's "not recognized" / "not found": the command itself is missing
    if (r.code == null && r.error && !r.timedOut) { out.reason = `the command could not start: ${r.error}`; out.duration_ms = Date.now() - t0; return finish(); }
    if ((r.code === 127 || (process.platform === 'win32' && r.code === 9009)) && !parseFailures(text, { cwd }).length) {
      out.reason = `the command was not found (\`${out.command}\`, exit ${r.code})`;
      out.duration_ms = Date.now() - t0;
      return finish();
    }
  }
  out.duration_ms = Date.now() - t0;
  // a run that ended (not cut by the timeout, not cancelled) measures the suite for the next timeouts
  if (!mock && measure && !out.timed_out && !signal?.aborted) recordDuration(hist, out.duration_ms);
  Object.assign(out, parseCounts(text));
  // agent mode (#219): the coverage table is in the human-readable report
  let human = '';
  if (out.human_log) { try { human = fs.readFileSync(path.join(runDir, out.human_log), 'utf8'); } catch { human = ''; } }
  const cov = saveCoverage(`${clean(text)}\n${clean(human)}`, runDir, changedFiles);
  if (cov) out.coverage = cov;
  if (out.exit_code === 0 && !out.timed_out) { out.status = 'pass'; return finish(); }
  const failures = parseFailures(text, { cwd });
  out.preexisting = failures.filter((f) => preexisting.some((p) => sameTest(f, p)));
  out.failures = failures.filter((f) => !out.preexisting.includes(f));
  // the failures the run does not know yet: do they fail on the base too? (#211)
  if (!out.timed_out && out.failures.length && (base || mock) && !signal?.aborted) {
    const { onBase, info } = await checkOnBase({
      command: out.command, failures: out.failures, base, mock, signal, run,
      env: childEnv ? { ...childEnv.env, MULTIAGENT_TEST_HUMAN_LOG: humanLog(path.join(runDir, 'logs', `suite-${round}-base.log`)) } : undefined, timeoutMs: out.timeout_ms,
      logFile: logFile ? path.join(runDir, 'logs', `suite-${round}-base.log`) : null, runDir, cacheDir: baseCacheDir, log,
    });
    out.base_check = info;
    if (onBase.length) {
      const where = info.commit && !String(info.commit).startsWith('(') ? ` (${String(info.commit).slice(0, 8)})` : '';
      out.preexisting.push(...onBase);
      out.failures = out.failures.filter((f) => !onBase.includes(f));
      out.preexisting_failures = onBase.map((f) => ({ test: f.test, file: f.file, reason: `fails on the base too${where}: ${String(f.error || '').split('\n')[0]}`.replace(/: $/, '') }));
    }
  }
  if (out.timed_out) {
    const still = out.running.length ? ` Still running: ${out.running.join(', ')}.` : '';
    out.failures.push({ test: '(the whole suite)', file: '', error: `timed out after ${Math.round(out.timeout_ms / 60e3)} min (${timeoutWhy}): a test hangs or the suite is too slow.${still}` });
  } else if (!failures.length) {
    // failed with nothing the parser knows: the end of the log says why
    const tail = clean(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-ERROR_LINES).join('\n');
    out.failures.push({ test: '(unrecognized failure)', file: '', error: `exit ${out.exit_code ?? '?'}${tail ? `: ${tail}` : ''}`.slice(0, 400) });
  }
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
  for (const f of output.failures || []) lines.push(`- ${f.test}${f.file ? ` (${f.file}${f.line ? `:${f.line}` : ''})` : ''}${f.error ? `: ${String(f.error).split('\n')[0]}` : ''}${f.trace ? ` [trace: ${f.trace}]` : ''}`);
  if (output.human_log && output.failures?.length) lines.push(`Human-readable report (read only the lines you need): ${output.human_log}`);
  if (output.preexisting?.length) {
    lines.push('Also failing on the base (reported, not chased):');
    for (const f of output.preexisting) lines.push(`- ${f.test}${f.file ? ` (${f.file})` : ''}`);
  }
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
  filteredCommand,
  isFullSuiteCommand,
  noteFailingOnMain,
  parseCounts,
  parseFailures,
  redCheck,
  runCommand,
  runningTestFiles,
  runSuite,
  saveCoverage,
  SUITE_TIMEOUT_MS,
  suiteEnv,
  suiteMessage,
  suiteScope,
  suiteTimeout,
  withWorkers,
};
