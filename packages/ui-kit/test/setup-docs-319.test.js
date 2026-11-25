// #319 (acceptance tests, written before the code): the docs and the renderer's copy point to the
// first-run Setup instead of "keep Simulation mode checked".
// Contract: README.md has a 'Getting started' heading whose section mentions Setup, its Screens
// table (generated from docs/screens/, column "Menu") has a row starting with '| Setup', and it no
// longer says 'Keep **Simulation mode** checked'; docs/agents/renderer.md mentions Setup; no file
// under apps/desktop/renderer says 'use simulation mode'.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pageDirs, pageFile, pageFiles } = require('../../../scripts/source-tree');
const PAGE_ROOT = path.join(__dirname, '..', '..', '..');
// a page file by its page-relative name, wherever its layer is (phase 3 of the reorganisation study)
const page = (rel) => pageFile(PAGE_ROOT, rel);
void pageDirs; void pageFiles; void page;

const root = path.join(__dirname, '..', '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

function filesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? filesUnder(p) : [p];
  });
}

test('README no longer tells the user to keep Simulation mode checked', () => {
  assert.equal(read('README.md').includes('Keep **Simulation mode** checked'), false);
});

test('README has a Getting started section that mentions Setup', () => {
  const readme = read('README.md');
  const m = readme.match(/^#{2,3} Getting started\b.*$/m);
  assert.ok(m, 'a Getting started heading');
  const rest = readme.slice(m.index + m[0].length);
  const next = rest.search(/^#{1,3} /m);
  const section = next === -1 ? rest : rest.slice(0, next);
  assert.match(section, /Setup/);
});

// #69: the Setup is Agents and First project, and the simulation is turned on in Settings
const SETUP_DOCS = ['docs/agents/renderer/screens-and-setup.md', 'docs/readme/010-running.md', 'docs/screens/setup.md'];
for (const file of SETUP_DOCS) {
  test(`#69 ${file} no longer describes the Setup's Try it safely step`, () => {
    assert.equal(/try[ -]it[ -]safely/i.test(read(file)), false);
  });
}

test('#69 the README no longer describes the Setup\'s Try it safely step', () => {
  assert.equal(/Try it safely/i.test(read('README.md')), false);
});

for (const file of ['docs/readme/010-running.md', 'docs/screens/setup.md']) {
  test(`#69 ${file} says two steps and how to turn the simulation on: Settings › Execution › Developer mode`, () => {
    const text = read(file).replace(/\*\*/g, '').replace(/\s+/g, ' ');
    assert.match(text, /Agents/);
    assert.match(text, /First project/);
    assert.match(text, /simulation/i);
    assert.match(text, /Settings › Execution/);
    assert.match(text, /Developer mode/i);
    assert.equal(/Finish[^.]*Simulation checked|on by default here/i.test(text), false, 'not on by default');
  });
}

test('README Screens table has a Setup row', () => {
  assert.ok(read('README.md').split('\n').some((l) => l.startsWith('| Setup')), 'a row starting with "| Setup"');
});

test('docs/agents/renderer.md mentions Setup', () => {
  assert.match(fs.readdirSync(path.join(root, 'docs', 'agents', 'renderer')).map((f) => read(`docs/agents/renderer/${f}`)).join('\n'), /Setup/);
});

test('no renderer file says "use simulation mode"', () => {
  const offenders = pageFiles(root).map((f) => path.join(root, f.file))
    .filter((f) => fs.readFileSync(f, 'utf8').includes('use simulation mode'))
    .map((f) => path.relative(root, f));
  assert.deepEqual(offenders, []);
});
