// packages/engine/engine/workflow-step.js (#174): the `type: workflow` step's pure pieces, tested directly
// with fake startChild promises (no real WorkflowRun): validateWorkflowStep, resolveValue,
// itemFiles, schedule (the concurrency/file-overlap scheduler) and runWorkflowStep itself.
// `render` is the real nunjucks wrapper from workflow.js, so templating behaves as it does for
// a real run; engine.test.js covers the end-to-end wiring (events, on_error, gates, summary).
const test = require('node:test');
const assert = require('node:assert/strict');
const { render } = require('../engine/workflow');
const {
  itemFiles, resolveValue, runWorkflowStep, schedule, validateWorkflowStep,
} = require('../engine/workflow-step');

const parent0 = { run_id: 'p1', workflow: 'parent', depth: 0 };

// ---- validateWorkflowStep ----------------------------------------------------------------------

test('validateWorkflowStep: an agent or agents on a workflow step is rejected', () => {
  assert.throws(() => validateWorkflowStep({ id: 's', agent: 'a', workflow: 'c.yaml' }), /has no agent/);
  assert.throws(() => validateWorkflowStep({ id: 's', agents: ['a', 'b'], workflow: 'c.yaml' }), /has no agent/);
});

test('validateWorkflowStep: workflow must name the file to run', () => {
  assert.throws(() => validateWorkflowStep({ id: 's' }), /workflow must name/);
  assert.throws(() => validateWorkflowStep({ id: 's', workflow: '   ' }), /workflow must name/);
  assert.doesNotThrow(() => validateWorkflowStep({ id: 's', workflow: 'child.yaml' }));
});

test('validateWorkflowStep: a workflow cannot run itself, by basename; a templated name is exempt', () => {
  assert.throws(() => validateWorkflowStep({ id: 's', workflow: 'parent.yaml' }, '/wf/parent.yaml'), /cannot run itself/);
  assert.doesNotThrow(() => validateWorkflowStep({ id: 's', workflow: '{{ inputs.file }}' }, '/wf/parent.yaml'));
  assert.doesNotThrow(() => validateWorkflowStep({ id: 's', workflow: 'other.yaml' }, '/wf/parent.yaml'));
});

test('validateWorkflowStep: inputs must be a plain map', () => {
  assert.throws(() => validateWorkflowStep({ id: 's', workflow: 'c.yaml', inputs: ['a'] }), /inputs must be a map/);
  assert.doesNotThrow(() => validateWorkflowStep({ id: 's', workflow: 'c.yaml', inputs: { a: 1 } }));
});

test('validateWorkflowStep: foreach must be a list or a template string', () => {
  assert.throws(() => validateWorkflowStep({ id: 's', workflow: 'c.yaml', foreach: 3 }), /foreach must be a list/);
  assert.doesNotThrow(() => validateWorkflowStep({ id: 's', workflow: 'c.yaml', foreach: [] }));
  assert.doesNotThrow(() => validateWorkflowStep({ id: 's', workflow: 'c.yaml', foreach: '{{ steps.plan.output.issues }}' }));
});

test('validateWorkflowStep: max_parallel needs foreach, and must be a whole number of 1 or more (or a template)', () => {
  assert.throws(() => validateWorkflowStep({ id: 's', workflow: 'c.yaml', max_parallel: 2 }), /max_parallel needs foreach/);
  assert.throws(() => validateWorkflowStep({ id: 's', workflow: 'c.yaml', foreach: [], max_parallel: 0 }), /whole number of 1 or more/);
  assert.throws(() => validateWorkflowStep({ id: 's', workflow: 'c.yaml', foreach: [], max_parallel: 1.5 }), /whole number of 1 or more/);
  assert.doesNotThrow(() => validateWorkflowStep({ id: 's', workflow: 'c.yaml', foreach: [], max_parallel: 2 }));
  assert.doesNotThrow(() => validateWorkflowStep({ id: 's', workflow: 'c.yaml', foreach: [], max_parallel: '{{ inputs.n }}' }));
});

// ---- resolveValue -------------------------------------------------------------------------------

test('resolveValue: a whole {{ expr }} keeps its type (a list or number stays one)', () => {
  const scope = { items: [1, 2, 3], n: 4 };
  assert.deepEqual(resolveValue('{{ items }}', scope, render), [1, 2, 3]);
  assert.equal(resolveValue('{{ n }}', scope, render), 4);
});

test('resolveValue: any other template renders to text, even one that names a list', () => {
  const scope = { items: [1, 2] };
  assert.equal(typeof resolveValue('got {{ items }}', scope, render), 'string');
  assert.equal(resolveValue('plain text', scope, render), 'plain text');
});

