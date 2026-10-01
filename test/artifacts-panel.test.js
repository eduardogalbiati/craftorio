// src/renderer/artifacts-panel.js (#108/#109): one component for the Run screen's Artifacts tab and
// the approval gate's side panel. It runs only inside the Electron renderer (window.api, the DOM,
// app.js's helpers), so it is evaluated whole in a sandbox with those stubbed, a fake `root` element
// standing in for the DOM (classList/innerHTML/querySelector only, no real parsing), the way
// test/renderer-run-gates.test.js checks app.js as a seam.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'artifacts-panel.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');

test('the Run screen has an Artifacts tab next to Session and Events, with a count badge', () => {
  assert.match(html, /<button class="tab" data-tab="artifacts"[^>]*>Artifacts <span id="tab-artifacts-count"/);
  assert.match(html, /id="tab-artifacts" class="tab-body hidden"/);
  assert.match(html, /<script src="artifacts-panel\.js"><\/script>/);
});

test('switchTab toggles #tab-artifacts like the other two tabs', () => {
  const switchTab = /function switchTab\(tab\) \{[\s\S]*?\n\}/.exec(appSrc)[0];
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
  const calls = { openArtifactsAt: [], readArtifact: [] };
  const sandbox = {
    esc: (s) => (s == null ? '' : String(s)),
    artKindIcon: (kind) => `<i data-kind="${kind}"></i>`,
    fmtSize: (n) => (n == null ? '' : `${n} B`),
    markdownHtml: (t) => `<md>${t}</md>`,
    renderJsonText: (t) => t,
    renderDelimited: (t) => `<table>${t}</table>`,
    errMsg: (e) => String(e?.message || e),
    openArtifactsAt: (...a) => calls.openArtifactsAt.push(a),
    api: {
      listArtifacts: opts.listArtifacts || (async () => [{ artifacts: [] }]),
      readArtifact: opts.readArtifact || (async (p) => { calls.readArtifact.push(p); return { text: '' }; }),
    },
    window: {},
    document: {},
    setTimeout, clearTimeout, Date,
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return { ArtifactsPanel: sandbox.window.ArtifactsPanel, calls };
}

// A fake DOM element good enough for mount()/render()/paintPreview(): innerHTML is just stored (no
// parsing), and querySelector('.ap-body') returns the one element paintPreview looks for.
function fakeRoot() {
  const body = { innerHTML: '' };
  const root = {
    classList: { add() {} },
    addEventListener() {},
    isConnected: true,
    _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v; },
    querySelector: (sel) => (sel === '.ap-body' ? body : null),
    querySelectorAll: () => [],
  };
  return { root, body };
}

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

test('mount/setRun: lists a fixture run\'s artifacts (a document, a screenshot pair, a handoff note) with the right count, newest first', async () => {
  const files = [
    { path: '/r/decisions.tsv', name: 'decisions.tsv', rel: 'decisions.tsv', kind: 'table', size: 40, mtime: '2026-01-01T00:00:00Z' },
    { path: '/r/handoffs/developer.md', name: 'developer.md', rel: 'handoffs/developer.md', kind: 'markdown', size: 500, mtime: '2026-01-03T00:00:00Z', step: 'develop', agent: 'developer' },
    { path: '/r/screenshots/before.png', name: 'before.png', rel: 'screenshots/before.png', kind: 'image', size: 10, mtime: '2026-01-02T00:00:00Z' },
    { path: '/r/screenshots/after.png', name: 'after.png', rel: 'screenshots/after.png', kind: 'image', size: 10, mtime: '2026-01-02T00:00:01Z' },
  ];
  const { ArtifactsPanel } = loadPanel({ listArtifacts: async () => [{ artifacts: files }] });
  const { root } = fakeRoot();
  let count = null;
  const panel = ArtifactsPanel.mount(root, { runId: 'r1', onCount: (n) => { count = n; } });
  await waitTick();
  assert.equal(count, 4, 'every artifact counted, screenshots included');
  assert.equal(panel.count(), 4);
  assert.match(root.innerHTML, /Handoff notes/);
  assert.match(root.innerHTML, /developer\.md/);
  assert.match(root.innerHTML, /Screenshots and evidence/);
  assert.match(root.innerHTML, /Decisions/);
  // groups are rendered in a fixed order (documents, evidence, handoffs, decisions, other), not by recency
  const groupOrder = ['Screenshots and evidence', 'Handoff notes', 'Decisions'].map((g) => root.innerHTML.indexOf(g));
  assert.deepEqual(groupOrder, [...groupOrder].sort((a, b) => a - b));
  // within the evidence group, after.png (newer) comes before before.png
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

test('preview: a before/after pair from screenshots.json renders both images side by side', async () => {
  const files = [
    { path: '/r/screenshots/before.png', name: 'before.png', rel: 'screenshots/before.png', kind: 'image', size: 1, mtime: '2026-01-01T00:00:00Z' },
    { path: '/r/screenshots/after.png', name: 'after.png', rel: 'screenshots/after.png', kind: 'image', size: 1, mtime: '2026-01-01T00:00:01Z' },
    { path: '/r/screenshots/screenshots.json', name: 'screenshots.json', rel: 'screenshots/screenshots.json', kind: 'other', size: 1, mtime: '2026-01-01T00:00:01Z' },
  ];
  const { ArtifactsPanel } = loadPanel({
    listArtifacts: async () => [{ artifacts: files }],
    readArtifact: async (p) => {
      if (p.endsWith('screenshots.json')) return { text: JSON.stringify([{ path: 'after.png', before: 'before.png', caption: 'Login page' }]) };
      if (p.endsWith('after.png')) return { image: 'data:after' };
      if (p.endsWith('before.png')) return { image: 'data:before' };
      return {};
    },
  });
  const { root, body } = fakeRoot();
  const panel = ArtifactsPanel.mount(root, { runId: 'r1' });
  await waitTick();
  panel.select({ path: '/r/screenshots/after.png' });
  await waitTick(100);
  assert.match(body.innerHTML, /class="ap-pair"/);
  assert.match(body.innerHTML, /Before[\s\S]*data:before/);
  assert.match(body.innerHTML, /After[\s\S]*data:after/);
  assert.match(body.innerHTML, /Login page/);
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
