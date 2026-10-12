// #99 and #69: the merge queue, the pr_mergeable probe and the validation of check: / precheck: /
// recover:. The mock runs (the fixture, local-hero, software-development) are in
// test/slow/merge-recovery-runs.slow.test.js (#305). Covers:
// - src/engine/merge-queue.js: one merge at a time per repository, the `merged` notification.
// - src/engine/probes.js: mergeableState (the `pr_mergeable` probe behind `check:`/`precheck:`).
// - src/engine/workflow.js: loadWorkflow's validation of check: / precheck: / recover:.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadWorkflow } = require('../src/engine/workflow');
const mergeQueue = require('../src/engine/merge-queue');
const { mergeableState } = require('../src/engine/probes');

// ---- src/engine/merge-queue.js: the seam a `check:`/`precheck:` merge goes through -------------

test('merge-queue: serialize() runs tasks for the same key one after another; different keys run concurrently', async () => {
  const order = [];
  const step = (key, label, ms) => mergeQueue.serialize(key, async () => {
    order.push(`${label}:start`);
    await new Promise((r) => setTimeout(r, ms));
    order.push(`${label}:end`);
    return label;
  });
  const sameKey = Promise.all([step('repo/a', 'a1', 30), step('repo/a', 'a2', 5)]);
  const otherKey = step('repo/b', 'b1', 5);
  const [[a1, a2], b1] = await Promise.all([sameKey, otherKey]);
  assert.deepEqual([a1, a2], ['a1', 'a2']);
  assert.equal(b1, 'b1');
  // a2 only starts once a1 finished, even though a1 is the slower task
  assert.deepEqual(order.filter((x) => x.startsWith('a')), ['a1:start', 'a1:end', 'a2:start', 'a2:end']);
  // the other key's task was not held up by repo/a's queue
  assert.ok(order.indexOf('b1:start') < order.indexOf('a1:end'));
});

test('merge-queue: a failed merge does not block the next one queued for the same key', async () => {
  const key = 'repo/failing';
  await assert.rejects(mergeQueue.serialize(key, async () => { throw new Error('boom'); }), /boom/);
  const result = await mergeQueue.serialize(key, async () => 'ok');
  assert.equal(result, 'ok');
});

test('merge-queue: onMerged notifies listeners of the same key only, and the unsubscribe works', () => {
  const seenA = [];
  const seenB = [];
  const offA = mergeQueue.onMerged((m) => seenA.push(m));
  const offB = mergeQueue.onMerged((m) => seenB.push(m));
  offB();
  mergeQueue.notifyMerged({ key: 'repo/x', runId: 'r1' });
  mergeQueue.notifyMerged({ key: 'repo/y', runId: 'r2' });
  assert.deepEqual(seenA, [{ key: 'repo/x', runId: 'r1' }, { key: 'repo/y', runId: 'r2' }]);
  assert.deepEqual(seenB, []);
  offA();
  mergeQueue.notifyMerged({ key: 'repo/z', runId: 'r3' });
  assert.deepEqual(seenA, [{ key: 'repo/x', runId: 'r1' }, { key: 'repo/y', runId: 'r2' }]);
});

// ---- src/engine/probes.js: mergeableState, the deterministic check behind pr_mergeable ---------

test('mergeableState: a conflict or a failed/pending/merged/closed state passes through unchanged', () => {
  assert.equal(mergeableState({ state: 'conflict', detail: 'x', head: 'h' }).state, 'conflict');
  for (const state of ['merged', 'closed', 'failed', 'pending']) {
    assert.deepEqual(mergeableState({ state, detail: 'd', head: 'h' }), { state, detail: 'd', head: 'h' });
  }
});

test('mergeableState: GitHub mergeStateStatus decides behind/blocked/pending on an otherwise open PR', () => {
  const open = { state: 'none', detail: 'no check registered on the head commit yet', head: 'h' };
  assert.equal(mergeableState(open, { mergeState: 'BEHIND' }).state, 'behind');
  assert.equal(mergeableState(open, { mergeState: 'BLOCKED' }).state, 'blocked');
  assert.equal(mergeableState(open, { mergeState: 'UNKNOWN' }).state, 'pending');
  const passed = mergeableState(open, { mergeState: 'CLEAN' });
  assert.equal(passed.state, 'passed');
  assert.match(passed.detail, /mergeable, no check registered/);
});

test('mergeableState: GitLab detailed_merge_status decides behind/blocked/pending the same way', () => {
  const open = { state: 'none', detail: 'no pipeline registered on the head commit yet', head: 'h' };
  assert.equal(mergeableState(open, { glStatus: 'need_rebase' }).state, 'behind');
  assert.equal(mergeableState(open, { glStatus: 'not_approved' }).state, 'blocked');
  assert.equal(mergeableState(open, { glStatus: 'discussions_not_resolved' }).state, 'blocked');
  assert.equal(mergeableState(open, { glStatus: 'checking' }).state, 'pending');
  assert.equal(mergeableState(open, { glStatus: 'mergeable' }).state, 'passed');
});

