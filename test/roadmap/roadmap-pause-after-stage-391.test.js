// #391 Roadmap Pause lets the current stage finish: "Pause after this stage" or "Pause now".
// Acceptance tests written before the code, through the service (mock runs only, simulation only:
// the fixture workflow has one mock agent turn and a human gate the TEST answers as the owner).
//
// Assumed interface (the developer implements it; names chosen to match the existing code):
// - Channel `roadmap:pause` (src/service/channels/roadmap.js) takes `after: 'stage' | 'now'` next to
//   `stop` (params ['projectId', 'stop', 'after'], so window.api.pauseRoadmap(projectId, stop, after));
//   nothing passed = 'now' = today's pause. Its schema lists both values and says the default is now.
// - `after: 'stage'` keeps the roadmap running until the current stage is over, then it pauses with
//   #141's end ("Stage N done. …", `scope` cleared); the pending pause is persisted in the roadmap
//   file (the field name is the developer's: the tests only read it back through the Roadmap view).
// - Cancel pause: a new channel `roadmap:cancel-pause` ({ projectId }, window.api.cancelRoadmapPause),
//   named after #368's `run:cancel-pause`: the roadmap runs the whole roadmap again.
// - The Roadmap bar (src/renderer/views/backlog/backlog-roadmap.js), given the roadmap read from the
//   file, shows the badge "Pausing after stage N" and a "Cancel pause" button.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const roadmaps = require('../../src/domains/roadmap/roadmap');
const { ISSUE_WORKFLOW, makeService, roadmapIssue, roadmapProject, until, watchRuns } = require('../service/helpers');
const H = require('../roadmap-status-helpers');

const hasIssue = (r, n) => (r.issues || []).some((i) => i.number === n);
const isRelease = (r) => /release/i.test(`${r.file || ''} ${r.workflow || ''}`);
const ticks = (ms = 500) => new Promise((r) => setTimeout(r, ms));
const ONE_SLOT = { concurrentRuns: { enabled: true, max: 1, perProject: null, countSimulations: true } };

// A simulated roadmap, unnamed stages (so its stages read "Stage 1", "Stage 2"), started, with one
// slot: `stages` = issue numbers per stage, e.g. [[1, 2], [3]] (#2 waits for the slot while #1 runs).
async function started(t, stages, { name, release = null, live = false, issues = null } = {}) {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, stages.flat(), name);
  if (issues) fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({ projectId: p.id, platform: 'github', repo: 'https://github.com/o/r', issues }));
  api['settings:set'](ONE_SLOT);
  const watched = watchRuns(service);
  await api['roadmap:save']({
    projectId: p.id,
    stages: stages.map((numbers, s) => ({
      items: numbers.map((number) => ({ workflow: 'fixture-issue.yaml', number, mock: true })),
      ...(s === 0 && release ? { release } : {}),
    })),
  });
  await api['roadmap:start']({ projectId: p.id, simulated: true });
  if (live) await api['roadmap:live']({ projectId: p.id, on: true });
  await until(() => api['runs:active']().some((r) => hasIssue(r, stages[0][0])));
  const get = () => api['roadmap:get']({ projectId: p.id });
  const runOf = (n) => api['runs:active']().find((r) => hasIssue(r, n));
  // the owner (this test) approves the gate of issue n's run, and waits for the run to end
  const approve = async (n) => {
    await until(() => !!runOf(n));
    const { runId } = runOf(n);
    await until(() => watched.gates.has(runId));
    api['approval:resolve']({ runId, id: watched.gates.get(runId), answer: true });
    await until(() => watched.finished.has(runId));
  };
  return { service, api, ws, p, get, runOf, approve, ...watched };
}

