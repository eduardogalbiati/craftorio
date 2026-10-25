// #368 acceptance (cheap part): pause a stage or a run after the current agent turn. Written before
// the code. The whole simulated runs (pause during a turn, a parallel step, a gate, the suite
// command, a stage with two runs, resume after a restart) are in test/slow/pause-after-turn-368.slow.test.js.
//
// The seam these tests pin down (the developer implements against it):
// - src/shared/roadmap-model.js: ITEM_STATES gains 'paused' (an item whose run ended paused);
//   allowedActions on a paused item refuses retry, skip, edit and move, each with a reason that says
//   it is paused; the roadmap's resume stays allowed.
// - src/roadmap.js: withStatus reads an item whose run's status is 'paused' as 'paused' (error null,
//   never 'failed'); advance never pauses the roadmap on a paused item (no pausedBy) and never starts
//   it again; pauseStage(dir, projectId, stageId) pauses the roadmap at that stage
//   (state 'paused', pausedStage: stageId, pausedBy null, no "failed" in its message).
// - src/domains/night/night-watch.js: NEVER_ALLOWED has { id: 'resume-paused' } (only the owner resumes a paused
//   run), so savePermissions refuses it.
// - src/shared/run-progress-model.js: pauseLabel(pause) is the line the run screens show, from the
//   `pause` record of runs:active ({ state: 'pausing', step, agents?, command? }) or of a paused run
//   ({ state: 'paused', step, next }).
// - src/engine/worktree.js: cleanupWorktrees keeps the worktree of a run that ended paused.
// New exports are looked up inside each test so this file loads before they exist.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const roadmapModel = require('../src/shared/roadmap-model');
const roadmap = require('../src/roadmap');
const night = require('../src/domains/night/night-watch');
const runProgress = require('../src/shared/run-progress-model');
const { prepareWorktree, cleanupWorktrees } = require('../src/engine/worktree');
const { endedRun, fixture } = require('./worktree-helpers');

const item = (id, status, extra = {}) => ({ id, workflow: 'software-development.yaml', inputs: {}, mock: true, number: Number(id.replace(/\D/g, '')) || 1, status, runId: null, runs: [], error: null, ...extra });
const stage = (id, items, extra = {}) => ({ id, name: id, note: '', items, ...extra });
const plan = (state, stages, extra = {}) => ({ state, simulated: true, error: null, pausedBy: null, scope: null, stages, updatedAt: null, ...extra });

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pause-368-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// ---- Roadmap model (#349): a paused item is not a failure ------------------------------------

test('roadmap model (#368): paused is an item state', () => {
  assert.equal(roadmapModel.ITEM_STATES.includes('paused'), true);
  assert.equal(roadmapModel.isFinished(item('i1', 'paused')), false);
});

test('roadmap model (#368): a paused item offers Resume on its roadmap, never Retry, Skip, Edit or Move', () => {
  const r = plan('paused', [stage('s1', [item('i1', 'paused', { runId: 'run-1' }), item('i2', 'paused', { runId: 'run-2' })])], { pausedStage: 's1' });
  const acts = roadmapModel.allowedActions(r, r.stages[0], r.stages[0].items[0]);
  assert.equal(acts.resume.allowed, true);
  for (const name of ['retry', 'skip', 'edit', 'move']) {
    assert.equal(acts[name].allowed, false, `${name} should be refused`);
    assert.match(acts[name].reason, /paused/i, `${name}: ${acts[name].reason}`);
  }
});

// ---- src/roadmap.js: statuses, sequencing, pauseStage ----------------------------------------

test('withStatus (#368): an item whose run ended paused reads paused, not failed', () => {
  const r = plan('paused', [stage('s1', [item('i1', 'planned', { runId: 'run-1', runs: ['run-1'] })])]);
  const out = roadmap.withStatus(r, () => ({ status: 'paused' }));
  assert.equal(out.stages[0].items[0].status, 'paused');
  assert.equal(out.stages[0].items[0].error, null);
});

