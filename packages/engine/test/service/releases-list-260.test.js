// Releases (#260), the service's channels behind the Releases screen (packages/engine/service/areas/releases.js):
// releases:list without a project and for a project (its history newest first, the next release, the
// cut line waiting), and releases:notes, which keeps the owner's notes of the next release. And what
// a cut line's release run leaves when it ended (its recorded summary, no real run here): a shipped
// one is recorded once and opens the line, a held one pauses the roadmap until Resume checks again.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const roadmaps = require('../../domains/roadmap/roadmap');
const { ISSUE_WORKFLOW, makeService, roadmapProject, until } = require('./helpers');

// A roadmap whose first stage is done and carries a cut line that a release run (`runId`, ended with
// `summary`) was started for; the second stage waits behind the line.
async function roadmapAtLine(t, name, runId, summary) {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1, 2], name);
  await api['roadmap:save']({
    projectId: p.id,
    stages: [
      { name: 'One', items: [{ workflow: 'fixture-issue.yaml', number: 1, mock: true }], release: { name: 'v1.0' } },
      { name: 'Two', items: [{ workflow: 'fixture-issue.yaml', number: 2, mock: true }] },
    ],
  });
  const stage = roadmaps.readRoadmap(ws.backlog, p.id).stages[0];
  roadmaps.updateRoadmap(ws.backlog, p.id, (r) => ({ ...r, stages: r.stages.map((s) => (s.id === stage.id ? { ...s, items: s.items.map((x) => ({ ...x, status: 'done' })) } : s)) }));
  roadmaps.setRelease(ws.backlog, p.id, stage.id, { status: 'running', runId });
  fs.mkdirSync(path.join(ws.runs, runId), { recursive: true });
  fs.writeFileSync(path.join(ws.runs, runId, 'summary.json'), JSON.stringify({
    run_id: runId, workflow: 'Release', project_id: p.id, mock: false, inputs: { version: 'v1.0' }, sessions: [],
    started_at: '2026-03-01T10:00:00.000Z', finished_at: '2026-03-01T10:30:00.000Z', cost_usd: 2, ...summary,
  }));
  return { service, api, ws, p };
}
const hasIssue = (r, n) => (r.issues || []).some((i) => i.number === n);

test('releases:list without a project is empty (#260)', (t) => {
  const { api } = makeService(t);
  assert.deepEqual(api['releases:list']({ projectId: null }), { projectId: null, releases: [], next: null, line: null, run: null });
});

test('releases:list gives the history newest first, the next release and the cut line waiting; releases:notes keeps the notes (#260)', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1, 2], 'releases-list');
  fs.mkdirSync(ws.releases, { recursive: true });
  fs.writeFileSync(path.join(ws.releases, `${p.id}.json`), JSON.stringify({ releases: [
    { version: 'v0.8', date: '2026-01-01T00:00:00Z', issues: [], status: 'shipped' },
    { version: 'v0.9', date: '2026-02-01T00:00:00Z', issues: [{ number: 1, title: 'One' }], status: 'shipped' },
  ] }));
  await api['roadmap:save']({
    projectId: p.id,
    stages: [
      { name: 'One', items: [{ workflow: 'fixture-issue.yaml', number: 1, mock: true }], release: { name: 'v1.0' } },
      { name: 'Two', items: [{ workflow: 'fixture-issue.yaml', number: 2, mock: true }] },
    ],
  });

  const list = api['releases:list']({ projectId: p.id });
  assert.deepEqual(list.releases.map((r) => r.version), ['v0.9', 'v0.8']);
  assert.equal(list.line.name, 'v1.0');
  assert.equal(list.next.version, 'v1.0', 'the next release is named by the cut line waiting');
  assert.equal(list.next.generated, true);
  assert.ok(list.next.notes.includes('v1.0'));
  assert.equal(list.run, null);

  const saved = api['releases:notes']({ projectId: p.id, notes: 'Fixes the rename crash.' });
  assert.equal(saved.next.notes, 'Fixes the rename crash.');
  assert.equal(saved.next.generated, false);
  assert.equal(api['releases:list']({ projectId: p.id }).next.notes, 'Fixes the rename crash.');
  assert.deepEqual(api['releases:list']({ projectId: p.id }).releases.map((r) => r.version), ['v0.9', 'v0.8'], 'the history is kept');
  // the Backlog marks the issue the release shipped
  const issue = api['backlog:get']({ projectId: p.id }).issues.find((i) => i.number === 1);
  assert.equal(issue.released, 'v0.9');
  assert.throws(() => api['releases:notes']({ projectId: 'no-such-project', notes: 'x' }));
});

