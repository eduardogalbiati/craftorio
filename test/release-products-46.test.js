// #46: this repository's two products, the app and the engine, as .craftorio/project.yaml declares them,
// and the version command of each one run in a scratch copy of the files Changesets reads and writes
// (every version set to 2.0.0 there, the pending changesets replaced, so today's versions never matter).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, execSync } = require('child_process');
const yaml = require('js-yaml');

const ROOT = path.join(__dirname, '..');
const emptyConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gitcfg-')), 'config');
fs.writeFileSync(emptyConfig, '');
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (cwd, ...args) => execFileSync('git', ['-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, env: ENV, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 }).toString().trim();
const readJson = (dir, f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const writeJson = (dir, f, o) => fs.writeFileSync(path.join(dir, f), `${JSON.stringify(o, null, 2)}\n`);

// the products of .craftorio/project.yaml, by id
function products() {
  const doc = yaml.load(fs.readFileSync(path.join(ROOT, '.craftorio', 'project.yaml'), 'utf8'));
  const list = Array.isArray(doc.products) ? doc.products : [];
  assert.deepEqual(list.map((p) => p.id).sort(), ['app', 'engine'], 'the manifest declares the app and the engine');
  return Object.fromEntries(list.map((p) => [p.id, p]));
}

// the workspace packages: { <package name>: its folder }
function packages(dir) {
  const out = {};
  for (const pattern of readJson(dir, 'package.json').workspaces) {
    const base = pattern.replace(/\/\*$/, '');
    const folders = pattern.endsWith('/*') ? fs.readdirSync(path.join(dir, base)).map((n) => `${base}/${n}`) : [base];
    for (const f of folders) if (fs.existsSync(path.join(dir, f, 'package.json'))) out[readJson(dir, `${f}/package.json`).name] = f;
  }
  return out;
}

const SECTIONS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
// a scratch copy with every version at 2.0.0 and only the given changesets: { name: text }
function scratch(t, changesets) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'release-products-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  const wanted = (f) => /(^|\/)(package\.json|CHANGELOG\.md)$/.test(f) || f === 'package-lock.json' || /^(\.changeset|\.craftorio|scripts)\//.test(f);
  for (const f of git(ROOT, 'ls-files', '-co', '--exclude-standard').split('\n').filter((x) => wanted(x) && fs.existsSync(path.join(ROOT, x)))) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  }
  const own = packages(dir);
  const at2 = (pkg) => {
    if (pkg.version) pkg.version = '2.0.0';
    for (const s of SECTIONS) for (const n of Object.keys(pkg[s] || {})) if (own[n]) pkg[s][n] = pkg[s][n].replace(/\d+\.\d+\.\d+/, '2.0.0');
    return pkg;
  };
  for (const f of ['.', ...Object.values(own)]) writeJson(dir, `${f}/package.json`, at2(readJson(dir, `${f}/package.json`)));
  const lock = readJson(dir, 'package-lock.json');
  lock.version = '2.0.0';
  for (const f of ['', ...Object.values(own)]) if (lock.packages[f]) at2(lock.packages[f]);
  writeJson(dir, 'package-lock.json', lock);
  for (const f of fs.readdirSync(path.join(dir, '.changeset'))) if (f.endsWith('.md') && f !== 'README.md') fs.rmSync(path.join(dir, '.changeset', f));
  for (const [name, text] of Object.entries(changesets)) fs.writeFileSync(path.join(dir, '.changeset', name), text);
  git(dir, 'init', '-q');
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  return { dir, own, app: readJson(dir, '.changeset/config.json').fixed.find((g) => g.includes('@craftorio/desktop')) };
}

// the product's version command in the scratch copy; its output is the failure's message
function version(s, command) {
  try { execSync(command, { cwd: s.dir, env: ENV, stdio: ['ignore', 'pipe', 'pipe'], timeout: 80000 }); } catch (e) {
    assert.fail(`${command} failed: ${String(e.stderr || '').slice(-800)}${String(e.stdout || '').slice(-400)}`);
  }
}
// { <folder, '' for the root>: version }, in the package.json files and in the lockfile
const written = (s) => Object.fromEntries(['', ...Object.values(s.own)].map((f) => [f, readJson(s.dir, `${f || '.'}/package.json`).version]).filter(([, v]) => v));
const locked = (s) => { const { packages: p } = readJson(s.dir, 'package-lock.json'); return Object.fromEntries(['', ...Object.values(s.own)].map((f) => [f, p[f]?.version]).filter(([, v]) => v)); };
// what is expected: 2.1.0 for the folders in `bumped`, 2.0.0 for the others
const expected = (found, bumped) => Object.fromEntries(Object.keys(found).map((f) => [f, bumped.includes(f) ? '2.1.0' : '2.0.0']));
const changeset = (names, text) => `---\n${names.map((n) => `"${n}": minor`).join('\n')}\n---\n\n${text}\n`;

test('#46 the manifest declares the app (apps/desktop, vX.Y.Z) and the engine (packages/engine, engine-vX.Y.Z), each with its version command', () => {
  const p = products();
  assert.deepEqual([p.app.folder, p.app.tag_prefix], ['apps/desktop', 'v']);
  assert.deepEqual([p.engine.folder, p.engine.tag_prefix], ['packages/engine', 'engine-v']);
  for (const id of ['app', 'engine']) assert.equal(typeof p[id].version_command === 'string' && p[id].version_command.trim() !== '', true, `${id} has a version_command`);
});

test('#46 the app\'s version command writes one version in the root, apps/desktop and its fixed group, their changelogs and the lockfile; the engine waits', { timeout: 90000 }, (t) => {
  const { app } = products();
  const s = scratch(t, { 'app-work-11.md': changeset(['@craftorio/ui-kit'], 'A warmer theme.'), 'engine-work-12.md': changeset(['@craftorio/engine'], 'A faster engine.') });
  version(s, app.version_command);
  const bumped = ['', ...s.app.map((n) => s.own[n])];
  assert.deepEqual(written(s), expected(written(s), bumped));
  assert.deepEqual(locked(s), expected(locked(s), bumped));
  assert.match(fs.readFileSync(path.join(s.dir, 'packages/ui-kit/CHANGELOG.md'), 'utf8'), /## 2\.1\.0[\s\S]*A warmer theme\./);
  assert.equal(fs.existsSync(path.join(s.dir, '.changeset/app-work-11.md')), false, 'the app\'s changeset is consumed');
  assert.equal(fs.existsSync(path.join(s.dir, '.changeset/engine-work-12.md')), true, 'the engine\'s changeset waits for its own release');
});

test('#46 the engine\'s version command bumps the engine only, even when a changeset is about the app too', { timeout: 90000 }, (t) => {
  const { engine } = products();
  const s = scratch(t, { 'app-work-11.md': changeset(['@craftorio/ui-kit'], 'A warmer theme.'), 'both-12.md': changeset(['@craftorio/engine', '@craftorio/ui-kit'], 'A faster engine, shown in the app.') });
  version(s, engine.version_command);
  const bumped = ['packages/engine'];
  assert.deepEqual(written(s), expected(written(s), bumped));
  assert.deepEqual(locked(s), expected(locked(s), bumped));
  assert.match(fs.readFileSync(path.join(s.dir, 'packages/engine/CHANGELOG.md'), 'utf8'), /## 2\.1\.0[\s\S]*A faster engine/);
  const left = fs.readdirSync(path.join(s.dir, '.changeset')).filter((f) => f.endsWith('.md') && f !== 'README.md').map((f) => fs.readFileSync(path.join(s.dir, '.changeset', f), 'utf8'));
  assert.equal(left.some((x) => x.includes('A warmer theme.')), true, 'the app\'s changeset waits for its own release');
  assert.equal(left.some((x) => x.includes('A faster engine, shown in the app.') && x.includes('@craftorio/ui-kit')), true, 'the app\'s part of the shared changeset waits too');
  assert.equal(left.some((x) => x.includes('@craftorio/engine')), false, 'the engine\'s part is consumed');
});
