// Findings (#361), internals the acceptance tests do not reach: the issue a finding is filed as
// (src/domains/evidence/findings.js issueOf), the filing status kept in filing.json (markFiling), and the main log's
// ring of the last 200 lines (src/domains/workspace/main-log.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const findings = require('../../src/domains/evidence/findings');
const mainLog = require('../../src/domains/workspace/main-log');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'findings-internals-361-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root };
}

test('the issue names the finding\'s folder, its pins\' elements and the screen', (t) => {
  const ws = workspace(t);
  const marks = [
    { type: 'pin', n: 1, x: 40, y: 30, note: 'does nothing', element: { empty: false, testid: 'step-retry', view: 'run', tab: 'steps', ids: { run: 'run-1' }, box: { x: 10, y: 20, width: 100, height: 30 } } },
    { type: 'pin', n: 2, x: 9, y: 9, element: { empty: true, x: 9, y: 9, view: 'run', tab: 'steps' } },
    { type: 'box', x: 1, y: 2, width: 3, height: 4 },
  ];
  const saved = findings.saveFinding(ws, { image: PNG, marked: PNG, marks, note: 'Retry is broken\nmore detail', context: { view: 'run', tab: 'steps', window: { width: 800, height: 600 } } });
  const { title, body } = findings.issueOf(findings.getFinding(ws, saved.id));
  assert.equal(title, 'UI finding: Retry is broken');
  assert.ok(body.includes(saved.dir), 'the body names the folder');
  assert.match(body, /1\. Pin 1 on `step-retry` \(view run; tab steps; run run-1\), box 10,20 100×30: does nothing/);
  assert.match(body, /2\. Pin 2 on empty space at 9,9/);
  assert.match(body, /- Box at 1,2/);
  assert.match(body, /view run › steps/);
  assert.match(body, /## Acceptance criteria/);
  assert.match(findings.issueOf(findings.getFinding(ws, saved.id), { imageUrl: 'https://x/y.png' }).body, /!\[Marked screenshot\]\(https:\/\/x\/y\.png\)/);
});

test('a finding\'s status follows filing.json, and an unknown or path-like id is no finding', (t) => {
  const ws = workspace(t);
  const saved = findings.saveFinding(ws, { image: PNG, marked: PNG, note: 'n' });
  const filed = findings.markFiling(ws, saved.id, { status: 'filed', projectId: 'p-1', ref: 'findings-x', issueUrl: 'https://github.com/o/r/issues/7' });
  assert.equal(filed.status, 'filed');
  assert.equal(filed.issueUrl, 'https://github.com/o/r/issues/7');
  assert.equal(findings.listFindings(ws)[0].status, 'filed');
  assert.equal(findings.getFinding(ws, '../../etc'), null);
  assert.equal(findings.markFiling(ws, 'nope', { status: 'filed' }), null);
});

test('the main log keeps the last 200 console lines', () => {
  const lines = [];
  const con = { log: (s) => lines.push(s), info() {}, warn() {}, error() {} };
  mainLog.capture(con);
  for (let i = 0; i < 230; i++) con.log(`line ${i}`);
  const recent = mainLog.recent();
  assert.equal(recent.length, 200);
  assert.match(recent[0], /log line 30$/);
  assert.match(recent[199], /log line 229$/);
  assert.equal(lines.length, 230, 'still printed');
});

// #475: finding bundles share the Recorder's baseline list (src/engine/redact-baseline.js) and its marker
test('scrub redacts a GitLab token and a bearer token with [REDACTED], keeping the text around them', () => {
  const out = findings.scrub({ log: ['push with glpat-AbCdEf123456_xyz', 'Authorization: Bearer abcdef0123456789'], password: 'p' });
  assert.deepEqual(out, { log: ['push with [REDACTED]', 'Authorization: Bearer [REDACTED]'] });
});
