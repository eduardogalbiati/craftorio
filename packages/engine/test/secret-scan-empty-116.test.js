// #116: the secret scan over a run with no commit of its own is not a pass ("No secret found in the commits."
// over zero commits hid a developer that committed nothing). Acceptance test written before the code.
// Contract: status other than 'pass', a message that says there is nothing to scan (no commit).
// Seam: the bundled fix workflow's secret_scan step on a small run state (helpers/fake-gitleaks.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { commit, git, installGitleaks, plainGit, project, scan } = require('./helpers/fake-gitleaks');

plainGit();
const LIMIT = { timeout: 120000 };

test('#116 scan: a run with no commit of its own says there is nothing to scan, not a pass', LIMIT, async (t) => {
  installGitleaks(t);
  const where = project(t); // the run's branch is still at the base: zero commits
  const { out } = await scan(t, 'fix', where);
  assert.notEqual(out.status, 'pass', out.message);
  assert.doesNotMatch(out.message, /No secret found/i);
  assert.match(out.message, /nothing to scan|no commits?\b/i);
});

test('#116 scan: a release whose last tag is at HEAD (since, zero commits) is skipped with nothing to scan', LIMIT, async (t) => {
  const { calls } = installGitleaks(t);
  const where = project(t);
  git(where.repo, 'tag', 'engine-v1.0.0', 'main');
  const steps = { version: { output: { kind: 'release_version', status: 'written', version: '1.1.0', product: 'engine', tag_prefix: 'engine-v', tag: 'engine-v1.1.0', folder: 'packages/engine', previous_version: 'engine-v1.0.0' }, visits: 1 } };
  const { out } = await scan(t, 'release', where, { steps });
  assert.equal(out.status, 'skipped', out.message);
  assert.equal(out.message_key, 'engine.secret_scan_no_commits');
  assert.match(out.message, /nothing to scan/i);
  assert.equal(calls().length, 0, 'gitleaks is not called over zero commits');
});

test('#116 scan: a run with one commit still passes when it holds no secret', LIMIT, async (t) => {
  installGitleaks(t);
  const where = project(t);
  commit(where.dir, 'the change', { 'src/new.txt': 'nothing here\n' });
  const { out } = await scan(t, 'fix', where);
  assert.equal(out.status, 'pass', out.message);
});
