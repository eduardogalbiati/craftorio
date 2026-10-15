// AI-friendly test output (#219): agents pay for tests by reading them, and a `node --test` log
// reaches 250 KB of passing tests and stack traces. In agent mode the suite prints one JSON line
// instead (failures only, no colours), and the human-readable report goes to a log file next to it.
//   { "reporter": "multiagent-agent", "passed", "failed", "skipped", "todo", "cancelled", "duration_ms",
//     "failures": [{ test, file, line, error, expected?, actual?, kind: test | file }],
//     "files"?: { <file>: { passed, failed } }   (focused runs only: at most FILE_COUNTS files),
//     "flow"?: { status, error }, "human_log"? }
// `kind: file` is a test file that could not run (a syntax error, a crash before its tests): the
// file is the failure. `error` is the error's first ERROR_LINES lines; `line` is the failing
// assertion's line in the test file when its stack names it, else the test's own line.
// `isAgentMode(env, { isTTY })` decides like Vitest's `agent` reporter: MULTIAGENT_AGENT_MODE=1/0
// wins; then CI and a terminal stay human; then the orchestrator's variable (MULTIAGENT_SIMULATION_ONLY,
// set for every agent and suite it starts) or an agent CLI's marker (CLAUDECODE, CODEX_SANDBOX, ...)
// means an agent. `reporter` is the node:test custom reporter (scripts/test-reporter-agent.js loads
// it); `parseAgentReport(text)` finds the JSON line in a suite's output (suite-step.js parseFailures).
// A test that ran out of its budget (#402, node's testTimeoutFailure) is a failure like any other,
// its error "test timed out after N s".

const path = require('path');
const util = require('util');

const REPORTER = 'multiagent-agent';
const ERROR_LINES = 3;
const VALUE_CHARS = 200;
const FILE_COUNTS = 20;
const AGENT_MARKERS = ['AI_AGENT', 'CLAUDECODE', 'CODEX_SANDBOX', 'CURSOR_AGENT', 'GEMINI_CLI', 'MULTIAGENT_SIMULATION_ONLY'];

const flag = (v) => {
  const s = String(v ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'off'].includes(s)) return false;
  return null;
};

// Inside an agent or the orchestrator? env: the process environment; isTTY: stdout is a terminal.
function isAgentMode(env = process.env, { isTTY = false } = {}) {
  const explicit = flag(env.MULTIAGENT_AGENT_MODE);
  if (explicit !== null) return explicit;
  if (flag(env.CI) || isTTY) return false;
  return AGENT_MARKERS.some((k) => env[k] != null && env[k] !== '');
}

const slash = (p) => String(p || '').split(path.sep).join('/');
const relFile = (f, cwd) => {
  const file = String(f || '').replace(/^file:\/\/\/?/, '');
  if (!file) return '';
  const rel = path.isAbsolute(file) ? path.relative(cwd, file) : file;
  return slash(rel.startsWith('..') ? file : rel);
};
const firstLines = (s) => String(s || '').split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim()).slice(0, ERROR_LINES).join('\n');
const show = (v) => {
  const s = typeof v === 'string' ? v : util.inspect(v, { depth: 2, breakLength: Infinity, colors: false });
  return s.length > VALUE_CHARS ? `${s.slice(0, VALUE_CHARS)}…` : s;
};

// The line of `file` in an error's stack (the failing assertion), or null.
function stackLine(stack, file) {
  if (!stack || !file) return null;
  const base = path.basename(file).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`${base}:(\\d+):\\d+`).exec(String(stack));
  return m ? Number(m[1]) : null;
}

