// Acceptance tests for #602: no test depends on the gitignored .test-output/ folder existing before
// it runs. fs.mkdtempSync never creates its parent, so a test that makes its temp dir under
// .test-output/ must create that folder first (fs.mkdirSync(..., { recursive: true })); otherwise
// it ends with ENOENT on a fresh checkout (a run's worktree, CI, the base check of #598).
// Seam: the test files themselves, read as text (the folder cannot be removed from this checkout
// while other tests and the runner's human log use it).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const SKIP = new Set(['node_modules', 'fixtures', '.test-output']);

function jsFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFiles(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function testFolders() {
  const folders = [path.join(root, 'test')];
  for (const area of ['packages', 'fronts', 'apps']) {
    const base = path.join(root, area);
    if (!fs.existsSync(base)) continue;
    for (const name of fs.readdirSync(base)) folders.push(path.join(base, name, 'test'));
  }
  return folders;
}

// Each mkdtempSync call whose line names .test-output, with the text of its file before it.
function mkdtempsUnderTestOutput() {
  const calls = [];
  for (const file of testFolders().flatMap(jsFiles)) {
    if (file === __filename) continue;
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      if (line.includes('mkdtempSync(') && line.includes("'.test-output'")) {
        calls.push({ file: path.relative(root, file).replace(/\\/g, '/'), line: i + 1, before: lines.slice(0, i).join('\n') });
      }
    });
  }
  return calls;
}

test('#602 every test that makes a temp dir under .test-output/ creates the folder first', () => {
  const missing = mkdtempsUnderTestOutput()
    .filter(({ before }) => !before.split('\n').some((l) => l.includes('mkdirSync(') && l.includes('.test-output') && l.includes('recursive: true')))
    .map(({ file, line }) => `${file}:${line}`);
  assert.deepEqual(missing, [], `mkdtempSync under .test-output/ without fs.mkdirSync(<.test-output>, { recursive: true }) before it: ${missing.join(', ')}`);
});

test('#602 the #402 runner fixtures still live under the repository\'s gitignored .test-output/, so the coverage table lists them', () => {
  const file = path.join(root, 'packages', 'engine', 'test', 'test-runner-budgets-402.test.js');
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /path\.join\(root, '\.test-output'/, 'the fixtures folder is built under the repository root');
  const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim());
  assert.equal(gitignore.some((l) => /^\/?\.test-output\/?$/.test(l)), true, '.test-output/ stays gitignored');
});
