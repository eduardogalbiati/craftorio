// #810 merge / close a pull request from the app: the platform adapters' commands (packages/shared/platforms/github.js,
// gitlab.js). Acceptance tests, written before the code, on the { cli, args } each adapter returns (as
// requestViewCommand).
//
// The interface these tests assume (new adapter methods; `t` is the adapter's parseTargetUrl result { host, repo, id }):
//   requestMergeCommand(t, { admin = false, deleteBranch = false } = {}) → { cli, args } | null
//     GitHub: `gh pr merge <n> --repo <host>/<repo> --merge` (a merge commit, never --squash / --rebase / --auto),
//             `--admin` only when admin, `--delete-branch` only when deleteBranch.
//     GitLab: `glab mr merge <iid> --repo <url> --yes` (no --squash / --rebase: a merge commit), `--remove-source-branch`
//             only when deleteBranch; admin → null (GitLab has no merge that ignores the approval rules).
//   requestCloseCommand(t) → { cli, args }: `gh pr close <n> --repo ...`, `glab mr close <iid> --repo ...`.
const test = require('node:test');
const assert = require('node:assert/strict');

const github = () => require('../platforms/github');
const gitlab = () => require('../platforms/gitlab');

const GH = () => github().parseTargetUrl('https://github.com/acme/app/pull/42');
const GL = () => gitlab().parseTargetUrl('https://gitlab.com/acme/app/-/merge_requests/7');
const has = (c, ...flags) => flags.map((f) => !!c?.args?.includes(f));
const repoArg = (c) => String(c?.args?.[c.args.indexOf('--repo') + 1] ?? '');

test('#810 GitHub: merge from the app is gh pr merge <n> with a merge commit, on the PR\'s repository', () => {
  const c = github().requestMergeCommand(GH());
  assert.deepEqual(
    [c.cli, c.args.slice(0, 3), repoArg(c).endsWith('acme/app'), ...has(c, '--merge', '--squash', '--rebase', '--auto', '--admin', '--delete-branch')],
    ['gh', ['pr', 'merge', '42'], true, true, false, false, false, false, false],
  );
});

test('#810 GitHub: merge ignoring protection adds --admin, still a merge commit', () => {
  const c = github().requestMergeCommand(GH(), { admin: true });
  assert.deepEqual(has(c, '--admin', '--merge', '--squash'), [true, true, false]);
});

test('#810 GitHub: the merged branch is deleted only when asked (--delete-branch)', () => {
  assert.deepEqual(has(github().requestMergeCommand(GH(), { deleteBranch: true }), '--delete-branch'), [true]);
});

test('#810 GitLab: merge from the app is glab mr merge <iid> --yes without squash, on the MR\'s project', () => {
  const c = gitlab().requestMergeCommand(GL());
  assert.deepEqual(
    [c.cli, c.args.slice(0, 3), repoArg(c).endsWith('acme/app'), ...has(c, '--yes', '--squash', '--rebase', '--remove-source-branch')],
    ['glab', ['mr', 'merge', '7'], true, true, false, false, false],
  );
});

test('#810 GitLab: the merged branch is deleted only when asked (--remove-source-branch)', () => {
  assert.deepEqual(has(gitlab().requestMergeCommand(GL(), { deleteBranch: true }), '--remove-source-branch'), [true]);
});

test('#810 GitLab: there is no merge ignoring the approval rules (admin → null)', () => {
  assert.equal(gitlab().requestMergeCommand(GL(), { admin: true }), null);
});

test('#810 close without merge: gh pr close <n> and glab mr close <iid>, on the request\'s repository', () => {
  const gh = github().requestCloseCommand(GH());
  const gl = gitlab().requestCloseCommand(GL());
  assert.deepEqual(
    [gh.cli, gh.args.slice(0, 3), repoArg(gh).endsWith('acme/app'), gl.cli, gl.args.slice(0, 3), repoArg(gl).endsWith('acme/app')],
    ['gh', ['pr', 'close', '42'], true, 'glab', ['mr', 'close', '7'], true],
  );
});
