// #281 Undo a roadmap edit, and the roadmap's history. Acceptance tests written before the code.
//
// Interface the developer implements (Node modules, required inside each test):
// NEW packages/engine/domains/roadmap/roadmap-undo.js (pure, no fs):
//   recordEdit(beforeStages, afterStages, label) -> edit: a plain JSON-safe object recording what the
//       edit changed (before / after), its label ("Removed #279") and when.
//   undoEdit(currentStages, edit) -> { ok: true, stages } | { ok: false, reason }
//       stages: the stages as they were before the edit (a removed item and its emptied stage come
//       back, a moved stage goes back, a renamed stage gets its name back), with the CURRENT run state
//       of every item that started meanwhile (status, runId, runs, error kept from currentStages).
//       Refused (ok false, a reason naming the issue "#<n>") when an issue the undo brings back is
//       now planned in another unfinished item (status not done / skipped); currentStages is never
//       mutated.
// NEW packages/engine/domains/roadmap/roadmap-history.js:
//   saveVersion(workspace, projectId, stages, label) -> writes one .json file per version under
//       <workspace>/backlog/<projectId>.roadmap.history/, keeping the last 20 (the oldest go).
//   listVersions(workspace, projectId) -> [{ id, at (ISO time), label }], newest first (versions saved
//       in the same millisecond keep their save order).
//   restoreVersion(workspace, projectId, id, currentStages) -> { ok: true, stages } | { ok: false, reason }
//       the version's stages under the same rule as undoEdit (refused when an issue it brings back is
//       planned in another unfinished item; run state of items that started is kept). It writes no
//       roadmap file (the service saves the stages).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const undo = () => require('../../domains/roadmap/roadmap-undo.js');
const history = () => require('../../domains/roadmap/roadmap-history.js');

const clone = (x) => JSON.parse(JSON.stringify(x));
const ref = (number) => ({ number, title: `Issue ${number}`, url: `https://github.com/o/r/issues/${number}` });
const item = (id, number, extra = {}) => ({ id, workflow: 'feature.yaml', workflowName: 'Local hero', inputs: {}, mock: false, ...ref(number), issues: [ref(number)], status: 'planned', runId: null, runs: [], error: null, ...extra });
const stage = (id, name, items) => ({ id, name, note: '', items });
const BEFORE = () => [
  stage('st1', 'Login', [item('it1', 101), item('it2', 102)]),
  stage('st2', 'Readable statuses', [item('it3', 279)]),
  stage('st3', 'Alerts', [item('it4', 270)]),
];
// what a stage list looks like, to compare: stage ids, names and item ids
const shape = (stages) => JSON.stringify(stages.map((s) => [s.id, s.name, s.items.map((x) => x.id)]));

// ---- undoEdit -----------------------------------------------------------------------------------

test('#281 undo of removing the only item of a stage gives back the stage and the item where they were', () => {
  const { recordEdit, undoEdit } = undo();
  const before = BEFORE();
  const after = [before[0], before[2]]; // #279 removed: its stage went with it (saveStages drops empty stages)
  const out = undoEdit(clone(after), recordEdit(clone(before), clone(after), 'Removed #279'));
  assert.equal(out.ok, true);
  assert.equal(shape(out.stages), shape(before));
  assert.equal(JSON.stringify(out.stages[1].items[0].issues), JSON.stringify([ref(279)]));
});

test('#281 undo of moving a stage restores the order', () => {
  const { recordEdit, undoEdit } = undo();
  const before = BEFORE();
  const after = [before[1], before[0], before[2]];
  const out = undoEdit(clone(after), recordEdit(clone(before), clone(after), 'Moved stage 2 up'));
  assert.equal(out.ok, true);
  assert.deepEqual(Array.from(out.stages, (s) => s.id), ['st1', 'st2', 'st3']);
});

test('#281 undo of renaming a stage restores its name', () => {
  const { recordEdit, undoEdit } = undo();
  const before = BEFORE();
  const after = clone(before);
  after[0].name = 'Authentication';
  const out = undoEdit(clone(after), recordEdit(clone(before), after, 'Renamed stage 1'));
  assert.equal(out.ok, true);
  assert.deepEqual(Array.from(out.stages, (s) => s.name), ['Login', 'Readable statuses', 'Alerts']);
});

