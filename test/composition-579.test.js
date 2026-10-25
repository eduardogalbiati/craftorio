// Phase 3 of the reorganisation study (#579): the tooling learns the UI's composition. scripts/source-tree.js
// lists the fronts (`fronts/<id>` workspaces) and reads an app's composition file; scripts/docs.js
// lays an app's page out from it: the shared modules, the UI kit (app.js first), the fronts' views in
// the composition's order, the app's own page files last, every path relative to the page, a
// `load: after` resolved in the file's own layer, else in the kit. A composition of one front leaves
// the other fronts out. Temporary trees only: nothing here reads the repository's own renderer.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  appPages,
  composition,
  featureDirs,
  frontOf,
  fronts,
  pageDirs,
  uiKit,
  viewsOf,
} = require('../scripts/source-tree');
const { pageLayers, rendererAssets } = require('../scripts/docs');

// A workspace root with the given files ({ 'path/from/root': content }); every folder under
// packages/, fronts/ and apps/ with a package.json is a workspace.
function tmpRoot(t, files) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'composition-579-'));
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
const PAGE = ['<!-- generated:styles -->', '<!-- /generated:styles -->', '<!-- generated:scripts -->', '<!-- /generated:scripts -->', ''].join('\n');

function composedRoot(t, { compositionFile = true } = {}) {
  return tmpRoot(t, {
    'packages/shared/package.json': pkg('@multiagent/shared'),
    'packages/shared/i18n.js': '// shared\n',
    'packages/ui-kit/package.json': pkg('@multiagent/ui-kit'),
    'packages/ui-kit/app.js': '// the shell\n',
    'packages/ui-kit/view-registry.js': '// load: early\n',
    'packages/ui-kit/robots.js': '// robots\n',
    'packages/ui-kit/style.css': '/* tokens\n   load: early */\n',
    'packages/ui-kit/views/dashboard/dashboard.js': '// Home\n',
    'packages/ui-kit/views/dashboard/dashboard.css': '/* Home */\n',
    'fronts/build/package.json': pkg('@multiagent/front-build'),
    'fronts/build/views/backlog/backlog.js': '// the Backlog\n',
    'fronts/build/views/backlog/backlog-po.js': '// load: after robots.js views/backlog/backlog.js\n',
    'fronts/build/views/backlog/backlog.css': '/* the Backlog */\n',
    'fronts/build/views/run/run.js': '// the Run screen\n',
    'fronts/ai/package.json': pkg('@multiagent/front-ai'),
    'fronts/ai/views/oracle/oracle.js': '// the Oracle\n',
    'apps/desktop/package.json': pkg('@multiagent/desktop'),
    ...(compositionFile ? { 'apps/desktop/composition.js': 'module.exports = { fronts: ["build", "ai"] };\n' } : {}),
    'apps/desktop/renderer/index.html': PAGE,
    'apps/web/package.json': pkg('@multiagent/web'),
    'apps/web/composition.js': 'module.exports = { fronts: ["ai"] };\n',
    'apps/web/renderer/index.html': PAGE,
    'apps/web/renderer/api-http.js': '// load: early\n',
  });
}

test('source-tree: fronts() lists the fronts/<id> workspaces by id; uiKit() the kit; viewsOf() a layer\'s screens; frontOf() the layer that holds a screen', (t) => {
  const root = composedRoot(t);
  assert.deepEqual(fronts(root).map((f) => [f.id, f.dir, f.name]), [['ai', 'fronts/ai', '@multiagent/front-ai'], ['build', 'fronts/build', '@multiagent/front-build']]);
  assert.equal(uiKit(root).dir, 'packages/ui-kit');
  assert.deepEqual(viewsOf(root, 'fronts/build'), ['backlog', 'run']);
  assert.deepEqual(viewsOf(root, 'fronts/none'), []);
  assert.equal(frontOf(root, 'backlog').id, 'build');
  assert.equal(frontOf(root, 'dashboard').name, '@multiagent/ui-kit');
  assert.equal(frontOf(root, 'nowhere'), null);
});

