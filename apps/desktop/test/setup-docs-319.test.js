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

test('README Screens table has a Setup row', () => {
  assert.ok(read('README.md').split('\n').some((l) => l.startsWith('| Setup')), 'a row starting with "| Setup"');
});

test('docs/agents/renderer.md mentions Setup', () => {
  assert.match(read('docs/agents/renderer.md'), /Setup/);
});

test('no renderer file says "use simulation mode"', () => {
  const offenders = filesUnder(path.join(root, 'apps', 'desktop', 'renderer'))
    .filter((f) => fs.readFileSync(f, 'utf8').includes('use simulation mode'))
    .map((f) => path.relative(root, f));
  assert.deepEqual(offenders, []);
});
