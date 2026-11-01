// #670 internals: po-mockups.js reads a spec's phases (`## Phases` / `## Later phases`, each with its
// `Mockups:` line) and proposes one issue per phase with the mockup coverage (the simulated answer).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { specPhases, specProposal } = require('../../domains/po/po-mockups');

const SPEC = [
  '---', 'stage: spec', 'status: signed-off', '---', '',
  '# Spec: Export runs as CSV', '',
  '## Requirements', '', '![Screen 1](images/mock-1.jpg)', '',
  '## Phases', '',
  '### Phase 1', '', 'Mockups: mock-1.jpg, mock-2.jpg', '',
  '### Phase 2', '', 'Mockups: `mock-3.jpg`', '',
  '## Later phases', '', '### Phase 3', '', 'Mockups: mock-5.jpg', '',
].join('\n');

function project(t, mockups) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  const item = path.join(dir, 'docs', 'work', 'export-runs-as-csv');
  fs.mkdirSync(path.join(item, 'images'), { recursive: true });
  fs.writeFileSync(path.join(item, 'spec.md'), SPEC);
  for (const m of mockups) fs.writeFileSync(path.join(item, 'images', m), 'x');
  return dir;
}

test('specPhases: the phases with their mockups, and the later ones', () => {
  assert.deepEqual(specPhases(SPEC), {
    phases: [{ name: 'Phase 1', mockups: ['mock-1.jpg', 'mock-2.jpg'] }, { name: 'Phase 2', mockups: ['mock-3.jpg'] }],
    later: ['mock-5.jpg'],
  });
});

test('specProposal: one issue per phase, every mockup covered, the later ones listed', (t) => {
  const folder = project(t, ['mock-1.jpg', 'mock-2.jpg', 'mock-3.jpg', 'mock-5.jpg']);
  const out = specProposal({ folder, question: 'Create the issues of docs/work/export-runs-as-csv/spec.md', mock: true });
  assert.equal(out.item, 'export-runs-as-csv');
  assert.deepEqual(out.issues.map((i) => i.title), ['Export runs as CSV: Phase 1', 'Export runs as CSV: Phase 2']);
  assert.match(out.issues[0].body, /Matches `mock-1\.jpg`: layout, icons, texts, controls, order/);
  assert.deepEqual(out.coverage.covered.map((c) => c.mockup), ['mock-1.jpg', 'mock-2.jpg', 'mock-3.jpg']);
  assert.deepEqual(out.coverage.later, ['mock-5.jpg']);
  assert.equal(out.coverage.ok, true);
});

test('specProposal: a mockup no phase names blocks; the model\'s issues replace the phases', (t) => {
  const folder = project(t, ['mock-1.jpg', 'mock-4.jpg']);
  const q = 'docs/work/export-runs-as-csv';
  assert.deepEqual(specProposal({ folder, question: q, mock: true }).coverage.errors, ['mock-4.jpg has no issue']);
  const own = specProposal({ folder, question: q, issues: [{ title: 'All screens', body: 'mock-1.jpg and mock-4.jpg' }] });
  assert.deepEqual(own.issues, [{ title: 'All screens', body: 'mock-1.jpg and mock-4.jpg' }]);
  assert.equal(own.coverage.ok, true);
});

test('specProposal: a real answer without issues proposes none, the coverage shows every mockup missing', (t) => {
  const folder = project(t, ['mock-1.jpg']);
  const out = specProposal({ folder, question: 'docs/work/export-runs-as-csv' });
  assert.deepEqual(out.issues, []);
  assert.deepEqual(out.coverage.errors, ['mock-1.jpg has no issue']);
});

test('specProposal: null without a spec or without a docs/work item in the question', (t) => {
  const folder = project(t, []);
  assert.equal(specProposal({ folder, question: 'What next?' }), null);
  assert.equal(specProposal({ folder, question: 'docs/work/other-item' }), null);
});