test('resolveValue: lists and maps are resolved item by item', () => {
  const scope = { a: 1, b: 2 };
  assert.deepEqual(resolveValue(['{{ a }}', '{{ b }}'], scope, render), [1, 2]);
  assert.deepEqual(resolveValue({ x: '{{ a }}', y: 'plain' }, scope, render), { x: 1, y: 'plain' });
});

test('resolveValue: a non-string, non-list, non-map value passes through unchanged', () => {
  assert.equal(resolveValue(5, {}, render), 5);
  assert.equal(resolveValue(null, {}, render), null);
});

// ---- itemFiles ------------------------------------------------------------------------------

test('itemFiles: normalizes slashes, case and a leading ./, drops blanks and non-strings', () => {
  assert.deepEqual(itemFiles({ files: ['Src\\A.JS', './src/b.js', '  ', 42] }), ['src/a.js', 'src/b.js']);
});

test('itemFiles: a non-object item (or one with no files) has none', () => {
  assert.deepEqual(itemFiles('just a string item'), []);
  assert.deepEqual(itemFiles({ title: 'no files' }), []);
});

// ---- schedule -------------------------------------------------------------------------------

test('schedule: runs at most `max` items at a time', async () => {
  let running = 0;
  let peak = 0;
  const runOne = async () => {
    running++; peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 15));
    running--;
  };
  await schedule(5, 2, [[], [], [], [], []], runOne);
  assert.equal(peak, 2);
});

test('schedule: items whose files overlap never run at the same time, even under a higher max', async () => {
  const windows = [];
  const files = [['a'], ['a'], ['b']]; // 0 and 1 share 'a'; 2 shares nothing
  const runOne = async (i) => {
    const start = Date.now();
    await new Promise((r) => setTimeout(r, 15));
    windows.push({ i, start, end: Date.now() });
  };
  await schedule(3, 3, files, runOne);
  const overlap = (a, b) => a.start < b.end && b.start < a.end;
  const w = (i) => windows.find((x) => x.i === i);
  assert.ok(!overlap(w(0), w(1)), 'items sharing a file ran at the same time');
});

test('schedule: items not yet started when the signal aborts are left for the caller to fill in', async () => {
  const controller = new AbortController();
  const started = [];
  const runOne = async (i) => { started.push(i); if (i === 0) controller.abort(); };
  await schedule(3, 1, [[], [], []], runOne, controller.signal);
  assert.deepEqual(started, [0]);
});

// ---- runWorkflowStep ------------------------------------------------------------------------

test('runWorkflowStep: without foreach, the output is { status, run_id, outputs } from the one child', async () => {
  const events = [];
  const emit = (type, data) => events.push({ type, data });
  const startChild = async ({ file, inputs }) => {
    assert.equal(file, 'child.yaml');
    assert.deepEqual(inputs, { task: 'do it' });
    return { runId: 'run-1', finished: Promise.resolve({ status: 'success', outputs: { x: 1 } }), stop: () => {} };
  };
  const step = { id: 'child', workflow: 'child.yaml', inputs: { task: '{{ task }}' } };
  const out = await runWorkflowStep({ step, scope: { task: 'do it' }, render, startChild, emit, parent: parent0 });
  assert.deepEqual(out, { kind: 'workflow', workflow: 'child.yaml', status: 'success', run_id: 'run-1', outputs: { x: 1 }, error: null });
  assert.deepEqual(events.map((e) => e.type), ['workflow.child_started', 'workflow.child_finished']);
});

test('runWorkflowStep: foreach preserves item order in output.outputs even when children finish out of order', async () => {
  const items = [{ n: 1 }, { n: 2 }, { n: 3 }];
  const resolvers = [];
  const startChild = async ({ parent }) => {
    let resolve;
    const finished = new Promise((r) => { resolve = r; });
    resolvers[parent.index] = resolve;
    return { runId: `r${parent.index}`, finished, stop: () => {} };
  };
  const resultP = runWorkflowStep({
    step: { id: 's', workflow: 'c.yaml', foreach: items, max_parallel: 3 },
    scope: {}, render, startChild, emit: () => {}, parent: parent0,
  });
  await new Promise((r) => setImmediate(r)); // all three children have started
  resolvers[2]({ status: 'success', outputs: { n: 3 } });
  resolvers[0]({ status: 'success', outputs: { n: 1 } });
  resolvers[1]({ status: 'success', outputs: { n: 2 } });
  const out = await resultP;
  assert.deepEqual(out.outputs, [{ n: 1 }, { n: 2 }, { n: 3 }]);
  assert.equal(out.status, 'success');
  assert.equal(out.succeeded, 3);
  assert.equal(out.failed, 0);
});

