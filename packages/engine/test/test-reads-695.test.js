// packages/engine/engine/test-reads.js (#695): the paths a test reads from disk, by static analysis.
const test = require('node:test');
const assert = require('node:assert/strict');
const { blankComments, readPattern, readsOf } = require('../engine/test-reads');

const paths = (file, text) => readsOf(file, blankComments(text)).map((r) => r.path);

test('readsOf: constants built from __dirname, a constant path and a literal read', () => {
  const text = [
    "const ROOT = path.join(__dirname, '..', '..');",
    "const SPEC = path.join(ROOT, 'docs', 'work', 'a', 'spec.md');",
    "fs.readFileSync(SPEC, 'utf8');",
    "fs.readdirSync('workflows');",
    '',
  ].join('\n');
  assert.deepEqual(paths('apps/x/spec.test.js', text), ['docs/work/a/spec.md', 'workflows']);
});

test('readsOf: a read written inside a string, a comment, a temp folder or a path outside the repository is none', () => {
  const text = [
    "const src = \"fs.readFileSync('docs/work/a.md')\";",
    "// fs.readFileSync('docs/work/b.md')",
    "fs.readFileSync(path.join(dir, 'docs', 'work', 'c.md'));",
    "fs.readFileSync(path.join(__dirname, '..', '..', 'elsewhere.md'));",
    "fs.readFileSync(path.join(__dirname, '..'));",
    '',
  ].join('\n');
  assert.deepEqual(paths('test/x.test.js', text), []);
});

test('readsOf and readPattern: a non-literal folder before a literal is any folders; a read path reaches what is under it', () => {
  const [p] = paths('apps/desktop/test/v.test.js', "const ROOT = path.join(__dirname, '..', '..', '..');\nfs.existsSync(path.join(ROOT, dir, 'views'));\n");
  assert.equal(p, '**/views');
  const re = readPattern(p);
  assert.equal(re.test('fronts/plan/views/docs/docs.js'), true);
  assert.equal(re.test('fronts/plan/viewsx/a.js'), false);
  assert.equal(readPattern('src/a.js').test('src/a.js'), true);
  assert.equal(readPattern('src/a.js').test('src/a.json'), false);
  assert.deepEqual(paths('test/x.test.js', "fs.readdirSync(path.join(__dirname, dir));\n"), []);
});
