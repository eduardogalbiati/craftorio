// src/renderer/chain-model.js (#134): pure functions for workflow chaining. The service
// (src/service/areas/chain.js) and its wiring through a live run are covered by
// test/service/chain.test.js; this file is the model alone (no engine, no files).
const test = require('node:test');
const assert = require('node:assert/strict');
const chain = require('../src/renderer/chain-model');

// ---- normalizeThen -------------------------------------------------------------------------------

test('normalizeThen: nothing (null, "", "none") is null; an unknown shape or action throws', () => {
  assert.equal(chain.normalizeThen(null), null);
  assert.equal(chain.normalizeThen(''), null);
  assert.equal(chain.normalizeThen('none'), null);
  assert.equal(chain.normalizeThen(undefined), null);
  assert.throws(() => chain.normalizeThen('workflow'), /must be an object with an action/);
  assert.throws(() => chain.normalizeThen({ action: 'explode' }), /action must be one of/);
});

test('normalizeThen: product_owner needs nothing else; workflow and queue need a workflow file (path stripped)', () => {
  assert.deepEqual(chain.normalizeThen({ action: 'product_owner' }), { action: 'product_owner' });
  assert.throws(() => chain.normalizeThen({ action: 'workflow' }), /"workflow" needs a workflow/);
  assert.throws(() => chain.normalizeThen({ action: 'queue' }), /"queue" needs a workflow/);
  assert.deepEqual(chain.normalizeThen({ action: 'queue', workflow: 'C:\\wf\\software-development.yaml' }),
    { action: 'queue', workflow: 'software-development.yaml', inputs: {} });
});

test('normalizeThen: a workflow then keeps its map (falsy entries dropped) and its own inputs', () => {
  const t = chain.normalizeThen({
    action: 'workflow', workflow: 'software-development-local-hero.yaml',
    map: { issues: 'issues', task: '', ignored: null, done: 'document' },
    inputs: { mode: 'validated' },
  });
  assert.deepEqual(t, {
    action: 'workflow', workflow: 'software-development-local-hero.yaml',
    map: { issues: 'issues', done: 'document' }, inputs: { mode: 'validated' },
  });
});

// ---- defaultMap -----------------------------------------------------------------------------------

test('defaultMap: an input named like a declared output maps to it', () => {
  assert.deepEqual(chain.defaultMap({ issues: {} }, { issues: { type: 'array' }, mode: { type: 'string' } }), { issues: 'issues' });
});

test('defaultMap: a `type: run` input always maps to the previous run itself (@run)', () => {
  assert.deepEqual(chain.defaultMap({ document: {} }, { base: { type: 'run' } }), { base: chain.RUN_SOURCE });
});

test('defaultMap: a text input (task/prompt/request) without a same-named output falls back to the first text-ish output present', () => {
  assert.deepEqual(chain.defaultMap({ findings: {} }, { task: { type: 'string' } }), { task: 'findings' });
  assert.deepEqual(chain.defaultMap({ document: {}, issue: {} }, { prompt: { type: 'string' } }), { prompt: 'document' });
  assert.deepEqual(chain.defaultMap({}, { task: { type: 'string' } }), {}); // nothing text-ish to offer
});

test('defaultMap: an input matching no output and no text source is left out', () => {
  assert.deepEqual(chain.defaultMap({ issues: {} }, { repo_path: { type: 'string' } }), {});
});

// ---- convertValue -----------------------------------------------------------------------------------

test('convertValue: null/undefined become undefined (nothing to set)', () => {
  assert.equal(chain.convertValue(null), undefined);
  assert.equal(chain.convertValue(undefined, { type: 'string' }), undefined);
});

test('convertValue: array target keeps a list, turns an issue into its url (or number without one), splits a string by line', () => {
  assert.deepEqual(chain.convertValue(['a', 'b'], { type: 'array' }), ['a', 'b']);
  assert.deepEqual(chain.convertValue([{ number: 5, url: 'https://x/5' }, { number: 6 }], { type: 'array' }), ['https://x/5', '6']);
  assert.deepEqual(chain.convertValue('one\ntwo\n', { type: 'array' }), ['one', 'two']);
  assert.deepEqual(chain.convertValue([{ a: 1 }], { type: 'array' }), ['{"a":1}']); // a plain object item, not an issue: JSON
});