test('runWorkflowStep: foreach runs at most max_parallel children at a time', async () => {
  let running = 0;
  let peak = 0;
  const startChild = async () => {
    running++; peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 15));
    running--;
    return { runId: 'r', finished: Promise.resolve({ status: 'success', outputs: {} }), stop: () => {} };
  };
  const out = await runWorkflowStep({
    step: { id: 's', workflow: 'c.yaml', foreach: [1, 2, 3], max_parallel: 2 },
    scope: {}, render, startChild, emit: () => {}, parent: parent0,
  });
  assert.equal(peak, 2);
  assert.equal(out.status, 'success');
});

test('runWorkflowStep: foreach items declaring overlapping files (case/slash differences) never run at the same time, even under max_parallel', async () => {
  const items = [
    { n: 1, files: ['src/a.js'] },
    { n: 2, files: ['SRC\\A.JS'] }, // same file: different case and slash
    { n: 3, files: ['./src/b.js'] }, // unrelated
  ];
  const windows = [];
  const startChild = async ({ parent }) => {
    const start = Date.now();
    await new Promise((r) => setTimeout(r, 15));
    windows.push({ index: parent.index, start, end: Date.now() });
    return { runId: `r${parent.index}`, finished: Promise.resolve({ status: 'success', outputs: {} }), stop: () => {} };
  };
  await runWorkflowStep({
    step: { id: 's', workflow: 'c.yaml', foreach: items, max_parallel: 3 },
    scope: {}, render, startChild, emit: () => {}, parent: parent0,
  });
  const overlap = (a, b) => a.start < b.end && b.start < a.end;
  const w = (i) => windows.find((x) => x.index === i);
  assert.ok(!overlap(w(0), w(1)), 'items declaring the same file ran at the same time');
});

test('runWorkflowStep: a failing child is reported in the output, never thrown', async () => {
  const startChild = async () => ({ runId: 'r1', finished: Promise.resolve({ status: 'failed', error: 'boom', outputs: {} }), stop: () => {} });
  const out = await runWorkflowStep({ step: { id: 's', workflow: 'c.yaml' }, scope: {}, render, startChild, emit: () => {}, parent: parent0 });
  assert.equal(out.status, 'failed');
  assert.equal(out.error, 'boom');
});

test('runWorkflowStep: when starting a child throws, the item fails with that error instead of throwing', async () => {
  const startChild = async () => { throw new Error('Workflow not found: x.yaml'); };
  const out = await runWorkflowStep({ step: { id: 's', workflow: 'x.yaml' }, scope: {}, render, startChild, emit: () => {}, parent: parent0 });
  assert.equal(out.status, 'failed');
  assert.match(out.error, /Workflow not found/);
});

test('runWorkflowStep: nesting deeper than 3 fails the item with a clear error, without starting a child', async () => {
  let called = false;
  const startChild = async () => { called = true; return { runId: 'r', finished: Promise.resolve({ status: 'success', outputs: {} }), stop: () => {} }; };
  const out = await runWorkflowStep({ step: { id: 's', workflow: 'c.yaml' }, scope: {}, render, startChild, emit: () => {}, parent: { ...parent0, depth: 3 } });
  assert.equal(out.status, 'failed');
  assert.match(out.error, /nest at most 3 deep/);
  assert.equal(called, false);
});

test('runWorkflowStep: stopping (an aborted signal) stops the live child; items not yet started come back cancelled', async () => {
  const controller = new AbortController();
  let stopCalled = 0;
  const resolvers = [];
  const startChild = async ({ parent }) => {
    let resolve;
    const finished = new Promise((r) => { resolve = r; });
    resolvers[parent.index] = resolve;
    return {
      runId: `r${parent.index}`, finished,
      stop: () => { stopCalled++; resolve({ status: 'cancelled', error: 'stopped' }); },
    };
  };
  const resultP = runWorkflowStep({
    step: { id: 's', workflow: 'c.yaml', foreach: [1, 2, 3], max_parallel: 1 },
    scope: {}, render, startChild, emit: () => {}, signal: controller.signal, parent: parent0,
  });
  await new Promise((r) => setImmediate(r)); // item 0 has started
  controller.abort();
  const out = await resultP;
  assert.equal(stopCalled, 1);
  assert.equal(out.runs[0].status, 'cancelled');
  assert.equal(out.runs[1].status, 'cancelled');
  assert.match(out.runs[1].error, /not started: the run was stopped/);
  assert.equal(out.runs[2].status, 'cancelled');
  assert.match(out.runs[2].error, /not started: the run was stopped/);
});

