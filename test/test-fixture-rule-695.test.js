// #695 "tests never read live documents": acceptance tests written before the code.
//
// `npm run check` (scripts/check.js) gets a rule that refuses a test file reading a path under
// docs/work/ (readFileSync, readdirSync, a path.join with docs/work), naming the file and line and
// saying to copy the document into test/fixtures/.
//
// Seam: scripts/check.js `runChecks(root, rules)` with the rules of RULES that are new in #695 (the
// rule's name and file are the developer's choice; the rules present before #695 are left out so
// the test stays fast and only sees the new rule's lines).
//
// Assumptions:
// - A test file is a `*.test.js` under a test folder (root test/, <workspace>/test/).
// - A mention in a comment, or a `docs/work/...` key of a fixture written into a temp folder, is not
//   a read of the live documents.
// - Production code (not a test) reading docs/work/ is not this rule's business.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.join(__dirname, '..');
// the rules of `npm run check` before #695
const OLD_RULES = ['lint:lists', 'layers', 'file-size', 'code-health', 'decisions', 'docs', 'oracle-capabilities', 'workflows', 'typecheck'];

async function newRuleLines(root) {
  const { runChecks, RULES } = require('../scripts/check');
  const rules = RULES.filter(([name]) => !OLD_RULES.includes(name));
  assert.equal(rules.length > 0, true, 'npm run check has no rule added by #695');
  return runChecks(root, rules);
}

function tmpRoot(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fixture-rule-695-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"fx","workspaces":["packages/*"]}\n');
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  }
  return dir;
}

test('#695 a test reading docs/work/x.md through path.join fails the check, naming the file and line and test/fixtures/', async (t) => {
  const root = tmpRoot(t, {
    'docs/work/x/spec.md': '# Spec\n',
    'test/reads-live.test.js': [
      "const fs = require('fs');",
      "const path = require('path');",
      "const spec = fs.readFileSync(path.join(__dirname, '..', 'docs', 'work', 'x', 'spec.md'), 'utf8');",
      '',
    ].join('\n'),
  });
  const lines = await newRuleLines(root);
  const hit = lines.filter((l) => l.includes('test/reads-live.test.js'));
  assert.equal(hit.length, 1, lines.join('\n'));
  assert.match(hit[0], /test\/reads-live\.test\.js:3\b/);
  assert.match(hit[0], /test\/fixtures/);
});

test('#695 a test reading a docs/work path given as one string, or listing docs/work, fails the check', async (t) => {
  const root = tmpRoot(t, {
    'docs/work/x/plan.md': '# Plan\n',
    'test/string-read.test.js': "const fs = require('fs');\nconst plan = fs.readFileSync('docs/work/x/plan.md', 'utf8');\n",
    'packages/core/test/lists.test.js': "const fs = require('fs');\nconst path = require('path');\nconst items = fs.readdirSync(path.join(__dirname, '..', '..', '..', 'docs/work'));\n",
  });
  const lines = await newRuleLines(root);
  assert.equal(lines.some((l) => /test\/string-read\.test\.js:2\b/.test(l)), true, lines.join('\n'));
  assert.equal(lines.some((l) => /packages\/core\/test\/lists\.test\.js:3\b/.test(l)), true, lines.join('\n'));
});

// the shape of the original offender (test/doc-editor-646.test.js before #695): a local helper
// reading its parameter under the repository root, called with a template naming a docs/work constant
test('#695 a local read helper called with `${DIR}/spec.md` (DIR under docs/work) fails the check at the call', async (t) => {
  const root = tmpRoot(t, {
    'docs/work/x/spec.md': '# Spec\n',
    'test/helper-read.test.js': [
      "const fs = require('fs');",
      "const path = require('path');",
      "const ROOT = path.join(__dirname, '..');",
      "const DIR = 'docs/work/x';",
      "const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');",
      'const spec = read(`${DIR}/spec.md`);',
      '',
    ].join('\n'),
  });
  const lines = await newRuleLines(root);
  const hit = lines.filter((l) => l.includes('test/helper-read.test.js'));
  assert.equal(hit.length >= 1, true, lines.join('\n'));
  assert.equal(hit.some((l) => /test\/helper-read\.test\.js:6\b/.test(l)), true, hit.join('\n'));
  assert.match(hit[0], /test\/fixtures/);
});

test('#695 a comment, a fixture key written into a temp folder and production code reading docs/work are no findings', async (t) => {
  const root = tmpRoot(t, {
    'test/comment.test.js': "// the onboarding example lives in docs/work/first-project-onboarding/spec.md\nrequire('assert');\n",
    'test/temp-repo.test.js': [
      "const fs = require('fs');",
      "const os = require('os');",
      "const path = require('path');",
      "const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'x-'));",
      "const files = { 'docs/work/demo/intent.md': '# Intent\\n' };",
      "for (const [f, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), text);",
      '',
    ].join('\n'),
    'test/fixture-read.test.js': "const fs = require('fs');\nconst path = require('path');\nconst spec = fs.readFileSync(path.join(__dirname, 'fixtures', 'spec.md'), 'utf8');\n",
    'test/fixtures/spec.md': '# Spec\n',
    'src/docs.js': "const fs = require('fs');\nmodule.exports = () => fs.readdirSync('docs/work');\n",
  });
  assert.deepEqual(await newRuleLines(root), []);
});

test('#695 no test of this repository reads a live document under docs/work/', async () => {
  assert.deepEqual(await newRuleLines(REPO), []);
});
