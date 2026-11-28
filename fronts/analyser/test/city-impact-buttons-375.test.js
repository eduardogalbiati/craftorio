// #375: the buttons that open an issue's impact preview on the project city.
// - The Roadmap view (fronts/build/views/backlog/backlog-roadmap.js, window.BacklogRoadmap.html, loaded
//   whole in a vm sandbox like test/renderer-backlog-roadmap.test.js): every item's row has a button
//   data-testid="show-on-map" with the text "Show on the map" (in its open row since the lanes of
//   2026-11-27); every stage's ⋮ menu has an entry data-testid="show-stage-on-map" with the text "Show
//   the stage on the map" (the same day: it was a button of the stage's head).
// - The Backlog's issue card (fronts/build/views/backlog/backlog.js `const card = (i) => ...`, a
//   closure with no exported markup function, so checked on its source as a seam like
//   test/renderer-backlog-filters.test.js): its markup carries a button data-testid="show-on-map"
//   with the text "Show on the map".
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('@craftorio/shared/test/i18n-sandbox');

const ROOT = path.join(__dirname, '..', '..', '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const SHOW_ALL = { showAll: true, since: 'total' };

function loadRoadmap() {
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
    document: { querySelector: () => null, querySelectorAll: () => [] },
    api: { listWorkflows: async () => [] },
    setTimeout,
    clearTimeout,
  };
  sandbox.window = sandbox;
  sandbox.showRun = () => {};
  withI18n(sandbox);
  vm.createContext(sandbox);
  for (const f of ['packages/ui-kit/status-pill.js', 'packages/ui-kit/estimates.js', 'packages/shared/run-progress-model.js', 'packages/shared/default-workflow.js', 'packages/shared/roadmap-model.js', 'packages/shared/run-inputs.js', 'packages/ui-kit/workflow-inputs.js', 'packages/ui-kit/menu.js', 'fronts/build/views/backlog/backlog-roadmap-meters.js', 'fronts/build/views/backlog/backlog-roadmap.js']) {
    vm.runInContext(read(f), sandbox, { filename: path.basename(f) });
  }
  return sandbox.window.BacklogRoadmap;
}

const item = (id, number, title) => ({ id, status: 'planned', workflow: 'software-development.yaml', inputs: {}, issues: [{ number, title, url: `https://github.com/x/y/issues/${number}` }] });
const DATA = {
  roadmap: {
    state: 'planned',
    stages: [
      { id: 'st1', name: 'First', note: '', items: [item('it1', 101, 'Fix the login bug'), item('it2', 102, 'Add the export')] },
      { id: 'st2', name: 'Second', note: '', items: [item('it3', 103, 'Ship the docs')] },
    ],
  },
  issues: [],
};
const buttons = (html, id) => html.match(new RegExp(`<button[^>]*data-testid="${id}"[^>]*>[\\s\\S]*?</button>`, 'g')) || [];
const textOf = (s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

test('#375 a roadmap item card has a "Show on the map" button', () => {
  const html = loadRoadmap().html(DATA, () => {}, SHOW_ALL);
  const found = buttons(html, 'show-on-map');
  assert.equal(found.length, 3, `one per item: ${found.length}`);
  for (const b of found) assert.match(textOf(b), /Show on the map/);
});

test('#375 a roadmap stage\'s ⋮ menu has a "Show the stage on the map" entry, for its own stage', async () => {
  const roadmap = loadRoadmap();
  assert.equal(buttons(roadmap.html(DATA, () => {}, SHOW_ALL), 'show-stage-on-map').length, 0, 'none while the menus are closed: no button in a stage\'s head');
  const ctx = { projectId: 'p1', render: () => {}, setData: () => {}, setError: () => {} };
  for (const [s, id] of [[0, 'st1'], [1, 'st2']]) {
    // the stage's ⋮ button clicked: without a page, the next draw shows its menu open
    const menuButton = { dataset: { rmStageMenu: id } };
    menuButton.closest = (sel) => (sel === '[data-rm-stage-menu]' ? menuButton : null);
    await roadmap.onClick({ target: menuButton }, ctx, DATA);
    const found = buttons(roadmap.html(DATA, () => {}, SHOW_ALL), 'show-stage-on-map');
    assert.equal(found.length, 1, `one entry, in the open menu of stage ${s + 1}: ${found.length}`);
    assert.match(found[0], new RegExp(`role="menuitem"[^>]*data-rm-map-stage="${s}"`));
    assert.match(textOf(found[0]), /Show the stage on the map/);
  }
});

test('#375 the Backlog issue card has a "Show on the map" button', () => {
  const src = read('fronts', 'build', 'views', 'backlog', 'backlog.js');
  const m = /const card = \(i\) => `[\s\S]*?`;/.exec(src);
  assert.ok(m, 'the issue card markup (const card = (i) => `...`) is in backlog.js');
  // #330: the label comes from the catalog
  assert.match(m[0], /<button[^>]*data-testid="show-on-map"[^>]*>\$\{t\('backlog\.show_on_the_map'\)\}<\/button>/);
  assert.equal(require('@craftorio/shared/i18n.js').t('backlog.show_on_the_map'), 'Show on the map');
});
