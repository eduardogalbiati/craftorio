// #287 A Roadmap edit saved from a stale screen never overwrites changes made elsewhere. Acceptance
// tests written before the code, through the service (the roadmap channels and the Product Owner's
// inbox), in a scratch workspace; everything runs simulated (MULTIAGENT_SIMULATION_ONLY=1).
//
// Interface the developer implements:
// - roadmap:save (api.saveRoadmap) takes a 4th parameter `base`: the roadmap's `updatedAt` the screen
//   read (params ['projectId', 'stages', 'label', 'base']). No base: as before (the stages replace the
//   stored ones). base equal to the stored updatedAt: as before.
// - base older than the stored roadmap: the edit (what the sent stages change against the roadmap
//   the screen read, by item and stage id) is applied to the STORED stages when it is a change of one
//   thing (an item's inputs, mode or workflow; a stage's name, note, cut line or switch; a move; a
//   removal); everything else stays as stored. The answer is the Backlog as usual (with `edit` when it
//   changed something); one history version is kept with the save's label, and Undo takes back only
//   that edit.
// - when the edit cannot be applied (the item or stage is gone, or the same field changed on both
//   sides): nothing is written, no version, no `edit`, and the answer is the current Backlog with
//   `conflict: { reason }` (a sentence for the owner). It resolves; it does not reject.
// - writers through the service (the owner's save, the Product Owner's / Oracle's roadmap actions)
//   never interleave: one read-modify-write at a time per project; nothing a writer did not mean to
//   change is dropped.
// The "elsewhere" change of the evidence is written by an outside writer (a script calling
// packages/engine/domains/roadmap/roadmap.js saveStages on the file, as the evidence's script did), never seen by the screen.
process.env.MULTIAGENT_MOCK_DELAY_SCALE ??= '0.05';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const roadmaps = require('../../domains/roadmap/roadmap');
const { ISSUE_WORKFLOW, makeService, roadmapProject } = require('./helpers');

const clone = (x) => JSON.parse(JSON.stringify(x));
const numbersIn = (item) => (item.issues || []).map((i) => (typeof i === 'object' ? i.number : i));
const later = () => new Promise((r) => setTimeout(r, 15)); // the outside write gets a newer updatedAt
const shape = (stages) => JSON.stringify(stages.map((s) => [s.id, s.name, s.note || '', s.items.map((x) => [x.id, numbersIn(x), x.inputs])]));
const itemWith = (stages, number) => stages.flatMap((s) => s.items).find((x) => numbersIn(x).includes(number));
const stored = (ws, id) => roadmaps.readRoadmap(ws.backlog, id);

// A project whose roadmap holds, as in the evidence: stage One = one item for #282 + #284 (model opus),
// stage Two = one item for #290. `read` is the roadmap as the screen read it (backlog:get).
async function evidence(t, name) {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [282, 284, 285, 290, 291], name);
  await api['roadmap:save']({
    projectId: p.id,
    stages: [
      { name: 'One', note: '', items: [{ workflow: 'fixture-issue.yaml', issues: [282, 284], mock: true, inputs: { model: 'opus' } }] },
      { name: 'Two', note: '', items: [{ workflow: 'fixture-issue.yaml', issues: [290], mock: true, inputs: {} }] },
    ],
    label: 'Planned',
  });
  const read = (await api['backlog:get']({ projectId: p.id })).roadmap;
  assert.ok(read.updatedAt, 'the roadmap the screen reads carries its updatedAt');
  // the outside writer: changes the stored stages without the screen knowing
  const outside = async (change) => {
    await later();
    const now = clone(stored(ws, p.id).stages);
    change(now);
    roadmaps.saveStages(ws.backlog, p.id, now);
    assert.notEqual(stored(ws, p.id).updatedAt, read.updatedAt, 'the outside write is newer than what the screen read');
  };
  return { service, api, ws, p, read, outside };
}

const versionsOf = async (api, p) => (await api['roadmap:versions']({ projectId: p.id })).length;

// ---- the evidence sequence ------------------------------------------------------------------------

