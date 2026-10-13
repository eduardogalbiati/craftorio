// #351: one adapter per git platform (src/shared/platforms/github.js, gitlab.js) and a registry
// (src/shared/platforms/index.js) that resolves either vocabulary: the platform id (`github`,
// `gitlab`: the backlog, settings) and the short id (`gh`, `gl`: workflow inputs, skill suffixes).
// Seams: the registry's resolvePlatform / PLATFORMS / platformOfUrl and each adapter's identity,
// request terms and issue URL parser. The adapters are created by the change: loaded inside each test.
const test = require('node:test');
const assert = require('node:assert/strict');

const registry = () => require('../src/shared/platforms');
const github = () => require('../src/shared/platforms/github');
const gitlab = () => require('../src/shared/platforms/gitlab');

const identity = (a) => ({ id: a.id, short: a.short, cli: a.cli, label: a.label });

test('the GitHub adapter: id github, short id gh, the gh CLI, label GitHub', () => {
  assert.deepEqual(identity(github()), { id: 'github', short: 'gh', cli: 'gh', label: 'GitHub' });
});

test('the GitLab adapter: id gitlab, short id gl, the glab CLI, label GitLab', () => {
  assert.deepEqual(identity(gitlab()), { id: 'gitlab', short: 'gl', cli: 'glab', label: 'GitLab' });
});

test('request terms: a pull request is "PR #", a merge request "MR !"', () => {
  assert.deepEqual({ ...github().request }, { noun: 'pull request', short: 'PR', sign: '#' });
  assert.deepEqual({ ...gitlab().request }, { noun: 'merge request', short: 'MR', sign: '!' });
});

test('resolvePlatform: either vocabulary gives the same adapter', () => {
  const { resolvePlatform } = registry();
  assert.equal(resolvePlatform('github').id, 'github');
  assert.equal(resolvePlatform('gh').id, 'github');
  assert.equal(resolvePlatform('gitlab').id, 'gitlab');
  assert.equal(resolvePlatform('gl').id, 'gitlab');
  assert.equal(resolvePlatform('gh') === resolvePlatform('github'), true);
  assert.equal(resolvePlatform('gl') === resolvePlatform('gitlab'), true);
});

test('resolvePlatform: the adapter it gives is the platform module itself', () => {
  const { resolvePlatform } = registry();
  assert.equal(resolvePlatform('gh') === github(), true);
  assert.equal(resolvePlatform('gitlab') === gitlab(), true);
});

test('resolvePlatform: the short id maps to the skill suffix and back (ci-pipeline-gh ↔ github)', () => {
  const { resolvePlatform } = registry();
  assert.equal(`ci-pipeline-${resolvePlatform('github').short}`, 'ci-pipeline-gh');
  assert.equal(`ci-pipeline-${resolvePlatform('gitlab').short}`, 'ci-pipeline-gl');
  assert.equal(resolvePlatform(resolvePlatform('gl').short).id, 'gitlab');
});

test('resolvePlatform: an unknown or missing platform is an error naming it', () => {
  const { resolvePlatform } = registry();
  assert.throws(() => resolvePlatform('bitbucket'), /bitbucket/);
  assert.throws(() => resolvePlatform('glab'), /glab/);
  assert.throws(() => resolvePlatform(''), Error);
  assert.throws(() => resolvePlatform(undefined), Error);
});

test('PLATFORMS: the two adapters, GitHub first', () => {
  const { PLATFORMS } = registry();
  assert.deepEqual(PLATFORMS.map((p) => p.id), ['github', 'gitlab']);
  assert.deepEqual(PLATFORMS.map((p) => p.short), ['gh', 'gl']);
});

test('parseIssueUrl (GitHub): host, repository and number of an issue URL', () => {
  const p = github();
  assert.deepEqual(p.parseIssueUrl('https://github.com/o/r/issues/12'), { host: 'github.com', repo: 'o/r', number: 12 });
  assert.deepEqual(p.parseIssueUrl('https://ghe.example.com/o/r/issues/3#issuecomment-1'), { host: 'ghe.example.com', repo: 'o/r', number: 3 });
  assert.equal(p.parseIssueUrl('https://gitlab.com/g/sub/p/-/issues/7'), null);
  assert.equal(p.parseIssueUrl('not a url'), null);
  assert.equal(p.parseIssueUrl(undefined), null);
});

test('parseIssueUrl (GitLab): subgroups are kept in the repository path', () => {
  const p = gitlab();
  assert.deepEqual(p.parseIssueUrl('https://gitlab.com/g/sub/p/-/issues/7'), { host: 'gitlab.com', repo: 'g/sub/p', number: 7 });
  assert.deepEqual(p.parseIssueUrl('https://git.example.com/g/p/-/issues/21?x=1'), { host: 'git.example.com', repo: 'g/p', number: 21 });
  assert.equal(p.parseIssueUrl('https://github.com/o/r/issues/12'), null);
  assert.equal(p.parseIssueUrl(''), null);
});

test('platformOfUrl: an issue, pull request or merge request URL names its platform; anything else none', () => {
  const { platformOfUrl } = registry();
  assert.equal(platformOfUrl('https://github.com/o/r/issues/12')?.id, 'github');
  assert.equal(platformOfUrl('https://ghe.example.com/o/r/pull/40')?.id, 'github');
  assert.equal(platformOfUrl('https://gitlab.com/g/sub/p/-/issues/7')?.id, 'gitlab');
  assert.equal(platformOfUrl('https://git.example.com/g/p/-/merge_requests/8')?.id, 'gitlab');
  assert.equal(platformOfUrl('https://example.com/readme'), null);
  assert.equal(platformOfUrl(null), null);
});
