// apps/desktop/renderer/display-name.js: an agent's slug read as a name, shared by the run chat, run lists,
// Backlog cards and the Run screen.
const test = require('node:test');
const assert = require('node:assert/strict');
const { displayName } = require('@multiagent/shared/display-name.js');

test('displayName: turns a snake_case slug into a capitalised name', () => {
  assert.equal(displayName('test_writer'), 'Test writer');
  assert.equal(displayName('pr_babysitter'), 'PR babysitter');
  assert.equal(displayName('ci_pusher'), 'CI pusher');
});

test('displayName: known acronyms stay uppercase wherever they appear in the slug', () => {
  assert.equal(displayName('pr_babysitter'), 'PR babysitter');
  assert.equal(displayName('ci_pusher'), 'CI pusher');
  assert.equal(displayName('open_mr'), 'Open MR');
  assert.equal(displayName('qa_engineer'), 'QA engineer');
  assert.equal(displayName('ui_reviewer'), 'UI reviewer');
  assert.equal(displayName('api_developer'), 'API developer');
});

test('displayName: an agent imported from the Agents menu shows its own name, not the slug', () => {
  assert.equal(displayName('test_writer', { test_writer: 'Grumpy QA' }), 'Grumpy QA');
  // an agent not in the menu still falls back to the slug reading
  assert.equal(displayName('developer', { test_writer: 'Grumpy QA' }), 'Developer');
});

test('displayName: empty or undefined input reads as an empty string', () => {
  assert.equal(displayName(''), '');
  assert.equal(displayName(undefined), '');
  assert.equal(displayName(null), '');
});

test('displayName: a name that already reads well is left as is', () => {
  assert.equal(displayName('developer'), 'Developer');
  assert.equal(displayName('reviewer'), 'Reviewer');
});

test('displayName: a fan-out label ("a · b") is named part by part', () => {
  assert.equal(displayName('qa_engineer · pr_babysitter'), 'QA engineer · PR babysitter');
  assert.equal(displayName('a · b', { a: 'Agent A' }), 'Agent A · B');
});
