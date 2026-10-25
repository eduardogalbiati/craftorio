// #489 the promotion dialog of the Releases screen (apps/desktop/renderer/views/releases/releases.js): "Promote
// to stable" opens it with the suggested stable version (editable) and the version the rc was built
// with; Promote calls api.promoteRelease(projectId, commit, version); a refusal is shown in the
// dialog, which stays open. The page is the real one (test/renderer-app-harness.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./roadmap-status-helpers');
const { loadApp } = require('@multiagent/ui-kit/test/renderer-app-harness');

const candidate = (tag, commit, runId, number, title) => ({ tag, commit, date: '2026-10-13T10:00:00.000Z', runId, issues: [{ number, title }], held: false });
const DATA = {
  projectId: 'p1',
  releases: [{ version: 'v1.2.0', tag: 'v1.2.0', date: '2026-10-10T10:00:00.000Z', issues: [{ number: 12, title: 'Add a health endpoint' }], runs: 1, cost: 1, status: 'shipped' }],
  next: { issues: [], commits: 0, runs: 0, notes: '' },
  line: null,
  run: null,
  stable: { version: 'v1.3.0', bump: 'minor' },
  candidates: [
    candidate('v1.3.0-rc.2', 'c2c2c2c2', 'run-c', 16, 'Export runs as CSV'),
    candidate('v1.3.0-rc.1', 'c1c1c1c1', 'run-b', 15, 'Refund a failed payment'),
  ],
};

async function openPromote(promoteRelease = async () => DATA) {
  const app = loadApp({ api: { listReleases: async () => DATA, holdCandidate: async () => DATA, promoteRelease } });
  await app.boot();
  app.sandbox.CurrentProject.get = () => 'p1'; // the project picked in the sidebar
  app.run("showView('releases')");
  await app.settle(20);
  const btn = H.findAll(String(app.el('#rel-body').innerHTML || ''), (e) => e.attrs['data-testid'] === 'promote-to-stable')[0];
  assert.ok(btn, 'a Promote to stable button');
  const attrs = { ...btn.attrs };
  const dataset = {};
  for (const [k, v] of Object.entries(attrs)) if (k.startsWith('data-')) dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
  await app.click('[data-testid="promote-to-stable"]', { attrs, dataset, within: ['#rel-body'] });
  await app.settle(20);
  return app;
}

const isOpen = (app) => app.el('#rel-promote-modal').classList.contains('hidden') === false;
async function submit(app) {
  app.el('#rel-promote-form').dispatchEvent({ type: 'submit', preventDefault() {} });
  await app.settle(20);
}

test('#489 "Promote to stable" opens the dialog with the suggested stable version and the version the rc was built with', async () => {
  const app = await openPromote();
  assert.equal(isOpen(app), true);
  assert.equal(String(app.el('#rel-promote-version').value), 'v1.3.0');
  assert.match(String(app.el('#rel-promote-built').textContent), /Built as 1\.3\.0\b/);
});

test('#489 Promote calls the service with the candidate\'s commit and the edited version, then closes the dialog', async () => {
  const app = await openPromote();
  app.el('#rel-promote-version').value = 'v1.4.0';
  await submit(app);
  assert.deepEqual(app.callsTo('promoteRelease').map((args) => JSON.stringify(Array.from(args))), ['["p1","c2c2c2c2","v1.4.0"]']);
  assert.equal(isOpen(app), false);
});

test('#489 a refused promotion shows the reason in the dialog, which stays open', async () => {
  const app = await openPromote(async () => { throw new Error('The commit c2c2c2c2 has no release candidate (rc): nothing was tagged.'); });
  await submit(app);
  assert.equal(isOpen(app), true);
  assert.match(String(app.el('#rel-promote-error').textContent), /no release candidate/);
});