test('convertValue: number/integer coerces, boolean is always truthy/falsy', () => {
  assert.equal(chain.convertValue('42', { type: 'integer' }), 42);
  assert.equal(chain.convertValue(3.5, { type: 'number' }), 3.5);
  assert.equal(chain.convertValue('x', { type: 'boolean' }), true);
  assert.equal(chain.convertValue(0, { type: 'boolean' }), false);
});

test('convertValue: a string target turns one issue into "Implement #n title (url)", several into a bullet list', () => {
  assert.equal(chain.convertValue({ number: 7, title: 'Fix it', url: 'https://x/7' }), 'Implement #7 Fix it (https://x/7)');
  assert.equal(chain.convertValue([{ number: 1, title: 'A' }]), 'Implement #1 A');
  assert.equal(chain.convertValue([{ number: 1, title: 'A' }, { number: 2, title: 'B' }]),
    'Implement these issues together:\n- #1 A\n- #2 B');
});

test('convertValue: a string target with a plain object uses its .text, else pretty JSON; a bare value is stringified', () => {
  assert.equal(chain.convertValue({ text: 'hello' }), 'hello');
  assert.equal(chain.convertValue({ a: 1 }), JSON.stringify({ a: 1 }, null, 2));
  assert.equal(chain.convertValue(['x', 'y'], { type: 'string' }), 'x\ny');
  assert.equal(chain.convertValue(5, { type: 'string' }), '5');
});

// ---- nextInputs -------------------------------------------------------------------------------------

test('nextInputs: a carried input (path/dir/branch/language/platform) with the same name passes through unchanged', () => {
  const then = chain.normalizeThen({ action: 'workflow', workflow: 'x.yaml' });
  const defs = { repo_path: { type: 'string' }, language: { type: 'string' }, task: { type: 'string', required: true } };
  const prev = { inputs: { repo_path: 'C:/repo', language: 'js' } };
  assert.deepEqual(chain.nextInputs(then, prev, defs), { repo_path: 'C:/repo', language: 'js' });
});

test('nextInputs: without a same-named input, a path-like input is filled from any of the previous run\'s own path/dir inputs', () => {
  const then = chain.normalizeThen({ action: 'workflow', workflow: 'x.yaml' });
  const defs = { repo_path: { type: 'string' } };
  const prev = { inputs: { project_path: 'C:/project' } };
  assert.deepEqual(chain.nextInputs(then, prev, defs), { repo_path: 'C:/project' });
});

test('nextInputs: the map pulls from the previous run\'s outputs, converted for the target input', () => {
  const then = chain.normalizeThen({ action: 'workflow', workflow: 'x.yaml', map: { issues: 'issues', task: 'issues' } });
  const defs = { issues: { type: 'array' }, task: { type: 'string', required: true } };
  const prev = { outputs: { issues: [{ number: 9, title: 'T', url: 'https://x/9' }] } };
  assert.deepEqual(chain.nextInputs(then, prev, defs), { issues: ['https://x/9'], task: 'Implement #9 T (https://x/9)' });
});

test('nextInputs: a `type: run` source (@run) passes the previous run\'s id (the engine refuses a folder path), falling back to its folder\'s name without one', () => {
  const then = chain.normalizeThen({ action: 'workflow', workflow: 'x.yaml', map: { base: chain.RUN_SOURCE } });
  const defs = { base: { type: 'run' } };
  assert.deepEqual(chain.nextInputs(then, { runDir: 'C:/runs/r1', runId: 'r1' }, defs), { base: 'r1' });
  assert.deepEqual(chain.nextInputs(then, { runId: 'r1' }, defs), { base: 'r1' });
  assert.deepEqual(chain.nextInputs(then, { runDir: 'C:/runs/r2' }, defs), { base: 'r2' });
});

test('nextInputs: then.inputs (the owner\'s own choices for the next run) win over the mapped and carried values', () => {
  const then = chain.normalizeThen({ action: 'workflow', workflow: 'x.yaml', map: { task: 'issues' }, inputs: { task: 'My own task', mode: 'validated' } });
  const defs = { task: { type: 'string' }, mode: { type: 'string' } };
  const prev = { outputs: { issues: [{ number: 1 }] } };
  assert.deepEqual(chain.nextInputs(then, prev, defs), { task: 'My own task', mode: 'validated' });
});

// ---- producedIssues ---------------------------------------------------------------------------------