test('#391 Pause after this stage: the stage\'s items still start (also the one waiting for a slot), its gate is never answered for the owner, and stage 2 does not start', async (t) => {
  const { api, p, get, runOf, approve, gates, finished } = await started(t, [[1, 2], [3]], { name: 'pas-stage' });
  await api['roadmap:pause']({ projectId: p.id, after: 'stage' });

  // the run in progress waits at its human gate: nothing answers it
  const run1 = runOf(1).runId;
  await until(() => gates.has(run1));
  await ticks();
  assert.equal(finished.has(run1), false, 'the gate of #1 is still waiting for the owner');
  assert.equal(!!runOf(2), false, '#2 waits for the free slot');

  await approve(1);
  await until(() => !!runOf(2) || get().state === 'paused');
  assert.equal(!!runOf(2), true, '#2 (not started, waiting for a slot) still starts');
  await approve(2);
  await until(() => get().state === 'paused');
  await ticks();
  assert.equal(!!runOf(3), false, 'stage 2 does not start');
  assert.equal(get().stages[1].items[0].status, 'planned');
});

test('#391 Pause after this stage: once the stage is over the roadmap pauses as "Stage 1 done", the scope cleared and nobody to blame (#141\'s end)', async (t) => {
  const { api, p, get, approve } = await started(t, [[1], [2]], { name: 'pas-done' });
  await api['roadmap:pause']({ projectId: p.id, after: 'stage' });
  assert.equal(get().state, 'running', 'the stage still runs while the pause waits for it');
  await approve(1);
  await until(() => get().state === 'paused');
  const r = get();
  assert.match(String(r.error), /^Stage 1 done\./);
  assert.deepEqual([r.pausedBy, r.scope ?? null], [null, null]);
  assert.deepEqual(r.stages.map((s) => s.items[0].status), ['done', 'planned']);
});

test('#391 Pause after this stage: a cut line on this stage does not start its release run; Resume starts it', async (t) => {
  const { api, p, get, approve } = await started(t, [[1], [2]], { name: 'pas-release', release: { name: 'v1.0' } });
  await api['roadmap:pause']({ projectId: p.id, after: 'stage' });
  await approve(1);
  await until(() => get().state === 'paused' || api['runs:active']().some(isRelease));
  await ticks();
  assert.equal(api['runs:active']().some(isRelease), false, 'no release run');
  assert.equal(get().state, 'paused');
  assert.match(String(get().error), /^Stage 1 done\./, 'paused by the end of the stage');
  assert.equal(get().stages[0].release?.status === 'running', false);

  await api['roadmap:start']({ projectId: p.id, simulated: true });
  await until(() => api['runs:active']().some(isRelease));
});

test('#391 Cancel pause: the roadmap runs the whole roadmap again, as if never asked: stage 2 starts when stage 1 is over', async (t) => {
  const { api, p, get, runOf, approve } = await started(t, [[1], [2]], { name: 'pas-cancel' });
  await api['roadmap:pause']({ projectId: p.id, after: 'stage' });
  await api['roadmap:cancel-pause']({ projectId: p.id });
  const r = get();
  assert.deepEqual([r.state, r.scope ?? null, r.error ?? null], ['running', null, null]);
  await approve(1);
  await until(() => !!runOf(2) || get().state !== 'running');
  assert.equal(!!runOf(2), true, 'stage 2 started');
  assert.equal(get().state, 'running');
});