test('runWorkflowStep: an empty foreach list runs no children and succeeds', async () => {
  const startChild = async () => { throw new Error('should not be called'); };
  const out = await runWorkflowStep({ step: { id: 's', workflow: 'c.yaml', foreach: [] }, scope: {}, render, startChild, emit: () => {}, parent: parent0 });
  assert.deepEqual(out, { kind: 'workflow', workflow: 'c.yaml', status: 'success', runs: [], outputs: [], succeeded: 0, failed: 0 });
});

test('runWorkflowStep: foreach accepts JSON text or one item per line, besides a literal list', async () => {
  const seen = [];
  const startChild = async ({ inputs }) => { seen.push(inputs.v); return { runId: 'r', finished: Promise.resolve({ status: 'success', outputs: {} }), stop: () => {} }; };
  const base = { id: 's', workflow: 'c.yaml', inputs: { v: '{{ item }}' }, max_parallel: 3 };
  await runWorkflowStep({ step: { ...base, foreach: '["a","b"]' }, scope: {}, render, startChild, emit: () => {}, parent: parent0 });
  await runWorkflowStep({ step: { ...base, foreach: 'a\nb' }, scope: {}, render, startChild, emit: () => {}, parent: parent0 });
  assert.deepEqual(seen, ['a', 'b', 'a', 'b']);
});

// ---- #175: previous (resume), cost_usd, resumed/reused annotations ---------------------------

test('runWorkflowStep: an item whose previous child has the same label is handed to startChild as `previous`', async () => {
  const seen = [];
  const startChild = async ({ parent, previous }) => {
    seen.push({ index: parent.index, previous: previous || null });
    return { runId: `r${parent.index}`, finished: Promise.resolve({ status: 'success', outputs: {} }), stop: () => {} };
  };
  const items = [{ title: 'a' }, { title: 'b' }];
  const previous = { 0: { run_id: 'old-0', status: 'success', label: 'a' }, 1: { run_id: 'old-1', status: 'failed', label: 'different label' } };
  await runWorkflowStep({
    step: { id: 's', workflow: 'c.yaml', foreach: items, max_parallel: 2 },
    scope: {}, render, startChild, emit: () => {}, parent: parent0, previous,
  });
  assert.deepEqual(seen.find((s) => s.index === 0).previous, { run_id: 'old-0', status: 'success' });
  // item 1's label changed since the previous run (a relabeled item): it starts afresh, no `previous`
  assert.equal(seen.find((s) => s.index === 1).previous, null);
});

test('runWorkflowStep: workflow.child_started carries resumed_from / reused from startChild\'s result', async () => {
  const events = [];
  const emit = (type, data) => events.push({ type, data });
  const startChild = async () => ({ runId: 'r1', resumedFrom: 'old-run', finished: Promise.resolve({ status: 'success', outputs: {} }), stop: () => {} });
  await runWorkflowStep({ step: { id: 's', workflow: 'c.yaml' }, scope: {}, render, startChild, emit, parent: parent0 });
  const started = events.find((e) => e.type === 'workflow.child_started');
  assert.equal(started.data.resumed_from, 'old-run');
  assert.equal(started.data.reused, undefined);

  events.length = 0;
  const startChildReused = async () => ({ runId: 'r2', reused: true, finished: Promise.resolve({ status: 'success', outputs: {} }), stop: () => {} });
  await runWorkflowStep({ step: { id: 's', workflow: 'c.yaml' }, scope: {}, render, startChild: startChildReused, emit, parent: parent0 });
  const started2 = events.find((e) => e.type === 'workflow.child_started');
  assert.equal(started2.data.reused, true);
  assert.equal(started2.data.resumed_from, undefined);
});

test('runWorkflowStep: workflow.child_finished carries the child\'s cost_usd', async () => {
  const events = [];
  const emit = (type, data) => events.push({ type, data });
  const startChild = async () => ({ runId: 'r1', finished: Promise.resolve({ status: 'success', outputs: {}, cost_usd: 1.234567 }), stop: () => {} });
  await runWorkflowStep({ step: { id: 's', workflow: 'c.yaml' }, scope: {}, render, startChild, emit, parent: parent0 });
  const finishedEv = events.find((e) => e.type === 'workflow.child_finished');
  assert.equal(finishedEv.data.cost_usd, 1.234567);
});

test('runWorkflowStep: a child that fails to start because the signal is already aborted is reported cancelled, not failed', async () => {
  const controller = new AbortController();
  controller.abort();
  const startChild = async () => { throw new Error('Cancelled: the parent run was stopped before this child run could start.'); };
  const out = await runWorkflowStep({
    step: { id: 's', workflow: 'c.yaml' }, scope: {}, render, startChild, emit: () => {}, signal: controller.signal, parent: parent0,
  });
  assert.equal(out.status, 'cancelled');
  assert.match(out.error, /Cancelled: the parent run was stopped/);
});
