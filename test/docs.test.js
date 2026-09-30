// #77: shared docs generated from per-feature fragments instead of hand-edited shared lists.
// Seams: scripts/docs.js's own exports (renderReadme, missingHeaders, codeMap, main).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { codeMap, main, missingHeaders, renderReadme } = require('../scripts/docs.js');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

test('README.md tables are up to date with the generator', () => {
  const readme = read(path.join(root, 'README.md'));
  assert.equal(renderReadme(readme, root), readme);
});

test('every source file has a header comment the code map can build from', () => {
  assert.deepEqual(missingHeaders(root), []);
});

test('the generated code map documents the channel manifest folder', () => {
  assert.match(codeMap(root), /src\/service\/manifest\.js/);
  assert.match(codeMap(root), /src\/service\/channels\//);
});

// A temporary copy of only what the generator reads (skills/, docs/screens/, README.md): editing
// one skill's summary there must not touch the real repository's files.
function tmpDocsRoot(t) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-root-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  fs.cpSync(path.join(root, 'skills'), path.join(tmp, 'skills'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'docs'));
  fs.cpSync(path.join(root, 'docs', 'screens'), path.join(tmp, 'docs', 'screens'), { recursive: true });
  fs.copyFileSync(path.join(root, 'README.md'), path.join(tmp, 'README.md'));
  return tmp;
}

test('a skill\'s frontmatter change is picked up by the README table, and --check reports the README as stale', (t) => {
  const tmp = tmpDocsRoot(t);
  const skillFile = path.join(tmp, 'skills', 'code-review', 'SKILL.md');
  fs.writeFileSync(skillFile, read(skillFile).replace(/^summary: .*$/m, 'summary: "Changed for this test"'));

  const readme = read(path.join(tmp, 'README.md'));
  const rendered = renderReadme(readme, tmp);
  assert.notEqual(rendered, readme);
  assert.match(rendered, /Changed for this test/);

  assert.equal(main(['--check'], tmp), 1);
});

test('--check passes on an up-to-date copy', (t) => {
  const tmp = tmpDocsRoot(t);
  // missingHeaders(tmp) would fail on the copy (no src/scripts/ there to check), so --check only
  // reports the README here: confirm it is silent when nothing changed.
  assert.equal(main(['--check'], tmp), 0);
});
