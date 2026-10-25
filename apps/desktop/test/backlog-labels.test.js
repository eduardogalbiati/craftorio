// apps/desktop/renderer/views/backlog/backlog-labels.js: the Backlog label filter rule (#91). Plain logic,
// no DOM, so it is required directly (module.exports), unlike the renderer files that only run
// inside Electron.
const test = require('node:test');
const assert = require('node:assert/strict');
const { hasLabel, labelGroup, labelOptions, matchesLabels, pruneLabels, toggleLabel } = require('../renderer/views/backlog/backlog-labels');

const issue = (...labels) => ({ labels: labels.map((l) => (typeof l === 'string' ? { name: l } : l)) });

test('matchesLabels: no selection matches every issue', () => {
  assert.equal(matchesLabels(issue('bug'), []), true);
  assert.equal(matchesLabels(issue(), null), true);
});

test('matchesLabels: a prefixed group (complexity) combines with AND against the unprefixed group', () => {
  assert.equal(matchesLabels(issue('bug'), ['bug', 'complexity:1']), false, 'no complexity label at all');
  assert.equal(matchesLabels(issue('bug', 'complexity:2'), ['bug', 'complexity:1']), false, 'wrong complexity');
  assert.equal(matchesLabels(issue('bug', 'complexity:1'), ['bug', 'complexity:1']), true);
});

test('matchesLabels: every label without a prefix is one group (OR among them), per the spec', () => {
  // selecting two unprefixed labels ("bug", "enhancement") matches issues with either
  assert.equal(matchesLabels(issue('bug'), ['bug', 'enhancement']), true);
  assert.equal(matchesLabels(issue('enhancement'), ['bug', 'enhancement']), true);
  assert.equal(matchesLabels(issue('documentation'), ['bug', 'enhancement']), false);
});

test('matchesLabels: labels sharing a prefix before ":" are one group, combined with OR', () => {
  const has1 = issue('bug', 'complexity:1');
  const has2 = issue('bug', 'complexity:2');
  const has3 = issue('bug', 'complexity:3');
  const selected = ['bug', 'complexity:1', 'complexity:2'];
  assert.equal(matchesLabels(has1, selected), true);
  assert.equal(matchesLabels(has2, selected), true);
  assert.equal(matchesLabels(has3, selected), false, 'complexity:3 is not in the selected group');
});

test('matchesLabels: whole names, case-insensitively; "bug" never matches "debug"', () => {
  assert.equal(matchesLabels(issue('BUG'), ['bug']), true);
  assert.equal(matchesLabels(issue('debug'), ['bug']), false);
  assert.equal(matchesLabels(issue('Complexity:1'), ['complexity:1']), true);
});

test('matchesLabels: accepts plain-string labels (GitLab) as well as { name, color } objects', () => {
  assert.equal(matchesLabels({ labels: ['bug'] }, ['bug']), true);
  assert.equal(matchesLabels({ labels: ['bug'] }, ['BUG']), true);
});

test('labelGroup: the prefix before ":", lower-cased; no prefix is the empty group', () => {
  assert.equal(labelGroup('complexity:1'), 'complexity');
  assert.equal(labelGroup('Complexity:2'), 'complexity');
  assert.equal(labelGroup('bug'), '');
  assert.equal(labelGroup(':oops'), ''); // nothing before the prefix: not a real group
});

test('labelOptions: every label present, with its first color and how many of the counted issues have it', () => {
  const all = [
    issue({ name: 'bug', color: 'ff0000' }, 'complexity:1'),
    issue({ name: 'bug', color: '00ff00' }), // same label seen again: keeps the first color
    issue('enhancement'),
  ];
  const options = labelOptions(all);
  assert.deepEqual(options.map((o) => [o.name, o.color, o.count]), [
    ['bug', 'ff0000', 2],
    ['enhancement', '', 1],
    ['complexity:1', '', 1],
  ]);
});

test('labelOptions: counts only the `counted` subset (e.g. the current state filter), not `all`', () => {
  const all = [issue('bug'), issue('bug'), issue('enhancement')];
  const options = labelOptions(all, [all[0]]);
  assert.deepEqual(options.map((o) => [o.name, o.count]), [['bug', 1], ['enhancement', 0]]);
});

test('labelOptions: sorted by group (unprefixed first), then by name', () => {
  const all = [issue('enhancement'), issue('complexity:10'), issue('complexity:2'), issue('bug')];
  const options = labelOptions(all);
  assert.deepEqual(options.map((o) => o.name), ['bug', 'enhancement', 'complexity:2', 'complexity:10']);
});

test('pruneLabels: drops labels no synced issue has any more, without erroring', () => {
  const issues = [issue('bug', 'complexity:1')];
  assert.deepEqual(pruneLabels(['bug', 'enhancement'], issues), ['bug']);
  assert.deepEqual(pruneLabels(['enhancement'], issues), []);
  assert.deepEqual(pruneLabels([], issues), []);
  assert.deepEqual(pruneLabels(['bug'], []), []);
});

test('pruneLabels: matches case-insensitively and drops duplicates', () => {
  const issues = [issue('Bug')];
  assert.deepEqual(pruneLabels(['bug', 'BUG', 'bug'], issues), ['bug']);
});

test('toggleLabel: adds a label not yet selected, removes it (any case) when it is', () => {
  assert.deepEqual(toggleLabel([], 'bug'), ['bug']);
  assert.deepEqual(toggleLabel(['bug'], 'BUG'), []);
  assert.deepEqual(toggleLabel(['bug'], 'enhancement'), ['bug', 'enhancement']);
  assert.deepEqual(toggleLabel(['bug'], ''), ['bug']); // an empty name changes nothing
});

test('hasLabel: whole-name, case-insensitive membership', () => {
  assert.equal(hasLabel(['complexity:1'], 'Complexity:1'), true);
  assert.equal(hasLabel(['bug'], 'debug'), false);
  assert.equal(hasLabel([], 'bug'), false);
});
