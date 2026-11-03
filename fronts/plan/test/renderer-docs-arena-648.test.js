// #648 (phase 2 of #636, docs/work/write-doc/spec.md R5, R14): "Several writers" (Arena mode) in the
// write-doc draft. The New item panel of the Documents screen (fronts/plan/views/docs, #647/#671) had
// the option drawn but disabled; with phase 2 it can be turned on. Acceptance test, written before the
// code: the real page in the renderer harness with a fake window.api.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('@multiagent/ui-kit/test/renderer-app-harness');

async function docsApp() {
  const app = loadApp({
    storage: { 'multiagent.currentProject': 'p1' },
    api: {
      listProjects: async () => [{ id: 'p1', name: 'Project One', repo: 'https://github.com/o/r', folder: 'C:/repo' }],
      getSettings: async () => ({ lastProject: 'p1' }),
      listDocItems: async () => [],
      listDocChanges: async () => ({ changes: [], unreviewed: [], base: 'abc123' }),
      startRun: async () => ({ runId: 'r9' }),
    },
  });
  await app.boot();
  app.run("showView('docs')");
  await app.settle(10);
  return app;
}

// the opening tag of the element carrying data-testid="<id>" in the page's markup, or ''
function openingTag(app, id) {
  const html = [...app.elements.values(), ...app.created].map((e) => e.innerHTML || '')
    .concat(app.defs.get('docs')?.markup || '', app.defs.get('docs')?.modals || '').join('\n');
  const at = html.indexOf(`data-testid="${id}"`);
  if (at < 0) return '';
  const start = html.lastIndexOf('<', at);
  return html.slice(start, html.indexOf('>', at) + 1);
}

test('#648 the New item panel\'s "Several writers" option can be turned on (no longer disabled)', async () => {
  const app = await docsApp();
  const tag = openingTag(app, 'docs-new-writers');
  assert.notEqual(tag, '', 'no docs-new-writers control');
  assert.equal(/\sdisabled(\s|=|\/|>)/.test(tag), false, `the option is still disabled: ${tag}`);
});
