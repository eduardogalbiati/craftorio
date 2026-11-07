// #807 Stack: the next stage starts from the branch of the stage that waits for its merge
// (packages/engine/domains/roadmap/roadmap.js). Acceptance tests, written before the code.
//
// The interface these tests assume:
// - itemAction(dir, projectId, itemId, 'stack', { runOf }) on the item that waits for its PR's merge
//   (runOf(runId) as advance's env: { status: 'success', merged: false, pr }): every planned item of the next
//   stage records `stacksOn: <that item's id>`, kept across reads. Refused, with nothing written: an item that
//   does not wait for a merge, an item in Fork + PR mode (inputs.mode 'fork', /fork/i), a stack already
//   holding RoadmapModel.MAX_STACK_DEPTH (3) PRs (the reason names 3).
// - advance: a stage whose items wait for their merge no longer holds the next stage once it is stacked on
//   it (the stacked items start); the waiting item stays waiting_merge.
// - stackBase(roadmap, itemId, { runOf }) → null for an item stacked on nothing; else { parentId, branch,
//   prNumber, prUrl, parentMerged } from the parent item's run (runOf(runId): { branch, merged, prNumber,
//   prUrl }, the service's parentRun), what the dispatch passes on as inputs.parent_branch / parent_pr.
// - the roadmap:item channel takes action 'stack' (its schema's action is free text, the domain refuses).
// New exports are read inside each test: before the code exists each test fails on its own.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const roadmaps = () => require('../../domains/roadmap/roadmap');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roadmap-807-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const PR = (number) => ({ number, url: `https://github.com/o/r/pull/${number}`, state: 'open' });
const item = (id, number, extra = {}) => ({ id, workflow: 'feature.yaml', inputs: { mode: 'remote' }, mock: true, number, status: 'planned', runId: null, runs: [], error: null, ...extra });
const started = (id, number, extra = {}) => item(id, number, { runId: `run-${id}`, runs: [`run-${id}`], ...extra });
const stage = (id, items) => ({ id, name: '', note: '', items });
const plan = (stages) => ({ state: 'running', simulated: true, error: null, pausedBy: null, scope: null, stages, updatedAt: null });

// every started item's run ended well and its PR waits for a person's merge
const waitingRuns = (numbers) => (runId) => (numbers[runId] ? { status: 'success', merged: false, pr: PR(numbers[runId]) } : null);
const TWO = () => plan([stage('s1', [started('a', 1)]), stage('s2', [item('b', 2), item('c', 3)])]);

test('#807 stack: the next stage\'s planned items record the item they stack on, kept across reads', (t) => {
  const dir = tmp(t);
  roadmaps().writeRoadmap(dir, 'p1', TWO());
  roadmaps().itemAction(dir, 'p1', 'a', 'stack', { runOf: waitingRuns({ 'run-a': 7 }) });
  const read = roadmaps().readRoadmap(dir, 'p1');
  assert.deepEqual(read.stages[1].items.map((x) => x.stacksOn ?? null), ['a', 'a']);
  assert.equal(read.stages[0].items[0].stacksOn ?? null, null);
});

test('#807 advance: a stacked next stage starts while the stage it stacks on still waits for its merge', () => {
  const r = plan([stage('s1', [started('a', 1)]), stage('s2', [item('b', 2, { stacksOn: 'a' })])]);
  const step = roadmaps().advance(r, { runOf: waitingRuns({ 'run-a': 7 }) });
  assert.deepEqual([step.roadmap.stages[0].items[0].status, step.start.map((x) => x.id), step.roadmap.state], ['waiting_merge', ['b'], 'running']);
});

