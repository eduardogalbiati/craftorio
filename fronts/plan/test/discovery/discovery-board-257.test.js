// #257 Discovery board, the store and the channels: the board's columns (Inbox, Triage, Shape,
// Define, Ready) with WIP limits on Shape and Define, the order within a column, the fast lane
// (bug / hotfix: Triage → Define), the version history of a card's document and the result of a
// Write & Review or AI Arena run coming back as a version and a thread entry.
//
// The contract these tests assume, packages/engine/domains/discovery/discovery.js (new functions called through the module object,
// so a missing one fails its test, not the file):
//   readBoard(dir, projectId).columns ids inbox, triage, shape, define, ready; wip 5 on shape/define, else null
//   setWip(dir, projectId, column, limit) → board (limit: a positive integer; unknown column throws)
//   moveCard(dir, projectId, id, column, { by, index }) → card; `index` places it in board.order[column];
//     a move within the column (with index) reorders without a history entry; past a WIP limit it is
//     never refused (the screen confirms)
//   listVersions(dir, projectId, id) → [{ name, ts, reason }] newest first
//   readVersion(dir, projectId, id, name) → text (a name that is a path throws)
//   restoreVersion(dir, projectId, id, name, { by }) → card (the current document is kept as a version first)
//   recordResult(dir, projectId, id, { source, text, runId }) → card (document = text, a version
//     whose name contains the source, a thread entry { kind: 'result', source, runId })
// Channels (fronts/plan/engine/channels/discovery.js), channel → window.api method (params):
//   discovery:board           → discoveryBoard (projectId)
//   discovery:set-wip         → setDiscoveryWip (projectId, column, limit)
//   discovery:move            → moveDiscoveryCard (projectId, cardId, column, index)
//   discovery:versions        → discoveryVersions (projectId, cardId)
//   discovery:version         → discoveryVersion (projectId, cardId, name)
//   discovery:restore-version → restoreDiscoveryVersion (projectId, cardId, name)
//   discovery:record-result   → recordDiscoveryResult (projectId, cardId, source, text, runId)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { layout, setupWorkspace } = require('@craftorio/engine/domains/workspace/workspace');
const discovery = require('@craftorio/engine/domains/discovery/discovery');

const P = 'p1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function tmp(t, prefix = 'discovery-board-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, dir: layout(root).discovery };
}

// A card walked to `column` through the board (inbox → triage → shape → define → ready).
function cardIn(dir, column, { title = 'A card', type = 'idea', text = '' } = {}) {
  const card = discovery.createCard(dir, P, { title, type, text });
  const path_ = ['triage', 'shape', 'define', 'ready'];
  for (const c of path_.slice(0, path_.indexOf(column) + 1)) discovery.moveCard(dir, P, card.id, c, { by: 'tester' });
  return card.id;
}

const orderOf = (dir, column) => [...discovery.readBoard(dir, P).order[column]];

// ---- 1. the columns -----------------------------------------------------------------------------

test('a fresh board has the columns Inbox, Triage, Shape, Define, Ready with a WIP limit of 5 on Shape and Define', (t) => {
  const { dir } = tmp(t);
  const { columns } = discovery.readBoard(dir, P);
  assert.deepEqual(columns.map((c) => c.id), ['inbox', 'triage', 'shape', 'define', 'ready']);
  assert.deepEqual(columns.map((c) => c.title), ['Inbox', 'Triage', 'Shape', 'Define', 'Ready']);
  assert.deepEqual(columns.map((c) => c.wip), [null, null, 5, 5, null]);
});

// ---- 2. WIP limits --------------------------------------------------------------------------------

test('setWip changes a column\'s limit, returns the board, and the limit persists in board.json', (t) => {
  const { dir } = tmp(t);
  discovery.createCard(dir, P, { title: 'Makes the project folder' });
  const board = discovery.setWip(dir, P, 'shape', 3);
  assert.equal(board.columns.find((c) => c.id === 'shape').wip, 3);
  assert.equal(discovery.readBoard(dir, P).columns.find((c) => c.id === 'shape').wip, 3);
  assert.equal(discovery.readBoard(dir, P).columns.find((c) => c.id === 'define').wip, 5, 'the other limit is unchanged');
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, P, 'board.json'), 'utf8'));
  assert.equal(onDisk.columns.find((c) => c.id === 'shape').wip, 3);
});

test('setWip refuses a limit that is not a positive integer, and an unknown column', (t) => {
  const { dir } = tmp(t);
  for (const bad of [0, -1, 2.5, 'x']) {
    assert.throws(() => discovery.setWip(dir, P, 'shape', bad), undefined, `limit ${JSON.stringify(bad)} is refused`);
  }
  assert.throws(() => discovery.setWip(dir, P, 'nowhere', 3));
  assert.equal(discovery.readBoard(dir, P).columns.find((c) => c.id === 'shape').wip, 5, 'nothing changed');
});

