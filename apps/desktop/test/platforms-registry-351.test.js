// #351: the platform registry's lenient helpers (findPlatform, platformOrDefault, requestRef), the
// short-id vocabulary accepted by the issue reads, and the adapters loaded as browser scripts in the
// order index.html gives (the Backlog and Settings screens use window.Platforms).
// Seams: packages/shared/platforms (registry), packages/engine/domains/backlog/backlog.js fetchIssues, packages/shared/backlog-archive.js
// archiveConfirmText, apps/desktop/renderer/index.html's script list.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
// a page file by its page-relative name, in whichever layer holds it (the UI kit, a front, the page folder)
const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
const vm = require('vm');

const registry = require('@craftorio/shared/platforms');

test('findPlatform: trims and ignores case; unknown or empty names give null', () => {
  assert.equal(registry.findPlatform(' GitHub ')?.id, 'github');
  assert.equal(registry.findPlatform('GL')?.id, 'gitlab');
  assert.equal(registry.findPlatform('bitbucket'), null);
  assert.equal(registry.findPlatform(''), null);
  assert.equal(registry.findPlatform(undefined), null);
});

test('platformOrDefault: an unknown or missing platform falls back to GitHub', () => {
  assert.equal(registry.platformOrDefault('bitbucket').id, 'github');
  assert.equal(registry.platformOrDefault(null).id, 'github');
  assert.equal(registry.platformOrDefault('gl').id, 'gitlab');
  assert.equal(registry.DEFAULT_PLATFORM, 'github');
});

test('requestRef: "PR #12" on GitHub, "MR !12" on GitLab, GitHub terms when unknown', () => {
  assert.equal(registry.requestRef('github', 12), 'PR #12');
  assert.equal(registry.requestRef('gh', 12), 'PR #12');
  assert.equal(registry.requestRef('gitlab', 12), 'MR !12');
  assert.equal(registry.requestRef('gl', 8), 'MR !8');
  assert.equal(registry.requestRef('bitbucket', 3), 'PR #3');
});

test('archiveConfirmText: GitLab wording for GitLab, GitHub wording otherwise', () => {
  const { archiveConfirmText } = require('@craftorio/shared/backlog-archive');
  assert.equal(archiveConfirmText([7], 'gitlab'), 'Close #7 on GitLab and label it archived?');
  assert.equal(archiveConfirmText([12, 13], 'github'), 'Close #12, #13 as not planned on GitHub and label them archived?');
  assert.equal(archiveConfirmText([3], 'bitbucket'), 'Close #3 as not planned on GitHub and label it archived?');
});

function recorder() {
  const calls = [];
  return { calls, exec: async (cli, args) => { calls.push([cli, ...args].join(' ')); return '[]'; } };
}

test('fetchIssues: the short ids gh / gl build the same CLI calls as github / gitlab', async () => {
  const { fetchIssues } = require('@craftorio/engine/domains/backlog/backlog');
  const gh = recorder();
  await fetchIssues({ platform: 'gh', repo: 'https://github.com/o/r', exec: gh.exec });
  assert.deepEqual(gh.calls, ['gh issue list --repo o/r --state all --limit 300 --json number,title,state,labels,url,author,assignees,body,createdAt,updatedAt']);
  const gl = recorder();
  await fetchIssues({ platform: 'gl', repo: 'https://git.example.com/g/p', exec: gl.exec });
  // #90: then the project's members, whose access level gives each issue's author association
  assert.deepEqual(gl.calls, ['glab issue list --repo https://git.example.com/g/p --all --per-page 100 --output json', 'glab api --hostname git.example.com --paginate projects/g%2Fp/members/all?per_page=100']);
});

test('index.html loads the adapters, then the registry, before every other shared script', () => {
  const html = fs.readFileSync(pageFileOf('index.html'), 'utf8');
  const shared = [...html.matchAll(/<script src="\.\.\/\.\.\/\.\.\/packages\/shared\/([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(shared.slice(0, 3).sort(), ['platforms/github.js', 'platforms/gitlab.js', 'platforms/index.js'].sort());
  assert.equal(shared[2], 'platforms/index.js');
});

test('as browser scripts in that order, the adapters and the registry give window.Platforms', () => {
  const dir = path.join(__dirname, '..', '..', '..', 'packages', 'shared', 'platforms');
  const window = {};
  const ctx = vm.createContext({ window });
  for (const f of ['github.js', 'gitlab.js', 'index.js']) vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
  const P = window.Platforms;
  assert.equal(typeof P, 'object');
  assert.deepEqual(Array.from(P.PLATFORMS.map((p) => p.id)), ['github', 'gitlab']);
  assert.equal(P.resolvePlatform('gl').cli, 'glab');
  assert.equal(P.requestRef('gitlab', 4), 'MR !4');
});
