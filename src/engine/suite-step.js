// The `type: suite` step (#177): a step without an agent that runs the project's whole test suite
// once per round in the run's worktree, so no agent turn stays open (and no context fills up) while
// it runs. The command is the step's `command` (a template, e.g. "{{ inputs.test_command }}") or,
// when it renders empty, the one the worktree's files give (`detectTestCommand`: package.json's test
// script → `npm test`, go.mod → `go test ./...`, ...). The whole output goes to
// <run_dir>/logs/suite-<round>.log; the failing tests are read from it (`parseFailures`: node:test
// spec and TAP, Jest, pytest, go test, dotnet test, Maven) as { test, file, error } (the error's
// first lines). Failures the run already knows fail on the base too (`preexisting`, the test
// writer's pre-existing failures, #101) are reported apart and never fail the step.
// Output: { kind: 'suite', status: pass | fail | blocked, round, command, log, exit_code, duration_ms,
// timed_out, failures, preexisting, reason, message }. `blocked`: the suite could not run (no
// worktree, no command found, the command not found). It never throws and never calls the supervisor:
// the transitions route the result (back to the test writer or the developer, or a gate).
// Simulation (`mock`): nothing is run; `mockResult` (mockSequences.suite: { <step>: [per visit] },
// default pass) is pass | fail | preexisting (only the run's pre-existing failures fail: a pass) |
// blocked, and a simulated log is written.
// `isFullSuiteCommand` tells the engine an agent started the whole suite itself (a warn, #177).

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { killTree } = require('./providers');

