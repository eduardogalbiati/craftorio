// #35: the issue workflow's run on a project with no remote files the approved drafts into the local backlog
// (packages/engine/domains/backlog/local-backlog.js fileRunDrafts).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const local = require('../../domains/backlog/local-backlog');

const tmpDir = () => fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'run-drafts-35-'));
const write = { output: { issues: [{ title: 'First', body: 'one', labels: ['bug'] }, { title: 'Second', body: 'two', labels: [] }], existing_issue: 0, addition: '' } };

test('create_assign adds each draft to the local backlog and answers the filer shape', () => {
  const dir = tmpDir();
  const filed = local.fileRunDrafts(dir, 'p', { write, review: { output: { choice: 'create_assign' } }, file: { output: { filed: [] } } });
  assert.deepStrictEqual(filed.map((f) => [f.action, f.number, f.title, f.url]), [['created', 1, 'First', ''], ['created', 2, 'Second', '']]);
  const issues = local.readLocalIssues(dir, 'p');
  assert.deepStrictEqual(issues.map((i) => [i.title, i.state, i.local]), [['First', 'open', true], ['Second', 'open', true]]);
  assert.deepStrictEqual(issues[0].labels.map((l) => l.name), ['bug']);
});

test('automatic mode (no review) creates; discard and revise file nothing', () => {
  const dir = tmpDir();
  assert.strictEqual(local.fileRunDrafts(dir, 'p', { write, file: { output: { filed: [] } } }).length, 2);
  assert.deepStrictEqual(local.fileRunDrafts(dir, 'p', { write, review: { output: { choice: 'discard' } } }), []);
  assert.strictEqual(local.readLocalIssues(dir, 'p').length, 2);
});

test('add_to appends to the local issue the note names, and ignores a number that is not local', () => {
  const dir = tmpDir();
  local.createLocalIssue(dir, 'p', { title: 'Old', body: 'start' });
  const steps = (feedback) => ({ write: { output: { ...write.output, addition: 'more' } }, review: { output: { choice: 'add_to', feedback } } });
  assert.deepStrictEqual(local.fileRunDrafts(dir, 'p', steps('add to #1')).map((f) => [f.action, f.number]), [['edited', 1]]);
  assert.strictEqual(local.readLocalIssues(dir, 'p')[0].body, 'start\n\nmore');
  assert.deepStrictEqual(local.fileRunDrafts(dir, 'p', steps('add to #9')), []);
});
