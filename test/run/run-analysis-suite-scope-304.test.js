// src/domains/run/run-analysis.js (#304): a suite round of a `scope: affected` step keeps its scope and its
// selection (why each test file ran) for Analytics › Run's Suite rounds table.
const test = require('node:test');
const assert = require('node:assert/strict');
const { runFigures } = require('../../src/domains/run/run-analysis');

const T0 = Date.parse('2026-10-06T10:00:00.000Z');
const ts = (m) => new Date(T0 + m * 60e3).toISOString();
const finished = (m, output) => ({ ts: ts(m), type: 'step.finished', step_id: 'suite', output });

function rounds(...outputs) {
  const events = [{ ts: ts(0), type: 'workflow.started', workflow: 'ai-development-local-hero', mock: true }];
  outputs.forEach((o, i) => events.push({ ts: ts(i * 2 + 1), type: 'step.started', step_id: 'suite', visit: i + 1, step_type: 'suite' }, finished(i * 2 + 2, o)));
  return runFigures({ summary: { status: 'success' }, events }).suiteRounds;
}

test('#304 runFigures: an affected round followed by the whole suite keeps its scope and why each file ran', () => {
  const selection = { mode: 'affected', files: ['test/roadmap.test.js'], reasons: { 'test/roadmap.test.js': 'imports src/domains/roadmap/roadmap.js' }, why: 'the 1 affected test file(s) passed' };
  const [r] = rounds({ kind: 'suite', status: 'pass', round: 1, scope: 'full', selection, affected: { log: 'logs/suite-1.log' } });
  assert.equal(r.scope, 'full');
  assert.equal(r.affected, true);
  assert.deepEqual(r.selection, { mode: 'affected', why: selection.why, reasons: selection.reasons });
});

test('#304 runFigures: a round of a whole-suite step has no selection', () => {
  const [r] = rounds({ kind: 'suite', status: 'pass', round: 1 });
  assert.equal(r.selection, null);
  assert.equal(r.affected, false);
  assert.equal(r.scope, null);
});