test('#391 Pause after this stage: a failure inside the stage still pauses at once (blaming the item), and the next item of the stage does not start', async (t) => {
  const { api, p, get, runOf } = await started(t, [[1, 2], [3]], { name: 'pas-fail' });
  await api['roadmap:pause']({ projectId: p.id, after: 'stage' });
  const failedId = get().stages[0].items[0].id;
  api['run:stop']({ runId: runOf(1).runId });
  await until(() => get().state === 'paused');
  await ticks();
  const r = get();
  assert.equal(r.pausedBy, failedId);
  assert.match(String(r.error), /#1/);
  assert.doesNotMatch(String(r.error), /Stage 1 done/);
  assert.deepEqual([!!runOf(2), !!runOf(3)], [false, false]);
});

test('#391 Pause after this stage on the last stage of a live roadmap: no refill starts, it pauses as "Stage 1 done"', async (t) => {
  const pickable = { ...roadmapIssue(2), body: 'x'.repeat(130), labels: [{ name: 'complexity:1' }] };
  const { api, p, get, approve } = await started(t, [[1]], { name: 'pas-live', live: true, issues: [roadmapIssue(1), pickable] });
  assert.equal(get().live, true);
  await api['roadmap:pause']({ projectId: p.id, after: 'stage' });
  await approve(1);
  await until(() => get().state !== 'running');
  await ticks();
  const r = get();
  assert.equal(r.state, 'paused');
  assert.match(String(r.error), /^Stage 1 done\./);
  assert.equal(r.stages.length, 1, 'no stage added by a refill');
});

for (const [label, extra] of [['no option', {}], ["after: 'now'", { after: 'now' }]]) {
  test(`#391 Pause now (${label}): today's pause, nothing new starts, not even the current stage's next item`, async (t) => {
    const { api, p, get, runOf, approve } = await started(t, [[1, 2], [3]], { name: `pas-now-${extra.after || 'none'}` });
    await api['roadmap:pause']({ projectId: p.id, ...extra });
    assert.equal(get().state, 'paused');
    await approve(1);
    await ticks();
    assert.deepEqual([!!runOf(2), !!runOf(3), get().state], [false, false, 'paused']);
    assert.equal(get().stages[0].items[1].status, 'planned');
  });
}

test('#391 the pending after-stage pause is persisted in the roadmap file: the bar drawn from the file shows "Pausing after stage 1" and "Cancel pause"', async (t) => {
  const { api, ws, p } = await started(t, [[1], [2]], { name: 'pas-persist' });
  await api['roadmap:pause']({ projectId: p.id, after: 'stage' });
  const fromFile = roadmaps.readRoadmap(ws.backlog, p.id); // the file, as a reload reads it
  const { R } = H.loadRoadmap();
  const html = R.html({ roadmap: fromFile, issues: [] }, () => {}, { showAll: true, since: 'total' });
  const bar = H.findEl(html, (e) => e.attrs['data-testid'] === 'roadmap-bar');
  assert.ok(bar, 'the roadmap bar is rendered');
  assert.match(H.visibleText(bar.inner), /Pausing after stage 1/);
  const buttons = H.findAll(bar.outer, (e) => e.name === 'button').map((e) => H.visibleText(e.inner).trim());
  assert.equal(buttons.includes('Cancel pause'), true, `buttons: ${buttons.join(' | ')}`);
});

test('#391 the bar\'s Cancel pause (drawn from the file) asks the service to take the pause back (window.api.cancelRoadmapPause)', async (t) => {
  const { api, ws, p } = await started(t, [[1], [2]], { name: 'pas-cancel-btn' });
  await api['roadmap:pause']({ projectId: p.id, after: 'stage' });
  const d = { roadmap: roadmaps.readRoadmap(ws.backlog, p.id), issues: [] };
  const { R, sandbox } = H.loadRoadmap();
  const calls = [];
  sandbox.api.cancelRoadmapPause = async (...a) => { calls.push(a.map(String)); return { roadmap: { state: 'running', stages: [] }, issues: [] }; };
  const html = R.html(d, () => {}, { showAll: true, since: 'total' });
  const { ctx } = H.makeCtx();
  await R.onClick(H.clickOn(html, (e) => e.name === 'button' && H.visibleText(e.inner).trim() === 'Cancel pause'), ctx, d);
  assert.deepEqual(calls, [['p1']]);
});

test('#391 channel roadmap:pause: its schema takes after (stage | now), says the default is now, and the service refuses another value', async (t) => {
  const stub = new Proxy(function stub() {}, { get: () => stub, apply: () => undefined });
  const ctx = new Proxy({}, { get: (target, key) => (key === 'ws' ? null : stub) });
  const entry = require('../../src/service/channels/roadmap')(ctx).find((e) => e.channel === 'roadmap:pause');
  assert.equal(entry.params.includes('after'), true, `params: ${entry.params.join(', ')}`);
  const after = JSON.stringify(entry.schema.params.properties.after || null);
  assert.deepEqual([/"stage"/.test(after), /"now"/.test(after)], [true, true], after);
  assert.match(after, /default/i);

  const { api, p } = await started(t, [[1]], { name: 'pas-schema' });
  await assert.rejects(async () => api['roadmap:pause']({ projectId: p.id, after: 'later' }));
});
