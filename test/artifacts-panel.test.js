// src/renderer/artifacts-panel.js (#108/#109): one component for the Run screen's Artifacts tab and
// the approval gate's side panel. The Run screen's markup and switchTab moved into
// views/run/run.js by #154. It runs only inside the Electron renderer (window.api, the DOM,
// app.js's helpers), so it is evaluated whole in a sandbox with those stubbed, a fake `root` element
// standing in for the DOM (classList/innerHTML/querySelector only, no real parsing), the way
// test/renderer-run-gates.test.js checks app.js as a seam.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('./i18n-sandbox.js');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'artifacts-panel.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
const runSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'views', 'run', 'run.js'), 'utf8');

test('the Run screen has an Artifacts tab next to Session and Events, with a count badge', () => {
  // #410: Artifacts is the first tab and a run opens on it
  assert.match(runSrc, /<button class="tab active"[^>]*data-tab="artifacts"[^>]*>\$\{t\('run\.artifacts'\)\} <span id="tab-artifacts-count"/);
  assert.match(runSrc, /id="tab-artifacts" class="tab-body"/);
  assert.match(html, /<script src="artifacts-panel\.js"><\/script>/);
});

test('switchTab toggles #tab-artifacts like the other two tabs', () => {
  const switchTab = /function switchTab\(tab\) \{[\s\S]*?\n\}/.exec(runSrc)[0];
  assert.match(switchTab, /\$\('#tab-artifacts'\)\.classList\.toggle\('hidden', tab !== 'artifacts'\)/);
});

test('ARTIFACT_EVENTS covers what adds a file to a run (handoffs, decisions, saved files, step/workflow finish)', () => {
  const decl = /const ARTIFACT_EVENTS = new Set\(\[[^\]]+\]\);/.exec(appSrc)[0];
  for (const type of ['decision.logged', 'file.saved', 'handoff.saved', 'step.finished', 'workflow.finished']) {
    assert.match(decl, new RegExp(`'${type}'`));
  }
});

// ---------------------------------------------------------------------------------------------
// ArtifactsPanel itself: the whole module, evaluated with app.js's helpers stubbed.
function loadPanel(opts = {}) {
  const calls = { openArtifactsAt: [], readArtifact: [], artifactMenuOpen: [], imageViewerOpen: [] };
  const sandbox = {
    esc: (s) => (s == null ? '' : String(s)),
    artKindIcon: (kind) => `<i data-kind="${kind}"></i>`,
    fmtSize: (n) => (n == null ? '' : `${n} B`),
    markdownHtml: (t) => `<md>${t}</md>`,
    renderJsonText: (t) => t,
    renderDelimited: (t) => `<table>${t}</table>`,
    errMsg: (e) => String(e?.message || e),
    openArtifactsAt: (...a) => calls.openArtifactsAt.push(a),
    showToast: () => {},
    // the copy menu itself is artifact-menu.js's own seam (test/artifact-menu.test.js): here only
    // the wiring (what target onContextMenu opens it with) matters (#114)
    ArtifactMenu: { open: (e, target) => calls.artifactMenuOpen.push(target) },
    // the shared image viewer is image-viewer.js's own seam (#145): here only the wiring (what it
    // is opened with) and the thumbnail attributes (ImageViewer.THUMB) matter
    ImageViewer: {
      THUMB: 'tabindex="0" role="button" title="Click to enlarge" data-iv-thumb',
      open: (o) => calls.imageViewerOpen.push(o),
    },
    api: {
      listArtifacts: opts.listArtifacts || (async () => [{ artifacts: [] }]),
      readArtifact: opts.readArtifact || (async (p) => { calls.readArtifact.push(p); return { text: '' }; }),
      runEvidence: opts.runEvidence,
    },
    window: {},
    document: {},
    setTimeout, clearTimeout, Date,
  };
  vm.createContext(withI18n(sandbox));
  vm.runInContext(src, sandbox);
  return { ArtifactsPanel: sandbox.window.ArtifactsPanel, calls };
}

// A fake DOM element good enough for mount()/render()/paintPreview(): innerHTML is just stored (no
// parsing), and querySelector('.ap-body') returns the one element paintPreview looks for.
// listeners: the handlers mount() registered (click, contextmenu), so a test can fire one directly.
function fakeRoot() {
  const body = { innerHTML: '' };
  const listeners = {};
  const root = {
    classList: { add() {} },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    isConnected: true,
    _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v; },
    querySelector: (sel) => (sel === '.ap-body' ? body : null),
    querySelectorAll: () => [],
  };
  return { root, body, listeners };
}

