// fronts/build/views/artifacts/artifacts.js: the Artifacts screen's run groups and the Collapse
// all / Expand all toggle (#126); ART_KIND/artKindIcon/fmtSize are shared in artifact-render.js
// (also used by artifacts-panel.js), moved out of app.js by #154. It runs only inside the
// Electron renderer, so the relevant functions are pulled out of the source and evaluated in a
// sandbox, the way test/renderer-run-gates.test.js checks app.js as a seam. A minimal fake DOM
// stands in for #art-list and #art-toggle-all: enough to read back the toggle button's label/aria
// state and the run groups' open/closed markup, not a full parser.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pageDirs, pageFile, pageFiles } = require('../../../scripts/source-tree');
const PAGE_ROOT = path.join(__dirname, '..', '..', '..');
// a page file by its page-relative name, wherever its layer is (phase 3 of the reorganisation study)
const page = (rel) => pageFile(PAGE_ROOT, rel);
void pageDirs; void pageFiles; void page;
const vm = require('vm');
const { withI18n } = require('@craftorio/shared/test/i18n-sandbox.js');

const renderSrc = fs.readFileSync(path.join(__dirname, '..', 'artifact-render.js'), 'utf8');
const artifactsSrc = fs.readFileSync(
  page('views/artifacts/artifacts.js'), 'utf8',
);
const runListSrc = fs.readFileSync(path.join(__dirname, '..', 'run-list.js'), 'utf8');

function extract(name, re, src = artifactsSrc) {
  const m = re.exec(src);
  assert.ok(m, `${name} not found: the source moved`);
  return m[0];
}

// A fake #art-toggle-all button: enough of the DOM API paintArtToggleAll touches.
function fakeToggleButton() {
  const span = { textContent: '' };
  const polyline = { points: '', setAttribute(k, v) { if (k === 'points') this.points = v; } };
  const attrs = {};
  const classes = new Set();
  return {
    disabled: false,
    title: '',
    classList: { toggle: (c, force) => (force ? classes.add(c) : classes.delete(c)), contains: (c) => classes.has(c) },
    setAttribute: (k, v) => { attrs[k] = v; },
    getAttribute: (k) => attrs[k],
    querySelector: (sel) => (sel === 'span' ? span : sel === 'polyline' ? polyline : null),
    _span: span,
    _polyline: polyline,
  };
}

// A fake #art-list: innerHTML is kept as a plain string; querySelectorAll always returns no
// elements (the file/group click wiring is exercised through setArtGroupOpen directly in these
// tests, not through simulated DOM clicks).
function fakeListBox() {
  return { _html: '', set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; }, querySelectorAll: () => [] };
}