// ---- 3. order within a column ------------------------------------------------------------------------

test('moveCard without an index puts the card last in the target column, with a history entry', (t) => {
  const { dir } = tmp(t);
  const a = cardIn(dir, 'shape', { title: 'A' });
  const b = cardIn(dir, 'triage', { title: 'B' });
  const moved = discovery.moveCard(dir, P, b, 'shape', { by: 'tester' });
  assert.deepEqual(orderOf(dir, 'shape'), [a, b]);
  assert.deepEqual(moved.history.map(({ from, to, by }) => ({ from, to, by })).at(-1), { from: 'triage', to: 'shape', by: 'tester' });
});

test('moveCard with an index places the card at that position of the target column', (t) => {
  const { dir } = tmp(t);
  const a = cardIn(dir, 'shape', { title: 'A' });
  const b = cardIn(dir, 'shape', { title: 'B' });
  const c = cardIn(dir, 'triage', { title: 'C' });
  const moved = discovery.moveCard(dir, P, c, 'shape', { by: 'tester', index: 1 });
  assert.equal(moved.column, 'shape');
  assert.deepEqual(orderOf(dir, 'shape'), [a, c, b]);
  assert.deepEqual(moved.history.map(({ from, to, by }) => ({ from, to, by })).at(-1), { from: 'triage', to: 'shape', by: 'tester' });
});

test('a move within the same column with an index reorders it and adds no history entry', (t) => {
  const { dir } = tmp(t);
  const a = cardIn(dir, 'shape', { title: 'A' });
  const b = cardIn(dir, 'shape', { title: 'B' });
  const c = cardIn(dir, 'shape', { title: 'C' });
  const before = discovery.readCard(dir, P, c).history.length;
  discovery.moveCard(dir, P, c, 'shape', { by: 'tester', index: 0 });
  assert.deepEqual(orderOf(dir, 'shape'), [c, a, b]);
  assert.equal(discovery.readCard(dir, P, c).history.length, before, 'no history entry for a reorder');
  assert.equal(discovery.readCard(dir, P, c).column, 'shape');
});

test('a reorder within the column snapshots no version of the document', (t) => {
  const { dir } = tmp(t);
  const a = cardIn(dir, 'shape', { title: 'A', text: 'doc' });
  cardIn(dir, 'shape', { title: 'B' });
  const before = discovery.listVersions(dir, P, a).length;
  discovery.moveCard(dir, P, a, 'shape', { by: 'tester', index: 1 });
  assert.equal(orderOf(dir, 'shape')[1], a);
  assert.equal(discovery.listVersions(dir, P, a).length, before);
});

test('a board.json from before the board (Inbox and Triage only) gains Shape and Define with a limit of 5, its order kept', (t) => {
  const { dir } = tmp(t);
  const id = discovery.createCard(dir, P, { title: 'Old card' }).id;
  discovery.moveCard(dir, P, id, 'triage', { by: 'tester' });
  const file = path.join(dir, P, 'board.json');
  fs.writeFileSync(file, JSON.stringify({ columns: [{ id: 'inbox', title: 'Inbox', wip: null }, { id: 'triage', title: 'Triage', wip: null }], order: { inbox: [], triage: [id] } }));
  const board = discovery.readBoard(dir, P);
  assert.deepEqual(board.columns.map((c) => [c.id, c.wip]), [['inbox', null], ['triage', null], ['shape', 5], ['define', 5], ['ready', null]]);
  assert.deepEqual(board.order.triage, [id]);
  discovery.moveCard(dir, P, id, 'shape', { by: 'tester' });
  assert.deepEqual(orderOf(dir, 'shape'), [id]);
});

// ---- 4. past a WIP limit --------------------------------------------------------------------------

test('the store never refuses a move past a WIP limit: a 6th card moves into Shape', (t) => {
  const { dir } = tmp(t);
  for (let i = 0; i < 5; i++) cardIn(dir, 'shape', { title: `In shape ${i}` });
  const sixth = cardIn(dir, 'triage', { title: 'Sixth' });
  const moved = discovery.moveCard(dir, P, sixth, 'shape', { by: 'tester' });
  assert.equal(moved.column, 'shape');
  assert.equal(orderOf(dir, 'shape').length, 6);
  assert.ok(orderOf(dir, 'shape').includes(sixth));
});

// ---- 5. fast lane ---------------------------------------------------------------------------------

