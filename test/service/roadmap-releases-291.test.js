// #291: the releases the Roadmap draws (src/service/areas/releases.js roadmapReleases): the shipped
// history with its release run's stations, the release runs not shipped since (checking, waiting at
// Ship in another app, on hold), and { error } when the history cannot be read (src/releases.js
// historyError).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const releases = require('../../src/releases');
const area = require('../../src/service/areas/releases');

function setup(t, history) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-rel291-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ws = { releases: path.join(root, 'releases'), backlog: path.join(root, 'backlog'), runs: path.join(root, 'runs'), projects: path.join(root, 'projects') };
  for (const d of Object.values(ws)) fs.mkdirSync(d, { recursive: true });
  if (history !== undefined) fs.writeFileSync(path.join(ws.releases, 'p1.json'), typeof history === 'string' ? history : JSON.stringify(history));
  return { ws, svc: area({ ws, active: new Map() }) };
}
const project = { id: 'p1', name: 'demo', folder: '.' };
const trail = (...steps) => steps.map((s) => (typeof s === 'string' ? { step: s, status: 'done' } : s));
const relRun = (runId, extra) => ({ runId, file: 'release.yaml', startedAt: '2026-10-06T10:00:00Z', durationMs: 3e6, costUsd: 2.46, mock: false, ...extra });

test('historyError: none for a missing or valid file, the parse error for a broken one', (t) => {
  const { ws } = setup(t);
  assert.equal(releases.historyError(ws.releases, 'p1'), null);
  fs.writeFileSync(path.join(ws.releases, 'p1.json'), '{ "releases": [ }');
  assert.match(releases.historyError(ws.releases, 'p1'), /JSON|Unexpected/);
  fs.writeFileSync(path.join(ws.releases, 'p1.json'), JSON.stringify({ releases: [] }));
  assert.equal(releases.historyError(ws.releases, 'p1'), null);
});

test('roadmapReleases: an unreadable history is { error, releases: [] }', (t) => {
  const { svc } = setup(t, '{ broken');
  const out = svc.roadmapReleases(project, []);
  assert.ok(out.error);
  assert.deepEqual(out.releases, []);
});

test('roadmapReleases: a shipped release gets its release run\'s stations; release runs since the last release are pending, newest per version', (t) => {
  const { svc } = setup(t, { releases: [{ version: '1.0.0', tag: '1.0.0', date: '2026-10-05T14:14:00Z', runs: ['r1', 'rel-1'], issues: [{ number: 1 }], cost: 9, status: 'shipped' }] });
  const list = [
    { runId: 'r1', file: 'software-development.yaml', status: 'success' },
    relRun('rel-1', { status: 'success', startedAt: '2026-10-05T13:10:00Z', progress: trail('unit', 'fix', 'unit', 'e2e', 'ship') }),
    relRun('rel-2', { status: 'running', inputs: { version: '1.1.0' }, progress: trail('unit', 'e2e', { step: 'ship', status: 'waiting' }) }),
    relRun('rel-old', { status: 'failed', startedAt: '2026-10-06T09:00:00Z', inputs: { version: '1.1.0' } }),
    relRun('rel-3', { status: 'cancelled', startedAt: '2026-10-06T08:00:00Z', inputs: { version: '1.0.1' } }),
  ];
  const out = svc.roadmapReleases(project, list).releases;
  assert.deepEqual(out.map((x) => [x.version, x.status, x.runId]), [['1.0.0', 'shipped', 'rel-1'], ['1.1.0', 'waiting', 'rel-2'], ['1.0.1', 'held', 'rel-3']]);
  assert.deepEqual(out[0].stations, { unit: 2, e2e: 1, fix: 1, ship: 1 });
  assert.equal(out[1].station, 'ship');
  assert.equal(out[1].runCost, 2.46);
  assert.ok(Array.isArray(out[1].runs), 'a pending release holds the next release\'s runs');
});

test('roadmapReleases: a release run started without a version is "(no version)", never the filter\'s "next"', (t) => {
  const { svc } = setup(t, { releases: [] });
  const out = svc.roadmapReleases(project, [relRun('rel-x', { status: 'running', inputs: {} })]).releases;
  assert.deepEqual(out.map((x) => [x.version, x.runId]), [['(no version)', 'rel-x']]);
});