function load({ runs = [], q = '', projectId = '', showSim = false, developerMode = false, storage = {} } = {}) {
  const body = [
    "const $ = (sel) => document.querySelector(sel);",
    "const esc = (s) => String(s ?? '').replace(/[&<>\"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' })[c]);",
    "const dateOf = (iso) => new Date(iso).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' });",
    "const devMode = () => !!state.settings.developerMode || !!state.simulationOnly;",
    extract('ART_KIND', /const ART_KIND = \{[^\n]+\};/, renderSrc),
    extract('artKindIcon', /const artKindIcon = [^\n]+/, renderSrc),
    extract('fmtSize', /function fmtSize\(n\) \{[\s\S]*?\n\}/, renderSrc),
    extract('ART_PAGE', /const ART_PAGE = \d+;/, runListSrc),
    extract('groupArtifacts', /function groupArtifacts\(files\) \{[\s\S]*?\n\}/, runListSrc),
    extract('artShowSim', /const artShowSim = [^\n]+/),
    extract('artifactRunsFiltered', /function artifactRunsFiltered\(\) \{[\s\S]*?\n\}/),
    extract('ensureArtFiles', /function ensureArtFiles\(r\) \{[\s\S]*?\n\}/),
    extract('fetchArtFiles', /function fetchArtFiles\(runId, entry\) \{[\s\S]*?\n\}/),
    extract('artFileHtml', /function artFileHtml\(f\) \{[\s\S]*?\n\}/),
    extract('artFilesHtml', /function artFilesHtml\(e\) \{[\s\S]*?\n\}/),
    extract('renderArtifactList', /function renderArtifactList\(\) \{[\s\S]*?\n\}/),
    extract('paintArtToggleAll', /function paintArtToggleAll\(runs, searching\) \{[\s\S]*?\n\}/),
    extract('toggleAllArtGroups', /function toggleAllArtGroups\(\) \{[\s\S]*?\n\}/),
    extract('ART_GROUPS_KEY', /const ART_GROUPS_KEY = [^\n]+/),
    'let artGroups = null;',
    extract('artGroupsState', /function artGroupsState\(\) \{[\s\S]*?\n\}/),
    extract('artGroupOpen', /function artGroupOpen\(runId, fallback\) \{[\s\S]*?\n\}/),
    extract('setArtGroupOpen', /function setArtGroupOpen\(runId, open\) \{[\s\S]*?\n\}/),
  ].join('\n');

  const listBox = fakeListBox();
  const toggleBtn = fakeToggleButton();
  const store = { ...storage };
  // A run's files load through api.listArtifacts({ runId }), same array-wrapped shape as the real
  // service (packages/engine/service/areas/artifacts.js): the fixture's own files (run()'s `_files`), never empty
  // by surprise so a test that opens a group doesn't see a silent "ReferenceError: api is not defined".
  const sandbox = {
    state: { art: { runs, q, loadedQ: q, projectId, showSim, sel: null }, settings: { developerMode }, simulationOnly: false, projects: [] },
    document: { querySelector: (sel) => (sel === '#art-list' ? listBox : sel === '#art-toggle-all' ? toggleBtn : null) },
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = v; },
    },
    api: { listArtifacts: (opts) => Promise.resolve([{ artifacts: runs.find((r) => r.runId === opts.runId)?._files || [] }]) },
    errMsg: (e) => String(e?.message || e),
    StatusPill: require('../status-pill.js'), // the real readable statuses (#266)
  };
  vm.createContext(withI18n(sandbox));
  vm.runInContext(
    `${body}\nthis.fns = { artifactRunsFiltered, renderArtifactList, paintArtToggleAll, toggleAllArtGroups, artGroupOpen, setArtGroupOpen };`,
    sandbox,
  );
  return { ...sandbox.fns, listBox, toggleBtn, sandbox, store };
}

// #200: a run row no longer carries its file list (`artifacts`); only a count. The files it would
// return from artifacts:list { runId } are kept on `_files` for the sandbox's fake api.listArtifacts.
function run(id, { mock = false, files = [{ name: 'a.md', rel: 'a.md', path: `${id}/a.md`, kind: 'markdown', size: 10, exists: true }] } = {}) {
  return { runId: id, workflow: 'wf', status: 'success', task: 't', startedAt: '2026-01-01T00:00:00Z', mock, project: null, artifactCount: files.length, imageCount: 0, _files: files };
}

test('paintArtToggleAll: "Collapse all" while any listed group is open, "Expand all" once every one is closed', () => {
  const runs = [run('r1'), run('r2'), run('r3')];
  const { paintArtToggleAll, toggleBtn } = load({ runs });
  // default: only the first of the three is open
  paintArtToggleAll(runs, false);
  assert.equal(toggleBtn._span.textContent, 'Collapse all');
  assert.equal(toggleBtn.getAttribute('aria-pressed'), 'false');

  const { paintArtToggleAll: paint2, toggleBtn: btn2, setArtGroupOpen } = load({ runs });
  for (const id of ['r1', 'r2', 'r3']) setArtGroupOpen(id, false);
  paint2(runs, false);
  assert.equal(btn2._span.textContent, 'Expand all');
  assert.equal(btn2.getAttribute('aria-pressed'), 'true');
});

test('renderArtifactList + toggle: three groups (one open by default) show "Collapse all"; collapsing all shows "Expand all"; expanding all restores "Collapse all"', () => {
  const { renderArtifactList, toggleAllArtGroups, toggleBtn } = load({ runs: [run('r1'), run('r2'), run('r3')] });
  renderArtifactList();
  assert.equal(toggleBtn._span.textContent, 'Collapse all', 'the first group opens by default');
  assert.equal(toggleBtn.getAttribute('aria-pressed'), 'false');

  toggleAllArtGroups();
  assert.equal(toggleBtn._span.textContent, 'Expand all');
  assert.equal(toggleBtn.getAttribute('aria-pressed'), 'true');
  assert.doesNotMatch(toggleBtn._polyline.points, /18 15 12 9 6 15/, 'the chevron flips too');

  toggleAllArtGroups();
  assert.equal(toggleBtn._span.textContent, 'Collapse all');
  assert.equal(toggleBtn.getAttribute('aria-pressed'), 'false');
});