test('fast lane: a bug and a hotfix move from Triage straight to Define, skipping Shape', (t) => {
  const { dir } = tmp(t);
  for (const type of ['bug', 'hotfix']) {
    const id = cardIn(dir, 'triage', { title: `A ${type}`, type });
    const moved = discovery.moveCard(dir, P, id, 'define', { by: 'tester' });
    assert.equal(moved.column, 'define', `${type} is in Define`);
    assert.deepEqual(moved.history.map(({ from, to }) => ({ from, to })).at(-1), { from: 'triage', to: 'define' });
    assert.ok(orderOf(dir, 'define').includes(id));
  }
});

// ---- 6. versions --------------------------------------------------------------------------------

test('listVersions lists the document\'s versions newest first as { name, ts, reason }, readVersion returns one\'s text', async (t) => {
  const { dir } = tmp(t);
  const id = cardIn(dir, 'triage', { title: 'A', text: 'first text' });
  await sleep(15);
  discovery.updateCard(dir, P, id, { document: 'second text' });
  discovery.moveCard(dir, P, id, 'shape', { by: 'tester' });
  const versions = discovery.listVersions(dir, P, id);
  assert.ok(versions.length >= 2, 'one version per move');
  for (const v of versions) {
    assert.equal(typeof v.name, 'string');
    assert.equal(typeof v.ts, 'string');
    assert.ok(v.ts, 'a version has its time');
    assert.equal(typeof v.reason, 'string');
  }
  assert.ok(fs.existsSync(path.join(dir, P, 'cards', id, 'versions', versions[0].name)), 'name is the file name in versions/');
  assert.match(versions[0].reason, /shape/, 'the newest is the move to Shape');
  assert.equal(discovery.readVersion(dir, P, id, versions[0].name), 'second text');
  assert.equal(discovery.readVersion(dir, P, id, versions.at(-1).name), 'first text');
});

test('readVersion and restoreVersion refuse a version name that is a path', (t) => {
  const { dir } = tmp(t);
  assert.equal(typeof discovery.readVersion, 'function', 'readVersion is exported');
  assert.equal(typeof discovery.restoreVersion, 'function', 'restoreVersion is exported');
  const id = cardIn(dir, 'triage', { title: 'A', text: 'x' });
  for (const name of ['../card.json', 'a/b.md', '..\\card.json']) {
    assert.throws(() => discovery.readVersion(dir, P, id, name), undefined, `readVersion ${name}`);
    assert.throws(() => discovery.restoreVersion(dir, P, id, name, { by: 'tester' }), undefined, `restoreVersion ${name}`);
  }
  assert.equal(discovery.readCard(dir, P, id).document, 'x');
});

test('restoreVersion puts a version back as the document and keeps the replaced document as a new version', async (t) => {
  const { dir } = tmp(t);
  const id = cardIn(dir, 'triage', { title: 'A', text: 'old text' });
  const [old] = discovery.listVersions(dir, P, id);
  discovery.updateCard(dir, P, id, { document: 'new text' });
  const before = discovery.listVersions(dir, P, id).length;
  await sleep(15);
  const card = discovery.restoreVersion(dir, P, id, old.name, { by: 'tester' });
  assert.equal(card.document, 'old text');
  assert.equal(discovery.readCard(dir, P, id).document, 'old text');
  const after = discovery.listVersions(dir, P, id);
  assert.equal(after.length, before + 1, 'the document before the restore is a new version');
  assert.ok(after.some((v) => discovery.readVersion(dir, P, id, v.name) === 'new text'), 'nothing is lost');
});

// ---- 7. a run's result comes back ---------------------------------------------------------------

test('recordResult from Write & Review makes the text the document, a version named after the source, and a result thread entry', (t) => {
  const { dir } = tmp(t);
  const id = cardIn(dir, 'shape', { title: 'A', text: 'draft' });
  const card = discovery.recordResult(dir, P, id, { source: 'write-review', text: '# Reviewed PRD', runId: 'run-123' });
  assert.equal(card.document, '# Reviewed PRD');
  assert.equal(discovery.readCard(dir, P, id).document, '# Reviewed PRD');
  const v = discovery.listVersions(dir, P, id).find((x) => /write-review/.test(x.name));
  assert.ok(v, 'a version whose name contains write-review');
  assert.equal(discovery.readVersion(dir, P, id, v.name), '# Reviewed PRD');
  const entry = discovery.readConversation(dir, P, id).at(-1);
  assert.equal(entry.kind, 'result');
  assert.equal(entry.source, 'write-review');
  assert.equal(entry.runId, 'run-123');
});