test('#807 stackBase: a stacked item starts from its parent\'s branch and names the parent\'s PR', () => {
  const r = plan([stage('s1', [started('a', 1)]), stage('s2', [item('b', 2, { stacksOn: 'a' }), item('c', 3)])]);
  const runOf = (id) => (id === 'run-a' ? { status: 'success', merged: false, branch: 'feat/a-1', prNumber: 7, prUrl: 'https://github.com/o/r/pull/7' } : null);
  const base = roadmaps().stackBase(r, 'b', { runOf });
  assert.deepEqual([base?.parentId, base?.branch, base?.prNumber, base?.prUrl, base?.parentMerged], ['a', 'feat/a-1', 7, 'https://github.com/o/r/pull/7', false]);
  assert.equal(roadmaps().stackBase(r, 'c', { runOf }), null);
});

test('#807 stack is refused on an item that does not wait for a merge, and nothing is written', (t) => {
  const dir = tmp(t);
  roadmaps().writeRoadmap(dir, 'p1', TWO());
  const running = (runId) => (runId === 'run-a' ? { status: 'running' } : null);
  assert.throws(() => roadmaps().itemAction(dir, 'p1', 'a', 'stack', { runOf: running }), /merge/i);
  assert.deepEqual(roadmaps().readRoadmap(dir, 'p1').stages[1].items.map((x) => x.stacksOn ?? null), [null, null]);
});

test('#807 stack is refused in Fork + PR mode (#738 keeps its wait and rebase), and nothing is written', (t) => {
  const dir = tmp(t);
  roadmaps().writeRoadmap(dir, 'p1', plan([stage('s1', [started('a', 1, { inputs: { mode: 'fork' } })]), stage('s2', [item('b', 2, { inputs: { mode: 'fork' } })])]));
  assert.throws(() => roadmaps().itemAction(dir, 'p1', 'a', 'stack', { runOf: waitingRuns({ 'run-a': 7 }) }), /fork/i);
  assert.equal(roadmaps().readRoadmap(dir, 'p1').stages[1].items[0].stacksOn ?? null, null);
});

test('#807 stack is refused past 3 PRs, saying why, and nothing is written', (t) => {
  const dir = tmp(t);
  roadmaps().writeRoadmap(dir, 'p1', plan([
    stage('s1', [started('a', 1)]),
    stage('s2', [started('b', 2, { stacksOn: 'a' })]),
    stage('s3', [started('c', 3, { stacksOn: 'b' })]),
    stage('s4', [item('d', 4)]),
  ]));
  assert.throws(() => roadmaps().itemAction(dir, 'p1', 'c', 'stack', { runOf: waitingRuns({ 'run-a': 7, 'run-b': 8, 'run-c': 9 }) }), /\b3\b/);
  assert.equal(roadmaps().readRoadmap(dir, 'p1').stages[3].items[0].stacksOn ?? null, null);
});

test('#807 "Seguir" (park, #395) on an item at a gate works as today: it is parked, nothing is stacked', (t) => {
  const dir = tmp(t);
  roadmaps().writeRoadmap(dir, 'p1', TWO());
  roadmaps().itemAction(dir, 'p1', 'a', 'park', { runOf: (id) => (id === 'run-a' ? { status: 'running', waiting: true, gate: 'Check' } : null) });
  const read = roadmaps().readRoadmap(dir, 'p1');
  assert.deepEqual([read.stages[0].items[0].status, read.stages[1].items.map((x) => x.stacksOn ?? null)], ['parked', [null, null]]);
});

test('#807 channel roadmap:item takes the stack action to the domain: an unknown item is refused as such, not as an unknown action', async () => {
  // the channel reads the project's roadmap from ctx.ws.backlog; an empty folder has no item
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roadmap-807-ch-'));
  try {
    const stub = new Proxy(function stub() {}, { get: () => stub, apply: () => undefined });
    const ctx = new Proxy({}, { get: (target, key) => (key === 'ws' ? { backlog: dir } : stub) });
    const entry = require('../../service/channels/roadmap')(ctx).find((e) => e.channel === 'roadmap:item');
    await assert.rejects(async () => entry.fn({ projectId: 'p1', itemId: 'nope', action: 'stack' }), (e) => !/unknown roadmap item action/i.test(String(e?.message)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
