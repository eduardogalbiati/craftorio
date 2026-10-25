// #489 the Releases screen's release candidates (src/renderer/views/releases/releases.js):
// acceptance tests written before the code. The page is the real one (test/renderer-app-harness.js,
// as test/renderer-releases-260.test.js and test/renderer-release-dialog-436.test.js do).
// Contract for the developer:
//   releases:list (api.listReleases) answers `candidates`: [{ tag, commit, date, runId, issues, held }]
//   data-testids the change adds:
//     release-candidate   one per candidate (an rc per merge): its rc tag, its run, its issues
//     promote-to-stable   the candidate's "Promote to stable" button, with data-tag="<rc tag>"
//     hold-candidate      the candidate's "Hold" button, with data-tag="<rc tag>"; a click calls
//                         api.holdCandidate(projectId, tag) (no confirmation)
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./roadmap-status-helpers');
const { loadApp, text } = require('./renderer-app-harness');

const candidate = (tag, commit, runId, number, title) => ({ tag, commit, date: '2026-10-13T10:00:00.000Z', runId, issues: [{ number, title }], held: false });
const DATA = {
  projectId: 'p1',
  releases: [{ version: 'v1.2.0', tag: 'v1.2.0', date: '2026-10-10T10:00:00.000Z', issues: [{ number: 12, title: 'Add a health endpoint' }], runs: 1, cost: 1, status: 'shipped' }],
  next: { issues: [{ number: 15, title: 'Refund a failed payment' }, { number: 16, title: 'Export runs as CSV' }], commits: 0, runs: 2, notes: '## Next' },
  line: null,
  run: null,
  candidates: [
    candidate('v1.3.0-rc.2', 'c2c2c2c2', 'run-c', 16, 'Export runs as CSV'),
    candidate('v1.3.0-rc.1', 'c1c1c1c1', 'run-b', 15, 'Refund a failed payment'),
  ],
};

async function showReleases() {
  const app = loadApp({ api: { listReleases: async () => DATA, holdCandidate: async () => DATA, promoteRelease: async () => DATA } });
  await app.boot();
  app.run("showView('releases')");
  await app.settle(20);
  assert.equal(app.state().view, 'releases');
  return app;
}
const body = (app) => String(app.el('#rel-body').innerHTML || '');
const withId = (id) => (e) => e.attrs['data-testid'] === id;

test('#489 Releases screen lists one candidate per rc with its tag, its run and its issues', async () => {
  const app = await showReleases();
  const html = body(app);
  const rows = H.findAll(html, withId('release-candidate'));
  assert.equal(rows.length, 2);
  const first = text(rows[0].outer);
  assert.equal(first.includes('v1.3.0-rc.2'), true, first);
  assert.equal(first.includes('run-c'), true, first);
  assert.equal(first.includes('#16'), true, first);
  assert.equal(text(rows[1].outer).includes('v1.3.0-rc.1'), true);
});

test('#489 each candidate has "Promote to stable" and "Hold" buttons naming its rc', async () => {
  const app = await showReleases();
  const html = body(app);
  const promote = H.findAll(html, withId('promote-to-stable'));
  const hold = H.findAll(html, withId('hold-candidate'));
  assert.deepEqual(promote.map((b) => b.attrs['data-tag']), ['v1.3.0-rc.2', 'v1.3.0-rc.1']);
  assert.deepEqual(hold.map((b) => b.attrs['data-tag']), ['v1.3.0-rc.2', 'v1.3.0-rc.1']);
  assert.equal(text(promote[0].outer), 'Promote to stable');
  assert.equal(text(hold[0].outer), 'Hold');
});

test('#489 "Hold" on a candidate asks the service to hold that rc', async () => {
  const app = await showReleases();
  const btn = H.findAll(body(app), withId('hold-candidate'))[1];
  assert.ok(btn, 'a second Hold button');
  const attrs = { ...btn.attrs };
  const dataset = {};
  for (const [k, v] of Object.entries(attrs)) if (k.startsWith('data-')) dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
  await app.click('[data-testid="hold-candidate"]', { attrs, dataset, within: ['#rel-body'] });
  await app.settle(20);
  const calls = app.callsTo('holdCandidate').map((args) => JSON.stringify(args));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].includes('v1.3.0-rc.1'), true, calls[0]);
});