test('producedIssues: merges the issues and issue outputs, keeps only a valid positive integer number, dedups', () => {
  const out = chain.producedIssues({
    issues: [{ number: 1, url: 'u1', title: 't1' }, { number: 0, url: 'bad' }, { number: '2', url: 'u2' }],
    issue: { number: 2, url: 'u2', title: 'dup' },
  });
  assert.deepEqual(out, [{ number: 1, url: 'u1', title: 't1' }, { number: 2, url: 'u2', title: '' }]);
});

test('producedIssues: without issues or issue, an empty list', () => {
  assert.deepEqual(chain.producedIssues({}), []);
  assert.deepEqual(chain.producedIssues(undefined), []);
});

// ---- queueBatches (ported from the pre-chain filedToQueue unit tests, #81/#134) ---------------------

function nearbyEntry(number, advice = 'group_with') { return { number, advice, group_with: undefined }; }
// chain-model reads grouping/group_with off each produced issue item (filed_issues already attaches
// them); nearby entries become the `group_with` list on the created issues themselves.
function issuesOf(numbers, grouping = 'alone', nearby = []) {
  const groupWith = nearby.filter((n) => n.advice === 'group_with').map((n) => n.number);
  return numbers.map((n) => ({ number: n, url: `https://github.com/o/r/issues/${n}`, title: `Issue ${n}`, grouping, group_with: groupWith }));
}

test('queueBatches: a group advice adds the open issues named group_with, nearest first, up to maxGroup', () => {
  const nearby = [1, 2, 3, 4, 5].map((n) => nearbyEntry(100 + n));
  const batches = chain.queueBatches({ issues: issuesOf([10, 11], 'group', nearby) }, 3);
  assert.deepEqual(batches, [{ numbers: [10, 11, 101], group: true }]); // the created issues first, then the nearest group_with filling the room left
});

test('queueBatches: maxGroup 1 floors the group at 2; 0 or missing falls back to 5', () => {
  const nearby = [201, 202, 203, 204, 205, 206].map((n) => nearbyEntry(n));
  const numbersOf = (maxGroup) => chain.queueBatches({ issues: issuesOf([20], 'group', nearby) }, maxGroup)[0].numbers.length;
  assert.equal(numbersOf(1), 2);
  assert.equal(numbersOf(0), 5);
  assert.equal(chain.queueBatches({ issues: issuesOf([20], 'group', nearby) })[0].numbers.length, 5);
});

test('queueBatches: created issues beyond maxGroup split into further batches; no room is left for nearby ones', () => {
  const batches = chain.queueBatches({ issues: issuesOf([30, 31, 32], 'group', [nearbyEntry(33)]) }, 2);
  assert.deepEqual(batches, [{ numbers: [30, 31], group: true }, { numbers: [32], group: false }]); // no room left for the nearby issue
});

test('queueBatches: a nearby issue already created, or named twice, is never duplicated', () => {
  const nearby = [nearbyEntry(40), nearbyEntry(41), nearbyEntry(41), nearbyEntry(42)]; // 40 was also created
  const batches = chain.queueBatches({ issues: issuesOf([40], 'group', nearby) }, 5);
  assert.deepEqual(batches[0].numbers, [40, 41, 42]);
});

test('queueBatches: without the group advice, the created issues queue alone and nearby is ignored', () => {
  const batches = chain.queueBatches({ issues: issuesOf([51, 52], 'alone', [nearbyEntry(50)]) }, 5);
  assert.deepEqual(batches, [{ numbers: [51, 52], group: false }]);
});

test('queueBatches: nearby advice other than group_with (avoid_together, do_first, do_after) never joins the group', () => {
  const nearby = [nearbyEntry(60, 'avoid_together'), nearbyEntry(61, 'do_first'), nearbyEntry(62, 'do_after'), nearbyEntry(63, 'group_with')];
  const batches = chain.queueBatches({ issues: issuesOf([64], 'group', nearby) }, 5);
  assert.deepEqual(batches[0].numbers, [64, 63]);
});

test('queueBatches: only valid produced issues are queued; duplicates collapse (producedIssues does the filtering)', () => {
  const outputs = { issues: [{ number: 80, url: 'u', title: 't' }, { number: 80, url: 'u', title: 't' }, { number: 0, url: 'u', title: 't' }, { number: 82, url: 'u', title: 't' }] };
  assert.deepEqual(chain.queueBatches(outputs, 5)[0].numbers, [80, 82]);
});