test('recordResult from AI Arena is recorded the same way with its own source', (t) => {
  const { dir } = tmp(t);
  const id = cardIn(dir, 'shape', { title: 'A', text: 'draft' });
  discovery.recordResult(dir, P, id, { source: 'ai-arena', text: 'Arena answer', runId: 'run-9' });
  assert.ok(discovery.listVersions(dir, P, id).some((x) => /ai-arena/.test(x.name)));
  const entry = discovery.readConversation(dir, P, id).at(-1);
  assert.deepEqual({ kind: entry.kind, source: entry.source, runId: entry.runId }, { kind: 'result', source: 'ai-arena', runId: 'run-9' });
});

// ---- channels -------------------------------------------------------------------------------------

function makeService(t) {
  process.env.MULTIAGENT_SIMULATION_ONLY = '1'; // tests never call real models
  const { createService } = require('@craftorio/engine/service');
  const service = createService({ host: { trashItem: async () => {}, appVersion: '9.9.9', isPackaged: false, userDataDir: tmp(t, 'discovery-board-ud-').root } });
  t.after(() => service.shutdown());
  const { root } = tmp(t);
  service.setWorkspace(setupWorkspace(root, { persist: false }));
  return service;
}

test('the manifest declares the board channels with their window.api methods and params', (t) => {
  const service = makeService(t);
  const byChannel = Object.fromEntries(service.manifest.filter((e) => e.channel).map((e) => [e.channel, e]));
  const expected = {
    'discovery:board': ['discoveryBoard', ['projectId']],
    'discovery:set-wip': ['setDiscoveryWip', ['projectId', 'column', 'limit']],
    'discovery:move': ['moveDiscoveryCard', ['projectId', 'cardId', 'column', 'index']],
    'discovery:versions': ['discoveryVersions', ['projectId', 'cardId']],
    'discovery:version': ['discoveryVersion', ['projectId', 'cardId', 'name']],
    'discovery:restore-version': ['restoreDiscoveryVersion', ['projectId', 'cardId', 'name']],
    'discovery:record-result': ['recordDiscoveryResult', ['projectId', 'cardId', 'source', 'text', 'runId']],
  };
  for (const [channel, [method, params]] of Object.entries(expected)) {
    assert.equal(byChannel[channel]?.method, method, `${channel} → ${method}`);
    if (byChannel[channel]?.params) assert.deepEqual([...byChannel[channel].params], params, `${channel} params`);
  }
});

test('discovery:board and discovery:set-wip: the board with its columns, a limit changed through the channel', async (t) => {
  const service = makeService(t);
  const api = service.api;
  await api['discovery:create']({ projectId: P, title: 'A', text: '' });
  const board = await api['discovery:board']({ projectId: P });
  assert.deepEqual(board.columns.map((c) => c.id), ['inbox', 'triage', 'shape', 'define', 'ready']);
  await api['discovery:set-wip']({ projectId: P, column: 'define', limit: 2 });
  const again = await api['discovery:board']({ projectId: P });
  assert.equal(again.columns.find((c) => c.id === 'define').wip, 2);
});

test('discovery:move with an index orders the column; record-result, versions, version and restore-version round-trip', async (t) => {
  const service = makeService(t);
  const api = service.api;
  const ids = [];
  for (const title of ['A', 'B']) {
    const c = await api['discovery:create']({ projectId: P, title, text: `${title} text` });
    await api['discovery:move']({ projectId: P, cardId: c.id, column: 'triage' });
    await api['discovery:move']({ projectId: P, cardId: c.id, column: 'shape' });
    ids.push(c.id);
  }
  await api['discovery:move']({ projectId: P, cardId: ids[1], column: 'shape', index: 0 });
  assert.deepEqual((await api['discovery:board']({ projectId: P })).order.shape, [ids[1], ids[0]]);

  const card = await api['discovery:record-result']({ projectId: P, cardId: ids[0], source: 'write-review', text: 'Reviewed', runId: 'r1' });
  assert.equal(card.document, 'Reviewed');
  const versions = await api['discovery:versions']({ projectId: P, cardId: ids[0] });
  const result = versions.find((v) => /write-review/.test(v.name));
  assert.ok(result, 'the result is a version');
  assert.equal(await api['discovery:version']({ projectId: P, cardId: ids[0], name: result.name }), 'Reviewed');
  const older = versions.find((v) => !/write-review/.test(v.name));
  const restored = await api['discovery:restore-version']({ projectId: P, cardId: ids[0], name: older.name });
  assert.equal(restored.document, await api['discovery:version']({ projectId: P, cardId: ids[0], name: older.name }));
  await assert.rejects(async () => api['discovery:version']({ projectId: P, cardId: ids[0], name: '../card.json' }));
});
