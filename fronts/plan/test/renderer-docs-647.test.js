// #647 Write doc phase 1 (docs/work/write-doc/spec.md R1): the Documents screen (Plan & Design ›
// Documents, fronts/plan/views/docs/docs.js). The real page in the renderer harness
// (packages/ui-kit/test/renderer-app-harness.js) with a fake window.api. The contract assumed here:
// - the view registers as id 'docs' with nav { label: t('nav.docs') = 'Documents', group: 'plan' };
// - show() calls window.api.listDocItems (channel docs:list) and draws each item
//   ([data-testid="docs-item"]) with its name and stage, and a New item control ([data-testid="docs-new-item"]);
// - Write & Review (duo) and AI Arena (arena) stay in the menu until phase 2.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, navEntries, text } = require('@craftorio/ui-kit/test/renderer-app-harness');

const ITEMS = [
  { item: 'write-doc', stage: 'design', docs: [
    { doc: 'intent', file: 'docs/work/write-doc/intent.md', status: 'accepted', translation: 'intent.pt-BR.md' },
    { doc: 'spec', file: 'docs/work/write-doc/spec.md', status: 'draft', translation: 'spec.pt-BR.md' },
  ] },
  { item: 'offline-mode', stage: 'intent', docs: [
    { doc: 'intent', file: 'docs/work/offline-mode/intent.md', status: 'draft', translation: 'intent.pt-BR.md' },
  ] },
];

async function documents() {
  const app = loadApp({
    storage: { 'craftorio.currentProject': 'p1' },
    api: {
      listProjects: async () => [{ id: 'p1', name: 'Project One', repo: 'https://github.com/o/r' }],
      getSettings: async () => ({ lastProject: 'p1' }),
      listDocItems: async () => ITEMS,
    },
  });
  await app.boot();
  app.run("showView('docs')");
  await app.settle(10);
  return app;
}
// all the markup the page's elements hold, the view's own markup included
const allMarkup = (app) => [...app.elements.values(), ...app.created].map((e) => e.innerHTML || '')
  .concat(app.defs.get('docs')?.markup || '').join('\n');

test('#647 the menu has a Documents entry in Plan & Design', () => {
  const app = loadApp();
  const entry = navEntries(app.defs).find((e) => e.id === 'docs');
  assert.ok(entry, 'no docs menu entry');
  assert.equal(entry.group, 'plan');
  assert.equal(text(entry.label), 'Documents');
});

test('#647 opening Documents lists each item with its name and stage', async () => {
  const app = await documents();
  assert.equal(app.callsTo('listDocItems').length > 0, true, 'listDocItems was not called');
  const html = allMarkup(app);
  const t = text(html);
  assert.equal(t.includes('write-doc'), true, 'the write-doc item is not shown');
  assert.equal(t.includes('offline-mode'), true, 'the offline-mode item is not shown');
  assert.match(t, /design/i);
  assert.equal(html.includes('data-testid="docs-item"'), true, 'the items are not marked docs-item');
});

test('#647 the Documents screen offers New item', async () => {
  const app = await documents();
  assert.equal(allMarkup(app).includes('data-testid="docs-new-item"'), true);
});

test('#647 #648 Write & Review and AI Arena leave the menu in phase 2', () => {
  const ids = navEntries(loadApp().defs).map((e) => e.id);
  assert.deepEqual(['duo', 'arena'].filter((id) => ids.includes(id)), []);
});

// ---- the editor: gates, a new document's run --------------------------------------------------
const SPEC_DOC = { item: 'write-doc', doc: 'spec', status: 'draft', source: { file: 'docs/work/write-doc/spec.md', markdown: '# Spec\n' }, translation: null };

// The Documents screen with a project that has a folder; `api` overrides the defaults.
async function editorApp(api = {}) {
  const app = loadApp({
    storage: { 'craftorio.currentProject': 'p1' },
    api: {
      listProjects: async () => [{ id: 'p1', name: 'Project One', repo: 'https://github.com/o/r', folder: 'C:/repo' }],
      getSettings: async () => ({ lastProject: 'p1' }),
      listDocItems: async () => ITEMS,
      readDoc: async () => SPEC_DOC,
      listDocChanges: async () => ({ changes: [], unreviewed: [], base: 'abc123' }),
      startRun: async () => ({ runId: 'r9' }),
      ...api,
    },
  });
  await app.boot();
  app.run("showView('docs')");
  await app.settle(10);
  return app;
}
const gateHtml = (app) => app.el('#docs-gate').innerHTML || '';
const editorError = (app) => String(app.el('#docs-editor-error').textContent || '');
// the spec of write-doc open, followed from a run whose gate is `gate`
async function openWithGate(app, gate) {
  await app.run("DocsActions.openDoc('write-doc', 'spec')");
  await app.settle(10);
  await app.run(`DocsActions.follow('r1', [${JSON.stringify({ type: 'approval.requested', approval_id: 'a7', ...gate })}])`);
  await app.settle(10);
}

