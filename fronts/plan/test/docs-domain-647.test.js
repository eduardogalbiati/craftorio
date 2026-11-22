// #647 Write doc phase 1 (docs/work/write-doc/spec.md R1, R3, R11, R13): the Documents service.
// fronts/plan/engine/domains/docs.js (plain functions, the folder first):
// - listItems(repoDir) → [{ item, stage, docs: [{ doc: 'intent' | 'spec', file, status, translation }] }] from
//   the front matter of docs/work/<item>/intent.md and spec.md (file repository-relative, `/`; translation
//   as the front matter writes it; stage: the latest document's, the spec's over the intent's); [] without docs/work;
// - applyRequest(worktreeDir, { item, doc, messageId, source: { lines, text }, translation: { lines, text } }) → { commit }:
//   the lines swapped in <doc>.md and <doc>.pt-BR.md, ONE commit with both files whose message has the messageId;
//   anything outside docs/work/<item>/ is refused;
// - listChanges(worktreeDir, { base }) → [{ commit, messageId, files }] one per request, newest last;
// - undoChange(worktreeDir, { commit }) → a revert commit: that request's lines come back, later ones stay;
// - unreviewed(worktreeDir, runDir, { base }) / markReviewed(runDir, commit): the queue of unreviewed changes;
// - acceptDoc(worktreeDir, { item, doc, approver, date }): intent → accepted, spec → signed off, approver and
//   date in the source and translation front matter, one commit, the body unchanged.
// fronts/plan/engine/channels/docs.js: `(ctx) => [{ channel, method, params, schema, fn }]`.
// A throwaway git repository per test (isolated git config, a local identity for the service's commits).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeRepo } = require('@craftorio/engine/test/repo-workflow-fixtures-485');

const load = () => require('../engine/domains/docs');
const loadChannels = () => require('../engine/channels/docs');

const fm = (fields) => `---\n${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n`;

const INTENT = `${fm({ item: 'demo', issue: '"#1"', stage: 'intent', status: 'accepted', approver: 'Owner', date: '2026-10-30', translation: 'intent.pt-BR.md' })}
# Intent: demo

## Problem

People lose track.
`;
const INTENT_PT = `${fm({ item: 'demo', issue: '"#1"', stage: 'intent', status: 'accepted', approver: 'Owner', date: '2026-10-30', source: 'intent.md' })}
# Intenção: demo

## Problema

As pessoas se perdem.
`;
// spec lines: 1-8 front matter, 9 blank, 10 title, 11 blank, 12 heading, 13 blank, 14 R1, 15 blank, 16 R2
const SPEC = `${fm({ item: 'demo', issue: '"#1"', stage: 'design', status: 'draft', date: '2026-10-31', translation: 'spec.pt-BR.md' })}
# Spec: demo

## Requirements

**R1. List.** The screen lists the items.

**R2. Edit.** The person edits a section.
`;
const SPEC_PT = `${fm({ item: 'demo', issue: '"#1"', stage: 'design', status: 'draft', date: '2026-10-31', source: 'spec.md' })}
# Spec: demo

## Requisitos

**R1. Lista.** A tela lista os itens.

**R2. Editar.** A pessoa edita uma seção.
`;

const FILES = {
  'docs/work/demo/intent.md': INTENT,
  'docs/work/demo/intent.pt-BR.md': INTENT_PT,
  'docs/work/demo/spec.md': SPEC,
  'docs/work/demo/spec.pt-BR.md': SPEC_PT,
  // a sibling folder a request with item "../x" would reach
  'docs/x/spec.md': SPEC,
  'docs/x/spec.pt-BR.md': SPEC_PT,
};