// One failure of a test:fail event's data → { test, file, line, error, expected?, actual?, kind }
function failureOf(data, cwd) {
  const err = data.details?.error || {};
  // node:test wraps the test's own error in a testCodeFailure: the cause is what the test threw
  const cause = err.cause && typeof err.cause === 'object' ? err.cause : err;
  const file = relFile(data.file, cwd);
  const ownName = data.nesting === 0 && (!data.file || path.resolve(cwd, String(data.name)) === path.resolve(String(data.file)) || relFile(data.name, cwd) === file);
  const out = {
    test: String(data.name || ''),
    file,
    line: stackLine(cause.stack, data.file) ?? data.line ?? null,
    error: firstLines(cause.message || err.message || String(cause)),
    kind: ownName ? 'file' : 'test',
  };
  // node says "test timed out after 90000ms": in seconds, how long the test ran (#402)
  if (err.failureType === 'testTimeoutFailure') out.error = out.error.replace(/timed out after (\d+)\s*ms/, (_, ms) => `timed out after ${Math.round(Number(ms) / 1000)} s`);
  if (cause && typeof cause === 'object' && 'expected' in cause && 'actual' in cause) {
    out.expected = show(cause.expected);
    out.actual = show(cause.actual);
  }
  return out;
}

// Builds the report from node:test events; `cwd` makes the files relative.
function collector(cwd = process.cwd()) {
  const t0 = Date.now();
  const report = { reporter: REPORTER, passed: 0, failed: 0, skipped: 0, todo: 0, cancelled: 0, duration_ms: 0, failures: [] };
  const files = new Map();
  // what a test file printed on stderr: why a file that could not run failed (its SyntaxError)
  const stderr = new Map();
  const crash = (file) => {
    const lines = String(stderr.get(file) || '').split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim());
    const err = lines.find((l) => /^\w*(Error|Exception)\b/.test(l.trim()));
    return err ? [err.trim(), lines[0]].filter((l, i, a) => a.indexOf(l) === i).join('\n') : firstLines(lines.join('\n'));
  };
  const count = (file, key) => {
    if (!file) return;
    const f = relFile(file, cwd);
    if (!files.has(f)) files.set(f, { passed: 0, failed: 0 });
    files.get(f)[key]++;
  };
  return {
    add(event) {
      const { type, data } = event || {};
      if (type === 'test:stderr' && data?.file) {
        const prev = stderr.get(data.file) || '';
        if (prev.length < 4000) stderr.set(data.file, prev + String(data.message || ''));
        return;
      }
      if (type !== 'test:pass' && type !== 'test:fail') return;
      // a suite (describe) or a test whose subtests failed is not a test of its own
      if (data.details?.type === 'suite' || data.details?.error?.failureType === 'subtestsFailed') return;
      if (type === 'test:pass') {
        if (data.skip !== undefined && data.skip !== false) report.skipped++;
        else if (data.todo !== undefined && data.todo !== false) report.todo++;
        else { report.passed++; count(data.file, 'passed'); }
        return;
      }
      if (data.details?.error?.failureType === 'cancelledByParent') { report.cancelled++; return; }
      if (data.todo !== undefined && data.todo !== false) { report.todo++; return; }
      report.failed++;
      count(data.file, 'failed');
      const failure = failureOf(data, cwd);
      // node:test only says "test failed" for a file that could not run: its stderr says why
      if (failure.kind === 'file' && /^test failed$/i.test(failure.error) && crash(data.file)) failure.error = crash(data.file);
      report.failures.push(failure);
    },
    done() {
      report.duration_ms = Date.now() - t0;
      if (files.size && files.size <= FILE_COUNTS) report.files = Object.fromEntries([...files].sort(([a], [b]) => a.localeCompare(b)));
      return report;
    },
  };
}

// The node:test custom reporter: nothing while the tests run, one JSON line at the end.
async function* reporter(source) {
  const c = collector(process.cwd());
  for await (const event of source) c.add(event);
  yield `${JSON.stringify(c.done())}\n`;
}

// The agent report in a suite's output (its last JSON line with this reporter), or null.
function parseAgentReport(text) {
  const lines = String(text || '').split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].trim();
    if (!l.startsWith('{') || !l.includes(`"reporter":"${REPORTER}"`)) continue;
    try {
      const r = JSON.parse(l);
      if (r && r.reporter === REPORTER && Array.isArray(r.failures)) return r;
    } catch { /* not the report */ }
  }
  return null;
}

module.exports = {
  collector,
  isAgentMode,
  parseAgentReport,
  REPORTER,
  reporter,
};
