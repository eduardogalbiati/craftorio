// #356: the Oracle's architecture analysis, src/oracle-architecture.js. REPORT_SCHEMA is the JSON
// schema of a report ({ summary, areas, findings }); validateReport accepts an object or a JSON string
// (optionally in a ```json fence) and gives { report } or { error } (never a partial report);
// compareReports marks each current finding 'new' or 'kept' against the previous report (identity =
// kind + sorted file paths) and lists the gone ones; estimateCost is the mean cost of the 5 newest
// real (non-simulated) reports.
// The module is created by the change: it is loaded inside each test (tests first).
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSchema } = require('../src/json-schema');

const load = () => require('../src/oracle-architecture');

function report() {
  return {
    summary: 'A small app with one oversized module.',
    areas: [{ area: 'src', verdict: 'Mostly cohesive.' }],
    findings: [{
      kind: 'oversized-unit',
      title: 'app.js does too much',
      files: [{ path: 'src/app.js', lines: '12-40' }],
      evidence: '200 lines, changed in 4 commits',
      severity: 'medium',
      refactor: 'Split the request handling out of app.js.',
    }],
  };
}

const finding = (kind, paths, extra = {}) => ({
  kind, title: `${kind} in ${paths.join(', ')}`, files: paths.map((p) => ({ path: p, lines: '1-10' })),
  evidence: 'e', severity: 'low', refactor: 'r', ...extra,
});
const key = (f) => `${f.kind}:${f.files.map((x) => x.path).sort().join(',')}`;

// ---------- validateReport ----------

test('#356 a valid report object passes validateReport and REPORT_SCHEMA', () => {
  const { validateReport, REPORT_SCHEMA } = load();
  const out = validateReport(report());
  assert.equal(out.error, undefined);
  assert.equal(out.report.summary, report().summary);
  assert.deepEqual(validateSchema(report(), REPORT_SCHEMA), []);
});

test('#356 a report as JSON text inside a ```json fence passes', () => {
  const text = `Here is the report:\n\`\`\`json\n${JSON.stringify(report(), null, 2)}\n\`\`\`\n`;
  const out = load().validateReport(text);
  assert.equal(out.error, undefined);
  assert.equal(out.report.findings.length, 1);
});

test('#356 a report without a summary is an error naming the field, with no partial report', () => {
  const bad = report();
  delete bad.summary;
  const out = load().validateReport(bad);
  assert.equal(typeof out.error, 'string');
  assert.match(out.error, /summary/);
  assert.equal('report' in out, false);
});

test('#356 an unknown severity is an error', () => {
  const bad = report();
  bad.findings[0].severity = 'critical';
  const out = load().validateReport(bad);
  assert.equal(typeof out.error, 'string');
  assert.equal('report' in out, false);
});

test('#356 text that is not JSON is an error', () => {
  const out = load().validateReport('I could not analyse this project, sorry.');
  assert.equal(typeof out.error, 'string');
  assert.equal('report' in out, false);
});

// ---------- compareReports ----------

test('#356 compareReports: a finding with the same kind and files is kept, a new one is new, a missing one is gone', () => {
  const previous = { findings: [finding('missing-abstraction', ['a.js', 'b.js']), finding('test-gap', ['c.js'])] };
  const current = {
    findings: [
      finding('missing-abstraction', ['b.js', 'a.js'], { title: 'Another title', files: [{ path: 'b.js', lines: '5-9' }, { path: 'a.js', lines: '30-44' }] }),
      finding('oversized-unit', ['d.js']),
    ],
  };
  const out = load().compareReports(previous, current);
  assert.deepEqual(out.findings.map((f) => `${key(f)}=${f.status}`), ['missing-abstraction:a.js,b.js=kept', 'oversized-unit:d.js=new']);
  assert.deepEqual(out.gone.map(key), ['test-gap:c.js']);
});

test('#356 compareReports without a previous report: every finding is new and nothing is gone', () => {
  const current = { findings: [finding('test-gap', ['c.js']), finding('other', ['e.js'])] };
  const out = load().compareReports(null, current);
  assert.deepEqual(out.findings.map((f) => f.status), ['new', 'new']);
  assert.deepEqual(out.gone, []);
});

// ---------- estimateCost ----------

test('#356 estimateCost with no saved report is null', () => {
  assert.equal(load().estimateCost([]), null);
});

test('#356 estimateCost is the mean cost of the saved reports', () => {
  const out = load().estimateCost([
    { date: '2026-10-01T10:00:00Z', costUsd: 0.30 },
    { date: '2026-10-02T10:00:00Z', costUsd: 0.50 },
    { date: '2026-10-03T10:00:00Z', costUsd: 0.40 },
  ]);
  assert.ok(Math.abs(out.usd - 0.4) < 1e-9, `usd ${out.usd}`);
  assert.equal(out.basis, 3);
});

test('#356 estimateCost uses the 5 newest real reports, in any order, simulated ones ignored', () => {
  const saved = [4, 1, 7, 2, 6, 3, 5].map((n) => ({ date: `2026-10-0${n}T10:00:00Z`, costUsd: n }));
  saved.push({ date: '2026-10-09T10:00:00Z', costUsd: 100, simulated: true });
  saved.push({ date: '2026-10-08T10:00:00Z', costUsd: 0, simulated: true });
  const out = load().estimateCost(saved);
  assert.ok(Math.abs(out.usd - 5) < 1e-9, `usd ${out.usd}`);
  assert.equal(out.basis, 5);
});

test('#356 estimateCost with only simulated reports is null', () => {
  assert.equal(load().estimateCost([{ date: '2026-10-01T10:00:00Z', costUsd: 0, simulated: true }]), null);
});
