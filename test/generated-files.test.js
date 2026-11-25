// The generated files and limits checked before the suite (scripts/generated-files.js, `npm run check`'s
// `generated` rule): contract.json, the #590 test's contract hash pin and the docs' size limit, each
// finding naming the command that fixes it; `npm run contract` rewrites the pin with contract.json.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const tmp = (t, prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
};

test('this checkout: contract.json, the #590 pin and the docs are current; npm run check runs the rule', () => {
  const { checkGenerated } = require('../scripts/generated-files');
  assert.deepEqual(checkGenerated(ROOT), []);
  const { RULES } = require('../scripts/check');
  assert.ok(RULES.some(([name]) => name === 'generated'), 'npm run check has the generated rule');
});

test('the pin: read from the #590 test, a different hash names npm run contract, and writePin rewrites it', (t) => {
  const { checkPin, pinnedHash, PIN_FILE, writePin } = require('../scripts/contract');
  assert.match(pinnedHash(), /^[0-9a-f]{12}$/, `the pin of ${PIN_FILE}`);
  const file = path.join(tmp(t, 'pin-'), 'pin.test.js');
  fs.writeFileSync(file, "const a = 1;\nconst MAIN_CONTRACT = 'aaaaaaaaaaaa';\nconst b = 2;\n");
  assert.equal(checkPin('aaaaaaaaaaaa', file), null);
  const problem = checkPin('bbbbbbbbbbbb', file);
  assert.match(problem, /aaaaaaaaaaaa/);
  assert.match(problem, /bbbbbbbbbbbb/);
  assert.match(problem, /run npm run contract/);
  assert.equal(writePin('bbbbbbbbbbbb', file), true);
  assert.equal(fs.readFileSync(file, 'utf8'), "const a = 1;\nconst MAIN_CONTRACT = 'bbbbbbbbbbbb';\nconst b = 2;\n");
  assert.equal(checkPin('bbbbbbbbbbbb', file), null);
});

test('the pin: a file without one, or no file, is nothing to check and nothing to write', (t) => {
  const { checkPin, writePin } = require('../scripts/contract');
  const file = path.join(tmp(t, 'pin-'), 'none.test.js');
  assert.equal(checkPin('bbbbbbbbbbbb', file), null);
  assert.equal(writePin('bbbbbbbbbbbb', file), false);
  fs.writeFileSync(file, 'const x = 1;\n');
  assert.equal(checkPin('bbbbbbbbbbbb', file), null);
  assert.equal(writePin('bbbbbbbbbbbb', file), false);
  assert.equal(fs.readFileSync(file, 'utf8'), 'const x = 1;\n');
});

test('contract.json behind the engine names npm run contract', (t) => {
  const { checkContract } = require('../scripts/contract');
  const file = path.join(tmp(t, 'contract-'), 'contract.json');
  fs.writeFileSync(file, `${JSON.stringify({ hash: '000000000000', entries: [] }, null, 1)}\n`);
  const problem = checkContract(file, { hash: '111111111111', entries: [] });
  assert.match(problem, /000000000000 → 111111111111/);
  assert.match(problem, /run npm run contract/);
  assert.equal(checkContract(file, { hash: '000000000000', entries: [] }), null);
});

test('a docs/agents file over 200 lines names the split and npm run docs; a scratch root has no finding', (t) => {
  const { checkGenerated } = require('../scripts/generated-files');
  const root = tmp(t, 'generated-');
  assert.deepEqual(checkGenerated(root), [], 'nothing of the repository: no finding');
  fs.mkdirSync(path.join(root, 'docs', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'agents', 'short.md'), '# Short\n\nA summary.\n');
  fs.writeFileSync(path.join(root, 'docs', 'agents', 'long.md'), `# Long\n\nA summary.\n${'line\n'.repeat(210)}`);
  fs.writeFileSync(path.join(root, 'docs', 'agents', 'decisions.md'), `# Decisions\n\nA summary.\n${'line\n'.repeat(210)}`);
  const problems = checkGenerated(root);
  assert.equal(problems.length, 1, JSON.stringify(problems));
  assert.match(problems[0], /^docs\/agents\/long\.md has 213 lines/);
  assert.match(problems[0], /npm run docs/);
});