// A fake contextmenu target: e.target.closest(sel) resolves like the real DOM would for a button
// matching `match` (e.g. '[data-ap-file]'), with the given dataset.
const closestTarget = (match, dataset) => ({ closest: (sel) => (sel === match ? { dataset } : null) });

const waitTick = (ms = 60) => new Promise((r) => setTimeout(r, ms));

test('ArtifactsPanel.groupOf: handoffs, decisions, evidence (images/screenshots), documents (markdown/external), other', () => {
  const { ArtifactsPanel } = loadPanel();
  assert.equal(ArtifactsPanel.groupOf({ rel: 'handoffs/developer.md' }), 'handoffs');
  assert.equal(ArtifactsPanel.groupOf({ rel: 'decisions.tsv' }), 'decisions');
  assert.equal(ArtifactsPanel.groupOf({ kind: 'image', rel: 'screenshots/after.png' }), 'evidence');
  assert.equal(ArtifactsPanel.groupOf({ rel: 'evidence/report.json', kind: 'json' }), 'evidence');
  assert.equal(ArtifactsPanel.groupOf({ kind: 'markdown', rel: 'docs/prd.md' }), 'documents');
  assert.equal(ArtifactsPanel.groupOf({ location: 'external', rel: 'prd.md', kind: 'other' }), 'documents');
  assert.equal(ArtifactsPanel.groupOf({ rel: 'summary.json', kind: 'json' }), 'other');
});

test('mount/setRun: lists a fixture run\'s artifacts (a document, a screenshot pair, a handoff note) with the right count, by category (#225), newest first', async () => {
  const files = [
    { path: '/r/decisions.tsv', name: 'decisions.tsv', rel: 'decisions.tsv', kind: 'table', category: 'process', size: 40, mtime: '2026-01-01T00:00:00Z' },
    { path: '/r/handoffs/developer.md', name: 'developer.md', rel: 'handoffs/developer.md', kind: 'markdown', category: 'process', size: 500, mtime: '2026-01-03T00:00:00Z', step: 'develop', agent: 'developer' },
    { path: '/r/screenshots/before.png', name: 'before.png', rel: 'screenshots/before.png', kind: 'image', category: 'screenshots', size: 10, mtime: '2026-01-02T00:00:00Z' },
    { path: '/r/screenshots/after.png', name: 'after.png', rel: 'screenshots/after.png', kind: 'image', category: 'screenshots', size: 10, mtime: '2026-01-02T00:00:01Z' },
  ];
  const { ArtifactsPanel } = loadPanel({ listArtifacts: async () => [{ artifacts: files }] });
  const { root, listeners } = fakeRoot();
  let count = null;
  const panel = ArtifactsPanel.mount(root, { runId: 'r1', onCount: (n) => { count = n; } });
  await waitTick();
  assert.equal(count, 4, 'every artifact counted, screenshots included');
  assert.equal(panel.count(), 4);
  // Produced (the default): the screenshots, not the handoff note nor the decision log
  assert.match(root.innerHTML, /Screenshots & images/);
  assert.doesNotMatch(root.innerHTML, /developer\.md/);
  listeners.click({ target: closestTarget('[data-artifact-filter]', { artifactFilter: 'all' }) });
  assert.match(root.innerHTML, /developer\.md/);
  assert.match(root.innerHTML, /decisions\.tsv/);
  // categories are rendered in a fixed order (result, screenshots, tests, reports, process), not by recency
  const groupOrder = ['Screenshots & images', 'Process'].map((g) => root.innerHTML.indexOf(g));
  assert.deepEqual(groupOrder, [...groupOrder].sort((a, b) => a - b));
  // within the screenshots category, after.png (newer) comes before before.png
  assert.ok(root.innerHTML.indexOf('after.png') < root.innerHTML.indexOf('before.png'));
});

test('mount: the empty state names what produces artifacts', async () => {
  const { ArtifactsPanel } = loadPanel({ listArtifacts: async () => [{ artifacts: [] }] });
  const { root } = fakeRoot();
  ArtifactsPanel.mount(root, { runId: 'r1' });
  await waitTick();
  assert.match(root.innerHTML, /No artifacts yet/);
});

