// #590 (phase 4 of docs/reorganisation-study-2026-10.md): scripts/source-tree.js reads a front's id
// from its package.json's `craftorio.front` (the folder name without it) and lists the fronts'
// engine-side folders (frontEngineDirs: `engine/` by default, `craftorio.engine` names another; only
// the existing ones unless { all: true }). Temporary trees only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { frontEngineDirs, fronts } = require('../scripts/source-tree');

function tmpRoot(t, files) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'source-tree-front-engine-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const all = { 'package.json': JSON.stringify({ name: 'tmp', workspaces: ['packages/*', 'fronts/*', 'apps/*'] }), ...files };
  for (const [rel, content] of Object.entries(all)) {
    const abs = path.join(tmp, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return tmp;
}

test('a front\'s id comes from craftorio.front, its engine folder from craftorio.engine', (t) => {
  const root = tmpRoot(t, {
    'fronts/build/package.json': JSON.stringify({ name: '@craftorio/front-build', craftorio: { front: 'build' } }),
    'fronts/build/engine/channels/x.js': '',
    'fronts/legacy-dir/package.json': JSON.stringify({ name: '@craftorio/front-ai', craftorio: { front: 'ai', engine: 'backend' } }),
    'fronts/legacy-dir/backend/areas/y.js': '',
    'fronts/plan/package.json': JSON.stringify({ name: '@craftorio/front-plan' }),
  });
  assert.deepEqual(fronts(root).map((f) => [f.id, f.dir]), [['ai', 'fronts/legacy-dir'], ['build', 'fronts/build'], ['plan', 'fronts/plan']], 'by id; the folder name without the field');
  assert.deepEqual(frontEngineDirs(root).map((f) => [f.id, f.engine]), [['ai', 'fronts/legacy-dir/backend'], ['build', 'fronts/build/engine']], 'the existing engine folders');
  assert.deepEqual(frontEngineDirs(root, { all: true }).map((f) => f.engine), ['fronts/legacy-dir/backend', 'fronts/build/engine', 'fronts/plan/engine']);
});

test('the repository: every front declares its id, and the engine package reads the same list', () => {
  const root = path.join(__dirname, '..');
  const { installedFronts } = require('@craftorio/engine/service/fronts');
  const ids = fronts(root).map((f) => f.id);
  assert.deepEqual(ids, ['ai', 'analyser', 'build', 'plan']);
  assert.deepEqual(installedFronts(root).map((f) => f.id), ids, 'scripts/source-tree.js and packages/engine/service/fronts.js agree');
  assert.deepEqual(frontEngineDirs(root).map((f) => f.engine), frontEngineDirs(root, { all: true }).filter((f) => fs.existsSync(path.join(root, f.engine))).map((f) => f.engine));
});
