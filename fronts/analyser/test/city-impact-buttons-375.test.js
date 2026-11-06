// #375: the buttons that open an issue's impact preview on the project city.
// - The Roadmap view (fronts/build/views/backlog/backlog-roadmap.js, window.BacklogRoadmap.html, loaded
//   whole in a vm sandbox like test/renderer-backlog-roadmap.test.js): every item card has a button
//   data-testid="show-on-map" with the text "Show on the map"; every stage's header (div.rm-stage-head,
//   not inside the closed ⋮ menu) has a button data-testid="show-stage-on-map" with the text "Show the
//   stage on the map".
// - The Backlog's issue card (fronts/build/views/backlog/backlog.js `const card = (i) => ...`, a
//   closure with no exported markup function, so checked on its source as a seam like
//   test/renderer-backlog-filters.test.js): its markup carries a button data-testid="show-on-map"
//   with the text "Show on the map".
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox');

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
  for (const f of ['packages/ui-kit/status-pill.js', 'packages/ui-kit/estimates.js', 'packages/shared/run-progress-model.js', 'packages/shared/default-workflow.js', 'packages/shared/roadmap-model.js', 'packages/shared/run-inputs.js', 'packages/ui-kit/workflow-inputs.js', 'fronts/build/views/backlog/backlog-roadmap.js']) {
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

test('#375 a roadmap stage header has a "Show the stage on the map" button', () => {
  const html = loadRoadmap().html(DATA, () => {}, SHOW_ALL);
  const found = buttons(html, 'show-stage-on-map');
  assert.equal(found.length, 2, `one per stage: ${found.length}`);
  for (const b of found) assert.match(textOf(b), /Show the stage on the map/);
  // each stage's head: from its div.rm-stage-head to its list of item cards
  const heads = html.split('<div class="rm-stage-head">').slice(1).map((s) => s.split('<div class="rm-items">')[0]);
  assert.equal(heads.length, 2, 'two stage heads');
  assert.equal(heads.filter((h) => h.includes('data-testid="show-stage-on-map"')).length, 2, 'in each stage header, before its items');
});

test('#375 the Backlog issue card has a "Show on the map" button', () => {
  const src = read('fronts', 'build', 'views', 'backlog', 'backlog.js');
  const m = /const card = \(i\) => `[\s\S]*?`;/.exec(src);
  assert.ok(m, 'the issue card markup (const card = (i) => `...`) is in backlog.js');
  // #330: the label comes from the catalog
  assert.match(m[0], /<button[^>]*data-testid="show-on-map"[^>]*>\$\{t\('backlog\.show_on_the_map'\)\}<\/button>/);
  assert.equal(require('@multiagent/shared/i18n.js').t('backlog.show_on_the_map'), 'Show on the map');
});
