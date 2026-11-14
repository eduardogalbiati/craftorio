// #702 on the workflow definitions: the Code & Build workflows (feature, fix) only declare their
// `evidence` and never write docs/work/; sdlc-record is one agent-less `record_docs` step whose commit
// is merged; sdlc-test closes the Test stage (full suite with coverage, full E2E with @visual, the
// screens against the spec's mockups by the ui_reviewer, evals) at the code owner's human_approval.
// Seam: the loaded workflow (loadWorkflow, which validates it) and the loader's MACHINE_STEP_TYPES.
// The step's module is tested in test/record-docs-702.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const engine = () => require('../../engine/run/load');
const loadBundled = (name) => engine().loadWorkflow(path.join(ROOT, 'workflows', `${name}.yaml`));
const textOf = (name) => fs.readFileSync(path.join(ROOT, 'workflows', `${name}.yaml`), 'utf8');
const callsAgent = (s) => !!(s.agent || (s.agents && s.agents.length));
const gotos = (s) => (s.transitions || []).map((tr) => tr.goto).filter(Boolean);

test('#702 feature and fix declare an `evidence` output and have no record_docs step (guard)', () => {
  for (const name of ['feature', 'fix']) {
    const wf = loadBundled(name);
    assert.equal(wf.outputs?.evidence?.type, 'object', `${name} evidence output`);
    assert.equal(wf.steps.filter((s) => s.type === 'record_docs').length, 0, `${name} has a record_docs step`);
  }
});

test('#702 the engine knows `record_docs` as a step type without an agent', () => {
  assert.equal(engine().MACHINE_STEP_TYPES.includes('record_docs'), true);
});

test('#702 sdlc-record: a valid workflow with exactly one record_docs step and no agent call', () => {
  const wf = loadBundled('sdlc-record');
  const record = wf.steps.filter((s) => s.type === 'record_docs');
  assert.deepEqual([record.length, wf.steps.filter(callsAgent).map((s) => s.id).join(',')], [1, '']);
});

test('#702 sdlc-record: the record\'s commit is merged (local or PR) on its way to the end', () => {
  const wf = loadBundled('sdlc-record');
  const step = wf.steps.find((s) => s.type === 'record_docs');
  assert.ok(step, 'sdlc-record has no record_docs step');
  const byId = Object.fromEntries(wf.steps.map((s) => [s.id, s]));
  // the transitions of the record step and of every step after it
  const seen = new Set();
  const queue = [step.id];
  const merges = [];
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id) || !byId[id]) continue;
    seen.add(id);
    for (const tr of byId[id].transitions || []) if (tr.merge) merges.push(String(tr.merge));
    queue.push(...gotos(byId[id]));
  }
  assert.equal(merges.length > 0, true, 'no transition after record_docs merges its commit');
});

test('#702 sdlc-test: a valid workflow whose code owner\'s gate is a human_approval', () => {
  const wf = loadBundled('sdlc-test');
  assert.equal(wf.steps.filter((s) => s.type === 'human_approval').length >= 1, true);
});

test('#702 sdlc-test: runs the full suite with coverage, the full E2E with @visual, the ui_reviewer and the evals', () => {
  const wf = loadBundled('sdlc-test');
  const suites = wf.steps.filter((s) => s.type === 'suite');
  const text = textOf('sdlc-test');
  assert.deepEqual([
    suites.length > 0,
    suites.some((s) => /coverage/i.test(JSON.stringify(s))),
    /@visual/.test(text),
    wf.steps.some((s) => s.agent === 'ui_reviewer' || (s.agents || []).includes('ui_reviewer')),
    /\bevals?\b/i.test(text),
  ], [true, true, true, true, true]);
});

test('#702 sdlc-test: approve records `passed`, reject goes on to record `failed` and file the findings', () => {
  const wf = loadBundled('sdlc-test');
  const gate = wf.steps.find((s) => s.type === 'human_approval');
  assert.ok(gate, 'sdlc-test has no human_approval');
  const on = (word) => (gate.transitions || []).find((tr) => new RegExp(word).test(String(tr.when || '')));
  const rejected = on('rejected');
  const text = textOf('sdlc-test');
  assert.deepEqual([
    !!on('approved'),
    !!rejected && rejected.goto !== 'end',
    /\bpassed\b/.test(text),
    /\bfailed\b/.test(text),
  ], [true, true, true, true]);
});
