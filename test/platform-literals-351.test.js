// #351: the GitHub / GitLab differences live in the platform adapters (src/shared/platforms/). This
// walks src/ for the platform ids in platform position ('github', 'gitlab', 'gh', 'gl' as a quoted
// literal) outside the adapters: a branch on the platform calls the adapter instead. EXCEPTIONS are
// the uses that are not a platform branch, with the most occurrences each file may keep; the list may
// only shrink (lower a ceiling or drop an entry, never raise or add one).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'src');
const ADAPTERS = path.join(ROOT, 'shared', 'platforms');
const LITERAL = /(['"`])(github|gitlab|gh|gl)\1/g;
const EXCEPTIONS = {
  'actions-usage.js': 2, // the GitHub Actions billing API: a GitHub-only feature run with the gh CLI
  'auth.js': 1, // the GitHub sign-in (OAuth) provider, not a git platform
  'renderer/setup.js': 1, // the CLIs the setup checks
  'service/areas/settings.js': 1, // the CLIs the settings check
  'shared/setup-model.js': 1, // the CLIs the setup describes
  'workspace.js': 1, // the gh credential helper for github.com clones
};

function jsFiles(dir) {
  return fs.readdirSync(dir, { recursive: true })
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.join(dir, f))
    .filter((f) => fs.statSync(f).isFile());
}

const rel = (file) => path.relative(ROOT, file).split(path.sep).join('/');
const isComment = (line) => /^\s*(\/\/|\/\*|\*)/.test(line);

// file (relative to src/, with /) → the lines with a platform literal, outside comments
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

test('the platform adapters exist: src/shared/platforms/github.js and gitlab.js', () => {
  assert.equal(fs.existsSync(path.join(ADAPTERS, 'github.js')), true);
  assert.equal(fs.existsSync(path.join(ADAPTERS, 'gitlab.js')), true);
});

test('no \'github\' / \'gitlab\' / \'gh\' / \'gl\' literal in src/ outside the platform adapters (listed exceptions only)', () => {
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

test('every listed exception is still a file of src/', () => {
  const missing = Object.keys(EXCEPTIONS).filter((f) => !fs.existsSync(path.join(ROOT, ...f.split('/'))));
  assert.deepEqual(missing, []);
});