test('queueBatches: no produced issue at all means nothing to queue', () => {
  assert.deepEqual(chain.queueBatches({ issues: [] }), []);
  assert.deepEqual(chain.queueBatches({}), []);
});

// ---- blockedReason ------------------------------------------------------------------------------

test('blockedReason: only a success goes on; anything else reports why', () => {
  assert.equal(chain.blockedReason({ status: 'failed' }), 'the run ended failed');
  assert.equal(chain.blockedReason({ status: 'cancelled' }), 'the run ended cancelled');
  assert.equal(chain.blockedReason({}), 'the run ended without a status');
});

test('blockedReason: a workflow declaring merged_commit must have actually merged (not a simulated run)', () => {
  const outputDefs = { merged_commit: { type: 'string' } };
  assert.equal(chain.blockedReason({ status: 'success', outputs: { merged_commit: '' }, outputDefs, mock: false }), 'the run succeeded but nothing was merged');
  assert.equal(chain.blockedReason({ status: 'success', outputs: { merged_commit: null }, outputDefs, mock: false }), 'the run succeeded but nothing was merged');
  assert.equal(chain.blockedReason({ status: 'success', outputs: { merged_commit: 'abc123' }, outputDefs, mock: false }), '');
});

test('blockedReason: a simulated run never touches git, so the merge requirement does not apply to it', () => {
  const outputDefs = { merged_commit: { type: 'string' } };
  assert.equal(chain.blockedReason({ status: 'success', outputs: { merged_commit: '' }, outputDefs, mock: true }), '');
});

test('blockedReason: a workflow without a merged_commit output (not a development one) is never blocked on it', () => {
  assert.equal(chain.blockedReason({ status: 'success', outputs: {}, outputDefs: { issues: { type: 'array' } }, mock: false }), '');
  assert.equal(chain.blockedReason({ status: 'success' }), '');
});

// ---- chainWorkflows -----------------------------------------------------------------------------

test('chainWorkflows: workflow and queue name the workflow they run; product_owner and nothing name none', () => {
  assert.deepEqual(chain.chainWorkflows(chain.normalizeThen({ action: 'workflow', workflow: 'a.yaml' })), ['a.yaml']);
  assert.deepEqual(chain.chainWorkflows(chain.normalizeThen({ action: 'queue', workflow: 'b.yaml' })), ['b.yaml']);
  assert.deepEqual(chain.chainWorkflows(chain.normalizeThen({ action: 'product_owner' })), []);
  assert.deepEqual(chain.chainWorkflows(null), []);
});

// ---- estimateCost / estimateText -----------------------------------------------------------------

test('estimateCost: averages a real, finished run\'s cost and duration per workflow; mock and running runs are excluded', () => {
  const runs = [
    { file: 'a.yaml', status: 'success', mock: false, finishedAt: 't', costUsd: 1, durationMs: 60000 },
    { file: 'a.yaml', status: 'failed', mock: false, finishedAt: 't', costUsd: 3, durationMs: 180000 },
    { file: 'a.yaml', status: 'success', mock: true, finishedAt: 't', costUsd: 999, durationMs: 1 }, // simulated: excluded
    { file: 'a.yaml', status: 'success', mock: false, finishedAt: null, costUsd: 999, durationMs: 1 }, // still running: excluded
    { workflow: 'b', status: 'success', mock: false, finishedAt: 't', costUsd: 2, durationMs: 120000 },
  ];
  const est = chain.estimateCost(['a.yaml', 'b.yaml'], runs);
  assert.deepEqual(est.items, [
    { workflow: 'a.yaml', basis: 2, costUsd: 2, minutes: 2 },
    { workflow: 'b.yaml', basis: 1, costUsd: 2, minutes: 2 },
  ]);
  assert.equal(est.costUsd, 4);
  assert.equal(est.complete, true);
});

test('estimateCost: a workflow with no past runs has no basis, and the total is not "complete"', () => {
  const est = chain.estimateCost(['never-run.yaml'], []);
  assert.deepEqual(est.items, [{ workflow: 'never-run.yaml', basis: 0, costUsd: null, minutes: null }]);
  assert.equal(est.costUsd, null);
  assert.equal(est.complete, false);
});