test('preview: selecting a markdown artifact renders it through markdownHtml', async () => {
  const { ArtifactsPanel } = loadPanel({
    listArtifacts: async () => [{ artifacts: [{ path: '/r/handoffs/developer.md', name: 'developer.md', rel: 'handoffs/developer.md', kind: 'markdown', size: 10, mtime: '2026-01-01T00:00:00Z' }] }],
    readArtifact: async () => ({ text: '# Handoff\n\nDone.' }),
  });
  const { root, body } = fakeRoot();
  const panel = ArtifactsPanel.mount(root, { runId: 'r1' });
  await waitTick();
  panel.select({ path: '/r/handoffs/developer.md' });
  await waitTick();
  assert.match(body.innerHTML, /<article class="md"><md># Handoff\n\nDone\.<\/md><\/article>/);
});

// A manifest (#146, src/domains/evidence/evidence.js, as returned by src/service/index.js's runEvidence) with one
// final original/modified pair for issue #146.
function evidenceFixture() {
  const modified = '/r/evidence/evidence/round-1/146-login-default.modified.png';
  const original = '/r/evidence/evidence/round-1/146-login-default.original.png';
  return {
    version: 1, base: 'main', branch: 'feat/146', legacy: undefined,
    final: { step: 'evidence', round: 1 },
    rounds: [{ step: 'evidence', round: 1, captured_at: '2026-01-01T00:00:00Z', final: true }],
    images: [
      { path: 'evidence/evidence/round-1/146-login-default.modified.png', file: modified, pair: 'evidence/evidence/round-1/146-login-default.original.png', pair_file: original, side: 'modified', key: '146-login-default', issue: '146', caption: 'Login page', commit: 'abc1234', step: 'evidence', round: 1, final: true },
      { path: 'evidence/evidence/round-1/146-login-default.original.png', file: original, pair: 'evidence/evidence/round-1/146-login-default.modified.png', pair_file: modified, side: 'original', key: '146-login-default', issue: '146', caption: 'Login page', commit: null, step: 'evidence', round: 1, final: true },
    ],
  };
}

test('preview: a final original/modified pair from the evidence manifest renders both images side by side, labelled Original/Modified', async () => {
  const ev = evidenceFixture();
  const [modified, original] = ev.images.map((x) => x.file);
  const files = [
    { path: modified, name: '146-login-default.modified.png', rel: 'evidence/evidence/round-1/146-login-default.modified.png', kind: 'image', size: 1, mtime: '2026-01-01T00:00:00Z' },
    { path: original, name: '146-login-default.original.png', rel: 'evidence/evidence/round-1/146-login-default.original.png', kind: 'image', size: 1, mtime: '2026-01-01T00:00:00Z' },
  ];
  const { ArtifactsPanel } = loadPanel({
    listArtifacts: async () => [{ artifacts: files }],
    runEvidence: async () => ev,
    readArtifact: async (p) => (p === modified ? { image: 'data:modified' } : { image: 'data:original' }),
  });
  const { root, body } = fakeRoot();
  const panel = ArtifactsPanel.mount(root, { runId: 'r1' });
  await waitTick();
  panel.select({ path: modified });
  await waitTick(100);
  assert.match(body.innerHTML, /Login page/);
  assert.match(body.innerHTML, /Original \(main\)/);
  assert.match(body.innerHTML, /Modified \(feat\/146 @abc1234\)/);
  assert.match(body.innerHTML, new RegExp(`data-ap-img="${modified.replace(/\//g, '\\/')}"[^>]*src="data:modified"`));
  assert.ok(body.innerHTML.includes(`data-ap-img="${original}"`));
});

// listArtifacts walks every file under the run folder (src/runs.js), so a run with evidence images
// also lists them as plain files; the fixtures below include matching entries, as a real run would.
const fileEntry = (file, mtime = '2026-01-01T00:00:00Z') => ({ path: file, name: path.basename(file), rel: file.replace('/r/', ''), kind: 'image', size: 1, mtime });

test('list: the final set is shown first, grouped by issue, with older rounds collapsed under History', async () => {
  const ev = evidenceFixture();
  // an older round (history): the developer step captured this pair before the evidence step did
  const oldFile = '/r/evidence/developer/round-1/146-login-default.modified.png';
  ev.images.push({ path: 'evidence/developer/round-1/146-login-default.modified.png', file: oldFile, pair: null, side: 'modified', key: '146-login-default', issue: '146', caption: 'Login page (first try)', commit: null, step: 'developer', round: 1, final: false });
  ev.rounds.unshift({ step: 'developer', round: 1, captured_at: '2025-12-31T00:00:00Z', final: false });
  const files = [...ev.images.map((x) => x.file), oldFile].map((f) => fileEntry(f));
  const { ArtifactsPanel } = loadPanel({ listArtifacts: async () => [{ artifacts: files }], runEvidence: async () => ev });
  const { root } = fakeRoot();
  ArtifactsPanel.mount(root, { runId: 'r1' });
  await waitTick();

  assert.match(root.innerHTML, /Screenshots <span class="badge">final<\/span>[\s\S]*evidence · round 1/);
  assert.match(root.innerHTML, /Issue #146/);
  assert.match(root.innerHTML, /Login page/);
  assert.match(root.innerHTML, /History <span class="muted">1<\/span>/);
  assert.match(root.innerHTML, /developer · round 1/);
  assert.match(root.innerHTML, /Login page \(first try\)/);
});

test('list: no evidence in the run shows "No screenshots in this run"', async () => {
  const { ArtifactsPanel } = loadPanel({ listArtifacts: async () => [{ artifacts: [fileEntry('/r/a.md')] }], runEvidence: async () => ({ images: [] }) });
  const { root } = fakeRoot();
  ArtifactsPanel.mount(root, { runId: 'r1' });
  await waitTick();
  assert.match(root.innerHTML, /No screenshots in this run\./);
});

test('list: a legacy run (screenshots/ + screenshots.json) shows its one set with no History section', async () => {
  const ev = {
    version: 1, legacy: true, base: null, branch: null, final: { step: 'screenshots', round: 1 },
    rounds: [{ step: 'screenshots', round: 1, captured_at: '', final: true }],
    images: [
      { path: 'screenshots/after.png', file: '/r/screenshots/after.png', pair: 'screenshots/before.png', pair_file: '/r/screenshots/before.png', side: 'modified', key: 'after', issue: null, caption: 'Settings', commit: null, step: 'screenshots', round: 1, final: true },
      { path: 'screenshots/before.png', file: '/r/screenshots/before.png', pair: 'screenshots/after.png', pair_file: '/r/screenshots/after.png', side: 'original', key: 'after', issue: null, caption: 'Settings', commit: null, step: 'screenshots', round: 1, final: true },
    ],
  };
  const files = ev.images.map((x) => fileEntry(x.file));
  const { ArtifactsPanel } = loadPanel({ listArtifacts: async () => [{ artifacts: files }], runEvidence: async () => ev });
  const { root } = fakeRoot();
  ArtifactsPanel.mount(root, { runId: 'r1' });
  await waitTick();
  assert.match(root.innerHTML, /recorded before evidence rounds/);
  assert.doesNotMatch(root.innerHTML, /History/);
});

test('live update: a new artifact (e.g. after file.saved) is reflected once ArtifactsPanel.refreshRun is called', async () => {
  let files = [{ path: '/r/a.md', name: 'a.md', rel: 'a.md', kind: 'markdown', size: 1, mtime: '2026-01-01T00:00:00Z' }];
  const { ArtifactsPanel } = loadPanel({ listArtifacts: async () => [{ artifacts: files }] });
  const { root } = fakeRoot();
  let count = null;
  ArtifactsPanel.mount(root, { runId: 'r1', onCount: (n) => { count = n; } });
  await waitTick();
  assert.equal(count, 1);

  files = files.concat([{ path: '/r/b.md', name: 'b.md', rel: 'b.md', kind: 'markdown', size: 1, mtime: '2026-01-03T00:00:00Z' }]);
  ArtifactsPanel.refreshRun('r1');
  await waitTick(1600);
  assert.equal(count, 2, 'the panel reloaded and now counts the new file');
  assert.match(root.innerHTML, /b\.md/);
});

test('mount with flat: true (the gate\'s side panel) lists files newest first without groups, plus extras (changed files, developer notes)', async () => {
  const files = [
    { path: '/r/old.md', name: 'old.md', rel: 'old.md', kind: 'markdown', size: 1, mtime: '2026-01-01T00:00:00Z' },
    { path: '/r/new.md', name: 'new.md', rel: 'new.md', kind: 'markdown', size: 1, mtime: '2026-01-02T00:00:00Z' },
  ];
  const { ArtifactsPanel } = loadPanel({ listArtifacts: async () => [{ artifacts: files }] });
  const { root } = fakeRoot();
  const extras = {
    changes: [{ file: 'src/a.js', added: 3, deleted: 1 }],
    notes: [{ title: 'Test notes', text: 'Covered the happy path.' }],
  };
  ArtifactsPanel.mount(root, { runId: 'r1', flat: true, extras });
  await waitTick();
  assert.doesNotMatch(root.innerHTML, /Handoff notes|Screenshots and evidence/, 'flat: no group headings');
  assert.match(root.innerHTML, /Changed files/);
  assert.match(root.innerHTML, /a\.js/);
  assert.match(root.innerHTML, /\+3/);
  assert.match(root.innerHTML, /From the developer/);
  assert.match(root.innerHTML, /Test notes/);
  const newIdx = root.innerHTML.indexOf('new.md');
  const oldIdx = root.innerHTML.indexOf('old.md');
  assert.ok(newIdx > -1 && oldIdx > -1 && newIdx < oldIdx, 'newest first');
});

test('extras: an empty changes list without changesReported (a real run with no changes against the base) says so, not "no changed files"', async () => {
  const { ArtifactsPanel } = loadPanel({ listArtifacts: async () => [{ artifacts: [] }] });
  const { root } = fakeRoot();
  ArtifactsPanel.mount(root, { runId: 'r1', flat: true, extras: { changes: [] } });
  await waitTick();
  assert.match(root.innerHTML, /No changes against the base\./);
  assert.doesNotMatch(root.innerHTML, /simulated|reported by the developer/);
});

// ---------------------------------------------------------------------------------------------
// extras.capture (#144): the gate right after a `type: screenshots` step (developer_check) leads
// with that step's own round, original/modified side by side, older rounds in History.

// A manifest with two rounds of the same step ("developer"): round 1 has a full pair, round 2 (the
// latest) recaptured only the modified side (its original capture failed). buildManifest (src/domains/evidence/evidence.js)
// still points round 2's modified image at round 1's original as its `pair` (the newest earlier one
// available) — the stale pairing the gate itself must ignore.
function developerRoundsFixture() {
  const r1mod = '/r/evidence/developer/round-1/144-dashboard-default.modified.png';
  const r1orig = '/r/evidence/developer/round-1/144-dashboard-default.original.png';
  const r2mod = '/r/evidence/developer/round-2/144-dashboard-default.modified.png';
  return {
    version: 1, base: 'main', branch: 'feat/144',
    final: { step: 'developer', round: 2 },
    rounds: [
      { step: 'developer', round: 1, captured_at: '2026-01-01T00:00:00Z', final: false },
      { step: 'developer', round: 2, captured_at: '2026-01-02T00:00:00Z', final: true },
    ],
    images: [
      { path: 'evidence/developer/round-1/144-dashboard-default.modified.png', file: r1mod, pair: 'evidence/developer/round-1/144-dashboard-default.original.png', pair_file: r1orig, side: 'modified', key: '144-dashboard-default', issue: '144', caption: 'The dashboard', commit: 'aaa1111', step: 'developer', round: 1, final: false },
      { path: 'evidence/developer/round-1/144-dashboard-default.original.png', file: r1orig, pair: 'evidence/developer/round-1/144-dashboard-default.modified.png', pair_file: r1mod, side: 'original', key: '144-dashboard-default', issue: '144', caption: 'The dashboard', commit: null, step: 'developer', round: 1, final: false },
      { path: 'evidence/developer/round-2/144-dashboard-default.modified.png', file: r2mod, pair: 'evidence/developer/round-1/144-dashboard-default.original.png', pair_file: r1orig, side: 'modified', key: '144-dashboard-default', issue: '144', caption: 'The dashboard', commit: 'bbb2222', step: 'developer', round: 2, final: true },
    ],
  };
}

test('extras.capture: the gate shows only the latest round\'s screenshots, paired and captioned, with a "latest" badge', async () => {
  const ev = developerRoundsFixture();
  const files = ev.images.map((x) => fileEntry(x.file));
  const cap = { kind: 'screenshots', folder: 'developer', round: 1, taken: 2, screens: 1, errors: [], reason: null };
  // use round 1 here (its own full pair) so this case is unambiguous; round 2's partial pair is
  // covered by the next test
  const onlyRound1 = { ...ev, final: { step: 'developer', round: 1 }, images: ev.images.filter((x) => x.round === 1) };
  const { ArtifactsPanel } = loadPanel({ listArtifacts: async () => [{ artifacts: files }], runEvidence: async () => onlyRound1 });
  const { root } = fakeRoot();
  ArtifactsPanel.mount(root, { runId: 'r1', flat: true, extras: { capture: cap } });
  await waitTick();
  assert.match(root.innerHTML, /Screenshots <span class="badge">latest<\/span>[\s\S]*developer · round 1/);
  assert.match(root.innerHTML, /The dashboard/);
  assert.equal((root.innerHTML.match(/<figure>/g) || []).length, 2, 'both sides of the one screen');
  assert.doesNotMatch(root.innerHTML, /No screenshots/);
});

test('extras.capture: a side that failed in the latest round is not paired with an older round\'s stale image (shown "modified only", with the error listed)', async () => {
  const ev = developerRoundsFixture();
  const files = ev.images.map((x) => fileEntry(x.file));
  const cap = { kind: 'screenshots', folder: 'developer', round: 2, taken: 1, screens: 1, errors: [{ name: '144-dashboard-default', side: 'original', error: 'exit 1: boom' }], reason: null };
  const { ArtifactsPanel } = loadPanel({ listArtifacts: async () => [{ artifacts: files }], runEvidence: async () => ev });
  const { root } = fakeRoot();
  ArtifactsPanel.mount(root, { runId: 'r1', flat: true, extras: { capture: cap } });
  await waitTick();
  assert.match(root.innerHTML, /developer · round 2/);
  // only the modified side of round 2 is rendered for this shot: one figure, "modified only" badge
  assert.equal((root.innerHTML.match(/<figure>/g) || []).length, 1, 'the stale round-1 original is not shown as the pair');
  assert.match(root.innerHTML, /modified only/);
  assert.match(root.innerHTML, /exit 1: boom/);
  // round 1's own pair (both sides) still shows up in History, not folded into the latest round
  assert.match(root.innerHTML, /History <span class="muted">2<\/span>/);
  assert.match(root.innerHTML, /developer · round 1/);
});

test('extras.capture: nothing captured shows "No screenshots: <reason>", not the run\'s other evidence', async () => {
  const cap = { kind: 'screenshots', folder: 'developer', round: 1, taken: 0, screens: 0, errors: [], reason: 'the developer listed no screens (a change without UI)' };
  const { ArtifactsPanel } = loadPanel({ listArtifacts: async () => [{ artifacts: [fileEntry('/r/a.md')] }], runEvidence: async () => ({ images: [] }) });
  const { root } = fakeRoot();
  ArtifactsPanel.mount(root, { runId: 'r1', flat: true, extras: { capture: cap } });
  await waitTick();
  assert.match(root.innerHTML, /No screenshots:.*the developer listed no screens \(a change without UI\)/);
  assert.doesNotMatch(root.innerHTML, /No screenshots in this run\./);
});

// ---------------------------------------------------------------------------------------------
// Right-click (or Shift+F10) on a file of the list, or on an open image: the copy menu (#114)

test('onContextMenu: right-click on a file of the list opens the copy menu with its metadata', async () => {
  const files = [{ path: '/r/a.png', name: 'a.png', rel: 'a.png', kind: 'image', size: 10, mtime: '2026-01-01T00:00:00Z' }];
  const { ArtifactsPanel, calls } = loadPanel({ listArtifacts: async () => [{ artifacts: files }] });
  const { root, listeners } = fakeRoot();
  ArtifactsPanel.mount(root, { runId: 'r1' });
  await waitTick();

  listeners.contextmenu({ target: closestTarget('[data-ap-file]', { apFile: '/r/a.png' }) });
  assert.deepEqual(calls.artifactMenuOpen, [files[0]]);
});

test('onContextMenu: right-click on an open image opens the copy menu with its path, offering Copy image instead of a file\'s actions', async () => {
  const { ArtifactsPanel, calls } = loadPanel();
  const { root, listeners } = fakeRoot();
  ArtifactsPanel.mount(root, { runId: 'r1' });
  await waitTick();

  listeners.contextmenu({ target: closestTarget('[data-ap-img]', { apImg: '/r/screenshots/after.png' }) });
  // the target is built inside the sandbox (a different object realm): compare its fields, not identity
  assert.equal(calls.artifactMenuOpen.length, 1);
  assert.equal(calls.artifactMenuOpen[0].path, '/r/screenshots/after.png');
  assert.equal(calls.artifactMenuOpen[0].image, true);
});

test('onContextMenu: right-click outside any file or image opens nothing', async () => {
  const { ArtifactsPanel, calls } = loadPanel();
  const { root, listeners } = fakeRoot();
  ArtifactsPanel.mount(root, { runId: 'r1' });
  await waitTick();

  listeners.contextmenu({ target: { closest: () => null } });
  assert.deepEqual(calls.artifactMenuOpen, []);
});
