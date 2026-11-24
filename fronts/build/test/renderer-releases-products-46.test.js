// #46 the Releases screen of a project of two products (fronts/build/views/releases/releases.js): a
// release of another product (releases:list gives it with `product`) is never the app's latest one.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./roadmap-status-helpers');
const { loadApp, text } = require('@craftorio/ui-kit/test/renderer-app-harness');

const release = (version, date, more = {}) => ({ version, tag: version, date, issues: [], runs: 1, cost: 1, status: 'shipped', ...more });
const DATA = {
  projectId: 'p1',
  // newest first, as the service gives them
  releases: [
    release('engine-v1.1.0', '2026-11-20T10:00:00.000Z', { product: 'engine' }),
    release('v1.0.0', '2026-11-10T10:00:00.000Z'),
    release('v0.9.0', '2026-11-01T10:00:00.000Z'),
  ],
  next: { issues: [], commits: 0, runs: 0, notes: '## Next' },
  line: null,
  run: null,
};

// the Releases screen with these releases: how many rows it lists, and the tags of the rows with the badge
async function shown(releases) {
  const app = loadApp({ api: { listReleases: async () => ({ ...DATA, releases }) } });
  await app.boot();
  app.run("showView('releases')");
  await app.settle(20);
  const rows = H.findAll(String(app.el('#rel-body').innerHTML || ''), (e) => e.attrs['data-testid'] === 'release-row');
  const latest = rows.filter((r) => r.outer.includes('data-testid="release-latest"')).map((r) => ['engine-v1.1.0', 'v1.0.0', 'v0.9.0'].find((v) => text(r.outer).includes(v)));
  return { rows: rows.length, latest };
}

test('#46 the Latest badge is on the app\'s last release, not on a newer engine one', async () => {
  assert.deepEqual(await shown(DATA.releases), { rows: 3, latest: ['v1.0.0'] });
});

test('#46 a project with releases of the engine only lists them, none with the Latest badge', async () => {
  assert.deepEqual(await shown([DATA.releases[0]]), { rows: 1, latest: [] });
});

test('#46 a project of one product keeps the Latest badge on its newest release', async () => {
  assert.deepEqual(await shown(DATA.releases.slice(1)), { rows: 2, latest: ['v1.0.0'] });
});
