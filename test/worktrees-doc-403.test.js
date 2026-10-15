// #403: docs/agents/worktrees.md says when a run's branch is brought up to date with the local base
// (before each suite and E2E round, a resumed run too, a conflict left to the final merge).
// The behaviour itself is tested in test/slow/suite-base-sync-403.slow.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('#403 docs/agents/worktrees.md says the branch is brought up to date with the base before each suite round', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'agents', 'worktrees.md'), 'utf8');
  const paragraphs = doc.split(/\r?\n\s*\r?\n/).filter((p) => /#403/.test(p));
  assert.equal(paragraphs.length >= 1, true, 'a paragraph cites #403');
  const text = paragraphs.join('\n');
  assert.match(text, /suite/i, 'it names the suite rounds');
  assert.match(text, /rebase|up to date/i, 'it says how the branch gets the base');
  assert.match(text, /conflict/i, 'it says what a conflict does');
  assert.match(text, /resum/i, 'it covers a resumed run');
});