test('#287 evidence: an issue appended to an item while its Edit form is open, then Save: the item has the form\'s inputs AND the appended issue', async (t) => {
  const { api, ws, p, read, outside } = await evidence(t, 'stale-evidence');
  const form = clone(read.stages); // the Edit form opens on the roadmap as read
  await outside((now) => { now[0].items[0].issues.push(285); });
  form[0].items[0].inputs = { model: 'sonnet' }; // the owner changes the developer model, then Save
  const out = await api['roadmap:save']({ projectId: p.id, stages: form, label: 'Edited the inputs of #282 + #284', base: read.updatedAt });
  assert.equal(out.conflict, undefined, `a change of one thing is merged, not refused: ${JSON.stringify(out.conflict)}`);
  const item = itemWith(stored(ws, p.id).stages, 282);
  assert.deepEqual([...numbersIn(item)].sort(), [282, 284, 285], 'the issue appended elsewhere is kept');
  assert.equal(item.inputs.model, 'sonnet', 'the form\'s inputs are saved');
  assert.deepEqual(stored(ws, p.id).stages.map((s) => s.name), ['One', 'Two'], 'the other stage is untouched');
});

test('#287 a stale rename of a stage keeps the item added elsewhere to another stage', async (t) => {
  const { api, ws, p, read, outside } = await evidence(t, 'stale-rename');
  const screen = clone(read.stages);
  await outside((now) => { now[1].items.push({ workflow: 'fixture-issue.yaml', issues: [291], mock: true, inputs: {} }); });
  screen[0].name = 'Login';
  const out = await api['roadmap:save']({ projectId: p.id, stages: screen, label: 'Renamed stage 1', base: read.updatedAt });
  assert.equal(out.conflict, undefined, JSON.stringify(out.conflict));
  const now = stored(ws, p.id).stages;
  assert.deepEqual(now.map((s) => s.name), ['Login', 'Two']);
  assert.deepEqual(now[1].items.map(numbersIn), [[290], [291]], 'the item added elsewhere is kept');
});

test('#287 a stale removal of an item removes only that item: what was added elsewhere stays', async (t) => {
  const { api, ws, p, read, outside } = await evidence(t, 'stale-remove');
  const screen = clone(read.stages);
  await outside((now) => { now[0].items[0].issues.push(285); });
  screen.splice(1, 1); // the owner removes #290 (its stage goes with it)
  const out = await api['roadmap:save']({ projectId: p.id, stages: screen, label: 'Removed #290 from the roadmap', base: read.updatedAt });
  assert.equal(out.conflict, undefined, JSON.stringify(out.conflict));
  const now = stored(ws, p.id).stages;
  assert.equal(itemWith(now, 290), undefined, 'the removed item is gone');
  assert.deepEqual([...numbersIn(itemWith(now, 282))].sort(), [282, 284, 285], 'the change made elsewhere stays');
});

// ---- refused: nothing saved, with the reason -------------------------------------------------------

test('#287 a stage removed elsewhere while its item is edited: the save is refused with the reason, and nothing is written', async (t) => {
  const { api, ws, p, read, outside } = await evidence(t, 'stale-stage-gone');
  const form = clone(read.stages);
  await outside((now) => { now.splice(0, 1); }); // stage One (and its item) removed elsewhere
  const before = stored(ws, p.id);
  const versions = await versionsOf(api, p);
  form[0].items[0].inputs = { model: 'sonnet' };
  const out = await api['roadmap:save']({ projectId: p.id, stages: form, label: 'Edited the inputs of #282 + #284', base: read.updatedAt });
  assert.equal(typeof out?.conflict?.reason, 'string', 'the answer says the save was refused');
  assert.ok(out.conflict.reason.trim().length > 0, 'with a reason for the owner');
  assert.equal(out.edit, undefined, 'a refused save is no edit');
  const after = stored(ws, p.id);
  assert.equal(shape(after.stages), shape(before.stages), 'the stored stages are unchanged');
  assert.equal(after.updatedAt, before.updatedAt, 'the file was not written');
  assert.equal(await versionsOf(api, p), versions, 'no history version');
  assert.deepEqual(out.roadmap.stages.map((s) => s.name), ['Two'], 'the answer carries the stored roadmap, for the screen to reload');
});

test('#287 the same field changed on both sides: the save is refused with the reason and the value set elsewhere stays', async (t) => {
  const { api, ws, p, read, outside } = await evidence(t, 'stale-same-field');
  const form = clone(read.stages);
  await outside((now) => { now[0].items[0].inputs = { model: 'haiku' }; });
  form[0].items[0].inputs = { model: 'sonnet' };
  const out = await api['roadmap:save']({ projectId: p.id, stages: form, label: 'Edited the inputs of #282 + #284', base: read.updatedAt });
  assert.equal(typeof out?.conflict?.reason, 'string');
  assert.ok(out.conflict.reason.trim().length > 0);
  assert.equal(itemWith(stored(ws, p.id).stages, 282).inputs.model, 'haiku');
});

