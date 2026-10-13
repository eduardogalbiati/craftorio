// scripts/layers.js internals (#345): the area of a file, a folder no area holds, an exception the
// table allows by now, and the low-level root utilities staying low level.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { areaOf, checkLayers, ENGINE_ROOT_UTILITIES } = require('../scripts/layers.js');

function tree(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'layers-internals-345-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(files)) {
    const abs = path.join(dir, ...file.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
  }
  return dir;
}

test('areaOf: folders, the desktop entry, the root utilities and the domain modules', () => {
  assert.equal(areaOf('src/shared/time-zone.js'), 'shared');
  assert.equal(areaOf('src/engine/run/load.js'), 'engine');
  assert.equal(areaOf('src/service/areas/backlog.js'), 'service');
  assert.equal(areaOf('src/control/index.js'), 'server');
  assert.equal(areaOf('src/server/index.js'), 'server');
  assert.equal(areaOf('src/main.js'), 'desktop');
  assert.equal(areaOf('src/shell.js'), 'utility');
  assert.equal(areaOf('src/backlog.js'), 'root');
  assert.equal(areaOf('src/renderer/views/backlog/backlog.js'), 'renderer');
  assert.equal(areaOf('src/elsewhere/x.js'), null);
});

test('a require from or to a folder no area holds fails, naming the folder to add', (t) => {
  const dir = tree(t, {
    'src/elsewhere/x.js': "module.exports = require('../zz-domain');\n",
    'src/zz-domain.js': 'module.exports = {};\n',
  });
  const problems = checkLayers({ root: dir, exceptions: [] });
  assert.deepEqual(problems.map((p) => `${p.kind} ${p.file}:${p.line}`), ['forbidden src/elsewhere/x.js:1']);
  assert.match(problems[0].message, /src\/elsewhere\/x\.js is in no area/);
});

test('an exception the table allows by now must leave the list', (t) => {
  const dir = tree(t, {
    'src/zz-domain.js': "module.exports = require('./engine/zz-e');\n",
    'src/engine/zz-e.js': 'module.exports = {};\n',
  });
  const problems = checkLayers({ root: dir, exceptions: [{ from: 'src/zz-domain.js', to: 'src/engine/zz-e.js', reason: 'fixture' }] });
  assert.deepEqual(problems.map((p) => p.kind), ['leave-list']);
  assert.match(problems[0].message, /the table allows it now/);
});

test('every root utility exists and requires nothing but other utilities and src/shared/', () => {
  const root = path.join(__dirname, '..');
  assert.deepEqual(ENGINE_ROOT_UTILITIES.filter((f) => !fs.existsSync(path.join(root, f))), []);
  assert.deepEqual(checkLayers({ root }).filter((p) => ENGINE_ROOT_UTILITIES.includes(p.file)), []);
});
