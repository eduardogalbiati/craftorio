// #259 Column automations, the store (src/discovery.js): a board column may declare `on_enter`, a
// pipeline or workflow run on the card when it enters the column, with inputs from the card
// (document, acceptance, attachments, type) and a mode 'on' | 'off' | 'ask' (default 'ask').
// The contract these tests assume:
//   readBoard(dir, projectId).columns[] → the default `shape` column has on_enter = { pipeline or
//     workflow: a name, mode: 'ask', inputs mentioning the card's document } (AI Arena → Write &
//     Review); the default `ready` column has on_enter with mode 'ask' (the clarity check); a column
//     without on_enter has no automation.
//   setColumnAutomation(dir, projectId, column, { mode }) → persists on_enter.mode in board.json;
//     a mode outside on/off/ask or an unknown column throws.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { layout } = require('../src/workspace');

const load = () => require('../src/discovery');
const P = 'p1';

function tmp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-automations-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, dir: layout(root).discovery };
}

const columnOf = (board, id) => board.columns.find((c) => c.id === id);

test('the default Shape column offers a pipeline on the card\'s document, in ask mode', (t) => {
  const { dir } = tmp(t);
  const d = load();
  d.createCard(dir, P, { title: 'Dark mode', text: 'Please.' });
  const shape = columnOf(d.readBoard(dir, P), 'shape');
  assert.ok(shape.on_enter, 'shape declares on_enter');
  const name = shape.on_enter.pipeline || shape.on_enter.workflow;
  assert.equal(typeof name, 'string');
  assert.ok(name.length > 0, 'on_enter names a pipeline or a workflow');
  assert.equal(shape.on_enter.mode, 'ask');
  assert.equal(typeof shape.on_enter.inputs, 'object');
  assert.match(JSON.stringify(shape.on_enter.inputs), /document/, 'the inputs take the card\'s document');
});

test('the default Ready column runs the clarity check on enter, in ask mode', (t) => {
  const { dir } = tmp(t);
  const ready = columnOf(load().readBoard(dir, P), 'ready');
  assert.ok(ready.on_enter, 'ready declares on_enter');
  assert.equal(ready.on_enter.mode, 'ask');
});

test('a column without on_enter has no automation', (t) => {
  const { dir } = tmp(t);
  const board = load().readBoard(dir, P);
  assert.equal(columnOf(board, 'triage').on_enter ?? null, null);
  assert.equal(columnOf(board, 'inbox').on_enter ?? null, null);
});

test('setColumnAutomation persists the mode in board.json and keeps the pipeline', (t) => {
  const { dir } = tmp(t);
  const d = load();
  const before = columnOf(d.readBoard(dir, P), 'shape').on_enter;
  d.setColumnAutomation(dir, P, 'shape', { mode: 'off' });
  const shape = columnOf(d.readBoard(dir, P), 'shape');
  assert.equal(shape.on_enter.mode, 'off');
  assert.equal(shape.on_enter.pipeline ?? shape.on_enter.workflow, before.pipeline ?? before.workflow, 'the pipeline is unchanged');
  const file = JSON.parse(fs.readFileSync(path.join(dir, P, 'board.json'), 'utf8'));
  assert.equal(file.columns.find((c) => c.id === 'shape').on_enter.mode, 'off', 'written to board.json');
  d.setColumnAutomation(dir, P, 'shape', { mode: 'on' });
  assert.equal(columnOf(d.readBoard(dir, P), 'shape').on_enter.mode, 'on');
});

test('setColumnAutomation refuses a mode outside on/off/ask and an unknown column', (t) => {
  const { dir } = tmp(t);
  const d = load();
  assert.equal(typeof d.setColumnAutomation, 'function');
  assert.throws(() => d.setColumnAutomation(dir, P, 'shape', { mode: 'always' }));
  assert.throws(() => d.setColumnAutomation(dir, P, 'nowhere', { mode: 'off' }));
  assert.equal(columnOf(d.readBoard(dir, P), 'shape').on_enter.mode, 'ask', 'a refused change leaves the mode');
});
