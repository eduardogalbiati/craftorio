// #28 acceptance, written before the code: the Backlog screens' fixed texts a first issue's owner reads go
// through t() (the renderer's convention: t('<key>'), the English in en.json, never in the source), so pt-BR
// shows them translated. Checked in the source of fronts/build/views/backlog/backlog-po.js (the Product Owner
// drawer's empty states and footer note) and backlog.js (the platform select's "(soon)").
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
const source = (rel) => fs.readFileSync(pageFileOf(rel), 'utf8');
const present =(src, literals) => literals.filter((s) => src.includes(s));

test('#28 PO drawer: the issue-mode empty state is not hard-coded English', () => {
  assert.deepEqual(present(source('views/backlog/backlog-po.js'), ['Describe the issue in a few words: type it, dictate it, or paste a screenshot']), []);
});

test('#28 PO drawer: the planning empty state is not hard-coded English', () => {
  assert.deepEqual(present(source('views/backlog/backlog-po.js'), ['I read the synced issues, the queue, the runs in progress']), []);
});

test('#28 PO drawer: the footer note (simulated / real call / conversation cost) is not hard-coded English', () => {
  assert.deepEqual(present(source('views/backlog/backlog-po.js'), [
    'Simulated: no model is called and nothing is spent.',
    'Filing only previews: nothing reaches GitHub/GitLab.',
    'Each question is one call to the model',
    ' Conversation cost ',
  ]), []);
});

test('#28 Backlog: the platform select\'s "(soon)" is not hard-coded English', () => {
  assert.deepEqual(present(source('views/backlog/backlog.js'), ["' (soon)'"]), []);
});