test('#287 a save whose read is no longer known (more than 50 writes since) is refused, nothing written', async (t) => {
  const { api, ws, p, read } = await evidence(t, 'stale-forgotten');
  for (let n = 0; n < 51; n++) {
    const now = clone(stored(ws, p.id).stages);
    now[1].note = `outside write ${n}`;
    roadmaps.saveStages(ws.backlog, p.id, now);
  }
  const before = stored(ws, p.id);
  const form = clone(read.stages);
  form[0].items[0].inputs = { model: 'sonnet' };
  const out = await api['roadmap:save']({ projectId: p.id, stages: form, label: 'Edited the inputs of #282 + #284', base: read.updatedAt });
  assert.match(out?.conflict?.reason || '', /no longer known/, JSON.stringify(out?.conflict));
  const after = stored(ws, p.id);
  assert.equal(after.updatedAt, before.updatedAt, 'the file was not written');
  assert.equal(itemWith(after.stages, 282).inputs.model, 'opus');
});

test('#287 two writes in a row get strictly increasing updatedAt values, so a save based on the first is told apart', async (t) => {
  const { ws, p } = await evidence(t, 'increasing');
  const now = clone(stored(ws, p.id).stages);
  now[1].note = 'a';
  roadmaps.saveStages(ws.backlog, p.id, now);
  const first = stored(ws, p.id).updatedAt;
  now[1].note = 'b';
  roadmaps.saveStages(ws.backlog, p.id, now);
  const second = stored(ws, p.id).updatedAt;
  assert.ok(Date.parse(second) > Date.parse(first), `${second} is after ${first}`);
});

// ---- the Oracle's regroup with a base -------------------------------------------------------------------

test('#287 an Oracle roadmap.regroup based on an older read applies only its change: an issue appended since stays', async (t) => {
  const { api, ws, p, read, outside } = await evidence(t, 'oracle-regroup-stale');
  const stages = clone(read.stages);
  await outside((now) => { now[0].items[0].issues.push(285); });
  stages[1].name = 'Later';
  const out = await api['po:request']({ projectId: p.id, kind: 'roadmap.regroup', params: { stages, base: read.updatedAt }, reason: 'test', from: 'oracle', ref: 'regroup-stale', mock: true });
  assert.equal(out.ok, true, out.error);
  const now = stored(ws, p.id).stages;
  assert.deepEqual(now.map((s) => s.name), ['One', 'Later']);
  assert.deepEqual([...numbersIn(itemWith(now, 282))].sort(), [282, 284, 285], 'the issue appended elsewhere is kept');
});

test('#287 an Oracle roadmap.regroup whose stage was removed since is refused with the reason, nothing written', async (t) => {
  const { api, ws, p, read, outside } = await evidence(t, 'oracle-regroup-gone');
  const stages = clone(read.stages);
  await outside((now) => { now.splice(0, 1); });
  const before = stored(ws, p.id);
  stages[0].name = 'Renamed';
  const out = await api['po:request']({ projectId: p.id, kind: 'roadmap.regroup', params: { stages, base: read.updatedAt }, reason: 'test', from: 'oracle', ref: 'regroup-gone', mock: true });
  assert.equal(out.ok, false);
  assert.match(out.error || '', /Nothing was saved/);
  assert.equal(stored(ws, p.id).updatedAt, before.updatedAt, 'the file was not written');
});

// ---- as before ----------------------------------------------------------------------------------------

test('#287 a fresh save (base equal to the stored updatedAt) replaces the stages as before, several changes at once', async (t) => {
  const { api, ws, p, read } = await evidence(t, 'fresh-save');
  const screen = clone(read.stages);
  screen[0].name = 'Login';
  screen[0].items[0].inputs = { model: 'sonnet' };
  screen.splice(1, 1);
  const out = await api['roadmap:save']({ projectId: p.id, stages: screen, label: 'Edited the roadmap', base: read.updatedAt });
  assert.equal(out.conflict, undefined);
  const now = stored(ws, p.id).stages;
  assert.deepEqual(now.map((s) => s.name), ['Login']);
  assert.equal(now[0].items[0].inputs.model, 'sonnet');
});

// ---- history and Undo ------------------------------------------------------------------------------

