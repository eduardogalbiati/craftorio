// #349 acceptance: src/shared/roadmap-model.js owns the roadmap's rules (states, isFinished,
// currentStage, unfinishedItems, stageProgress, allowedActions); it is pure and dual-loaded
// (require, and a <script> that sets window.RoadmapModel). The module is loaded inside each test
// so this file runs before it exists.
// allowedActions(roadmap, stage, item) is read as: one entry per action (start, resume, pause,
// edit, skip, retry, disable, move), each { allowed: boolean, reason: string } with a non-empty
// reason when it is not allowed; an object keyed by action name or an array of { action, ... }.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const MODEL = path.join(__dirname, '..', 'src', 'shared', 'roadmap-model.js');
const load = () => require(MODEL);

const freeze = (o) => {
  if (o && typeof o === 'object') {
    Object.values(o).forEach(freeze);
    Object.freeze(o);
  }
  return o;
};
const item = (id, status, extra = {}) => ({ id, workflow: 'software-development', inputs: {}, mock: true, number: Number(id.replace(/\D/g, '')) || 1, status, runId: status === 'running' ? `run-${id}` : null, runs: [], error: null, ...extra });
const stage = (id, items, extra = {}) => ({ id, name: id, note: '', items, ...extra });
const roadmap = (state, stages, extra = {}) => freeze({ state, simulated: true, error: null, pausedBy: null, scope: null, stages, updatedAt: null, ...extra });

const ids = (items) => Array.from(items, (x) => x.id);
const actions = (result) => {
  const out = {};
  const entries = Array.isArray(result) ? result.map((a) => [a.action || a.name || a.id, a]) : Object.entries(result || {});
  for (const [name, a] of entries) out[String(name).toLowerCase()] = { allowed: !!(a && (a.allowed ?? a.ok)), reason: (a && a.reason) || '' };
  return out;
};
const allowed = (acts, name) => {
  assert.ok(acts[name], `allowedActions has no "${name}" entry`);
  assert.equal(acts[name].allowed, true, `${name} should be allowed`);
};
const refused = (acts, name, pattern) => {
  assert.ok(acts[name], `allowedActions has no "${name}" entry`);
  assert.equal(acts[name].allowed, false, `${name} should not be allowed`);
  assert.equal(typeof acts[name].reason, 'string');
  assert.ok(acts[name].reason.trim().length > 0, `${name} has no reason`);
  if (pattern) assert.match(acts[name].reason, pattern);
};

test('the model lists the roadmap states and the item states', () => {
  const m = load();
  const states = m.STATES || m.ROADMAP_STATES;
  assert.deepEqual([...states].sort(), ['done', 'paused', 'planned', 'running']);
  assert.deepEqual([...m.ITEM_STATES].sort(), ['done', 'failed', 'planned', 'running', 'skipped']);
});

test('isFinished: done and skipped items are finished, the others are not', () => {
  const { isFinished } = load();
  assert.equal(isFinished(item('a1', 'done')), true);
  assert.equal(isFinished(item('a2', 'skipped')), true);
  for (const status of ['planned', 'running', 'failed']) assert.equal(isFinished(item('a3', status)), false, status);
});

test('currentStage of a planned roadmap is its first stage with an unfinished item', () => {
  const { currentStage } = load();
  assert.equal(currentStage(roadmap('planned', [stage('s1', [item('i1', 'planned')]), stage('s2', [item('i2', 'planned')])])), 0);
  assert.equal(currentStage(roadmap('planned', [stage('s1', [item('i1', 'done'), item('i2', 'skipped')]), stage('s2', [item('i3', 'planned')])])), 1);
});

test('currentStage is -1 when nothing is left, and for an empty roadmap', () => {
  const { currentStage } = load();
  assert.equal(currentStage(roadmap('done', [stage('s1', [item('i1', 'done')]), stage('s2', [item('i2', 'skipped')])])), -1);
  assert.equal(currentStage(roadmap('planned', [])), -1);
  assert.equal(currentStage({}), -1);
});

test('currentStage of a running roadmap is the stage of its running item', () => {
  const { currentStage } = load();
  const r = roadmap('running', [stage('s1', [item('i1', 'done')]), stage('s2', [item('i2', 'running'), item('i3', 'done')]), stage('s3', [item('i4', 'planned')])]);
  assert.equal(currentStage(r), 1);
});

