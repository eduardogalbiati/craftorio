// #399: addedGates (src/workflows.js), the human gates a workspace copy has and its bundled default
// lacks, which the control channel refuses to remove with a restore.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { addedGates } = require('../src/workflows');

function dirs(t, bundled, copy) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'added-gates-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const src = path.join(root, 'src');
  const dest = path.join(root, 'dest');
  fs.mkdirSync(src);
  fs.mkdirSync(dest);
  if (bundled != null) fs.writeFileSync(path.join(src, 'w.yaml'), bundled);
  if (copy != null) fs.writeFileSync(path.join(dest, 'w.yaml'), copy);
  return { src, dest };
}

const BUNDLED = 'steps:\n  - id: plan\n    type: agent\n  - id: approve\n    type: human_approval\n';

test('addedGates: the copy\'s human_approval steps the default lacks, nested ones included', (t) => {
  const copy = `${BUNDLED}  - id: extra\n    type: human_approval\n  - id: both\n    type: parallel\n    steps:\n      - id: inner_gate\n        type: human_approval\n`;
  const { src, dest } = dirs(t, BUNDLED, copy);
  assert.deepEqual(addedGates(src, dest, 'w.yaml'), ['extra', 'inner_gate']);
});

test('addedGates: none when the copy only edits or removes steps', (t) => {
  const { src, dest } = dirs(t, BUNDLED, 'steps:\n  - id: plan\n    type: agent\n    prompt: edited\n');
  assert.deepEqual(addedGates(src, dest, 'w.yaml'), []);
});

test('addedGates: a missing or unreadable copy has no gate to keep', (t) => {
  const { src, dest } = dirs(t, BUNDLED, 'steps: [: not yaml');
  assert.deepEqual(addedGates(src, dest, 'w.yaml'), []);
  assert.deepEqual(addedGates(src, dest, 'missing.yaml'), []);
});