function repo(t, files = FILES) {
  const r = makeRepo(t, files);
  r.git('config', 'user.name', 'Test');
  r.git('config', 'user.email', 'test@example.com');
  r.git('config', 'core.autocrlf', 'false');
  return r;
}
const read = (r, rel) => fs.readFileSync(path.join(r.dir, ...rel.split('/')), 'utf8');
const commitCount = (r) => Number(r.git('rev-list', '--count', 'HEAD'));
const lineOf = (text, n) => text.split('\n')[n - 1];
const frontMatter = (text) => {
  const lines = text.split('\n');
  const end = lines.indexOf('---', 1);
  return Object.fromEntries(lines.slice(1, end).map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]));
};
const bodyOf = (text) => text.split('\n').slice(text.split('\n').indexOf('---', 1) + 1).join('\n');
function runDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-run-647-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const request = (messageId, line, en, pt) => ({
  item: 'demo', doc: 'spec', messageId,
  source: { lines: { start: line, end: line }, text: en },
  translation: { lines: { start: line, end: line }, text: pt },
});

// ---- listItems ----------------------------------------------------------------------------------

test('#647 listItems is empty for a repository without docs/work', (t) => {
  const r = makeRepo(t, {});
  assert.deepEqual(load().listItems(r.dir), []);
});

test('#647 listItems reports an item with its accepted intent and draft spec and the spec\'s stage', (t) => {
  const r = repo(t);
  const items = load().listItems(r.dir);
  assert.deepEqual(items.map((i) => i.item), ['demo']);
  assert.equal(items[0].stage, 'design');
  assert.deepEqual(items[0].docs.map((d) => [d.doc, d.file, d.status, d.translation]), [
    ['intent', 'docs/work/demo/intent.md', 'accepted', 'intent.pt-BR.md'],
    ['spec', 'docs/work/demo/spec.md', 'draft', 'spec.pt-BR.md'],
  ]);
});

test('#670 listItems gives each item the title of its documents\' heading, the spec\'s over the intent\'s', (t) => {
  const r = repo(t, {
    'docs/work/demo/intent.md': INTENT.replace('# Intent: demo', '# Intent: Export runs as CSV (draft name)'),
    'docs/work/demo/spec.md': SPEC.replace('# Spec: demo', '# Spec: Export runs as CSV'),
    'docs/work/early/intent.md': INTENT.replace('# Intent: demo', '# Intent: Home screen'),
  });
  const items = load().listItems(r.dir);
  assert.deepEqual(items.map((i) => [i.item, i.title]), [['demo', 'Export runs as CSV'], ['early', 'Home screen']]);
});

test('#670 listItems leaves the title out when no document has a heading', (t) => {
  const r = repo(t, { 'docs/work/plain/intent.md': `${fm({ item: 'plain', stage: 'intent', status: 'draft' })}\nJust text.\n` });
  const items = load().listItems(r.dir);
  assert.deepEqual(items.map((i) => [i.item, i.title === undefined]), [['plain', true]]);
});

// ---- applyRequest -------------------------------------------------------------------------------

test('#647 applyRequest swaps the lines of the source and its translation', (t) => {
  const r = repo(t);
  load().applyRequest(r.dir, request('m-0001', 16, '**R2. Edit.** The person rewrites a section.', '**R2. Editar.** A pessoa reescreve uma seção.'));
  assert.equal(lineOf(read(r, 'docs/work/demo/spec.md'), 16), '**R2. Edit.** The person rewrites a section.');
  assert.equal(lineOf(read(r, 'docs/work/demo/spec.pt-BR.md'), 16), '**R2. Editar.** A pessoa reescreve uma seção.');
  assert.equal(lineOf(read(r, 'docs/work/demo/spec.md'), 14), '**R1. List.** The screen lists the items.');
});

test('#647 applyRequest makes exactly one commit with both files and the message id', (t) => {
  const r = repo(t);
  const before = commitCount(r);
  const { commit } = load().applyRequest(r.dir, request('m-0001', 16, 'EN', 'PT'));
  assert.equal(commitCount(r), before + 1);
  assert.equal(commit, r.head());
  assert.deepEqual(r.git('show', '--name-only', '--format=', 'HEAD').split('\n').map((s) => s.trim()).filter(Boolean).sort(),
    ['docs/work/demo/spec.md', 'docs/work/demo/spec.pt-BR.md']);
  assert.equal(r.git('log', '-1', '--format=%B').includes('m-0001'), true);
});

