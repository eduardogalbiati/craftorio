// #669 the wizard's repository list through the platform adapters (repoListCommand / parseRepos) and
// packages/engine/service/areas/project-onboarding.js machineRepos.
const test = require('node:test');
const assert = require('node:assert/strict');

const github = () => require('@craftorio/shared/platforms/github');
const gitlab = () => require('@craftorio/shared/platforms/gitlab');
const onboarding = () => require('../service/areas/project-onboarding');

test('#669 repoListCommand: each adapter lists the account repositories as JSON with its own CLI', () => {
  assert.equal(github().repoListCommand(30).cli, 'gh');
  assert.deepEqual(github().repoListCommand(30).args.slice(0, 2), ['repo', 'list']);
  assert.ok(github().repoListCommand(30).args.includes('--json'));
  assert.equal(gitlab().repoListCommand(30).cli, 'glab');
  assert.ok(gitlab().repoListCommand(30).args.includes('json'));
});

test('#669 parseRepos: the CLI JSON becomes { name, private, updatedAt }, tolerant of noise around it', () => {
  const gh = `warning: something\n${JSON.stringify([{ nameWithOwner: 'acme/shop', isPrivate: true, updatedAt: '2026-10-30T10:00:00Z' }, { isPrivate: false }])}`;
  assert.deepEqual(github().parseRepos(gh), [{ name: 'acme/shop', private: true, updatedAt: '2026-10-30T10:00:00Z' }]);
  const gl = JSON.stringify([{ path_with_namespace: 'grp/sub/app', visibility: 'public', last_activity_at: null }]);
  assert.deepEqual(gitlab().parseRepos(gl), [{ name: 'grp/sub/app', private: false, updatedAt: null }]);
  assert.deepEqual(github().parseRepos('not json'), []);
  assert.deepEqual(gitlab().parseRepos(''), []);
});

test('#669 machineRepos: an unknown provider answers [] without running anything', async () => {
  assert.deepEqual(await onboarding().machineRepos('constructor'), []);
  assert.deepEqual(await onboarding().machineRepos('bitbucket'), []);
});