test('toggleAllArtGroups: each group is remembered as if toggled by hand (setArtGroupOpen), and the state survives a later render', () => {
  const { toggleAllArtGroups, renderArtifactList, artGroupOpen } = load({ runs: [run('r1'), run('r2'), run('r3')] });
  toggleAllArtGroups(); // collapses all three
  assert.equal(artGroupOpen('r1', true), false);
  assert.equal(artGroupOpen('r2', false), false);
  assert.equal(artGroupOpen('r3', false), false);

  renderArtifactList(); // a later render must not reset them to the "first one open" default
  assert.equal(artGroupOpen('r1', true), false);
});

test('opening one group by hand after "Collapse all" flips the button back to "Collapse all"', () => {
  const { toggleAllArtGroups, renderArtifactList, setArtGroupOpen, toggleBtn } = load({ runs: [run('r1'), run('r2'), run('r3')] });
  toggleAllArtGroups();
  assert.equal(toggleBtn._span.textContent, 'Expand all');

  setArtGroupOpen('r2', true); // what the art-run-head click handler does by hand
  renderArtifactList();
  assert.equal(toggleBtn._span.textContent, 'Collapse all');
  assert.equal(toggleBtn.getAttribute('aria-pressed'), 'false');
});

test('while searching, the toggle is disabled with a tooltip explaining why, and toggling does nothing', () => {
  const { renderArtifactList, toggleAllArtGroups, toggleBtn, artGroupOpen } = load({ runs: [run('r1'), run('r2')], q: 'a.md' });
  renderArtifactList();
  assert.equal(toggleBtn.disabled, true);
  assert.match(toggleBtn.title, /open while searching/);

  toggleAllArtGroups(); // a no-op while searching: nothing to collapse by hand
  assert.equal(artGroupOpen('r1', true), true, 'the remembered state (still only r1 open) is untouched');
});

test('clearing the search restores the remembered open/closed states, not every group open', () => {
  const { renderArtifactList, toggleAllArtGroups, toggleBtn, sandbox } = load({ runs: [run('r1'), run('r2')] });
  toggleAllArtGroups(); // remembers both closed
  // the search box text and the committed (loaded) search move together, as a finished loadArtifacts() does
  sandbox.state.art.q = 'a.md';
  sandbox.state.art.loadedQ = 'a.md';
  renderArtifactList();
  assert.equal(toggleBtn.disabled, true, 'both groups show open while searching, but the toggle is disabled, not relabelled');

  sandbox.state.art.q = '';
  sandbox.state.art.loadedQ = '';
  renderArtifactList();
  assert.equal(toggleBtn.disabled, false);
  assert.equal(toggleBtn._span.textContent, 'Expand all', 'the remembered collapsed state is back');
});

test('renderArtifactList: no run has artifacts hides the toggle instead of showing a disabled, empty button', () => {
  const { renderArtifactList, toggleBtn } = load({ runs: [] });
  renderArtifactList();
  assert.equal(toggleBtn.classList.contains('hidden'), true);
});

test('setArtGroupOpen / artGroupOpen: a run id not yet toggled by hand falls back to the caller\'s default, not false', () => {
  const { artGroupOpen, setArtGroupOpen } = load({ runs: [run('r1')] });
  assert.equal(artGroupOpen('never-touched', true), true);
  setArtGroupOpen('r1', false);
  assert.equal(artGroupOpen('r1', true), false, 'once set, the remembered value wins over the default');
});

test('views/artifacts/artifacts.js markup: the toggle is a real <button> (Enter/Space work without extra wiring) under the search box, with aria-pressed set', () => {
  const searchIdx = artifactsSrc.indexOf('id="art-search"');
  const toggleIdx = artifactsSrc.indexOf('id="art-toggle-all"');
  assert.ok(searchIdx > 0 && toggleIdx > searchIdx, 'the toggle sits after the search box');
  const tag = artifactsSrc.slice(toggleIdx - 40, toggleIdx);
  assert.match(tag, /<button\b/);
  assert.match(artifactsSrc.slice(toggleIdx, toggleIdx + 200), /aria-pressed="false"/);
});