test('#647 applyRequest refuses an item that leaves docs/work and writes nothing', async (t) => {
  const r = repo(t);
  const docs = load();
  const head = r.head();
  await assert.rejects(async () => docs.applyRequest(r.dir, { ...request('m-0001', 16, 'EN', 'PT'), item: '../x' }));
  assert.equal(r.head(), head);
  assert.equal(read(r, 'docs/x/spec.md'), SPEC);
});

// ---- listChanges / undoChange -------------------------------------------------------------------

test('#647 listChanges gives one change per request with its message id, newest last', (t) => {
  const r = repo(t);
  const base = r.head();
  const docs = load();
  const first = docs.applyRequest(r.dir, request('m-0001', 14, 'EN 1', 'PT 1')).commit;
  const second = docs.applyRequest(r.dir, request('m-0002', 16, 'EN 2', 'PT 2')).commit;
  const changes = docs.listChanges(r.dir, { base });
  assert.deepEqual(changes.map((c) => [c.commit, c.messageId]), [[first, 'm-0001'], [second, 'm-0002']]);
  assert.deepEqual([...changes[0].files].sort(), ['docs/work/demo/spec.md', 'docs/work/demo/spec.pt-BR.md']);
});

test('#647 undoChange reverts one request in a new commit and keeps the later ones', (t) => {
  const r = repo(t);
  const docs = load();
  const first = docs.applyRequest(r.dir, request('m-0001', 14, 'EN 1', 'PT 1')).commit;
  docs.applyRequest(r.dir, request('m-0002', 16, 'EN 2', 'PT 2'));
  const before = commitCount(r);
  docs.undoChange(r.dir, { commit: first });
  assert.equal(commitCount(r), before + 1);
  const en = read(r, 'docs/work/demo/spec.md');
  assert.deepEqual([lineOf(en, 14), lineOf(en, 16)], ['**R1. List.** The screen lists the items.', 'EN 2']);
  assert.equal(lineOf(read(r, 'docs/work/demo/spec.pt-BR.md'), 14), '**R1. Lista.** A tela lista os itens.');
});

// ---- unreviewed / markReviewed ------------------------------------------------------------------

test('#647 a change marked reviewed leaves the unreviewed queue', (t) => {
  const r = repo(t);
  const run = runDir(t);
  const base = r.head();
  const docs = load();
  const first = docs.applyRequest(r.dir, request('m-0001', 14, 'EN 1', 'PT 1')).commit;
  const second = docs.applyRequest(r.dir, request('m-0002', 16, 'EN 2', 'PT 2')).commit;
  assert.equal(docs.unreviewed(r.dir, run, { base }).length, 2);
  docs.markReviewed(run, first);
  assert.deepEqual(docs.unreviewed(r.dir, run, { base }).map((c) => c.commit), [second]);
});

// ---- acceptDoc ----------------------------------------------------------------------------------

test('#647 accepting an intent sets status accepted, approver and date in both languages in one commit', (t) => {
  const r = repo(t, { ...FILES, 'docs/work/demo/intent.md': INTENT.replace('status: accepted', 'status: draft'), 'docs/work/demo/intent.pt-BR.md': INTENT_PT.replace('status: accepted', 'status: draft') });
  const before = commitCount(r);
  load().acceptDoc(r.dir, { item: 'demo', doc: 'intent', approver: 'Eduardo Galbiati', date: '2026-10-31' });
  assert.equal(commitCount(r), before + 1);
  for (const rel of ['docs/work/demo/intent.md', 'docs/work/demo/intent.pt-BR.md']) {
    const f = frontMatter(read(r, rel));
    assert.deepEqual([f.status, f.approver, f.date], ['accepted', 'Eduardo Galbiati', '2026-10-31'], rel);
  }
  assert.equal(bodyOf(read(r, 'docs/work/demo/intent.md')), bodyOf(INTENT));
});

