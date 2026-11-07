// #812 the PRs / MRs screen: every open pull request of a project, read through the platform adapters
// (packages/shared/platforms/github.js, gitlab.js). Acceptance tests, written before the code, on the { cli, args }
// each adapter returns (as requestViewCommand) and on its parser of the CLI's JSON (no CLI runs here).
//
// The interface these tests assume (new adapter methods, the developer implements them as named):
//   pullListCommand(target, limit) → { cli, args }   (target: the adapter's cliTarget, e.g. 'acme/app')
//     GitHub: `gh pr list --repo <target> --state open --limit <n> --json <fields>`, fields with at least
//             number,title,url,author,isDraft,headRefName,baseRefName,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup
//     GitLab: `glab mr list --repo <target> ... --output json` (open MRs are glab's default)
//   parsePulls(json) → [{ number, title, url, author, draft, head, base, state, ci: { status }, review: { status },
//                         conflicts: { status } }]   (json: the CLI's parsed JSON list; anything else → [])
//     the same card fields as run-pr.js fetchPrMonitor (#809), so each entry draws as the run's PR card:
//     state: ready | conflict | pending | failing | draft | open (run-pr.js PR_STATES)
//     ci.status: passed | failed | running | none; review.status: approved | changes_requested | required | none;
//     conflicts.status: base | none; head / base: the source and target branch names (a stack, #807, is read from them)
const test = require('node:test');
const assert = require('node:assert/strict');

const github = () => require('../platforms/github');
const gitlab = () => require('../platforms/gitlab');

const after = (c, flag) => String(c?.args?.[c.args.indexOf(flag) + 1] ?? '');
// the fields the tests read of one parsed entry, as primitives
const view = (p) => [p.number, p.title, p.url, p.author, p.draft, p.head, p.base, p.state, p.ci?.status, p.review?.status, p.conflicts?.status];

test('#812 GitHub: the list is gh pr list --state open --json with the fields a PR card and a stack need', () => {
  const c = github().pullListCommand('acme/app', 50);
  const fields = after(c, '--json').split(',');
  const need = ['number', 'title', 'url', 'author', 'isDraft', 'headRefName', 'baseRefName', 'mergeable', 'mergeStateStatus', 'reviewDecision', 'statusCheckRollup'];
  assert.deepEqual(
    [c.cli, c.args.slice(0, 2), after(c, '--repo'), after(c, '--state'), after(c, '--limit'), need.filter((f) => !fields.includes(f))],
    ['gh', ['pr', 'list'], 'acme/app', 'open', '50', []],
  );
});

test('#812 GitLab: the list is glab mr list --output json on the project', () => {
  const c = gitlab().pullListCommand('grp/app', 50);
  assert.deepEqual([c.cli, c.args.slice(0, 2), after(c, '--repo'), after(c, '--output')], ['glab', ['mr', 'list'], 'grp/app', 'json']);
});

const OK_CHECK = { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' };
const GH_LIST = [
  {
    number: 1, title: 'Add health', url: 'https://github.com/acme/app/pull/1', author: { login: 'eduardo' }, isDraft: false,
    headRefName: 'feat-a', baseRefName: 'main', mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: 'APPROVED', statusCheckRollup: [OK_CHECK],
  },
  {
    number: 2, title: 'Refund', url: 'https://github.com/acme/app/pull/2', author: { login: 'ana' }, isDraft: false,
    headRefName: 'feat-b', baseRefName: 'main', mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY', reviewDecision: 'REVIEW_REQUIRED', statusCheckRollup: [OK_CHECK],
  },
  {
    number: 3, title: 'Cache', url: 'https://github.com/acme/app/pull/3', author: { login: 'eduardo' }, isDraft: false,
    headRefName: 'feat-c', baseRefName: 'feat-a', mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED', reviewDecision: 'CHANGES_REQUESTED',
    statusCheckRollup: [{ __typename: 'CheckRun', name: 'test', status: 'IN_PROGRESS', conclusion: '' }],
  },
  {
    number: 4, title: 'Bump lodash', url: 'https://github.com/acme/app/pull/4', author: { login: 'app/dependabot', is_bot: true }, isDraft: false,
    headRefName: 'dependabot/npm/lodash', baseRefName: 'main', mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: '', statusCheckRollup: [],
  },
];

test('#812 GitHub parsePulls: each open PR becomes a card entry (state, CI, review, conflicts) with its branches', () => {
  assert.deepEqual(github().parsePulls(GH_LIST).map(view), [
    [1, 'Add health', 'https://github.com/acme/app/pull/1', 'eduardo', false, 'feat-a', 'main', 'ready', 'passed', 'approved', 'none'],
    [2, 'Refund', 'https://github.com/acme/app/pull/2', 'ana', false, 'feat-b', 'main', 'conflict', 'passed', 'required', 'base'],
    [3, 'Cache', 'https://github.com/acme/app/pull/3', 'eduardo', false, 'feat-c', 'feat-a', 'pending', 'running', 'changes_requested', 'none'],
    [4, 'Bump lodash', 'https://github.com/acme/app/pull/4', 'app/dependabot', false, 'dependabot/npm/lodash', 'main', 'ready', 'none', 'none', 'none'],
  ]);
});

const GL_LIST = [
  {
    iid: 7, title: 'Add health', web_url: 'https://gitlab.com/grp/app/-/merge_requests/7', author: { username: 'ana' }, draft: false,
    source_branch: 'feat-x', target_branch: 'main', has_conflicts: false, detailed_merge_status: 'mergeable',
  },
  {
    iid: 8, title: 'Refund', web_url: 'https://gitlab.com/grp/app/-/merge_requests/8', author: { username: 'bob' }, draft: false,
    source_branch: 'feat-y', target_branch: 'feat-x', has_conflicts: true, detailed_merge_status: 'conflict',
  },
  {
    iid: 9, title: 'Cache', web_url: 'https://gitlab.com/grp/app/-/merge_requests/9', author: { username: 'ana' }, draft: false,
    source_branch: 'feat-z', target_branch: 'main', has_conflicts: false, detailed_merge_status: 'requested_changes',
  },
];

test('#812 GitLab parsePulls: iid, web_url, author.username and the branches; mergeable is ready, a conflict is a conflict', () => {
  const [a, b, c] = gitlab().parsePulls(GL_LIST);
  assert.deepEqual(
    [view(a).slice(0, 8), view(a)[10], view(b).slice(0, 8), view(b)[10], c.review?.status],
    [
      [7, 'Add health', 'https://gitlab.com/grp/app/-/merge_requests/7', 'ana', false, 'feat-x', 'main', 'ready'], 'none',
      [8, 'Refund', 'https://gitlab.com/grp/app/-/merge_requests/8', 'bob', false, 'feat-y', 'feat-x', 'conflict'], 'base',
      'changes_requested',
    ],
  );
});

test('#812 parsePulls: an answer that is not a JSON list reads as no pull request on both platforms', () => {
  assert.deepEqual(
    [github().parsePulls(null), github().parsePulls({ message: 'Not Found' }), gitlab().parsePulls(undefined), gitlab().parsePulls('x')],
    [[], [], [], []],
  );
});
