// Releases (#260), the service's channels behind the Releases screen (src/service/areas/releases.js):
// releases:list without a project and for a project (its history newest first, the next release, the
// cut line waiting), and releases:notes, which keeps the owner's notes of the next release.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ISSUE_WORKFLOW, makeService, roadmapProject } = require('./helpers');

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