test('#287 a merged save records one history version with its label, and its Undo takes back only that edit', async (t) => {
  const { api, ws, p, read, outside } = await evidence(t, 'stale-undo');
  const form = clone(read.stages);
  await outside((now) => { now[0].items[0].issues.push(285); });
  const versions = await versionsOf(api, p);
  form[0].items[0].inputs = { model: 'sonnet' };
  const out = await api['roadmap:save']({ projectId: p.id, stages: form, label: 'Edited the inputs of #282 + #284', base: read.updatedAt });
  assert.equal(out.conflict, undefined, JSON.stringify(out.conflict));
  assert.equal(out.edit?.label, 'Edited the inputs of #282 + #284');
  const list = await api['roadmap:versions']({ projectId: p.id });
  assert.equal(list.length, versions + 1, 'one version for the merged save');
  assert.equal(list[0].label, 'Edited the inputs of #282 + #284');
  assert.deepEqual([...numbersIn(itemWith(stored(ws, p.id).stages, 282))].sort(), [282, 284, 285], 'the merged save kept the appended issue');

  // another change elsewhere after the save: Undo leaves it too
  await outside((now) => { now[1].items.push({ workflow: 'fixture-issue.yaml', issues: [291], mock: true, inputs: {} }); });
  await api['roadmap:undo']({ projectId: p.id, editId: out.edit.id });
  const now = stored(ws, p.id).stages;
  const item = itemWith(now, 282);
  assert.equal(item.inputs.model, 'opus', 'Undo takes the inputs back');
  assert.deepEqual([...numbersIn(item)].sort(), [282, 284, 285], 'the issue appended elsewhere survives the Undo');
  assert.ok(itemWith(now, 291), 'the item added after the save survives the Undo');
});

// ---- two writers at once -----------------------------------------------------------------------------

test('#287 two owner saves at once from the same read (two windows), on different things: both changes are kept', async (t) => {
  const { api, ws, p, read } = await evidence(t, 'two-saves');
  const a = clone(read.stages);
  a[0].name = 'Login';
  const b = clone(read.stages);
  b[1].items[0].inputs = { model: 'sonnet' };
  const [outA, outB] = await Promise.all([
    api['roadmap:save']({ projectId: p.id, stages: a, label: 'Renamed stage 1', base: read.updatedAt }),
    api['roadmap:save']({ projectId: p.id, stages: b, label: 'Edited the inputs of #290', base: read.updatedAt }),
  ]);
  assert.equal(outA.conflict, undefined, JSON.stringify(outA.conflict));
  assert.equal(outB.conflict, undefined, JSON.stringify(outB.conflict));
  const now = stored(ws, p.id).stages;
  assert.equal(now[0].name, 'Login');
  assert.equal(itemWith(now, 290).inputs.model, 'sonnet');
});

test('#287 an owner save and a Product Owner append at once: the appended item and the owner\'s edit are both kept', async (t) => {
  const { api, ws, p, read } = await evidence(t, 'save-and-append');
  const screen = clone(read.stages);
  screen[0].name = 'Login';
  const [saved, added] = await Promise.all([
    api['roadmap:save']({ projectId: p.id, stages: screen, label: 'Renamed stage 1', base: read.updatedAt }),
    api['po:request']({ projectId: p.id, kind: 'roadmap.add', params: { issues: [291], workflow: 'fixture-issue.yaml' }, reason: 'test', from: 'oracle', ref: 'add-291', mock: true }),
  ]);
  assert.equal(saved.conflict, undefined, JSON.stringify(saved.conflict));
  assert.equal(added.ok, true, added.error);
  const now = stored(ws, p.id).stages;
  assert.equal(now[0].name, 'Login');
  assert.ok(itemWith(now, 291), 'the appended item is kept');
  assert.ok(itemWith(now, 282) && itemWith(now, 290), 'nothing else is dropped');
});

test('#287 a Product Owner move and append at once (the Oracle\'s requests): both land, no item is dropped', async (t) => {
  const { api, ws, p } = await evidence(t, 'move-and-append');
  const it290 = itemWith(stored(ws, p.id).stages, 290);
  const request = (kind, params, ref) => api['po:request']({ projectId: p.id, kind, params, reason: 'test', from: 'oracle', ref, mock: true });
  const [moved, added] = await Promise.all([
    request('roadmap.move', { itemId: it290.id, stage: 1 }, 'move-290'),
    request('roadmap.add', { issues: [291], workflow: 'fixture-issue.yaml' }, 'add-291'),
  ]);
  assert.equal(moved.ok, true, moved.error);
  assert.equal(added.ok, true, added.error);
  const now = stored(ws, p.id).stages;
  assert.deepEqual(now[0].items.map(numbersIn).map((n) => n.slice().sort()), [[282, 284], [290]], '#290 moved to stage 1');
  assert.ok(itemWith(now, 291), 'the appended item is kept');
});
