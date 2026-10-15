// #249: the screenshot seeds split per view. Each view's simulated data and options live in their
// own module under scripts/screenshot/views/<view>.js, which the runner discovers (no list to edit);
// scripts/screenshot.js keeps only the shared runner, and the code map's "how to add a screen" says
// where a new screen's seed goes. Plain Node only: no Electron window is opened here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RUNNER = path.join(ROOT, 'scripts', 'screenshot.js');
const SEEDS_DIR = path.join(ROOT, 'scripts', 'screenshot', 'views');
const RENDERER_VIEWS = path.join(ROOT, 'src', 'renderer', 'views');

// a fresh copy of the runner, so a seed module added during a test is discovered
function loadRunner() {
  for (const key of Object.keys(require.cache)) {
    if (key === RUNNER || key.startsWith(path.join(ROOT, 'scripts', 'screenshot') + path.sep)) delete require.cache[key];
  }
  return require(RUNNER);
}

function seedFiles() {
  if (!fs.existsSync(SEEDS_DIR)) return [];
  return fs.readdirSync(SEEDS_DIR).filter((f) => f.endsWith('.js')).sort();
}

test('every view of --view has its own seed module in scripts/screenshot/views/', () => {
  const { VIEWS } = loadRunner();
  const views = Object.keys(VIEWS).sort();
  assert.deepEqual(seedFiles().map((f) => f.replace(/\.js$/, '')).sort(), views);
});

test('every screen folder with a screenshot view has a seed module', () => {
  const { VIEWS } = loadRunner();
  const folders = fs.readdirSync(RENDERER_VIEWS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  const missing = [];
  let checked = 0;
  for (const folder of folders) {
    // the folder runchat is the view run-chat; a folder without a view (supervisor) has no screenshot
    const view = Object.keys(VIEWS).find((v) => v.replace(/-/g, '') === folder);
    if (!view) continue;
    checked++;
    if (!fs.existsSync(path.join(SEEDS_DIR, `${view}.js`))) missing.push(`${folder} -> scripts/screenshot/views/${view}.js`);
  }
  assert.ok(checked >= 20, `only ${checked} screen folders matched a view`);
  assert.deepEqual(missing, []);
});

test('every seed module loads under plain Node, without Electron', () => {
  const files = seedFiles();
  assert.ok(files.length > 0, 'scripts/screenshot/views/ has no seed module');
  const failed = [];
  for (const f of files) {
    try {
      require(path.join(SEEDS_DIR, f));
    } catch (err) {
      failed.push(`${f}: ${String(err && err.message).split('\n')[0]}`);
    }
  }
  assert.deepEqual(failed, []);
});

// #394: the throwaway view lives in a folder of its own, never in scripts/screenshot/views/, which
// test/screenshot.test.js loads in parallel; the runner's loadViews(dir) discovers it there
test('a new seed module is a new --view without editing scripts/screenshot.js', (t) => {
  const name = 'zz-acceptance-249';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'views-249-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // assumption: a seed module with no exports is a view with no tabs, modes or demo data
  fs.writeFileSync(path.join(dir, `${name}.js`), '// a throwaway view of test/screenshot-seeds-249.test.js\nmodule.exports = {};\n');
  const { loadViews, parseArgs } = loadRunner();
  const views = loadViews(dir);
  assert.equal(Object.prototype.hasOwnProperty.call(views, name), true);
  assert.equal(parseArgs(['--view', name], views).view, name);
});

test('scripts/screenshot.js keeps only the shared runner: no per-view seeding left in it', () => {
  const src = fs.readFileSync(RUNNER, 'utf8');
  const leftovers = [
    ...(src.match(/args\.view\s*===\s*['"][\w-]+['"]/g) || []),
    ...(src.match(/\]\.includes\(args\.view\)/g) || []),
    ...(src.match(/^(?:async )?function demo\w+/gm) || []),
  ];
  assert.deepEqual(leftovers, []);
});

test('code map: "how to add a screen" says where the seed goes, not an edit of scripts/screenshot.js', () => {
  const { codeMap } = require('../scripts/docs');
  const map = String(codeMap(ROOT));
  const start = map.indexOf('**A screen**');
  assert.ok(start >= 0, 'the code map has no "A screen" entry');
  const entry = map.slice(start, map.indexOf('\n- ', start) === -1 ? undefined : map.indexOf('\n- ', start));
  assert.match(entry, /scripts\/screenshot\/views\//);
  assert.doesNotMatch(entry, /in `scripts\/screenshot\.js`/);
});

test('renderer.md no longer asks for a VIEWS entry in scripts/screenshot.js for a new screen', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'agents', 'renderer.md'), 'utf8');
  assert.doesNotMatch(doc, /`VIEWS` entry in\s+`scripts\/screenshot\.js`/);
  assert.match(doc, /scripts\/screenshot\/views\//);
});