test('currentStage of a roadmap paused by a failure stays at the failed item\'s stage', () => {
  const { currentStage } = load();
  const r = roadmap('paused', [stage('s1', [item('i1', 'done')]), stage('s2', [item('i2', 'failed', { error: 'tests failed' })])], { pausedBy: 'i2', error: 'Stage 2: #2 failed.' });
  assert.equal(currentStage(r), 1);
});

test('currentStage of a roadmap paused by hand is unchanged by the pause', () => {
  const { currentStage } = load();
  const r = roadmap('paused', [stage('s1', [item('i1', 'done'), item('i2', 'planned')]), stage('s2', [item('i3', 'planned')])]);
  assert.equal(currentStage(r), 0);
});

test('currentStage skips a disabled stage (#284)', () => {
  const { currentStage } = load();
  const r = roadmap('running', [stage('s1', [item('i1', 'planned')], { disabled: true }), stage('s2', [item('i2', 'planned')])]);
  assert.equal(currentStage(r), 1);
  assert.equal(currentStage(roadmap('running', [stage('s1', [item('i1', 'planned')], { disabled: true })])), -1);
});

test('currentStage ignores the scope: the stage run on its own is the scope\'s business (#141, #237)', () => {
  const { currentStage } = load();
  const r = roadmap('running', [stage('s1', [item('i1', 'planned')]), stage('s2', [item('i2', 'running')])], { scope: { stage: 's2' } });
  assert.equal(currentStage(r), 0);
});

test('currentStage of a live roadmap: -1 once every stage is done, the refilled stage after a refill (#164)', () => {
  const { currentStage, unfinishedItems } = load();
  const live = { live: true, liveSince: '2026-10-01T10:00:00.000Z', liveRefill: { status: 'added', at: '2026-10-01T11:00:00.000Z', added: 1 } };
  const drained = roadmap('running', [stage('s1', [item('i1', 'done')])], live);
  assert.equal(currentStage(drained), -1);
  assert.deepEqual(ids(unfinishedItems(drained)), []);
  const refilled = roadmap('running', [stage('s1', [item('i1', 'done')]), stage('s2', [item('i2', 'planned')])], live);
  assert.equal(currentStage(refilled), 1);
});

test('currentStage passes a release cut line once its stage\'s items are finished (#260)', () => {
  const { currentStage } = load();
  const r = roadmap('paused', [stage('s1', [item('i1', 'done')], { release: { name: 'v1.2.0', status: 'held', runId: null } }), stage('s2', [item('i2', 'planned')])], { releaseHold: 's1' });
  assert.equal(currentStage(r), 1);
});

test('unfinishedItems lists the planned, running and failed items of enabled stages, in order', () => {
  const { unfinishedItems } = load();
  const r = roadmap('paused', [
    stage('s1', [item('i1', 'done'), item('i2', 'failed'), item('i3', 'skipped')]),
    stage('s2', [item('i4', 'running'), item('i5', 'planned')]),
    stage('s3', [item('i6', 'planned')], { disabled: true }),
  ], { pausedBy: 'i2' });
  assert.deepEqual(ids(unfinishedItems(r)), ['i2', 'i4', 'i5']);
  assert.deepEqual(ids(unfinishedItems(roadmap('planned', []))), []);
});

test('stageProgress counts the finished items of a stage', () => {
  const { stageProgress } = load();
  const p = stageProgress(stage('s1', [item('i1', 'done'), item('i2', 'skipped'), item('i3', 'running'), item('i4', 'planned')]));
  assert.equal(p.total, 4);
  assert.equal(p.done, 1);
  assert.equal(p.finished, 2);
  const empty = stageProgress(stage('s2', []));
  assert.equal(empty.total, 0);
  assert.equal(empty.finished, 0);
});

test('the model never changes the roadmap it is given', () => {
  const m = load();
  const r = roadmap('paused', [stage('s1', [item('i1', 'failed')]), stage('s2', [item('i2', 'planned')], { disabled: true })], { pausedBy: 'i1' });
  const before = JSON.stringify(r);
  m.currentStage(r);
  m.unfinishedItems(r);
  m.stageProgress(r.stages[0]);
  m.isFinished(r.stages[0].items[0]);
  m.allowedActions(r, r.stages[0], r.stages[0].items[0]);
  m.allowedActions(r, r.stages[1]);
  m.allowedActions(r);
  assert.equal(JSON.stringify(r), before);
});

