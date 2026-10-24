// #489 the release candidates in the service (src/service/areas/releases.js): acceptance tests
// written before the code. Contract for the developer:
//   listReleases({ projectId }) gains `candidates`: the rcs since the last stable release, newest
//     first, each { tag, commit, runId, issues, held } (from the history file's `candidates`, see
//     test/releases-rc-stable-489.test.js); an rc older than the last stable is not listed.
//   holdCandidate({ projectId, tag, held = true }) → listReleases: puts the candidate on Hold (the
//     train never promotes it) or takes it off.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const loadArea = () => require('../../src/service/areas/releases');

const rc = (tag, commit, date, runId, number) => ({ tag, commit, date, runId, issues: [{ number, title: `Issue ${number}`, labels: ['enhancement'] }] });
const HISTORY = {
  releases: [{ version: 'v1.2.0', tag: 'v1.2.0', date: '2026-10-10T10:00:00.000Z', commit: 'c0c0c0c0', issues: [{ number: 12, title: 'Issue 12' }], runs: ['run-a'], status: 'shipped' }],
  candidates: [
    rc('v1.2.0-rc.1', 'c0c0c0c0', '2026-10-09T10:00:00.000Z', 'run-a', 12),
    rc('v1.3.0-rc.1', 'c1c1c1c1', '2026-10-12T10:00:00.000Z', 'run-b', 15),
    rc('v1.3.0-rc.2', 'c2c2c2c2', '2026-10-13T10:00:00.000Z', 'run-c', 16),
  ],
  next: { notes: '' },
};

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-rel489-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ws = { releases: path.join(root, 'releases'), backlog: path.join(root, 'backlog'), runs: path.join(root, 'runs'), projects: path.join(root, 'projects'), discovery: path.join(root, 'discovery') };
  for (const d of Object.values(ws)) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(ws.projects, 'p1.json'), JSON.stringify({ name: 'demo', folder: root }));
  fs.writeFileSync(path.join(ws.releases, 'p1.json'), JSON.stringify(HISTORY));
  return loadArea()({ ws, active: new Map() });
}

test('#489 listReleases lists the candidates since the last stable, newest first, with their run and issues', (t) => {
  const svc = setup(t);
  const list = svc.listReleases({ projectId: 'p1' }).candidates || [];
  assert.deepEqual(list.map((c) => c.tag), ['v1.3.0-rc.2', 'v1.3.0-rc.1']);
  assert.deepEqual(list.map((c) => c.runId), ['run-c', 'run-b']);
  assert.deepEqual(list.map((c) => (c.issues || []).map((i) => i.number).join(',')), ['16', '15']);
  assert.deepEqual(list.map((c) => !!c.held), [false, false]);
});

test('#489 holdCandidate puts a candidate on Hold and takes it off', async (t) => {
  const svc = setup(t);
  await svc.holdCandidate({ projectId: 'p1', tag: 'v1.3.0-rc.2' });
  const heldOf = () => (svc.listReleases({ projectId: 'p1' }).candidates || []).map((c) => [c.tag, !!c.held]);
  assert.deepEqual(heldOf(), [['v1.3.0-rc.2', true], ['v1.3.0-rc.1', false]]);
  await svc.holdCandidate({ projectId: 'p1', tag: 'v1.3.0-rc.2', held: false });
  assert.deepEqual(heldOf(), [['v1.3.0-rc.2', false], ['v1.3.0-rc.1', false]]);
});
