// Releases (#260) in the UI: a Releases screen (Code & Build › Releases, between Roadmap and
// Sessions) lists the releases (version, date, issues, runs, cost, test results, notes) and the next
// release, whose notes are editable before Ship; the Roadmap shows a cut line ("Release here" with
// its name) after a stage carrying `release: { name }`, and none without one.
// The page is the real one (test/renderer-app-harness.js loads index.html's scripts in a vm sandbox;
// nothing is parsed, the tests read the markup strings the views produce). The Roadmap is
// fronts/build/views/backlog/backlog-roadmap.js loaded alone, as in test/renderer-backlog-roadmap-view.test.js.
// New modules (packages/ui-kit/nav-groups.js's entries, views/releases/) are reached inside each test.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
// a page file by its page-relative name, in whichever layer holds it (the UI kit, a front, the page folder)
const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
const vm = require('vm');
const { withI18n } = require('@craftorio/shared/test/i18n-sandbox.js');
const { loadApp, navEntries, text } = require('@craftorio/ui-kit/test/renderer-app-harness');

const NAV_GROUPS = pageFileOf('nav-groups.js');
const navGroups = () => {
  delete require.cache[require.resolve(NAV_GROUPS)];
  return require(NAV_GROUPS);
};

// ---- the menu ---------------------------------------------------------------------------------

test('the menu has Releases in Code & Build, between Roadmap and Sessions (#260)', () => {
  const { navLayout } = navGroups();
  const app = loadApp();
  const code = navLayout(navEntries(app.defs)).find((b) => b.group === 'build');
  assert.ok(code, 'a Code & Build group');
  const labels = code.items.map((i) => text(i.label)).filter((l) => ['Roadmap', 'Releases', 'Sessions'].includes(l));
  assert.deepEqual(labels, ['Roadmap', 'Releases', 'Sessions']);
  const entry = code.items.find((i) => text(i.label) === 'Releases');
  assert.equal(entry.id, 'releases', 'Releases opens the releases screen');
});

// ---- the Releases screen ----------------------------------------------------------------------

const RELEASES = {
  releases: [{
    version: 'v1.2.0', date: '2026-10-01T10:00:00Z', issues: [{ number: 12, title: 'Add a /health endpoint' }],
    runs: 3, cost: 4.5, tests: { unit: 'pass', e2e: 'pass' }, notes: 'Health check',
  }],
  next: { issues: [{ number: 15, title: 'Refund a failed payment' }], commits: 4, runs: 2, notes: '## Next' },
};

// every markup string the page holds: the views' own markup, what was written into an element, and what was inserted
function pageMarkup(app) {
  const parts = [];
  for (const def of app.defs.values()) parts.push(String(def.markup || ''));
  for (const el of [...app.elements.values(), ...app.created]) {
    parts.push(String(el.innerHTML || ''));
    for (const [, html] of el.inserted || []) parts.push(String(html || ''));
  }
  return parts.join('\n');
}

// the markup of the first element with that data-testid, up to the next release element (or 2000 chars)
function block(html, testid) {
  const at = html.indexOf(`data-testid="${testid}"`);
  if (at < 0) return null;
  const next = html.indexOf('data-testid="release-', at + testid.length + 13);
  return html.slice(at, next < 0 ? at + 2000 : Math.min(next, at + 2000));
}

async function showReleases() {
  const app = loadApp({ api: { listReleases: async () => RELEASES } });
  await app.boot();
  assert.ok(app.defs.has('releases'), 'a view registered under the id "releases"');
  app.run("showView('releases')");
  await app.settle(20);
  assert.equal(app.state().view, 'releases');
  return app;
}

test('the Releases screen lists a release with its version and its issues (#260)', async () => {
  const app = await showReleases();
  assert.ok(app.callsTo('listReleases').length > 0, 'the screen asked for the releases');
  const row = block(pageMarkup(app), 'release-row');
  assert.ok(row, 'a release row (data-testid="release-row")');
  assert.ok(text(row).includes('v1.2.0'), `the row shows the version: ${text(row)}`);
  assert.ok(text(row).includes('#12'), `the row shows its issues: ${text(row)}`);
});

test('the Releases screen shows the next release with its issues (#260)', async () => {
  const app = await showReleases();
  const next = block(pageMarkup(app), 'release-next');
  assert.ok(next, 'the next release (data-testid="release-next")');
  assert.ok(text(next).includes('Refund a failed payment'), `the next release shows its issues: ${text(next)}`);
});

test('the next release\'s notes are editable in a textarea before Ship (#260)', async () => {
  const app = await showReleases();
  const markup = pageMarkup(app);
  const tag = /<textarea\b[^>]*data-testid="release-notes"[^>]*>/.exec(markup);
  const made = app.created.find((el) => el.tagName === 'TEXTAREA' && el.attrs['data-testid'] === 'release-notes');
  assert.ok(tag || made, 'a textarea[data-testid="release-notes"]');
  if (tag) assert.doesNotMatch(tag[0], /\b(readonly|disabled)\b/, 'the notes can be edited');
  if (made) assert.ok(!made.disabled && !('readonly' in made.attrs), 'the notes can be edited');
});

// ---- the Roadmap's cut line -------------------------------------------------------------------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const read = (...p) => fs.readFileSync(pageFileOf(p.join('/')), 'utf8');