test('source-tree: composition() reads <app>/composition.js in its order, defaults to every front without the file, and refuses an unknown front', (t) => {
  const root = composedRoot(t);
  assert.deepEqual(composition(root, 'apps/desktop'), { app: 'apps/desktop', page: 'apps/desktop/renderer', fronts: fronts(root).filter((f) => f.id !== 'x').sort((a, b) => (a.id === 'build' ? -1 : 1)) });
  assert.deepEqual(composition(root, 'apps/web').fronts.map((f) => f.id), ['ai']);
  const bare = composedRoot(t, { compositionFile: false });
  assert.deepEqual(composition(bare, 'apps/desktop').fronts.map((f) => f.id), ['ai', 'build']);
  const wrong = tmpRoot(t, { 'fronts/ai/package.json': pkg('@multiagent/front-ai'), 'apps/desktop/composition.js': 'module.exports = { fronts: ["plan"] };\n' });
  assert.throws(() => composition(wrong, 'apps/desktop'), /names the front "plan", which has no workspace fronts\/plan\//);
  const notList = tmpRoot(t, { 'apps/desktop/composition.js': 'module.exports = { fronts: "ai" };\n' });
  assert.throws(() => composition(notList, 'apps/desktop'), /`fronts` must be a list/);
});

test('docs: pageLayers() = the kit, the composition\'s fronts in order, the app\'s page folder, each with its path prefix from the page', (t) => {
  const root = composedRoot(t);
  assert.deepEqual(pageLayers(root, 'apps/desktop').map((l) => [l.id, l.dir, l.prefix]), [
    ['ui-kit', 'packages/ui-kit', '../../../packages/ui-kit/'],
    ['build', 'fronts/build', '../../../fronts/build/'],
    ['ai', 'fronts/ai', '../../../fronts/ai/'],
    ['app', 'apps/desktop/renderer', ''],
  ]);
});

test('docs: rendererAssets() lays the desktop page out: shared, early files of any layer, the kit (app.js first, root files, views), the fronts in order, then the app\'s files; a front\'s "load: after" reaches the kit', (t) => {
  const root = composedRoot(t);
  assert.deepEqual(rendererAssets(root, '.js', 'apps/desktop'), [
    '../../../packages/shared/i18n.js',
    '../../../packages/ui-kit/view-registry.js',
    '../../../packages/ui-kit/app.js',
    '../../../packages/ui-kit/robots.js',
    '../../../packages/ui-kit/views/dashboard/dashboard.js',
    '../../../fronts/build/views/backlog/backlog.js',
    '../../../fronts/build/views/backlog/backlog-po.js',
    '../../../fronts/build/views/run/run.js',
    '../../../fronts/ai/views/oracle/oracle.js',
  ]);
  assert.deepEqual(rendererAssets(root, '.css', 'apps/desktop'), [
    '../../../packages/ui-kit/style.css',
    '../../../packages/ui-kit/views/dashboard/dashboard.css',
    '../../../fronts/build/views/backlog/backlog.css',
  ]);
});

test('docs: a composition of one front leaves the others out, and the app\'s own early file (api-http.js) loads before the kit', (t) => {
  const root = composedRoot(t);
  const web = rendererAssets(root, '.js', 'apps/web');
  assert.ok(!web.some((f) => f.includes('fronts/build/')), 'the web composition ships no build screen');
  assert.ok(web.includes('../../../fronts/ai/views/oracle/oracle.js'));
  assert.ok(web.indexOf('api-http.js') < web.indexOf('../../../packages/ui-kit/app.js'));
  assert.equal(web[0], '../../../packages/shared/i18n.js');
});

test('docs: a "load: after" naming a file of another front (not the kit) is an error that names both folders', (t) => {
  const root = composedRoot(t);
  fs.writeFileSync(path.join(root, 'fronts', 'ai', 'views', 'oracle', 'oracle.js'), '// load: after views/run/run.js\n');
  assert.throws(() => rendererAssets(root, '.js', 'apps/desktop'), /fronts\/ai\/views\/oracle\/oracle\.js: "load: after views\/run\/run\.js" names no file of fronts\/ai\/ or of packages\/ui-kit\//);
});

test('docs: before the kit has files, the page folder holds the shell (app.js first) and the layout is the one of phase 2', (t) => {
  const root = tmpRoot(t, {
    'packages/ui-kit/package.json': pkg('@multiagent/ui-kit'),
    'fronts/ai/package.json': pkg('@multiagent/front-ai'),
    'apps/desktop/package.json': pkg('@multiagent/desktop'),
    'apps/desktop/renderer/index.html': PAGE,
    'apps/desktop/renderer/api-http.js': '// load: early\n',
    'apps/desktop/renderer/app.js': '// the shell\n',
    'apps/desktop/renderer/zed.js': '// a root module\n',
    'apps/desktop/renderer/views/usage/usage.js': '// a screen\n',
  });
  assert.deepEqual(rendererAssets(root, '.js', 'apps/desktop'), ['api-http.js', 'app.js', 'zed.js', 'views/usage/usage.js']);
});