test('#647 a merge_blocked gate (no choices) offers retry and stop, never accept', async () => {
  const app = await editorApp();
  await openWithGate(app, { step_id: 'merge', choices: null, message: 'The merge into main failed.' });
  const html = gateHtml(app);
  assert.equal(html.includes('data-testid="doc-gate-retry"'), true, 'no retry button');
  assert.equal(html.includes('data-testid="doc-gate-stop"'), true, 'no stop button');
  assert.equal(html.includes('data-testid="doc-gate-accept"'), false, 'accept offered at a merge gate');
  assert.equal(text(html).includes('The merge into main failed.'), true);
});

test('#647 retry at a merge_blocked gate answers true and never accepts the document', async () => {
  const app = await editorApp();
  await openWithGate(app, { step_id: 'merge', choices: null });
  await app.click('#docs-editor', { dataset: { docsGate: 'yes' } });
  await app.settle(10);
  assert.deepEqual(app.callsTo('resolveApproval').map((a) => [a[0], a[1], a[3]]), [['a7', true, 'r1']]);
  assert.equal(app.callsTo('acceptDoc').length, 0);
});

test('#647 stop at a merge_blocked gate answers false and never accepts the document', async () => {
  const app = await editorApp();
  await openWithGate(app, { step_id: 'merge', choices: [] });
  await app.click('#docs-editor', { dataset: { docsGate: 'no' } });
  await app.settle(10);
  assert.deepEqual(app.callsTo('resolveApproval').map((a) => [a[0], a[1]]), [['a7', false]]);
  assert.equal(app.callsTo('acceptDoc').length, 0);
});

test('#647 the approval gate restored without its choices still offers sign off and back to the edit', async () => {
  const app = await editorApp({
    listDocItems: async () => [{ ...ITEMS[0], runId: 'r1', runDoc: 'spec' }],
    listActiveRuns: async () => [{ runId: 'r1', gates: [{ approval_id: 'a4', step_id: 'approval', message: 'Sign off the spec?' }] }],
  });
  await app.click('#docs-list', { dataset: { item: 'write-doc', docsOpen: 'spec', run: 'r1' } });
  await app.settle(10);
  const html = gateHtml(app);
  assert.equal(html.includes('data-testid="doc-gate-accept"'), true, 'no sign-off button');
  assert.equal(html.includes('data-docs-gate="revise"'), true, 'no back-to-the-edit button');
  assert.equal(html.includes('doc-gate-retry'), false);
  await app.click('#docs-editor', { dataset: { docsGate: 'accept' } });
  await app.settle(10);
  assert.deepEqual(app.callsTo('acceptDoc').map((a) => [a[1], a[2]]), [['write-doc', 'spec']]);
  assert.deepEqual(app.callsTo('resolveApproval').map((a) => [a[0], a[1]]), [['a4', 'accept']]);
});

test('#647 writing the spec of an item starts write-doc from the project default branch', async () => {
  const app = await editorApp({ projectInputHints: async () => ({ defaultBranch: 'develop' }), readDoc: async () => { throw new Error('No spec for offline-mode yet.'); } });
  await app.click('#docs-list', { dataset: { docsWriteSpec: 'yes', item: 'offline-mode' } });
  await app.settle(10);
  const runs = app.callsTo('startRun');
  assert.equal(runs.length, 1, 'startRun was not called once');
  assert.equal(runs[0][0].file, 'write-doc.yaml');
  assert.deepEqual({ ...runs[0][0].inputs }, { project_path: 'C:/repo', item: 'offline-mode', document: 'spec', title: 'offline-mode', base_branch: 'develop' });
});

test('#647 without the project hints the run starts with no base_branch input', async () => {
  const app = await editorApp({ projectInputHints: async () => { throw new Error('no remote'); }, readDoc: async () => { throw new Error('No spec for offline-mode yet.'); } });
  await app.click('#docs-list', { dataset: { docsWriteSpec: 'yes', item: 'offline-mode' } });
  await app.settle(10);
  const runs = app.callsTo('startRun');
  assert.equal(runs.length, 1, 'startRun was not called once');
  assert.equal('base_branch' in runs[0][0].inputs, false);
  assert.equal(runs[0][0].inputs.document, 'spec');
});

test('#647 a new document shows no error while its run has not written the skeleton', async () => {
  const app = await editorApp({ readDoc: async () => { throw new Error('No spec for offline-mode yet.'); } });
  await app.click('#docs-list', { dataset: { docsWriteSpec: 'yes', item: 'offline-mode' } });
  await app.settle(10);
  assert.equal(app.callsTo('readDoc').length > 0, true, 'the document was not read');
  assert.equal(editorError(app), '');
  assert.equal(String(app.el('#docs-list-error').textContent || ''), '');
  assert.equal(app.callsTo('startRun').length, 1, 'the writer run did not start');
});

test('#647 a successful read of the document clears the error of a failed one', async () => {
  let fail = true;
  const app = await editorApp({ readDoc: async () => { if (fail) throw new Error('disk unavailable'); return SPEC_DOC; } });
  await app.run("DocsActions.openDoc('write-doc', 'spec')");
  await app.settle(10);
  assert.equal(editorError(app).includes('disk unavailable'), true, 'the failed read shows no error');
  fail = false;
  app.run("showView('docs')");
  await app.settle(10);
  assert.equal(editorError(app), '');
});