// backlog-roadmap.js alone in a sandbox (copied from test/renderer-backlog-roadmap-view.test.js)
function loadRoadmap() {
  const store = new Map();
  const sandbox = {
    esc,
    state: {},
    errMsg: (e) => String(e?.message || e),
    devMode: () => false,
    confirmDialog: async () => true,
    keptWorkDialog: async () => null,
    choiceDialog: async () => null,
    fmtDur: (ms) => (ms == null ? 'unknown' : `${Math.round(ms / 1000)}s`),
    robotAvatar: () => '<svg class="robot"></svg>',
    agentLabel: (agent) => agent,
    PERSON_SVG: '<svg class="person"></svg>',
    ENGINE_SVG: '<svg class="engine"></svg>',
    progressChip: (c) => esc(c.name),
    ChainModel: { chainBadgesHtml: () => '' },
    scheduleRender: () => {},
    markdownHtml: (s) => esc(s),
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    document: { querySelector: () => null, querySelectorAll: () => [] },
    api: {
      listWorkflows: async () => [],
      saveRoadmap: async (projectId, stages) => ({ roadmap: { state: 'planned', stages } }),
      startRoadmap: async () => ({ roadmap: { state: 'running', stages: [] } }),
      roadmapItem: async () => ({ roadmap: { state: 'planned', stages: [] } }),
      setRoadmapLive: async () => ({ roadmap: { state: 'running', stages: [] } }),
    },
  };
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  sandbox.window = sandbox;
  sandbox.window.showRun = () => {};
  vm.createContext(withI18n(sandbox));
  vm.runInContext(read('status-pill.js'), sandbox);
  vm.runInContext(read('..', '..', '..', 'packages', 'shared', 'run-progress-model.js'), sandbox);
  vm.runInContext(read('..', '..', '..', 'packages', 'shared', 'default-workflow.js'), sandbox);
  vm.runInContext(read('..', '..', '..', 'packages', 'shared', 'roadmap-model.js'), sandbox); // the real RoadmapModel (#349)
  vm.runInContext(read('..', '..', '..', 'packages', 'shared', 'run-inputs.js'), sandbox);
  vm.runInContext(read('workflow-inputs.js'), sandbox);
  if (fs.existsSync(pageFileOf('estimates.js'))) vm.runInContext(read('estimates.js'), sandbox);
  vm.runInContext(read('menu.js'), sandbox); // the shared menu (#748)
  vm.runInContext(read('views', 'backlog', 'backlog-roadmap-meters.js'), sandbox); // the meters, the timer and the Progress cell (split out on 2026-11-27)
  vm.runInContext(read('views', 'backlog', 'backlog-roadmap.js'), sandbox);
  return sandbox.window.BacklogRoadmap;
}

const ref = (number, title) => ({ number, title, url: `https://github.com/o/r/issues/${number}` });
const item = (id, status, number, title) => ({ id, status, workflow: 'feature.yaml', inputs: {}, issues: [ref(number, title)] });
// two open stages; `release` on the first one when given
function roadmapData(release) {
  return {
    roadmap: { state: 'planned', stages: [
      { id: 'st1', name: '', note: '', ...(release ? { release } : {}), items: [item('i1', 'planned', 1, 'Planned one')] },
      { id: 'st2', name: '', note: '', items: [item('i2', 'planned', 2, 'Planned two')] },
    ] },
    issues: [{ number: 1, title: 'Planned one', labels: [] }, { number: 2, title: 'Planned two', labels: [] }],
    epics: [],
  };
}
const sectionAt = (html, n) => html.search(new RegExp(`<section class="rm-stage[^"]*"[^>]*data-stage="${n}"`));

test('the Roadmap shows a "Release here" cut line with its name between the stage carrying it and the next one (#260)', () => {
  const html = loadRoadmap().html(roadmapData({ name: 'v1.0' }), () => {}, { showAll: true, epic: '' });
  const first = sectionAt(html, 0);
  const second = sectionAt(html, 1);
  assert.ok(first >= 0 && second > first, 'both stages are rendered');
  const at = html.indexOf('data-testid="roadmap-cut-line"');
  assert.ok(at >= 0, 'a cut line (data-testid="roadmap-cut-line")');
  assert.ok(at > first && at < second, 'the cut line sits after the first stage, before the second');
  const line = text(html.slice(at, second));
  assert.ok(line.includes('Release here'), `the cut line says "Release here": ${line}`);
  assert.ok(line.includes('v1.0'), `the cut line shows its name: ${line}`);
  assert.equal(html.split('data-testid="roadmap-cut-line"').length - 1, 1, 'one cut line');
});

test('the Roadmap without a release shows no cut line (#260)', () => {
  const Roadmap = loadRoadmap();
  const html = Roadmap.html(roadmapData(null), () => {}, { showAll: true, epic: '' });
  assert.ok(sectionAt(html, 1) >= 0, 'the roadmap is rendered');
  assert.equal(html.includes('data-testid="roadmap-cut-line"'), false);
  // and with one, the line appears (so this test is not green before the change)
  const withLine = Roadmap.html(roadmapData({ name: 'v1.0' }), () => {}, { showAll: true, epic: '' });
  assert.ok(withLine.includes('data-testid="roadmap-cut-line"'), 'a stage with a release draws its cut line');
});
