// #281 through the service: the roadmap channels keep the version before each owner edit
// (backlog/<project>.roadmap.history/), answer with the edit Undo takes back, undo only the last
// edit, and restore an earlier version, with ids and run states kept. The pure rules are in
// test/roadmap-undo-281.test.js (the acceptance tests); this file covers the wiring.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ISSUE_WORKFLOW, makeService, roadmapProject } = require('./helpers');

const item = (number) => ({ workflow: 'fixture-issue.yaml', number, mock: true });
const shape = (out) => out.roadmap.stages.map((s) => [s.id, s.name, s.items.map((x) => x.id)]);

async function planned(t, name) {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1, 2, 3], name);
  const first = await api['roadmap:save']({
    projectId: p.id,
    stages: [{ name: 'One', items: [item(1), item(2)] }, { name: 'Two', items: [item(3)] }],
  });
  return { api, ws, p, first };
}

test('#281 roadmap:save answers with the edit, keeps the version before it, and roadmap:undo puts the removed item and its stage back with their ids', async (t) => {
  const { api, ws, p, first } = await planned(t, 'undo-remove');
  const removed = await api['roadmap:save']({ projectId: p.id, stages: [first.roadmap.stages[0]], label: 'Removed #3 from the roadmap' });
  assert.equal(removed.roadmap.stages.length, 1);
  assert.equal(removed.edit.label, 'Removed #3 from the roadmap');
  assert.ok(removed.edit.id);

  const versions = await api['roadmap:versions']({ projectId: p.id });
  assert.equal(versions[0].label, 'Removed #3 from the roadmap');
  assert.ok(fs.existsSync(path.join(ws.backlog, `${p.id}.roadmap.history`)), 'the history sits beside the roadmap file');

  const back = await api['roadmap:undo']({ projectId: p.id, editId: removed.edit.id });
  assert.deepEqual(shape(back), shape(first));
  // undone once: the same edit cannot be undone again
  await assert.rejects(() => api['roadmap:undo']({ projectId: p.id, editId: removed.edit.id }), /Only the last edit/);
});

test('#281 only the last edit can be undone: an older edit id is refused and nothing changes', async (t) => {
  const { api, p, first } = await planned(t, 'undo-last');
  const removed = await api['roadmap:save']({ projectId: p.id, stages: [first.roadmap.stages[0]], label: 'Removed #3 from the roadmap' });
  const renamed = await api['roadmap:save']({ projectId: p.id, stages: [{ ...removed.roadmap.stages[0], name: 'Renamed' }], label: 'Renamed stage 1' });
  await assert.rejects(() => api['roadmap:undo']({ projectId: p.id, editId: removed.edit.id }), /Only the last edit/);
  const now = await api['roadmap:get']({ projectId: p.id });
  assert.deepEqual(now.stages.map((s) => s.name), ['Renamed']);
  const back = await api['roadmap:undo']({ projectId: p.id, editId: renamed.edit.id });
  assert.deepEqual(back.roadmap.stages.map((s) => s.name), ['One']);
});

test('#281 a save that changes nothing is no edit: no version, nothing to undo', async (t) => {
  const { api, p, first } = await planned(t, 'undo-noop');
  const before = (await api['roadmap:versions']({ projectId: p.id })).length;
  const same = await api['roadmap:save']({ projectId: p.id, stages: first.roadmap.stages, label: 'Moved #1 up' });
  assert.equal(same.edit, undefined);
  assert.equal((await api['roadmap:versions']({ projectId: p.id })).length, before);
});

test('#281 Clear can be undone, and roadmap:restore-version puts an earlier version back (itself an edit that can be undone)', async (t) => {
  const { api, p, first } = await planned(t, 'undo-clear');
  const cleared = await api['roadmap:clear']({ projectId: p.id });
  assert.equal(cleared.roadmap.stages.length, 0);
  assert.equal(cleared.edit.label, 'Cleared the roadmap');
  const back = await api['roadmap:undo']({ projectId: p.id, editId: cleared.edit.id });
  assert.deepEqual(shape(back), shape(first));

  const removed = await api['roadmap:save']({ projectId: p.id, stages: [back.roadmap.stages[0]], label: 'Removed #3 from the roadmap' });
  const version = (await api['roadmap:versions']({ projectId: p.id })).find((v) => v.label === 'Removed #3 from the roadmap');
  const restored = await api['roadmap:restore-version']({ projectId: p.id, versionId: version.id });
  assert.deepEqual(shape(restored), shape(first));
  assert.match(restored.edit.label, /^Restored the roadmap from before "Removed #3/);
  const again = await api['roadmap:undo']({ projectId: p.id, editId: restored.edit.id });
  assert.deepEqual(shape(again), shape(removed));
});

test('#281 a restore is refused, changing nothing, when an issue it brings back is planned in another item now', async (t) => {
  const { api, p, first } = await planned(t, 'undo-refused');
  const removed = await api['roadmap:save']({ projectId: p.id, stages: [first.roadmap.stages[0]], label: 'Removed #3 from the roadmap' });
  // #3 is planned again, as a new item of a new stage
  const replanned = await api['roadmap:save']({ projectId: p.id, stages: [...removed.roadmap.stages, { name: 'Elsewhere', items: [item(3)] }], label: 'Added #3' });
  const version = (await api['roadmap:versions']({ projectId: p.id })).find((v) => v.label === 'Removed #3 from the roadmap');
  await assert.rejects(() => api['roadmap:restore-version']({ projectId: p.id, versionId: version.id }), /#3/);
  assert.deepEqual(shape({ roadmap: await api['roadmap:get']({ projectId: p.id }) }), shape(replanned));
  await assert.rejects(() => api['roadmap:restore-version']({ projectId: p.id, versionId: '0000000000000-0000' }), /no longer kept/);
});
