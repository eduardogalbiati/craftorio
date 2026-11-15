// #568 the comment a triggered run leaves on the pull/merge request it started from: the platform adapters'
// prCommentCommand (gh reads the text from a file, glab takes it as an argument).
const test = require('node:test');
const assert = require('node:assert/strict');

const github = () => require('../platforms/github');
const gitlab = () => require('../platforms/gitlab');

test('#568 GitHub comments on a pull request with gh pr comment and the text file', () => {
  const c = github().prCommentCommand({ target: 'acme/app', n: '7', file: '/run/trigger-report.md', text: 'hello' });
  assert.equal(c.cli, 'gh');
  assert.deepEqual(c.args, ['pr', 'comment', '7', '--repo', 'acme/app', '--body-file', '/run/trigger-report.md']);
});

test('#568 GitLab comments on a merge request with glab mr note and the text', () => {
  const c = gitlab().prCommentCommand({ target: 'acme/app', n: '7', file: '/run/trigger-report.md', text: 'hello' });
  assert.equal(c.cli, 'glab');
  assert.deepEqual(c.args, ['mr', 'note', '7', '--repo', 'acme/app', '--message', 'hello']);
});