test('#281 undo is refused when the issue it brings back is now planned in another unfinished item, and changes nothing', () => {
  const { recordEdit, undoEdit } = undo();
  const before = BEFORE();
  const after = [before[0], before[2]];
  const edit = recordEdit(clone(before), clone(after), 'Removed #279');
  const current = clone(after);
  current[1].items.push(item('it9', 279)); // #279 planned again, elsewhere
  const snapshot = JSON.stringify(current);
  const out = undoEdit(current, edit);
  assert.equal(out.ok, false);
  assert.match(String(out.reason), /#279/);
  assert.equal(JSON.stringify(current), snapshot, 'the current stages are untouched');
});

test('#281 undo keeps the run and state of an item that started between the edit and the undo', () => {
  const { recordEdit, undoEdit } = undo();
  const before = BEFORE();
  const after = clone(before);
  after[0].name = 'Authentication';
  const edit = recordEdit(clone(before), clone(after), 'Renamed stage 1');
  const current = clone(after);
  Object.assign(current[0].items[0], { status: 'running', runId: 'run-9', runs: ['run-9'] });
  const out = undoEdit(current, edit);
  assert.equal(out.ok, true);
  const it1 = out.stages[0].items.find((x) => x.id === 'it1');
  assert.deepEqual([out.stages[0].name, it1.status, it1.runId, Array.from(it1.runs)], ['Login', 'running', 'run-9', ['run-9']]);
});

test('#281 undo of moving an item to another stage puts it back, keeping the run it started meanwhile', () => {
  const { recordEdit, undoEdit } = undo();
  const before = BEFORE();
  const after = clone(before);
  after[1].items.push(after[0].items.pop()); // it2 (#102) moved from Login to Readable statuses
  const edit = recordEdit(clone(before), clone(after), 'Moved #102 to stage 2');
  const current = clone(after);
  Object.assign(current[1].items[1], { status: 'running', runId: 'run-7', runs: ['run-7'] });
  const out = undoEdit(current, edit);
  assert.equal(out.ok, true);
  assert.equal(shape(out.stages), shape(before));
  const it2 = out.stages[0].items.find((x) => x.id === 'it2');
  assert.deepEqual([it2.status, it2.runId], ['running', 'run-7']);
});

test('#281 undo keeps an item added to the roadmap after the edit', () => {
  const { recordEdit, undoEdit } = undo();
  const before = BEFORE();
  const after = [before[0], before[2]];
  const edit = recordEdit(clone(before), clone(after), 'Removed #279');
  const current = clone(after);
  current[1].items.push(item('it9', 300)); // added later, to the Alerts stage
  const out = undoEdit(current, edit);
  assert.equal(out.ok, true);
  assert.deepEqual(Array.from(out.stages, (s) => s.id), ['st1', 'st2', 'st3']);
  assert.equal(out.stages.some((s) => s.items.some((x) => x.id === 'it9')), true, 'the item added since is still there');
});

// ---- the history ----------------------------------------------------------------------------------

const tmpWorkspace = () => fs.mkdtempSync(path.join(os.tmpdir(), 'roadmap-history-'));
const historyDir = (ws) => path.join(ws, 'backlog', 'p1.roadmap.history');

test('#281 history: 25 saves keep the last 20 versions, one .json file each, under backlog/<project>.roadmap.history/', () => {
  const { saveVersion, listVersions } = history();
  const ws = tmpWorkspace();
  try {
    for (let i = 1; i <= 25; i++) saveVersion(ws, 'p1', BEFORE(), `Edit ${i}`);
    const files = fs.readdirSync(historyDir(ws)).filter((f) => f.endsWith('.json'));
    assert.equal(files.length, 20);
    const list = listVersions(ws, 'p1');
    assert.equal(list.length, 20);
    assert.deepEqual([list[0].label, list[19].label], ['Edit 25', 'Edit 6'], 'newest first; the 5 oldest are gone');
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
});

test('#281 history: listVersions names each version with its label and time, newest first', () => {
  const { saveVersion, listVersions } = history();
  const ws = tmpWorkspace();
  try {
    saveVersion(ws, 'p1', BEFORE(), 'Moved stage 2 up');
    saveVersion(ws, 'p1', BEFORE().slice(1), 'Removed #279');
    const list = listVersions(ws, 'p1');
    assert.deepEqual(Array.from(list, (v) => v.label), ['Removed #279', 'Moved stage 2 up']);
    assert.deepEqual(Array.from(list, (v) => typeof v.id === 'string' && v.id.length > 0 && !Number.isNaN(Date.parse(v.at))), [true, true]);
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
});

test('#281 history: restoreVersion gives back a version\'s stages, keeping the run state of items that started', () => {
  const { saveVersion, listVersions, restoreVersion } = history();
  const ws = tmpWorkspace();
  try {
    saveVersion(ws, 'p1', BEFORE(), 'Before removing #279');
    const current = [BEFORE()[0], BEFORE()[2]];
    Object.assign(current[0].items[1], { status: 'running', runId: 'run-7', runs: ['run-7'] });
    const out = restoreVersion(ws, 'p1', listVersions(ws, 'p1')[0].id, current);
    assert.equal(out.ok, true);
    assert.equal(shape(out.stages), shape(BEFORE()));
    const it2 = out.stages[0].items.find((x) => x.id === 'it2');
    assert.deepEqual([it2.status, it2.runId], ['running', 'run-7']);
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
});

test('#281 history: restoreVersion follows the undo rule: refused when an issue it brings back is planned elsewhere', () => {
  const { saveVersion, listVersions, restoreVersion } = history();
  const ws = tmpWorkspace();
  try {
    saveVersion(ws, 'p1', BEFORE(), 'Before removing #279');
    const current = [BEFORE()[0], stage('st9', 'Elsewhere', [item('it9', 279)])];
    const out = restoreVersion(ws, 'p1', listVersions(ws, 'p1')[0].id, current);
    assert.equal(out.ok, false);
    assert.match(String(out.reason), /#279/);
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
});
