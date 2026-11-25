// #52, internals of scripts/typecheck.js the acceptance tests (typecheck-coverage-52.test.js) do not reach:
// which lines count as silenced, the deleted files of the lists, the two jsconfigs, and nextFiles where git cannot say.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkRatchet, checkSilenced, nextFiles, typecheck } = require('../../../scripts/typecheck.js');

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

test('#52 @ts-expect-error and a cast to * silence the checker too', (t) => {
  const dir = project(t, {
    'src/expect.js': '// @ts-check\n// @ts-expect-error\nmodule.exports = 1;\n',
    'src/star.js': '// @ts-check\nmodule.exports = /** @type {*} */ (1);\n',
    'src/why.js': '// @ts-check\nmodule.exports = /** @type { * } */ (1); // it comes from outside\n',
  });
  const kinds = checkSilenced({ root: dir, recorded: { 'src/expect.js': 1, 'src/star.js': 1, 'src/why.js': 1 } }).map((p) => `${p.file}:${p.line} ${p.kind}`);
  assert.deepEqual(kinds, ['src/expect.js:2 no-reason', 'src/star.js:2 no-reason']);
});

test('#52 a deleted file still in NEXT or UNCHECKED fails until it leaves the list', (t) => {
  const dir = project(t, { 'src/old.js': 'module.exports = 1;\n' });
  const problems = checkRatchet({ root: dir, checked: [], next: ['src/gone-next.js'], unchecked: ['src/gone.js', 'src/old.js'] });
  assert.deepEqual(problems.map((p) => `${p.file} ${p.kind}`), ['src/gone-next.js leave-list', 'src/gone.js leave-list']);
  assert.match(problems[0].message, /NEXT/);
  assert.match(problems[1].message, /UNCHECKED/);
});

test('#52 the browser names are known in the files of jsconfig.pages.json only, and an error of both configs is told once', async (t) => {
  const body = 'module.exports = document.title;\n';
  const dir = project(t, {
    'src/engine.js': `// @ts-check\n${body}`,
    'pages/screen.js': "// @ts-check\nconst shared = require('../src/shared');\nmodule.exports = [document.title, shared];\n",
    'src/shared.js': '// @ts-check\n/** @type {number} */\nmodule.exports.n = "x";\n',
    'jsconfig.pages.json': JSON.stringify({ extends: './jsconfig.json', compilerOptions: { lib: ['es2023', 'dom'] }, files: ['pages/screen.js'], include: ['pages/**/*.js'] }),
  });
  const found = (await typecheck({ root: dir })).map((e) => `${posix(path.relative(fs.realpathSync(dir), fs.realpathSync(e.file)))}:${e.line}`);
  assert.deepEqual(found.sort(), ['src/engine.js:2', 'src/shared.js:3']);
});

test('#52 nextFiles outside a git repository: the commits are unknown (null), never 0', async (t) => {
  const dir = project(t, { 'src/b.js': 'module.exports = 1;\n', 'src/a.js': '/** @type {number} */\nconst n = "x";\nmodule.exports = { n };\n' });
  assert.deepEqual(await nextFiles({ root: dir }), [
    { file: 'src/a.js', fixes: null, changes: null, errors: 1 },
    { file: 'src/b.js', fixes: null, changes: null, errors: 0 },
  ]);
});
