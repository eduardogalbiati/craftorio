// #52, internals of scripts/typecheck.js the acceptance tests (typecheck-coverage-52.test.js) do not reach:
// which lines count as silenced, and nextFiles where git cannot say.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkSilenced, nextFiles } = require('../../../scripts/typecheck.js');

const root = path.join(__dirname, '..', '..', '..');
const posix = (p) => String(p).replace(/\\/g, '/');

function project(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'typecheck-int-52-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  const jsconfig = { extends: posix(path.join(root, 'jsconfig.json')), compilerOptions: { typeRoots: [posix(path.join(root, 'node_modules', '@types'))] }, include: ['src/**/*.js'] };
  for (const [rel, text] of Object.entries({ 'jsconfig.json': JSON.stringify(jsconfig), ...files })) {
    const file = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  return dir;
}

test('#52 a comment that only names a directive is not a silenced line; a block directive and two casts on a line are one each', (t) => {
  const dir = project(t, {
    'src/named.js': '// @ts-check\n// never write `@ts-ignore` here, nor see @ts-nocheck\nmodule.exports = 1;\n',
    'src/block.js': '// @ts-check\r\n/* @ts-ignore: the library lacks it */\r\nmodule.exports = 1;\r\n',
    'src/two.js': '// @ts-check\nmodule.exports = [/** @type {any} */ (1), /** @type {any} */ (2)]; // both come from outside\n',
  });
  assert.deepEqual(checkSilenced({ root: dir, recorded: { 'src/block.js': 1, 'src/two.js': 1 } }), []);
});

test('#52 a block directive without text, and a URL before the cast, give no reason', (t) => {
  const dir = project(t, {
    'src/block.js': '// @ts-check\n/* @ts-ignore */\nmodule.exports = 1;\n',
    'src/url.js': "// @ts-check\nmodule.exports = ['https://x.y', /** @type {any} */ (1)];\n",
  });
  const kinds = checkSilenced({ root: dir, recorded: { 'src/block.js': 1, 'src/url.js': 1 } }).map((p) => `${p.file}:${p.line} ${p.kind}`);
  assert.deepEqual(kinds, ['src/block.js:2 no-reason', 'src/url.js:2 no-reason']);
});

test('#52 nextFiles outside a git repository: the commits are unknown (null), never 0', async (t) => {
  const dir = project(t, { 'src/b.js': 'module.exports = 1;\n', 'src/a.js': '/** @type {number} */\nconst n = "x";\nmodule.exports = { n };\n' });
  assert.deepEqual(await nextFiles({ root: dir }), [
    { file: 'src/a.js', fixes: null, changes: null, errors: 1 },
    { file: 'src/b.js', fixes: null, changes: null, errors: 0 },
  ]);
});