test('estimateText: one line per workflow, each marked as an estimate (or "no past runs")', () => {
  const text = chain.estimateText(chain.estimateCost(['a.yaml'], [{ file: 'a.yaml', status: 'success', mock: false, finishedAt: 't', costUsd: 1.2, durationMs: 90000 }]));
  assert.equal(text, 'a.yaml: ≈ US$ 1.20, ~2 min (estimate from 1 past run)');
  assert.equal(chain.estimateText(chain.estimateCost(['a.yaml'], [])), 'a.yaml: no past runs to estimate from');
  assert.equal(chain.estimateText({ items: [] }), '');
});

// ---- thenLabel / chainBadgesHtml ------------------------------------------------------------------

test('thenLabel: the words shown on a badge or notice', () => {
  assert.equal(chain.thenLabel(null), '');
  assert.equal(chain.thenLabel(chain.normalizeThen({ action: 'product_owner' })), 'Product Owner (roadmap)');
  assert.equal(chain.thenLabel(chain.normalizeThen({ action: 'workflow', workflow: 'software-development.yaml' })), 'software-development');
  assert.equal(chain.thenLabel(chain.normalizeThen({ action: 'queue', workflow: 'writer-reviewer.yaml' })), 'queue for writer-reviewer');
});

test('chainBadgesHtml: without a chain, nothing; a `then` shows "→ then:", a `from` shows "← from"', () => {
  assert.equal(chain.chainBadgesHtml(null), '');
  const then = chain.normalizeThen({ action: 'workflow', workflow: 'software-development.yaml' });
  const html = chain.chainBadgesHtml({ then, state: 'waiting' });
  assert.match(html, /→ then: software-development/);
  assert.doesNotMatch(html, /chain waiting/); // "waiting" is the quiet default: no extra state text
  const fromHtml = chain.chainBadgesHtml({ from: { run_id: 'r1', workflow: 'issue-tracker' } });
  assert.match(fromHtml, /← from issue-tracker/);
  assert.match(fromHtml, /data-run-link="r1"/);
});

test('chainBadgesHtml: a paused chain is marked (warn tone) with its reason in the tooltip, HTML-escaped', () => {
  const then = chain.normalizeThen({ action: 'workflow', workflow: 'a.yaml' });
  const html = chain.chainBadgesHtml({ then, state: 'paused', reason: 'the run ended failed <script>' });
  assert.match(html, /chain-badge warn/);
  assert.match(html, /chain paused/);
  assert.match(html, /the run ended failed &lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

// ---- runChain / withThen (#134, 758184d: the run lists' own chain reading, moved out of app.js) ----

test('runChain: an existing x.chain is kept as is, from/state and all', () => {
  const existing = { then: { action: 'queue', workflow: 'a.yaml' }, from: { run_id: 'r0' }, state: 'paused', reason: 'x' };
  assert.equal(chain.runChain({ chain: existing }), existing);
});

test('runChain: without x.chain, a then gets state "waiting"; a from alone gets no state', () => {
  const then = { action: 'workflow', workflow: 'a.yaml' };
  assert.deepEqual(chain.runChain({ then }), { then, from: null, state: 'waiting' });
  const from = { run_id: 'r0', workflow: 'issue-tracker' };
  assert.deepEqual(chain.runChain({ from }), { then: null, from, state: undefined });
  assert.deepEqual(chain.runChain({ then, from }), { then, from, state: 'waiting' });
});

test('runChain: neither x.chain, x.then nor x.from returns null', () => {
  assert.equal(chain.runChain({}), null);
  assert.equal(chain.runChain({ runId: 'r0' }), null);
});

test('withThen: keeps the chain\'s other fields (e.g. from) and sets the new then, state "waiting"', () => {
  const chain1 = { from: { run_id: 'r0', workflow: 'issue-tracker' }, state: 'done', reason: 'old' };
  const then = { action: 'workflow', workflow: 'b.yaml' };
  assert.deepEqual(chain.withThen(chain1, then), { from: chain1.from, reason: 'old', then, state: 'waiting' });
});

test('withThen: setting then to null clears the state (and a missing chain defaults to {})', () => {
  const chain1 = { then: { action: 'queue', workflow: 'a.yaml' }, state: 'waiting' };
  assert.deepEqual(chain.withThen(chain1, null), { then: null, state: undefined });
  assert.deepEqual(chain.withThen(null, null), { then: null, state: undefined });
});