test('allowedActions answers every action', () => {
  const { allowedActions } = load();
  const r = roadmap('planned', [stage('s1', [item('i1', 'planned')])]);
  const acts = actions(allowedActions(r, r.stages[0], r.stages[0].items[0]));
  for (const name of ['start', 'resume', 'pause', 'edit', 'skip', 'retry', 'disable', 'move']) {
    assert.ok(acts[name], `no "${name}" entry`);
    assert.equal(typeof acts[name].allowed, 'boolean');
    if (!acts[name].allowed) assert.ok(acts[name].reason.trim().length > 0, `${name} has no reason`);
  }
});

test('allowedActions on a planned roadmap: Start, not Pause or Resume', () => {
  const { allowedActions } = load();
  const acts = actions(allowedActions(roadmap('planned', [stage('s1', [item('i1', 'planned')])])));
  allowed(acts, 'start');
  refused(acts, 'pause');
  refused(acts, 'resume');
});

test('allowedActions on an empty roadmap: Start says to add items first', () => {
  const { allowedActions } = load();
  refused(actions(allowedActions(roadmap('planned', []))), 'start');
});

test('allowedActions on a running roadmap: Pause, not Start or Resume', () => {
  const { allowedActions } = load();
  const acts = actions(allowedActions(roadmap('running', [stage('s1', [item('i1', 'running'), item('i2', 'planned')])])));
  allowed(acts, 'pause');
  refused(acts, 'start');
  refused(acts, 'resume');
});

test('allowedActions on a roadmap paused by hand: Resume, not Pause', () => {
  const { allowedActions } = load();
  const acts = actions(allowedActions(roadmap('paused', [stage('s1', [item('i1', 'planned')])])));
  allowed(acts, 'resume');
  refused(acts, 'pause');
});

test('allowedActions on a scoped paused roadmap: Resume (that stage only)', () => {
  const { allowedActions } = load();
  const r = roadmap('paused', [stage('s1', [item('i1', 'planned')]), stage('s2', [item('i2', 'planned')])], { scope: { stage: 's2' } });
  allowed(actions(allowedActions(r)), 'resume');
});

test('allowedActions on the item that paused the roadmap by failing: Retry, Skip and Edit', () => {
  const { allowedActions } = load();
  const r = roadmap('paused', [stage('s1', [item('i1', 'done'), item('i2', 'failed', { error: 'tests failed', runs: ['run-old'] })])], { pausedBy: 'i2', error: 'Stage 1: #2 failed.' });
  const acts = actions(allowedActions(r, r.stages[0], r.stages[0].items[1]));
  allowed(acts, 'retry');
  allowed(acts, 'skip');
  allowed(acts, 'edit');
  allowed(acts, 'resume');
});

test('allowedActions on a planned item: Edit and Move, not Retry', () => {
  const { allowedActions } = load();
  const r = roadmap('planned', [stage('s1', [item('i1', 'planned'), item('i2', 'planned')])]);
  const acts = actions(allowedActions(r, r.stages[0], r.stages[0].items[1]));
  allowed(acts, 'edit');
  allowed(acts, 'move');
  refused(acts, 'retry');
});

test('allowedActions on a running item: no Edit, Move, Skip or Retry, each with its reason', () => {
  const { allowedActions } = load();
  const r = roadmap('running', [stage('s1', [item('i1', 'running'), item('i2', 'planned')])]);
  const acts = actions(allowedActions(r, r.stages[0], r.stages[0].items[0]));
  for (const name of ['edit', 'move', 'skip', 'retry']) refused(acts, name);
});

test('allowedActions on a done item: no Edit or Retry', () => {
  const { allowedActions } = load();
  const r = roadmap('running', [stage('s1', [item('i1', 'done')]), stage('s2', [item('i2', 'running')])]);
  const acts = actions(allowedActions(r, r.stages[0], r.stages[0].items[0]));
  refused(acts, 'edit');
  refused(acts, 'retry');
});

test('allowedActions on a stage: Disable while nothing runs in it, refused with the reason while an item runs', () => {
  const { allowedActions } = load();
  const r = roadmap('running', [stage('s1', [item('i1', 'running')]), stage('s2', [item('i2', 'planned')])]);
  refused(actions(allowedActions(r, r.stages[0])), 'disable', /running/i);
  allowed(actions(allowedActions(r, r.stages[1])), 'disable');
});

