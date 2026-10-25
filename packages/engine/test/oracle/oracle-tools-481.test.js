// #481 (SEC-24), packages/engine/domains/oracle/oracle-tools.js repo_git: `git diff --no-index <a> <b>` compares any two files of
// the machine, outside the project's repository: refused like the write options (refusedGitCommand
// answers a non-empty reason). A plain diff stays allowed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { refusedGitCommand } = require('../../domains/oracle/oracle-tools');

test('#481 repo_git: diff --no-index is refused, wherever it sits in the args', () => {
  assert.notEqual(refusedGitCommand('diff', ['--no-index', '/etc/passwd', 'a.txt']), '');
  assert.notEqual(refusedGitCommand('diff', ['--stat', '--no-index', 'C:/Users/x/.ssh/id_rsa', 'a.txt']), '');
});

test('#481 repo_git: a plain diff is still allowed', () => {
  assert.equal(refusedGitCommand('diff', ['--stat', 'HEAD~1']), '');
});
