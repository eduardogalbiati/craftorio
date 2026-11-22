// #671 The Diff tab of the Documents screen (mock-3, spec R11): the change's page draws only the sections
// a request touched. fronts/plan/views/docs/docs-diff.js (Node side): words(a, b) → [{ op, text }] word
// diff; compare(before, after, DocModel) → the sections at the change with touched / removed / near and
// the parts of each touched one. fronts/plan/engine/domains/docs.js readAt(dir, { item, doc, commit }) →
// the source at the change's parent and at it (git show), a non-commit refused.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeRepo } = require('@craftorio/engine/test/repo-workflow-fixtures-485');
const DocModel = require('../../../packages/shared/doc-model');
const { compare, words } = require('../views/docs/docs-diff');
const docs = require('../engine/domains/docs');

const SPEC = `---
item: demo
stage: design
status: draft
translation: spec.pt-BR.md
---

# Spec: demo

## Requirements

**R1. List.** The screen lists the items.

**R2. Edit.** The person edits a section.

**R3. Review.** The reviewer leaves notes.
`;
const SPEC_PT = SPEC.replace('translation: spec.pt-BR.md', 'source: spec.md');

test('#671 words joins the unchanged, removed and added words of two texts', () => {
  assert.deepEqual(words('The person edits a section.', 'The person rewrites a section.'), [
    { op: '=', text: 'The person ' },
    { op: '-', text: 'edits' },
    { op: '+', text: 'rewrites' },
    { op: '=', text: ' a section.' },
  ]);
  assert.deepEqual(words('', 'New text'), [{ op: '+', text: 'New text' }]);
  assert.deepEqual(words('same', 'same'), [{ op: '=', text: 'same' }]);
});

test('#671 compare marks the touched requirement, its neighbours near and the far ones untouched', () => {
  const after = SPEC.replace('edits a section', 'rewrites a section');
  const secs = compare(SPEC, after, DocModel);
  const r2 = secs.find((s) => s.label === 'r2');
  assert.equal(r2.touched, true);
  assert.equal(r2.name, 'Edit');
  assert.deepEqual(r2.parts.filter((p) => p.op !== '=').map((p) => [p.op, p.text]), [['-', 'edits'], ['+', 'rewrites']]);
  assert.equal(secs.find((s) => s.label === 'r1').near, true);
  assert.equal(secs.find((s) => s.label === 'r3').near, true);
  assert.equal(secs.filter((s) => s.touched).length, 1);
});

test('#671 compare keeps a removed requirement after its predecessor, its words removed', () => {
  const after = SPEC.replace('\n**R2. Edit.** The person edits a section.\n', '');
  const secs = compare(SPEC, after, DocModel);
  const i = secs.findIndex((s) => s.label === 'r2');
  assert.equal(secs[i].removed, true);
  assert.equal(secs[i - 1].label, 'r1');
  assert.deepEqual(secs[i].parts.map((p) => p.op), ['-']);
});

test('#671 readAt reads the source before and at a request, and refuses what is not a commit', (t) => {
  const r = makeRepo(t, { 'docs/work/demo/spec.md': SPEC, 'docs/work/demo/spec.pt-BR.md': SPEC_PT });
  r.git('config', 'user.name', 'Test');
  r.git('config', 'user.email', 'test@example.com');
  r.git('config', 'core.autocrlf', 'false');
  const { commit } = docs.applyRequest(r.dir, {
    item: 'demo', doc: 'spec', messageId: 'm-0001',
    source: { lines: { start: 14, end: 14 }, text: '**R2. Edit.** The person rewrites a section.' },
    translation: { lines: { start: 14, end: 14 }, text: '**R2. Edit.** The person rewrites a section.' },
  });
  const at = docs.readAt(r.dir, { item: 'demo', doc: 'spec', commit });
  assert.equal(at.file, 'docs/work/demo/spec.md');
  // git's output comes trimmed, on both sides alike
  assert.equal(at.before.replace(/\r\n/g, '\n'), SPEC.trim());
  assert.match(at.after, /rewrites a section/);
  assert.throws(() => docs.readAt(r.dir, { item: 'demo', doc: 'spec', commit: 'HEAD; rm -rf' }));
});
