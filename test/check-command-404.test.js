// Acceptance tests for #404: `npm run check` runs the repository's fast, deterministic rule checks
// (lint:lists, layers, the file-size ratchet, code health, the decisions log, docs --check, the
// typecheck ratchet, the Oracle's capabilities list), prints one actionable line per finding and
// exits non-zero when there is one.
// Seam: the npm script itself, run on this checkout (it passes) and on a copy of the repository
// with one planted breakage per rule (each finding is reported, naming what broke). The copy lives
// in the gitignored .test-output/ of this checkout, so its scripts resolve this checkout's
// node_modules without a link.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const TIMEOUT = 300000;
// what a copy of the repository leaves out: dependencies, git, and gitignored output folders
const SKIP = new Set(['.features-gen', '.git', '.test-output', 'build', 'dist', 'node_modules', 'playwright-report', 'runs', 'target', 'test-results']);

function npmCheck(cwd) {
  const started = Date.now();
  const r = spawnSync('npm', ['run', 'check'], { cwd, shell: true, encoding: 'utf8', timeout: TIMEOUT, env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' } });
  return { status: r.status, out: `${r.stdout || ''}\n${r.stderr || ''}`, seconds: (Date.now() - started) / 1000 };
}

function write(dir, rel, text) {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
}

// A copy of the repository with one breakage per rule; returns the copy's folder.
function brokenCopy() {
  const parent = path.join(root, '.test-output');
  fs.mkdirSync(parent, { recursive: true });
  const dir = fs.mkdtempSync(path.join(parent, 'check-404-'));
  for (const name of fs.readdirSync(root).filter((n) => !SKIP.has(n))) {
    fs.cpSync(path.join(root, name), path.join(dir, name), { recursive: true, filter: (src) => !SKIP.has(path.basename(src)) });
  }

  // lint:lists: four names exported on one line
  // (each planted file has a header comment, so docs --check does not name it too)
  write(dir, 'scripts/zz-lists-404.js', '// planted by test/check-command-404.test.js\nconst a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\n\nmodule.exports = { d, c, b, a };\n');
  // layers: src/shared/ requires the engine
  write(dir, 'src/shared/zz-layers-404.js', "// planted by test/check-command-404.test.js\nmodule.exports = require('../engine/workflow');\n");
  // file-size ratchet: a new file over 1000 lines
  write(dir, 'scripts/zz-size-404.js', `${Array.from({ length: 1005 }, (_, i) => `// planted line ${i + 1}`).join('\n')}\n`);
  // code health: one function far above the complexity cap
  const branches = Array.from({ length: 40 }, (_, i) => `  if (x === ${i}) return ${i * 7};`).join('\n');
  write(dir, 'scripts/zz-complex-404.js', `// planted by test/check-command-404.test.js\nfunction zzComplex404(x) {\n${branches}\n  return -1;\n}\n\nmodule.exports = { zzComplex404 };\n`);
  // typecheck ratchet: a file opts in with // @ts-check without being listed in CHECKED
  write(dir, 'src/zz-typecheck-404.js', '// @ts-check\n// planted by test/check-command-404.test.js\nmodule.exports = 1;\n');
  // decisions log: an entry with no issue, older than the next one (not newest first)
  const decisions = path.join(dir, 'docs', 'agents', 'decisions.md');
  const lines = fs.readFileSync(decisions, 'utf8').replace(/\r\n/g, '\n').split('\n');
  const first = lines.findIndex((l) => /^\s*(?:#{2,4}\s+|[-*]\s+|\|\s*)[*_]*\d{4}-\d{2}-\d{2}/.test(l));
  assert.ok(first > 0, 'docs/agents/decisions.md has a dated entry');
  const table = /^\s*\|/.test(lines[first]);
  lines.splice(first, 0, ...(table ? ['| 2001-01-01 | Zz planted decision | none | none |'] : ['- **2001-01-01**: Zz planted decision with nothing else.', '']));
  fs.writeFileSync(decisions, lines.join('\n'));
  // docs --check: a new README fragment the README does not have yet
  const fragments = fs.readdirSync(path.join(dir, 'docs', 'readme')).filter((f) => f.endsWith('.md')).sort();
  write(dir, `docs/readme/${fragments[0].replace(/\.md$/, 'x.md')}`, '## Zz fragment 404\n\nPlanted by test/check-command-404.test.js.\n');
  // the Oracle's capabilities list: capabilities.md no longer names issues_search
  const caps = path.join(dir, 'docs', 'agents', 'capabilities.md');
  fs.writeFileSync(caps, fs.readFileSync(caps, 'utf8').split('issues_search').join('issues_zz'));
  return dir;
}

test('package.json has a check script', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(typeof (pkg.scripts || {}).check, 'string', 'scripts.check is missing');
  assert.ok(pkg.scripts.check.trim().length > 0);
});

test('npm run check passes on this checkout, in a few minutes at most', { timeout: TIMEOUT + 10000 }, () => {
  const { status, out, seconds } = npmCheck(root);
  assert.equal(status, 0, `npm run check failed:\n${out.slice(-3000)}`);
  // the issue asks for about a minute; the bound leaves room for a loaded machine
  assert.ok(seconds < 180, `npm run check took ${seconds} s`);
});

test('npm run check fails on a copy that breaks every rule, with one finding per rule naming what broke', { timeout: TIMEOUT + 60000 }, (t) => {
  let dir;
  try {
    dir = brokenCopy();
  } finally {
    t.after(() => dir && fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  }
  const { status, out } = npmCheck(dir);
  assert.notEqual(status, 0, `npm run check passed on the broken copy:\n${out.slice(-3000)}`);
  const lines = out.split(/\r?\n/);
  const has = (re) => lines.some((l) => re.test(l));
  const missing = [
    ['lint:lists', /zz-lists-404/],
    ['layers', /zz-layers-404/],
    ['file-size ratchet', /zz-size-404/],
    ['code health', /zz-complex-404|zzComplex404/],
    ['typecheck ratchet', /zz-typecheck-404/],
    ['decisions log', /decisions/i],
    ['docs --check', /README/],
    ['Oracle capabilities list', /issues_search/],
  ].filter(([, re]) => !has(re)).map(([rule]) => rule);
  assert.deepEqual(missing, [], `rules with no finding line in the output:\n${out.slice(-4000)}`);
});
