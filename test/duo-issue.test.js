// src/renderer/views/duo/duo-issue.js: prefilling Write & Review from a Backlog issue (#103). Pure, no DOM.
const test = require('node:test');
const assert = require('node:assert/strict');
const DuoIssue = require('../src/renderer/views/duo/duo-issue');

const ISSUE = {
  number: 29, title: 'Backlog screen', url: 'https://github.com/o/r/issues/29',
  body: 'Add a kanban view.', labels: [{ name: 'enhancement' }, 'ui'],
};

test('defaultGoal: a non-empty goal for every document type, empty for free-form or an unknown skill', () => {
  for (const skill of ['issue-writing', 'rfc-writing', 'prd-writing', 'design-doc-writing']) {
    assert.ok(DuoIssue.defaultGoal(skill).length > 20, skill);
  }
  assert.equal(DuoIssue.defaultGoal(''), '');
  assert.equal(DuoIssue.defaultGoal('does-not-exist'), '');
});

test('issuePrompt: the issue\'s number, title, URL, labels and full body', () => {
  const prompt = DuoIssue.issuePrompt(ISSUE, 'issue-writing');
  assert.match(prompt, /#29/);
  assert.match(prompt, /Backlog screen/);
  assert.match(prompt, /URL: https:\/\/github\.com\/o\/r\/issues\/29/);
  assert.match(prompt, /Labels: enhancement, ui/);
  assert.match(prompt, /<issue>\nAdd a kanban view\.\n<\/issue>/);
});

test('issuePrompt: no labels reads "none", no body reads "(no description)"', () => {
  const prompt = DuoIssue.issuePrompt({ number: 1, title: 'T', url: 'u' });
  assert.match(prompt, /Labels: none/);
  assert.match(prompt, /<issue>\n\(no description\)\n<\/issue>/);
});

test('issuePrompt: a body that is only whitespace also reads "(no description)"', () => {
  const prompt = DuoIssue.issuePrompt({ number: 1, title: 'T', url: 'u', body: '   \n  ' });
  assert.match(prompt, /<issue>\n\(no description\)\n<\/issue>/);
});

test('enrichInputs: prompt, goal and document_skill for the default and for another document type', () => {
  const def = DuoIssue.enrichInputs(ISSUE);
  assert.equal(def.document_skill, 'issue-writing');
  assert.equal(def.document_skill, DuoIssue.DEFAULT_ISSUE_SKILL);
  assert.equal(def.goal, DuoIssue.defaultGoal('issue-writing'));
  assert.match(def.prompt, /#29/);

  const rfc = DuoIssue.enrichInputs(ISSUE, 'rfc-writing');
  assert.equal(rfc.document_skill, 'rfc-writing');
  assert.equal(rfc.goal, DuoIssue.defaultGoal('rfc-writing'));
  assert.notEqual(rfc.goal, def.goal);
});

test('enrichInputs: a free-form document carries no goal', () => {
  const out = DuoIssue.enrichInputs(ISSUE, '');
  assert.equal(out.document_skill, '');
  assert.equal(out.goal, '');
  assert.match(out.prompt, /a fuller document/);
});

test('issuePrompt: an unknown skill still names it in the prompt', () => {
  assert.match(DuoIssue.issuePrompt(ISSUE, 'made-up-skill'), /a document \(made-up-skill\)/);
});