test('advance (#368): a paused run never pauses the roadmap as a failure and is never started again', () => {
  const r = plan('running', [stage('s1', [item('i1', 'planned', { runId: 'run-1', runs: ['run-1'] }), item('i2', 'planned')])]);
  const step = roadmap.advance(r, { runOf: (id) => (id === 'run-1' ? { status: 'paused' } : null) });
  assert.equal(step.roadmap.state, 'running');
  assert.equal(step.roadmap.pausedBy, null);
  assert.deepEqual(step.start.map((x) => x.id), ['i2']);
});

test('advance (#368): a stage left with only paused runs pauses the roadmap there, pausedAt from env.now, kept once set', () => {
  const runOf = () => ({ status: 'paused' });
  const now = () => new Date('2026-10-13T10:00:00Z');
  const r = plan('running', [stage('s1', [item('i1', 'planned', { runId: 'run-1', runs: ['run-1'] })]), stage('s2', [item('i2', 'planned')])]);
  const step = roadmap.advance(r, { runOf, now });
  assert.equal(step.roadmap.state, 'paused');
  assert.equal(step.roadmap.pausedStage, 's1');
  assert.equal(step.roadmap.pausedBy, null);
  assert.equal(step.roadmap.pausedAt, '2026-10-13T10:00:00.000Z');
  assert.deepEqual(step.start, []);
  const again = roadmap.advance({ ...r, pausedAt: '2026-10-12T08:00:00.000Z' }, { runOf, now });
  assert.equal(again.roadmap.pausedAt, '2026-10-12T08:00:00.000Z');
});

test('pauseStage (#368): the roadmap pauses at that stage, blaming no item and naming no failure', (t) => {
  const dir = tmpDir(t);
  roadmap.writeRoadmap(dir, 'p1', plan('running', [stage('s1', [item('i1', 'planned')]), stage('s2', [item('i2', 'planned')])]));
  roadmap.pauseStage(dir, 'p1', 's1');
  const r = roadmap.readRoadmap(dir, 'p1');
  assert.equal(r.state, 'paused');
  assert.equal(r.pausedStage, 's1');
  assert.equal(r.pausedBy, null);
  assert.doesNotMatch(String(r.error || ''), /fail/i);
});

// ---- Night watch: only the owner resumes ------------------------------------------------------

test('night watch (#368): resuming a paused run is never allowed, and the checklist refuses it', (t) => {
  assert.equal(night.NEVER_ALLOWED.some((n) => n.id === 'resume-paused'), true);
  assert.throws(() => night.savePermissions(tmpDir(t), ['retry', 'resume-paused']), /never allowed/);
});

// ---- The line the screens show ----------------------------------------------------------------

test('pauseLabel (#368): pausing while an agent finishes its turn', () => {
  assert.equal(runProgress.pauseLabel({ state: 'pausing', step: 'develop', agents: ['Developer'] }), 'Pausing: waiting for Developer to finish its turn (develop)');
});

test('pauseLabel (#368): pausing while a step command finishes', () => {
  assert.equal(runProgress.pauseLabel({ state: 'pausing', step: 'suite', command: 'npm test' }), 'Pausing: waiting for npm test to finish (suite)');
});

test('pauseLabel (#368): paused, with the step and the next agent\'s turn', () => {
  assert.match(runProgress.pauseLabel({ state: 'paused', step: 'code_review', next: 'Reviewer', at: '2026-10-13T10:00:00.000Z' }), /^Paused at code_review, next: Reviewer's turn/);
});

// ---- The worktree of a paused run is kept -----------------------------------------------------

test('cleanupWorktrees (#368): a run that ended paused keeps its worktree', async (t) => {
  const f = fixture(t);
  const runsDir = path.join(f.tmp, 'runs');
  const dir = path.join(f.worktrees, '20261013-100000-paused01');
  await prepareWorktree({ repo: f.repo, base: 'main', dir });
  endedRun(runsDir, '20261013-100000-paused01', { summary: { status: 'paused' } });
  const removed = await cleanupWorktrees({ worktreesDir: f.worktrees, runsDir, active: [] });
  assert.deepEqual(removed, []);
  assert.equal(fs.existsSync(dir), true);
});
