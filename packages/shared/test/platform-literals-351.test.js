// #351: the GitHub / GitLab differences live in the platform adapters (packages/shared/platforms/). This
// walks every source file (scripts/source-tree.js) for the platform ids in platform position ('github', 'gitlab', 'gh', 'gl' as a quoted
// literal) outside the adapters: a branch on the platform calls the adapter instead. EXCEPTIONS are
// the uses that are not a platform branch, with the most occurrences each file may keep; the list may
// only shrink (lower a ceiling or drop an entry, never raise or add one).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { sourceFiles } = require('../../../scripts/source-tree');

const ROOT = path.join(__dirname, '..', '..', '..');
const ADAPTERS = path.join(__dirname, '..', 'platforms');
const LITERAL = /(['"`])(github|gitlab|gh|gl)\1/g;
const EXCEPTIONS = {
  'packages/shared/setup-model.js': 1, // the CLIs the setup describes
  'src/domains/usage/actions-usage.js': 2, // the GitHub Actions billing API: a GitHub-only feature run with the gh CLI
  'src/domains/workspace/workspace.js': 1, // the gh credential helper for github.com clones
  'src/host/auth.js': 1, // the GitHub sign-in (OAuth) provider, not a git platform
  'src/renderer/setup.js': 1, // the CLIs the setup checks
  'src/service/areas/settings.js': 1, // the CLIs the settings check
};

const jsFiles = (root) => sourceFiles(root).map((f) => path.join(root, ...f.split('/')));

const rel = (file) => path.relative(ROOT, file).split(path.sep).join('/');
const isComment = (line) => /^\s*(\/\/|\/\*|\*)/.test(line);

// file (relative to the repository, with /) → the lines with a platform literal, outside comments
function platformLiterals() {
  const found = {};
  for (const file of jsFiles(ROOT)) {
    if (file.startsWith(`${ADAPTERS}${path.sep}`)) continue;
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, n) => {
      if (isComment(line)) return;
      const hits = line.match(LITERAL) || [];
      for (const hit of hits) (found[rel(file)] ||= []).push(`${rel(file)}:${n + 1}: ${hit} in ${line.trim().slice(0, 160)}`);
    });
  }
  return found;
}

test('the platform adapters exist: packages/shared/platforms/github.js and gitlab.js', () => {
  assert.equal(fs.existsSync(path.join(ADAPTERS, 'github.js')), true);
  assert.equal(fs.existsSync(path.join(ADAPTERS, 'gitlab.js')), true);
});

test('no \'github\' / \'gitlab\' / \'gh\' / \'gl\' literal in the sources outside the platform adapters (listed exceptions only)', () => {
  const offenders = [];
  for (const [file, lines] of Object.entries(platformLiterals())) {
    const allowed = EXCEPTIONS[file] || 0;
    if (lines.length > allowed) offenders.push(...lines);
  }
  assert.deepEqual(offenders, []);
});

test('the literal check sees a platform branch (the check is not blind)', () => {
  const line = "if (platform === 'gitlab') return { cli: 'glab' };";
  assert.deepEqual(line.match(LITERAL), ["'gitlab'"]);
  assert.deepEqual("t.platform === 'gh'".match(LITERAL), ["'gh'"]);
  assert.equal("const cli = 'glab'; const host = 'github.com';".match(LITERAL), null);
});

test('every listed exception is still a source file', () => {
  const missing = Object.keys(EXCEPTIONS).filter((f) => !fs.existsSync(path.join(ROOT, ...f.split('/'))));
  assert.deepEqual(missing, []);
});