test('#647 signing off a spec sets status signed off, approver and date in both languages, the body unchanged', (t) => {
  const r = repo(t);
  load().acceptDoc(r.dir, { item: 'demo', doc: 'spec', approver: 'Eduardo Galbiati', date: '2026-11-01' });
  for (const rel of ['docs/work/demo/spec.md', 'docs/work/demo/spec.pt-BR.md']) {
    const f = frontMatter(read(r, rel));
    assert.deepEqual([f.status, f.approver, f.date], ['signed off', 'Eduardo Galbiati', '2026-11-01'], rel);
  }
  assert.equal(bodyOf(read(r, 'docs/work/demo/spec.pt-BR.md')), bodyOf(SPEC_PT));
});

// ---- channels -----------------------------------------------------------------------------------

test('#647 the docs channels declare list, apply-request, changes, undo, mark-reviewed and accept', () => {
  const channels = loadChannels()({}).map((c) => c.channel);
  const expected = ['docs:list', 'docs:apply-request', 'docs:changes', 'docs:undo', 'docs:mark-reviewed', 'docs:accept'];
  assert.deepEqual(expected.filter((c) => !channels.includes(c)), []);
});

test('#647 docs:list is window.api.listDocItems', () => {
  const list = loadChannels()({}).find((c) => c.channel === 'docs:list');
  assert.equal(list?.method, 'listDocItems');
});

// ---- the write-doc run's draft (the service follows the run's events) ---------------------------
// A lint-clean draft: a frozen copy of this repository's own write-doc intent and its translation
// (#695: tests never read live documents under docs/work/).
const OWN = path.join(__dirname, 'fixtures', 'write-doc');
const DRAFT = {
  source_text: fs.readFileSync(path.join(OWN, 'intent.md'), 'utf8'),
  translation_text: fs.readFileSync(path.join(OWN, 'intent.pt-BR.md'), 'utf8'),
};

// the channels on a fake service with one live write-doc run on the item write-doc in `r`
function followRun(t, r) {
  const { EventEmitter } = require('events');
  const events = new EventEmitter();
  const folder = runDir(t);
  const run = { runId: 'r1', projectId: 'p1', wf: { metadata: { name: 'write-doc' } }, inputs: { item: 'write-doc', document: 'intent', title: 'Write doc', project_path: r.dir } };
  loadChannels()({ events, active: new Map([['r1', run]]), runFolder: () => folder });
  const emit = (ev) => events.emit('run:event', { run_id: 'r1', ...ev });
  return { emit, base: () => JSON.parse(fs.readFileSync(path.join(folder, 'docs-base.json'), 'utf8')) };
}

test('#647 the first step of a run on a new document writes its skeleton and keeps it as fresh', (t) => {
  const r = repo(t, { 'README.md': '# demo\n' });
  const { emit, base } = followRun(t, r);
  emit({ type: 'step.started', step_id: 'screenshots' });
  assert.equal(fs.existsSync(path.join(r.dir, 'docs', 'work', 'write-doc', 'intent.md')), true, 'no skeleton');
  assert.equal(base().fresh, true);
  assert.equal(base().base, r.head());
});

test('#647 the draft of a document the run created is written into it', (t) => {
  const r = repo(t, { 'README.md': '# demo\n' });
  const { emit } = followRun(t, r);
  emit({ type: 'step.started', step_id: 'screenshots' });
  emit({ type: 'step.finished', step_id: 'draft', output: DRAFT });
  assert.equal(read(r, 'docs/work/write-doc/intent.md'), DRAFT.source_text);
  assert.equal(read(r, 'docs/work/write-doc/intent.pt-BR.md'), DRAFT.translation_text);
});

test('#647 the draft never replaces a document that already existed', (t) => {
  const r = repo(t, { 'docs/work/write-doc/intent.md': INTENT, 'docs/work/write-doc/intent.pt-BR.md': INTENT_PT });
  const { emit, base } = followRun(t, r);
  emit({ type: 'step.started', step_id: 'screenshots' });
  assert.equal(base().fresh, false);
  const commits = commitCount(r);
  emit({ type: 'step.finished', step_id: 'draft', output: DRAFT });
  assert.equal(read(r, 'docs/work/write-doc/intent.md'), INTENT);
  assert.equal(read(r, 'docs/work/write-doc/intent.pt-BR.md'), INTENT_PT);
  assert.equal(commitCount(r), commits);
});
