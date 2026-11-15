// #568 the backlog's prCommentCommand: the CLI call that comments on a pull/merge request, its target taken
// from the repository URL (like issueSaveCommand), the text never shown in the display.
const test = require('node:test');
const assert = require('node:assert/strict');

const backlog = require('../../domains/backlog/backlog');

test('#568 the PR comment command targets the GitHub repository of its URL', () => {
  const c = backlog.prCommentCommand({ platform: 'github', repo: 'https://github.com/acme/app', number: 7, file: '/run/r.md', text: 'secret text' });
  assert.deepEqual([c.cli, ...c.args], ['gh', 'pr', 'comment', '7', '--repo', 'acme/app', '--body-file', '/run/r.md']);
  assert.match(c.display, /^gh pr comment 7 --repo acme\/app/);
});

test('#568 the GitLab PR comment command is a merge request note with the text', () => {
  const c = backlog.prCommentCommand({ platform: 'gitlab', repo: 'https://gitlab.com/g/r', number: 3, text: 'hello' });
  assert.deepEqual([c.cli, ...c.args], ['glab', 'mr', 'note', '3', '--repo', 'g/r', '--message', 'hello']);
});

test('#568 the number is normalised to digits', () => {
  const c = backlog.prCommentCommand({ platform: 'github', repo: 'https://github.com/acme/app', number: '07', file: 'f', text: 'x' });
  assert.equal(c.args[2], '7');
});
