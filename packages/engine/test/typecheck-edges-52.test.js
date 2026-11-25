// #52, the edges the review named and the acceptance tests (typecheck-coverage-52.test.js) do not reach: the rule
// for new files on another checkout (`node scripts/check.js --root <dir>`), errors that share a line and a message,
// which of this repository's two jsconfigs knows the browser's names, and which subjects count as a fix.
// Seam: scripts/typecheck.js { checkRatchet, nextFiles, typecheck }.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const ts = require('typescript');
const { CHECKED, UNCHECKED, checkRatchet, nextFiles, typecheck } = require('../../../scripts/typecheck.js');

const root = path.join(__dirname, '..', '..', '..');
const posix = (p) => String(p).replace(/\\/g, '/');
const TYPE_ROOTS = [posix(path.join(root, 'node_modules', '@types'))];

function write(dir, files) {
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
}

function scratch(t, files) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'typecheck-edges-52-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  write(dir, files);
  return dir;
}

const JSCONFIG = JSON.stringify({ extends: posix(path.join(root, 'jsconfig.json')), compilerOptions: { typeRoots: TYPE_ROOTS }, include: ['src/**/*.js'] });

// this repository's own jsconfig, with the types of its node_modules (a scratch folder has none)
function ownConfig(name) {
  const { config } = ts.parseConfigFileTextToJson(name, fs.readFileSync(path.join(root, name), 'utf8'));
  return JSON.stringify({ ...config, compilerOptions: { ...config.compilerOptions, typeRoots: TYPE_ROOTS } });
}

function configFiles(name) {
  const parsed = ts.getParsedCommandLineOfConfigFile(path.join(root, name), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
  return new Set(parsed.fileNames.map((f) => posix(path.relative(root, f))));
}

test('#52 on another checkout of this repository, a file recorded in UNCHECKED is not a new file; one in no list is', (t) => {
  const [older] = UNCHECKED;
  const dir = scratch(t, { [older]: 'module.exports = 1;\n', 'packages/shared/zz-new-52.js': 'module.exports = 1;\n' });
  const news = checkRatchet({ root: dir }).filter((p) => p.kind === 'new-file').map((p) => p.file);
  assert.deepEqual(news, ['packages/shared/zz-new-52.js']);
});

test('#52 two type errors on one line with the same message are two, also in the errors of nextFiles', async (t) => {
  const body = 'const half = (/** @type {number} */ n) => n / 2;\nconst s = String(half(1));\nmodule.exports = [half(s), half(s)];\n';
  const dir = scratch(t, { 'jsconfig.json': JSCONFIG, 'src/loose.js': body });
  const [row] = await nextFiles({ root: dir });
  assert.deepEqual({ file: row.file, errors: row.errors }, { file: 'src/loose.js', errors: 2 });
  write(dir, { 'src/loose.js': `// @ts-check\n${body}` });
  assert.deepEqual((await typecheck({ root: dir })).map((e) => e.line), [4, 4]);
});

test('#52 with the jsconfigs of this repository, an engine file that uses a browser name fails and a screen passes', async (t) => {
  const uses = '// @ts-check\nmodule.exports = document.title;\n';
  const dir = scratch(t, {
    'jsconfig.json': ownConfig('jsconfig.json'),
    'jsconfig.pages.json': ownConfig('jsconfig.pages.json'),
    'packages/contract/node-globals.js': fs.readFileSync(path.join(root, 'packages', 'contract', 'node-globals.js'), 'utf8'),
    'packages/contract/page-globals.js': '// @ts-check\n',
    'apps/desktop/renderer/zz.js': uses,
    'fronts/build/views/zz.js': uses,
    'packages/ui-kit/zz.js': uses,
    'apps/desktop/host/zz.js': uses,
    'packages/engine/engine/zz.js': uses,
    'packages/shared/zz.js': uses,
  });
  const found = (await typecheck({ root: dir })).map((e) => posix(path.relative(dir, e.file))).sort();
  assert.deepEqual(found, ['apps/desktop/host/zz.js', 'packages/engine/engine/zz.js', 'packages/shared/zz.js']);
});

test('#52 every file that opted in is in one of the two jsconfigs, so tsc really checks it', () => {
  const covered = new Set([...configFiles('jsconfig.json'), ...configFiles('jsconfig.pages.json')]);
  assert.deepEqual(CHECKED.filter((f) => !covered.has(f)), []);
});

test('#52 nextFiles counts a fix by the first word of the subject: Fix, fixes and Fixed, not Fixture or a fix named later', async (t) => {
  const dir = scratch(t, { 'jsconfig.json': JSCONFIG, 'src/a.js': 'module.exports = 0;\n' });
  const git = (...args) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, stdio: 'pipe' });
  git('init', '-q');
  const subjects = ['Start', 'Fix a crash', 'fixes #3', 'Fixed: the empty list', 'Fixture for the list', 'A panel, with a fix'];
  subjects.forEach((subject, i) => {
    write(dir, { 'src/a.js': `module.exports = ${i};\n` });
    git('add', '-A');
    git('commit', '-q', '-m', subject);
  });
  const [row] = await nextFiles({ root: dir });
  // the commit that creates the file is not a change of it (walkHistory of packages/shared/architecture-model.js)
  assert.deepEqual({ fixes: row.fixes, changes: row.changes }, { fixes: 3, changes: 5 });
});
