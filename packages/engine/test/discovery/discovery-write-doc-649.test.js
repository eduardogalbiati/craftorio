// #649 (write-doc phase 3, R1): a Discovery card's "Write a document" run comes back on the card.
// packages/engine/domains/discovery/discovery.js: recordResult(dir, projectId, id, { source: 'write-doc', text, runId })
// is a known result source; the text is kept as a version (result-write-doc) and as a .md attachment of
// the card (readCard(...).attachments lists the names; readAttachment gives its folder).
// The module is required inside each test so this file loads before the change exists.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { layout } = require('../../domains/workspace/workspace');

const load = () => require('../../domains/discovery/discovery');
const P = 'p1';
const DOC = '# Export runs\n\nThe runs are exported as CSV, once a night.\n';

function tmp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-write-doc-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return layout(root).discovery;
}

test('recordResult accepts the write-doc source and keeps the document as a write-doc version', (t) => {
  const d = load();
  const dir = tmp(t);
  const c = d.createCard(dir, P, { title: 'Export runs', text: 'draft' });
  let card;
  assert.doesNotThrow(() => { card = d.recordResult(dir, P, c.id, { source: 'write-doc', text: DOC, runId: 'run-wd' }); });
  assert.equal(card.document, DOC);
  const versions = d.listVersions(dir, P, c.id);
  const mine = versions.find((v) => /write-doc/.test(v.name));
  assert.ok(mine, `a write-doc version among ${versions.map((v) => v.name).join(', ')}`);
  assert.equal(d.readVersion(dir, P, c.id, mine.name), DOC);
});

test('recordResult with write-doc brings the document back as a .md attachment of the card', (t) => {
  const d = load();
  const dir = tmp(t);
  const c = d.createCard(dir, P, { title: 'Export runs', text: 'draft' });
  d.recordResult(dir, P, c.id, { source: 'write-doc', text: DOC, runId: 'run-wd' });
  const names = d.readCard(dir, P, c.id).attachments;
  const md = names.filter((n) => /\.md$/i.test(n));
  assert.equal(md.length, 1, `one .md attachment, got ${JSON.stringify(names)}`);
  const att = d.readAttachment(dir, P, c.id, md[0]);
  assert.equal(fs.readFileSync(path.join(att.folder, att.name), 'utf8'), DOC);
});