test('allowedActions on a disabled stage: Start says to enable it first', () => {
  const { allowedActions } = load();
  const r = roadmap('planned', [stage('s1', [item('i1', 'planned')], { disabled: true }), stage('s2', [item('i2', 'planned')])]);
  refused(actions(allowedActions(r, r.stages[0])), 'start', /disabled|enable/i);
});

test('allowedActions on a stage: Enable only on a disabled stage, Disable only on an enabled one', () => {
  const { allowedActions } = load();
  const r = roadmap('planned', [stage('s1', [item('i1', 'planned')], { disabled: true }), stage('s2', [item('i2', 'planned')])]);
  const off = actions(allowedActions(r, r.stages[0]));
  allowed(off, 'enable');
  refused(off, 'disable');
  const on = actions(allowedActions(r, r.stages[1]));
  refused(on, 'enable');
  allowed(on, 'disable');
});

test('allowedActions: Stop applies to a running or paused roadmap, not to a planned one', () => {
  const { allowedActions } = load();
  const stages = () => [stage('s1', [item('i1', 'planned')])];
  refused(actions(allowedActions(roadmap('planned', stages()))), 'stop');
  allowed(actions(allowedActions(roadmap('paused', stages()))), 'stop');
  allowed(actions(allowedActions(roadmap('running', stages()))), 'stop');
});

test('allowedActions: Resume is refused on a paused roadmap with no stage', () => {
  const { allowedActions } = load();
  refused(actions(allowedActions(roadmap('paused', []))), 'resume');
});

test('allowedActions on a stage: Run this stage gives the stage menu\'s reasons', () => {
  const { allowedActions } = load();
  const disabled = roadmap('planned', [stage('s1', [item('i1', 'planned')], { disabled: true })]);
  assert.equal(actions(allowedActions(disabled, disabled.stages[0])).start.reason, 'This stage is disabled: enable it first');
  const running = roadmap('running', [stage('s1', [item('i1', 'running')]), stage('s2', [item('i2', 'planned')])]);
  assert.equal(actions(allowedActions(running, running.stages[1])).start.reason, 'The roadmap is running: pause or stop it first');
  const over = roadmap('paused', [stage('s1', [item('i1', 'done'), item('i2', 'failed')]), stage('s2', [item('i3', 'planned')])]);
  assert.equal(actions(allowedActions(over, over.stages[0])).start.reason, 'No planned item in this stage');
  allowed(actions(allowedActions(over, over.stages[1])), 'start');
});

test('scopedStage is the index of the scope\'s stage while it has work, -1 otherwise (#237)', () => {
  const { scopedStage } = load();
  const stages = (extra = {}) => [stage('s1', [item('i1', 'planned')]), stage('s2', [item('i2', 'planned')], extra)];
  assert.equal(scopedStage(roadmap('paused', stages(), { scope: { stage: 's2' } })), 1);
  assert.equal(scopedStage(roadmap('paused', stages())), -1);
  assert.equal(scopedStage(roadmap('paused', stages({ disabled: true }), { scope: { stage: 's2' } })), -1);
  assert.equal(scopedStage(roadmap('paused', [stage('s1', [item('i1', 'planned')]), stage('s2', [item('i2', 'done'), item('i3', 'skipped')])], { scope: { stage: 's2' } })), -1);
  assert.equal(scopedStage(roadmap('paused', stages(), { scope: { stage: 'gone' } })), -1);
});

test('loaded by a <script>, the model sets window.RoadmapModel', () => {
  const sandbox = { window: {} };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(MODEL, 'utf8'), sandbox, { filename: 'roadmap-model.js' });
  const model = sandbox.window.RoadmapModel || sandbox.RoadmapModel;
  assert.equal(typeof model, 'object');
  for (const fn of ['isFinished', 'currentStage', 'unfinishedItems', 'stageProgress', 'allowedActions']) assert.equal(typeof model[fn], 'function', fn);
  assert.equal(model.currentStage(roadmap('planned', [stage('s1', [item('i1', 'done')]), stage('s2', [item('i2', 'planned')])])), 1);
});

test('the renderer loads the model before the Roadmap and Dashboard views', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  const at = (src) => html.indexOf(`<script src="${src}"></script>`);
  assert.ok(at('../shared/roadmap-model.js') >= 0, 'index.html does not load ../shared/roadmap-model.js');
  assert.ok(at('../shared/roadmap-model.js') < at('views/backlog/backlog-roadmap.js'));
  assert.ok(at('../shared/roadmap-model.js') < at('views/dashboard/dashboard.js'));
});
