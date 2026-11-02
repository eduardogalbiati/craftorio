// #738: split implementations in a Fork + PR project: a roadmap item depends on an earlier item
// (packages/engine/domains/roadmap/roadmap.js). Acceptance tests, written before the code.
//
// The interface these tests assume:
// - an item keeps `dependsOn: <item id>` (saveStages / cleanItem), only on an item of an earlier stage;
//   another id (a later stage's item, its own, an unknown one) throws.
// - dependencyBase(roadmap, itemId, { runOf, policy }) → null for an item without dependsOn; else
//   { parentId, branch, parentMerged, policy, prNote }: branch = the parent's run branch (runOf(runId).branch),
//   parentMerged = runOf(runId).merged, policy 'wait-and-rebase' (the project default) or 'depends-on';
//   with 'depends-on', prNote = "Depends on #<parent PR>" (runOf(runId).prNumber) for the PR body, else null.
// New exports are read inside each test: before the code exists each test fails on its own.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const roadmaps = () => require('../../domains/roadmap/roadmap');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roadmap-738-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const issue = (number) => ({ number, title: `Issue ${number}`, url: `https://github.com/o/r/issues/${number}`, body: '', pullRequests: [] });
const SYNCED = [issue(1), issue(2), issue(3)];

// two stages, one item each: the parent (issue 1), then the child (issue 2)
function twoStages(dir) {
  const first = roadmaps().saveStages(dir, 'proj', [
    { name: 'One', items: [{ workflow: 'feature.yaml', number: 1 }] },
    { name: 'Two', items: [{ workflow: 'feature.yaml', number: 2 }] },
  ], { issues: SYNCED });
  const [s1, s2] = first.stages;
  return { s1, s2, parent: s1.items[0], child: s2.items[0] };
}

const resave = (dir, { s1, s2, parent, child }, childOver = {}, parentOver = {}) => roadmaps().saveStages(dir, 'proj', [
  { id: s1.id, name: s1.name, items: [{ id: parent.id, workflow: 'feature.yaml', number: 1, ...parentOver }] },
  { id: s2.id, name: s2.name, items: [{ id: child.id, workflow: 'feature.yaml', number: 2, ...childOver }] },
], { issues: SYNCED });

test('#738 an item records its dependency on an item of an earlier stage, kept across saves and reads', (t) => {
  const dir = tmp(t);
  const r = twoStages(dir);
  resave(dir, r, { dependsOn: r.parent.id });
  const read = roadmaps().readRoadmap(dir, 'proj');
  assert.equal(read.stages[1].items[0].dependsOn, r.parent.id);
  assert.equal('dependsOn' in read.stages[0].items[0], false, 'the parent has no dependency');
});

test('#738 a dependency on a later item (or an unknown one) is refused', (t) => {
  const dir = tmp(t);
  const r = twoStages(dir);
  assert.throws(() => resave(dir, r, {}, { dependsOn: r.child.id }), /earlier/i);
  assert.throws(() => resave(dir, r, { dependsOn: 'item-nope' }));
});

test('#738 dependencyBase: an item without a dependency has none', (t) => {
  const dir = tmp(t);
  const r = twoStages(dir);
  const roadmap = roadmaps().readRoadmap(dir, 'proj');
  assert.equal(roadmaps().dependencyBase(roadmap, r.child.id, { runOf: () => null }), null);
});

test('#738 dependencyBase: the child\'s base is the parent run\'s branch; wait and rebase by default', (t) => {
  const dir = tmp(t);
  const r = twoStages(dir);
  resave(dir, r, { dependsOn: r.parent.id });
  roadmaps().markStarted(dir, 'proj', r.parent.id, { runId: 'run-parent' });
  const roadmap = roadmaps().readRoadmap(dir, 'proj');
  const runOf = (id) => (id === 'run-parent' ? { status: 'success', merged: false, branch: 'feat/parent-1', prNumber: 12 } : null);
  const base = roadmaps().dependencyBase(roadmap, r.child.id, { runOf });
  assert.equal(base.parentId, r.parent.id);
  assert.equal(base.branch, 'feat/parent-1');
  assert.equal(base.parentMerged, false);
  assert.equal(base.policy, 'wait-and-rebase');
  assert.equal(base.prNote, null, 'wait and rebase writes no "depends on" text');
});

test('#738 dependencyBase with "depends on": the PR text names the parent\'s PR', (t) => {
  const dir = tmp(t);
  const r = twoStages(dir);
  resave(dir, r, { dependsOn: r.parent.id });
  roadmaps().markStarted(dir, 'proj', r.parent.id, { runId: 'run-parent' });
  const roadmap = roadmaps().readRoadmap(dir, 'proj');
  const runOf = (id) => (id === 'run-parent' ? { status: 'success', merged: false, branch: 'feat/parent-1', prNumber: 12 } : null);
  const base = roadmaps().dependencyBase(roadmap, r.child.id, { runOf, policy: 'depends-on' });
  assert.equal(base.policy, 'depends-on');
  assert.match(base.prNote, /depends on #12\b/i);
});

test('#738 dependencyBase: a merged parent is reported, so the child rebases onto the synced default branch', (t) => {
  const dir = tmp(t);
  const r = twoStages(dir);
  resave(dir, r, { dependsOn: r.parent.id });
  roadmaps().markStarted(dir, 'proj', r.parent.id, { runId: 'run-parent' });
  const roadmap = roadmaps().readRoadmap(dir, 'proj');
  const runOf = (id) => (id === 'run-parent' ? { status: 'success', merged: true, branch: 'feat/parent-1', prNumber: 12 } : null);
  assert.equal(roadmaps().dependencyBase(roadmap, r.child.id, { runOf }).parentMerged, true);
});
