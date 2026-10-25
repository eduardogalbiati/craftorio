// #259 Column automations, the store's side of a run (packages/engine/domains/discovery/discovery.js): what board.json keeps of a
// column's automation (only the owner's mode, the defaults merged on read), the inputs rendered from
// the card (renderAutomationInputs), the running record (markAutomation) and the result coming back
// (recordAutomation): applied to the document, kept only as a version when the document was edited
// meanwhile, nothing changed when the run failed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { layout } = require('../../domains/workspace/workspace');

const load = () => require('../../domains/discovery/discovery');
const P = 'p1';

function tmp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-auto-record-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, dir: layout(root).discovery };
}

const storedColumn = (dir, id) => JSON.parse(fs.readFileSync(path.join(dir, P, 'board.json'), 'utf8')).columns.find((c) => c.id === id);
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6364f8cf00000301010018dd8db40000000049454e44ae426082', 'hex');

test('board.json keeps only the owner\'s mode of a default automation, and nothing once it is the default again', (t) => {
  const { dir } = tmp(t);
  const d = load();
  d.createCard(dir, P, { title: 'Dark mode', text: 'Please.' });
  d.setColumnAutomation(dir, P, 'shape', { mode: 'off' });
  assert.deepEqual(storedColumn(dir, 'shape').on_enter, { mode: 'off' });
  // the pipeline and its inputs still come from the default
  const shape = d.readBoard(dir, P).columns.find((c) => c.id === 'shape').on_enter;
  assert.equal(shape.mode, 'off');
  assert.equal(shape.pipeline, 'ai-arena-write-review.yaml');

  d.setColumnAutomation(dir, P, 'shape', { mode: 'ask' });
  assert.equal('on_enter' in storedColumn(dir, 'shape'), false);
  d.setWip(dir, P, 'ready', 3);
  assert.equal('on_enter' in storedColumn(dir, 'ready'), false, 'another board write copies no default');
});

test('setColumnAutomation refuses a column without an automation', (t) => {
  const { dir } = tmp(t);
  const d = load();
  d.createCard(dir, P, { title: 'Dark mode', text: 'Please.' });
  assert.throws(() => d.setColumnAutomation(dir, P, 'triage', { mode: 'on' }), /no automation/);
});

test('an automation\'s inputs are rendered from the card; an unknown field renders empty', (t) => {
  const { dir } = tmp(t);
  const d = load();
  const card = d.createCard(dir, P, { title: 'Export CSV', text: 'Runs cannot be exported.', type: 'idea' });
  d.updateCard(dir, P, card.id, { acceptance: '- a CSV downloads' });
  const out = d.renderAutomationInputs(dir, P, card.id, {
    task: 'Card: {{ card.title }} / {{card.type}} / {{ card.nope }}.',
    doc: '{{ card.document }}',
    criteria: '{{ card.acceptance }}',
    skill: '{{ card.document_skill }}',
    count: 3,
  });
  assert.equal(out.task, 'Card: Export CSV / idea / .');
  assert.match(out.doc, /Runs cannot be exported\./);
  assert.match(out.criteria, /a CSV downloads/);
  assert.equal(out.skill, 'prd-writing');
  assert.equal(out.count, 3);

  const rfc = d.createCard(dir, P, { title: 'Queue API', text: 'x', type: 'rfc' });
  assert.equal(d.renderAutomationInputs(dir, P, rfc.id, { s: '{{ card.document_skill }}' }).s, 'rfc-writing');
});

test('the attachments input holds the card\'s text attachments, never an image', (t) => {
  const { dir } = tmp(t);
  const d = load();
  const card = d.createCard(dir, P, { title: 'Export CSV', text: 'x' });
  d.addAttachment(dir, P, card.id, { name: 'notes.txt', data: Buffer.from('Customers ask for Excel too.') });
  d.addAttachment(dir, P, card.id, { name: 'mock.png', data: PNG });
  const { a } = d.renderAutomationInputs(dir, P, card.id, { a: '{{ card.attachments }}' });
  assert.match(a, /===== Attached file: notes\.txt =====/);
  assert.match(a, /Customers ask for Excel too\./);
  assert.equal(a.includes('mock.png'), false);
});

