// @ts-check
// The failing tests of a suite's output (`parseFailures`, split out of suite-step.js for #109): the
// agent reporter's JSON (#219), else the runners' text formats (node:test spec and TAP, Jest, pytest,
// go test, cargo test, dotnet test, Maven, Playwright) as { test, file, error } (the error's first
// ERROR_LINES lines), at most MAX_FAILURES, deduplicated. `sameTest` matches two failures by name and
// file basename (an empty file matches any). cargo test (libtest, #109) names tests, not files.

const { parseAgentReport } = require('./agent-test-report');
const { clean, fileOf } = require('./output-lines');

const MAX_FAILURES = 30;
const ERROR_LINES = 3;

const firstLines = (lines) => lines.map((l) => l.trim()).filter(Boolean).slice(0, ERROR_LINES).join('\n').slice(0, 400);

// cargo test's failing tests (libtest, #109): "test x ... FAILED", then "---- x stdout ----" and the
// panic up to the next "---- " or "failures:" line → [{ test, error }]
function cargoFailures(lines) {
  const out = [];
  for (const l of lines) {
    const m = /^test (.+?) \.\.\. FAILED$/.exec(l.trim());
    if (!m) continue;
    const at = lines.findIndex((x) => x.trim() === `---- ${m[1]} stdout ----`);
    const block = [];
    for (let j = at + 1; at >= 0 && j < lines.length && !/^(---- |failures:\s*$)/.test(lines[j].trim()); j++) block.push(lines[j]);
    out.push({ test: m[1], error: firstLines(block) });
  }
  return out;
}

// The failing tests of a suite's output: [{ test, file, error }], at most MAX_FAILURES, deduplicated.
// The agent reporter's JSON (#219) is read as is, with the failure's `line` and `kind` (file: a test
// file that could not run); the runners' text formats are scraped otherwise.
/** @param {string} text @param {{ cwd?: string | null }} [opts] */
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
  // cargo test (libtest, #109): no file, the base check runs them by name
  cargoFailures(lines).forEach((f) => add(f.test, '', f.error));
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

module.exports = {
  ERROR_LINES,
  parseFailures,
  sameTest,
};
