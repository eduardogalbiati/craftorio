// Stall detection on a fan-out step (#151): repeatKey and answeredKey read each agent's answer under
// output.results, so code_review visits with different verdicts are never "the same answer".
const test = require('node:test');
const assert = require('node:assert/strict');
const { answeredKey, repeatKey } = require('../src/engine/workflow');

const finding = { type: 'object', properties: { severity: { type: 'string', enum: ['major', 'minor'] }, file: { type: 'string' }, description: { type: 'string' } } };
const review = {
  id: 'code_review',
  agents: ['reviewer', 'ui_reviewer'],
  output_schema: {
    type: 'object',
    properties: {
      verdict: { type: 'string', enum: ['approved', 'changes_requested'] },
      findings: { type: 'array', items: finding },
      ui_findings: { type: 'array', items: { type: 'object', properties: { element: { type: 'string' }, blocking: { type: 'boolean' } } } },
    },
  },
};
const fanOut = (reviewer, ui) => ({ results: { reviewer, ui_reviewer: ui }, succeeded: ['reviewer', 'ui_reviewer'], failed: [] });

test('repeatKey: fan-out visits with different verdicts give different keys', () => {
  const a = fanOut({ verdict: 'approved', findings: [] }, { verdict: 'approved', ui_findings: [{ element: 'x', blocking: true }] });
  const b = fanOut({ verdict: 'changes_requested', findings: [{ severity: 'major', file: 'a.js' }] }, { verdict: 'approved', ui_findings: [] });
  const c = fanOut({ verdict: 'approved', findings: [] }, { verdict: 'approved', ui_findings: [] });
  const keys = [a, b, c].map((o) => repeatKey(review, o));
  assert.equal(new Set(keys).size, 3);
});

test('repeatKey: fan-out visits with the same answers give the same key', () => {
  const o = () => fanOut({ verdict: 'changes_requested', findings: [{ severity: 'major', file: 'a.js', description: 'reworded ' + Math.random() }] }, { verdict: 'approved', ui_findings: [] });
  assert.equal(repeatKey(review, o()), repeatKey(review, o()));
});

test('answeredKey: a fan-out review gives each agent findings and ui_findings; a plain review its findings', () => {
  const code = fanOut({ verdict: 'changes_requested', findings: [{ severity: 'major', file: 'a.js' }] }, { verdict: 'approved', ui_findings: [] });
  const ui = fanOut({ verdict: 'approved', findings: [] }, { verdict: 'approved', ui_findings: [{ element: 'x', blocking: true }] });
  assert.notEqual(JSON.stringify(answeredKey(review, code)), JSON.stringify(answeredKey(review, ui)));
  assert.equal(answeredKey(review, fanOut({}, {})), null);
  const plain = { ...review, agents: undefined };
  assert.deepEqual(answeredKey(plain, { findings: [{ severity: 'minor', file: 'b.js' }] }), [['minor', 'b.js']]);
  assert.equal(answeredKey(plain, {}), null);
});