// ---- loadWorkflow validates check: / precheck: / recover: --------------------------------------

test('loadWorkflow validates check:, precheck: and recover:', () => {
  const tmp = path.join(os.tmpdir(), `wf-check-${process.pid}.yaml`);
  const base = (extra) => `agents: { a: { provider: claude, model: m } }\nsteps:\n${extra}`;
  const write = (yaml) => fs.writeFileSync(tmp, yaml);
  try {
    // check: only on a human_approval step
    write(base('  - id: s1\n    agent: a\n    prompt: x\n    check: { probe: pr_mergeable, target: "x" }\n'));
    assert.throws(() => loadWorkflow(tmp), /check is only valid for human_approval/);

    // check: needs a known probe and a target
    write(base('  - id: s1\n    type: human_approval\n    message: x\n    check: { probe: nope, target: "x" }\n    transitions: [{ when: approved, goto: end }]\n'));
    assert.throws(() => loadWorkflow(tmp), /check needs a probe .* and a target/);
    write(base('  - id: s1\n    type: human_approval\n    message: x\n    check: { probe: pr_mergeable }\n    transitions: [{ when: approved, goto: end }]\n'));
    assert.throws(() => loadWorkflow(tmp), /check needs a probe .* and a target/);

    // check.on_fail points to a real step
    write(base('  - id: s1\n    type: human_approval\n    message: x\n    check: { probe: pr_mergeable, target: "x", on_fail: nope }\n    transitions: [{ when: approved, goto: end }]\n'));
    assert.throws(() => loadWorkflow(tmp), /points to unknown step "nope"/);

    // check.recover: a non-empty list, only with a failure route, only agent steps
    write(base('  - id: s1\n    type: human_approval\n    message: x\n    check: { probe: pr_mergeable, target: "x", recover: [] }\n    transitions: [{ when: approved, goto: end }]\n'));
    assert.throws(() => loadWorkflow(tmp), /check.recover must be a non-empty list of steps/);
    write(base('  - id: s1\n    type: human_approval\n    message: x\n    check: { probe: pr_mergeable, target: "x", recover: [fix] }\n    transitions: [{ when: approved, goto: end }]\n  - id: fix\n    agent: a\n    prompt: x\n'));
    assert.throws(() => loadWorkflow(tmp), /check.recover needs a failure route/);
    write(base('  - id: s1\n    type: human_approval\n    message: x\n    check: { probe: pr_mergeable, target: "x", on_fail: fix, recover: [fix] }\n    transitions: [{ when: approved, goto: end }]\n  - id: fix\n    type: human_approval\n    message: x\n    transitions: [{ when: approved, goto: end }]\n'));
    assert.throws(() => loadWorkflow(tmp), /check.recover must list agent steps \("fix" is not one\)/);
    write(base('  - id: s1\n    type: human_approval\n    message: x\n    check: { probe: pr_mergeable, target: "x", on_fail: fix, recover: [fix] }\n    transitions: [{ when: approved, goto: end }]\n  - id: fix\n    agent: a\n    prompt: x\n'));
    assert.doesNotThrow(() => loadWorkflow(tmp));

    // precheck: true reuses the step's own check
    write(base('  - id: s1\n    type: human_approval\n    message: x\n    transitions: [{ when: approved, precheck: true, goto: end }]\n'));
    assert.throws(() => loadWorkflow(tmp), /precheck: true reuses the step's check, which it does not have/);
    write(base('  - id: s1\n    type: human_approval\n    message: x\n    check: { probe: pr_mergeable, target: "x" }\n    transitions: [{ when: approved, precheck: true, goto: end }]\n'));
    assert.doesNotThrow(() => loadWorkflow(tmp));

    // precheck: an object needs a probe and a target, same as check:
    write(base('  - id: s1\n    type: human_approval\n    message: x\n    transitions: [{ when: approved, precheck: { probe: pr_mergeable }, goto: end }]\n'));
    assert.throws(() => loadWorkflow(tmp), /precheck needs a probe .* and a target/);

    // a transition's recover: same rules as check.recover, against on_error
    write(base('  - id: s1\n    agent: a\n    prompt: x\n    transitions: [{ when: "true", action: x, recover: [s1], goto: end }]\n'));
    assert.throws(() => loadWorkflow(tmp), /transition.recover needs a failure route/);
    write(base('  - id: s1\n    agent: a\n    prompt: x\n    transitions: [{ when: "true", action: x, on_error: s1, recover: [s1], goto: end }]\n'));
    assert.doesNotThrow(() => loadWorkflow(tmp));
  } finally {
    fs.unlinkSync(tmp);
  }
});
