// #647 Write doc phase 1 (docs/work/write-doc/plan.md, Proof): the screenshot seed of the Documents
// screen, `npm run screenshot -- --view docs --mode <list|editor|changes|review|sign-off>`.
// Plain Node only: no Electron window is opened here.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const load = () => require(path.join(__dirname, '..', 'scripts', 'screenshot', 'views', 'docs.js'));

test('#647 the docs screenshot view exports a seed function', () => {
  assert.equal(typeof load().seed, 'function');
});

test('#647 the docs screenshot view has the modes list, editor, changes, review and sign-off', () => {
  assert.deepEqual(load().modes, ['list', 'editor', 'changes', 'review', 'sign-off']);
});