test('markAutomation records the run on the card, and null takes it away', (t) => {
  const { dir } = tmp(t);
  const d = load();
  const card = d.createCard(dir, P, { title: 'Export CSV', text: 'x', column: 'shape' });
  const marked = d.markAutomation(dir, P, card.id, { runId: 'r1', name: 'AI Arena → Write & Review', column: 'shape' });
  assert.equal(marked.automation.state, 'running');
  assert.equal(marked.automation.runId, 'r1');
  assert.equal(typeof marked.automation.startedAt, 'string');
  assert.equal(d.markAutomation(dir, P, card.id, null).automation, undefined);
});

test('a successful result becomes the document, a version and a thread entry with the run and its cost', (t) => {
  const { dir } = tmp(t);
  const d = load();
  const card = d.createCard(dir, P, { title: 'Export CSV', text: 'Old text.', column: 'shape' });
  d.markAutomation(dir, P, card.id, { runId: 'r1', name: 'Shape it', column: 'shape' });
  const done = d.recordAutomation(dir, P, card.id, { runId: 'r1', name: 'Shape it', column: 'shape', status: 'success', text: '# Shaped\n\nNew text.', costUsd: 0.42 });
  assert.match(done.document, /New text\./);
  assert.equal(done.automation.state, 'done');
  assert.equal(done.automation.costUsd, 0.42);
  const names = d.listVersions(dir, P, card.id).map((v) => v.name);
  assert.ok(names.some((n) => /automation-shape/.test(n)), `a version automation-shape (${names.join(', ')})`);
  const entry = d.readConversation(dir, P, card.id).find((e) => e.kind === 'automation');
  assert.equal(entry.runId, 'r1');
  assert.equal(entry.costUsd, 0.42);
  assert.equal(entry.applied, true);
});

test('a document edited during the run is left alone: the result is only kept as a version', (t) => {
  const { dir } = tmp(t);
  const d = load();
  const card = d.createCard(dir, P, { title: 'Export CSV', text: 'Old text.', column: 'shape' });
  d.markAutomation(dir, P, card.id, { runId: 'r1', name: 'Shape it', column: 'shape' });
  d.updateCard(dir, P, card.id, { document: 'The owner wrote this meanwhile.' });
  const done = d.recordAutomation(dir, P, card.id, { runId: 'r1', name: 'Shape it', column: 'shape', status: 'success', text: 'Agent text.', costUsd: 0.1 });
  assert.match(done.document, /The owner wrote this meanwhile\./);
  assert.equal(done.document.includes('Agent text.'), false);
  const entry = d.readConversation(dir, P, card.id).find((e) => e.kind === 'automation');
  assert.equal(entry.applied, false);
  assert.equal(typeof entry.version, 'string');
  assert.match(d.readVersion(dir, P, card.id, entry.version), /Agent text\./);
});

test('a failed run leaves the document unchanged and ends the automation as failed', (t) => {
  const { dir } = tmp(t);
  const d = load();
  const card = d.createCard(dir, P, { title: 'Export CSV', text: 'Old text.', column: 'shape' });
  d.markAutomation(dir, P, card.id, { runId: 'r1', name: 'Shape it', column: 'shape' });
  const versions = d.listVersions(dir, P, card.id).length;
  const done = d.recordAutomation(dir, P, card.id, { runId: 'r1', name: 'Shape it', column: 'shape', status: 'failed', text: 'ignored' });
  assert.match(done.document, /Old text\./);
  assert.equal(done.automation.state, 'failed');
  assert.equal(d.listVersions(dir, P, card.id).length, versions);
  const entry = d.readConversation(dir, P, card.id).find((e) => e.kind === 'automation');
  assert.equal(entry.status, 'failed');
  assert.equal(entry.applied, false);
  assert.equal(entry.version, null);
});
