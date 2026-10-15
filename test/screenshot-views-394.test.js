// #394: test/screenshot-seeds-249.test.js wrote a throwaway view into scripts/screenshot/views/ while
// test/screenshot.test.js loaded every view of that folder in parallel ("Cannot find module
// .../zz-acceptance-249.js"). The runner's views loader takes a folder (loadViews(dir)) and parseArgs
// a set of views, so a test uses a folder of its own; VIEWS stays every real view of the folder.
// Plain Node only: no Electron window is opened here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const RUNNER = path.join(ROOT, 'scripts', 'screenshot.js');
const VIEWS_DIR = path.join(ROOT, 'scripts', 'screenshot', 'views');
const loadRunner = () => require(RUNNER);
const realViewFiles = () => fs.readdirSync(VIEWS_DIR).filter((f) => f.endsWith('.js')).map((f) => f.slice(0, -3)).sort();

function tempViews(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'views-394-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  return dir;
}

test('loadViews loads every .js seed module of the folder it is given, keyed by view name', (t) => {
  const dir = tempViews(t, {
    'alpha-394.js': "module.exports = { tabs: ['one'] };\n",
    'beta-394.js': 'module.exports = {};\n',
    'notes.txt': 'not a view\n',
  });
  const views = loadRunner().loadViews(dir);
  assert.deepEqual(Object.keys(views).sort(), ['alpha-394', 'beta-394']);
  assert.deepEqual(views['alpha-394'].tabs, ['one']);
});

test('VIEWS and loadViews of scripts/screenshot/views/ are exactly the real views of the folder', () => {
  const { VIEWS, loadViews } = loadRunner();
  assert.deepEqual(Object.keys(VIEWS).sort(), realViewFiles());
  assert.deepEqual(Object.keys(loadViews(VIEWS_DIR)).sort(), realViewFiles());
  assert.ok(Object.hasOwn(VIEWS, 'dashboard'), 'the dashboard view is loaded');
});

test('a view of another folder is a --view for parseArgs given that folder, never of VIEWS', (t) => {
  const dir = tempViews(t, { 'zz-other-394.js': "module.exports = { modes: ['grid'] };\n" });
  const { VIEWS, loadViews, parseArgs } = loadRunner();
  const views = loadViews(dir);
  assert.equal(parseArgs(['--view', 'zz-other-394', '--mode', 'grid'], views).mode, 'grid');
  assert.equal(Object.hasOwn(VIEWS, 'zz-other-394'), false);
  assert.throws(() => parseArgs(['--view', 'zz-other-394']), /Unknown view: zz-other-394/);
  // without a set of views, parseArgs still takes the real ones
  assert.equal(parseArgs(['--view', 'backlog']).view, 'backlog');
});

test('parseArgs given a folder of views resolves an alias and names unknown views from that folder', (t) => {
  const dir = tempViews(t, {
    'zz-target-394.js': "module.exports = { modes: ['grid'] };\n",
    'zz-alias-394.js': "module.exports = { alias: { view: 'zz-target-394', mode: 'grid' } };\n",
  });
  const { loadViews, parseArgs } = loadRunner();
  const views = loadViews(dir);
  const a = parseArgs(['--view', 'zz-alias-394'], views);
  assert.equal(a.view, 'zz-target-394');
  assert.equal(a.mode, 'grid');
  assert.throws(() => parseArgs(['--view', 'dashboard'], views), /Unknown view: dashboard\. Views: zz-alias-394, zz-target-394$/);
});

test('running test/screenshot-seeds-249.test.js never adds a file to scripts/screenshot/views/', { timeout: 180000 }, async () => {
  const before = new Set(fs.readdirSync(VIEWS_DIR));
  const added = new Set();
  const watcher = fs.watch(VIEWS_DIR, (event, name) => { if (name && !before.has(String(name))) added.add(String(name)); });
  try {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const status = await new Promise((resolve) => {
      const child = spawn(process.execPath, ['--test', '--test-reporter=dot', path.join(__dirname, 'screenshot-seeds-249.test.js')], { cwd: ROOT, env, stdio: 'ignore', windowsHide: true });
      const kill = setTimeout(() => child.kill(), 150000);
      child.on('exit', (code) => { clearTimeout(kill); resolve(code); });
    });
    // watch events of the last writes may arrive just after the child exits
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(typeof status, 'number', 'the seeds test file ran to its end');
  } finally {
    watcher.close();
  }
  assert.deepEqual([...added].sort(), []);
  assert.deepEqual(fs.readdirSync(VIEWS_DIR).filter((f) => !before.has(f)), []);
});
