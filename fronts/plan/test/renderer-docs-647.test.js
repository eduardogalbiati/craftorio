// #647 Write doc phase 1 (docs/work/write-doc/spec.md R1): the Documents screen (Plan & Design ›
// Documents, fronts/plan/views/docs/docs.js). The real page in the renderer harness
// (packages/ui-kit/test/renderer-app-harness.js) with a fake window.api. The contract assumed here:
// - the view registers as id 'docs' with nav { label: t('nav.docs') = 'Documents', group: 'plan' };
// - show() calls window.api.listDocItems (channel docs:list) and draws each item
//   ([data-testid="docs-item"]) with its name and stage, and a New item control ([data-testid="docs-new-item"]);
// - Write & Review (duo) and AI Arena (arena) stay in the menu until phase 2.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, navEntries, text } = require('@multiagent/ui-kit/test/renderer-app-harness');

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
    storage: { 'multiagent.currentProject': 'p1' },
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

test('#647 Write & Review and AI Arena are still in the menu until phase 2', () => {
  const ids = navEntries(loadApp().defs).map((e) => e.id);
  assert.deepEqual(['duo', 'arena'].filter((id) => !ids.includes(id)), []);
});
