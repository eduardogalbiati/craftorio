// #580 review: scripts/source-tree.js is the one place that knows the page layout. appPages() gives the
// apps' page folders, pageDirs() the layers that hold page files (the kit, the fronts, the apps' pages),
// featureDirs() the folders Playwright reads; scripts/docs.js, playwright.config.js and the tests ask
// these instead of naming `apps/*/renderer` or `fronts/*/features` themselves. Temporary trees only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { appPages, featureDirs, pageDirs } = require('../scripts/source-tree');

function tmpRoot(t, files) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'source-tree-layout-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const all = { 'package.json': JSON.stringify({ name: 'tmp', workspaces: ['packages/*', 'fronts/*', 'apps/*'] }), ...files };
  for (const [rel, content] of Object.entries(all)) {
    const abs = path.join(tmp, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return tmp;
}
const pkg = (name) => JSON.stringify({ name });

test('appPages, pageDirs and featureDirs on a tree with the kit, two fronts and two apps', (t) => {
  const root = tmpRoot(t, {
    'packages/ui-kit/package.json': pkg('@multiagent/ui-kit'),
    'fronts/build/package.json': pkg('@multiagent/front-build'),
    'fronts/ai/package.json': pkg('@multiagent/front-ai'),
    'apps/desktop/package.json': pkg('@multiagent/desktop'),
    'apps/desktop/renderer/index.html': '',
    'apps/web/package.json': pkg('@multiagent/web'),
    'apps/web/renderer/index.html': '',
    'apps/cli/package.json': pkg('@multiagent/cli'),
  });
  assert.deepEqual(appPages(root), [{ app: 'apps/desktop', page: 'apps/desktop/renderer' }, { app: 'apps/web', page: 'apps/web/renderer' }], 'an app without a renderer/ folder has no page');
  assert.deepEqual(pageDirs(root), ['packages/ui-kit', 'fronts/ai', 'fronts/build', 'apps/desktop/renderer', 'apps/web/renderer']);
  assert.deepEqual(featureDirs(root), ['features', 'packages/ui-kit/features', 'fronts/ai/features', 'fronts/build/features']);
});

test('before phase 3 (no kit, no front): the page folder alone, the root features alone', (t) => {
  const root = tmpRoot(t, { 'apps/desktop/package.json': pkg('@multiagent/desktop'), 'apps/desktop/renderer/index.html': '' });
  assert.deepEqual(pageDirs(root), ['apps/desktop/renderer']);
  assert.deepEqual(featureDirs(root), ['features']);
  assert.deepEqual(appPages(tmpRoot(t, {})), [], 'no apps folder: no pages');
});