test('a cut line whose release run shipped is recorded once in the history and lets the next stage start (#260)', async (t) => {
  const runId = '20260301-100000-rel00001';
  const { api, ws, p } = await roadmapAtLine(t, 'release-shipped', runId, {
    status: 'success',
    release: { tag: 'v1.0', base: 'main', commit: '0123456789abcdef0123456789abcdef01234567', pushed: true, issues: [1] },
    steps: { unit: { visits: 1, output: { kind: 'suite', status: 'pass', passed: 40, failed: 0 } }, e2e: { visits: 1, output: { kind: 'suite', status: 'pass' } } },
  });
  await api['roadmap:start']({ projectId: p.id, simulated: true });
  await until(() => api['runs:active']().some((r) => hasIssue(r, 2)));
  assert.equal(api['roadmap:get']({ projectId: p.id }).stages[0].release.status, 'shipped');
  const { releases } = api['releases:list']({ projectId: p.id });
  assert.equal(releases.length, 1);
  const [release] = releases;
  assert.equal(release.version, 'v1.0');
  assert.equal(release.status, 'shipped');
  assert.deepEqual(release.issues.map((i) => i.number), [1]);
  assert.deepEqual(release.runs, [runId]);
  assert.equal(release.cost, 2);
  assert.deepEqual(release.tests, { unit: { status: 'pass', passed: 40, failed: 0 }, e2e: { status: 'pass' } });
  assert.ok(release.notes.includes('v1.0'));
  assert.equal(fs.existsSync(path.join(ws.releases, `${p.id}.json`)), true);
  // settled again by a later dispatch: still one release
  await api['roadmap:save']({ projectId: p.id, stages: api['roadmap:get']({ projectId: p.id }).stages });
  assert.equal(api['releases:list']({ projectId: p.id }).releases.length, 1);
});

test('a cut line whose release run was held pauses the roadmap; Resume checks the release again (#260)', async (t) => {
  const { api, p } = await roadmapAtLine(t, 'release-held', '20260301-100000-rel00002', { status: 'cancelled' });
  await api['roadmap:start']({ projectId: p.id, simulated: true });
  const paused = api['roadmap:get']({ projectId: p.id });
  assert.equal(paused.state, 'paused');
  assert.match(paused.error, /v1\.0 was not shipped \(on hold\)/);
  assert.equal(paused.stages[0].release.status, 'held');
  assert.equal(paused.stages[1].items[0].status, 'planned');
  assert.equal(api['runs:active']().length, 0, 'nothing starts behind the line');
  assert.deepEqual(api['releases:list']({ projectId: p.id }).releases, [], 'nothing is recorded');

  await api['roadmap:start']({ projectId: p.id, simulated: true });
  await until(() => api['runs:active']().some((r) => r.file === 'release.yaml'));
  const again = api['roadmap:get']({ projectId: p.id });
  assert.equal(again.stages[0].release.status, 'running');
  assert.notEqual(again.stages[0].release.runId, '20260301-100000-rel00002');
  assert.equal(api['runs:active']().some((r) => hasIssue(r, 2)), false);
  // the project folder has no test:e2e script: the release run skips the E2E suite
  const release = api['runs:active']().find((r) => r.file === 'release.yaml');
  assert.equal(release.inputs.e2e_suite, 'skip');
  assert.equal(release.inputs.version, 'v1.0');
});

test('a release run of the cut line\'s name started from the Releases screen takes the line and the paused roadmap waits for it (#260)', async (t) => {
  const { api, p } = await roadmapAtLine(t, 'release-by-hand', '20260301-100000-rel00003', { status: 'failed' });
  await api['roadmap:start']({ projectId: p.id, simulated: true });
  assert.equal(api['roadmap:get']({ projectId: p.id }).stages[0].release.status, 'failed');
  assert.equal(api['roadmap:get']({ projectId: p.id }).state, 'paused');

  const started = await api['releases:start']({ projectId: p.id, version: 'v1.0', simulated: true });
  const roadmap = api['roadmap:get']({ projectId: p.id });
  assert.deepEqual([roadmap.stages[0].release.status, roadmap.stages[0].release.runId], ['running', started.runId]);
  assert.equal(roadmap.state, 'running');
  assert.equal(roadmap.error, null);
  assert.equal(api['releases:list']({ projectId: p.id }).run.runId, started.runId);
  await assert.rejects(api['releases:start']({ projectId: p.id, version: 'v1.0', simulated: true }), /in progress/);
  // a release of another name is not the line's
  assert.equal(api['runs:active']().some((r) => hasIssue(r, 2)), false);
});