const SUITE_TIMEOUT_MS = 30 * 60e3;
const MAX_FAILURES = 30;
const ERROR_LINES = 3;

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
function parseFailures(text, { cwd } = {}) {
  const lines = clean(text).split(/\r?\n/);
  const out = [];
  const add = (test, file, error) => {
    test = String(test || '').trim();
    if (!test || out.some((f) => f.test === test && f.file === file)) return;
    out.push({ test, file: file || '', error: error || '' });
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

// Runs `command` in a shell in cwd, its whole output into logFile → { code, timedOut, error }; never rejects.
function runCommand({ command, cwd, env, timeoutMs, signal, logFile }) {
  const childEnv = { ...env };
  // the engine may run inside Electron as node: the suite's own Electron children must not
  delete childEnv.ELECTRON_RUN_AS_NODE;
  delete childEnv.CLAUDECODE;
  return new Promise((resolve) => {
    const out = fs.createWriteStream(logFile, { flags: 'a' });
    let child;
    try {
      child = spawn(command, { cwd, env: childEnv, shell: true, windowsHide: true });
    } catch (e) {
      out.end(`${e.message}\n`);
      resolve({ code: null, timedOut: false, error: e.message });
      return;
    }
    let timedOut = false;
    child.stdout?.on('data', (d) => out.write(d));
    child.stderr?.on('data', (d) => out.write(d));
    const stop = () => killTree(child);
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    signal?.addEventListener('abort', stop, { once: true });
    let finished = false;
    const done = (code, err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      out.end(err ? `\n${err.message}\n` : '', () => resolve({ code, timedOut, error: err?.message || null }));
    };
    child.on('error', (e) => done(null, e));
    child.on('close', (code) => done(code));
  });
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// The simulated suite of a mock run: the log and its result
function mockSuite(result, preexisting) {
  const pre = preexisting.length ? preexisting : [{ test: 'simulated pre-existing failure', file: 'test/simulated-base.test.js', reason: 'fails on the base too' }];
  if (result === 'fail') {
    return { code: 1, text: '✖ failing tests:\n\ntest at test/simulated.test.js:12:3\n✖ simulated failing test (3.1ms)\n  AssertionError [ERR_ASSERTION]: simulated failure\n    expected: 1\n    actual: 2\n\nℹ pass 41\nℹ fail 1\n' };
  }
  if (result === 'preexisting') {
    return { code: 1, text: `✖ failing tests:\n\n${pre.map((f) => `test at ${f.file}:1:1\n✖ ${f.test} (1ms)\n  Error: ${f.reason || 'fails on the base too'}\n`).join('\n')}\nℹ pass 41\nℹ fail ${pre.length}\n` };
  }
  return { code: 0, text: 'ℹ tests 42\nℹ pass 42\nℹ fail 0\n' };
}

// command: rendered (empty: detected); cwd: the worktree; runDir: the run folder (log under logs/);
// round: the step's visit; env: the agents' environment (simulation only, scratch workspace);
// preexisting: the run's known pre-existing failures [{ test, file, reason }]; mockResult: see above;
// run: runCommand (replaceable)
async function runSuite({ command, cwd, runDir, round, env, mock, mockResult = 'pass', preexisting = [], signal, timeoutMs = SUITE_TIMEOUT_MS, run = runCommand, log = () => {} }) {
  const logFile = runDir ? path.join(runDir, 'logs', `suite-${round}.log`) : null;
  const out = {
    kind: 'suite', status: 'blocked', round, command: null, log: logFile ? path.relative(runDir, logFile).split(path.sep).join('/') : null,
    exit_code: null, duration_ms: 0, timed_out: false, failures: [], preexisting: [], reason: null, message: '',
  };
  const finish = () => {
    const pre = out.preexisting.length ? ` (${plural(out.preexisting.length, 'pre-existing failure')} not counted: they fail on the base too)` : '';
    out.message = out.status === 'pass' ? `The suite passed in round ${round}${out.command ? ` (\`${out.command}\`)` : ''}${pre}.`
      : out.status === 'fail' ? `The suite failed in round ${round} (\`${out.command}\`): ${plural(out.failures.length, 'failing test')}${out.timed_out ? ', timed out' : ''}${pre}. Log: ${out.log}`
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
  if (logFile) {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.writeFileSync(logFile, `$ ${out.command}${mock ? '   (simulated: nothing was run)' : ''}\n`);
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
    log('info', `suite: ${out.command} (round ${round}, log ${out.log})`);
    const r = await run({ command: out.command, cwd, env, timeoutMs, signal, logFile });
    out.exit_code = r.code;
    out.timed_out = r.timedOut;
    try { text = fs.readFileSync(logFile, 'utf8'); } catch { text = ''; }
    // the shell's "not recognized" / "not found": the command itself is missing
    if (r.code == null && r.error && !r.timedOut) { out.reason = `the command could not start: ${r.error}`; out.duration_ms = Date.now() - t0; return finish(); }
    if ((r.code === 127 || (process.platform === 'win32' && r.code === 9009)) && !parseFailures(text, { cwd }).length) {
      out.reason = `the command was not found (\`${out.command}\`, exit ${r.code})`;
      out.duration_ms = Date.now() - t0;
      return finish();
    }
  }
  out.duration_ms = Date.now() - t0;
  if (out.exit_code === 0 && !out.timed_out) { out.status = 'pass'; return finish(); }
  const failures = parseFailures(text, { cwd });
  out.preexisting = failures.filter((f) => preexisting.some((p) => sameTest(f, p)));
  out.failures = failures.filter((f) => !out.preexisting.includes(f));
  if (out.timed_out) out.failures.push({ test: '(the whole suite)', file: '', error: `timed out after ${Math.round(timeoutMs / 60e3)} min: a test hangs or the suite is too slow` });
  else if (!failures.length) {
    // failed with nothing the parser knows: the end of the log says why
    const tail = clean(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-ERROR_LINES).join('\n');
    out.failures.push({ test: '(unrecognized failure)', file: '', error: `exit ${out.exit_code ?? '?'}${tail ? `: ${tail}` : ''}`.slice(0, 400) });
  }
  out.status = out.failures.length ? 'fail' : 'pass';
  return finish();
}

// A suite output for a prompt or a gate's message: the result, the log and one line per failing
// test (file, error's first line); '' when the output is not a suite's.
function suiteMessage(output) {
  if (output?.kind !== 'suite') return '';
  const lines = [output.message];
  for (const f of output.failures || []) lines.push(`- ${f.test}${f.file ? ` (${f.file})` : ''}${f.error ? `: ${String(f.error).split('\n')[0]}` : ''}`);
  if (output.preexisting?.length) {
    lines.push('Also failing on the base (reported, not chased):');
    for (const f of output.preexisting) lines.push(`- ${f.test}${f.file ? ` (${f.file})` : ''}`);
  }
  return lines.join('\n');
}

module.exports = {
  detectTestCommand,
  isFullSuiteCommand,
  parseFailures,
  runCommand,
  runSuite,
  SUITE_TIMEOUT_MS,
  suiteMessage,
};
