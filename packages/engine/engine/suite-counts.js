// @ts-check
// The passed / failed counts a test runner prints at the end of the suite step's output (suite-step.js):
// the agent reporter's JSON, node:test, TAP, Jest, pytest, cargo test, dotnet test, Maven Surefire,
// Playwright. parseCounts(text) → { passed, failed }, both null when no summary is recognized.

'use strict';

const { parseAgentReport } = require('./agent-test-report');
const { clean } = require('./output-lines');

// #82: runners that print one summary line per test binary / project / module, summed.
// Groups: p passed, f failed, e errors (they fail too), s skipped; n run (passed = n - f - e - s).
const SUMMED = [
  // cargo test: a "test result:" line per test binary and the doc-tests
  /^test result: (?:ok|FAILED)\. (?<p>\d+) passed; (?<f>\d+) failed;/gm,
  // dotnet test: a line per test project
  /^\s*(?:Passed|Failed)!\s+-\s+Failed:\s+(?<f>\d+),\s+Passed:\s+(?<p>\d+),/gm,
  // Maven Surefire: each module's total line (a class's line goes on with "Time elapsed")
  /^(?:\[\w+\]\s+)?Tests run: (?<n>\d+), Failures: (?<f>\d+), Errors: (?<e>\d+), Skipped: (?<s>\d+)\s*$/gm,
];

// the sum of every line `re` matches in `text`, or null when none does
function summed(text, re) {
  const lines = [...text.matchAll(re)].map((m) => m.groups || {});
  if (!lines.length) return null;
  let passed = 0;
  let failed = 0;
  for (const g of lines) {
    const f = Number(g.f || 0) + Number(g.e || 0);
    passed += g.n != null ? Number(g.n) - f - Number(g.s || 0) : Number(g.p || 0);
    failed += f;
  }
  return { passed, failed };
}

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
  for (const re of SUMMED) {
    const counts = summed(t, re);
    if (counts) return counts;
  }
  // Playwright: "  1 failed" (then the failed tests' lines), "  2 passed (15.4s)"
  const pw = { passed: last(/^\s*(\d+) passed(?: \([^)]*\))?\s*$/gm), failed: last(/^\s*(\d+) failed\s*$/gm) };
  if (pw.passed != null || pw.failed != null) return { passed: pw.passed ?? 0, failed: pw.failed ?? 0 };
  return { passed: null, failed: null };
}

module.exports = {
  parseCounts,
};
