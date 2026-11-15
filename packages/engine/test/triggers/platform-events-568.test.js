// #568: reading platform events (GitHub through `gh api`, GitLab through `glab api`). Acceptance tests,
// written before the code.
//
// Seam (the interface these tests assume), packages/engine/domains/triggers/platform-events.js (CommonJS):
//   readGithubEvents({ repo, since, exec }) -> Promise<[event]>
//   readGitlabEvents({ project, since, exec }) -> Promise<[event]>
//     repo: 'owner/name'; project: the GitLab project path ('group/app') or id; since: an ISO date or null.
//     exec: async (cmd, args) -> stdout (string): the CLI boundary (production: the probes' allowlisted
//       gh/glab runner). cmd is 'gh' (GitHub) or 'glab' (GitLab), args[0] is 'api', then the endpoint
//       path (query string allowed). On a CLI failure it rejects with an Error whose message has the stderr.
//     Endpoints read (the fake below answers by the substring of the args, '[]' for anything else):
//       GitHub: repos/<repo>/issues/events (event 'labeled', label.name, issue.number, issue.html_url;
//               labels added to an issue, not a PR), repos/<repo>/issues/comments (comments; a PR's have an
//               html_url with /pull/<n>), repos/<repo>/actions/runs (workflow_runs, conclusion 'failure', head_branch)
//       GitLab: projects/<id>/issues + .../resource_label_events (action 'add', label.name), .../merge_requests +
//               .../notes (non-system notes on a merge request), projects/<id>/pipelines (status 'failed', ref)
//     event (normalised):
//       { kind: 'issue_labeled', id, url, label, issue: { number } }
//       { kind: 'pr_comment', id, url, body, pr: { number } }
//       { kind: 'ci_failed', id, url, branch }
//     id: a string unique per platform event, containing the platform's own id (so dedup survives a restart);
//       the reader returns each event once even when two endpoints return it.
//     Only these: an unlabel, a comment on a plain issue, a system note, a successful run are not events.
//     A rate limit (the CLI's stderr has HTTP 403 or HTTP 429) rejects with an Error whose
//       code === 'RATE_LIMITED' (the watcher backs off on it); any other failure rejects as is.
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => require('../../domains/triggers/platform-events');

// a fake CLI answering by endpoint substring (first match wins), recording each call
function fakeExec(routes) {
  const calls = [];
  const exec = async (cmd, args) => {
    calls.push({ cmd, args: [...args] });
    const line = args.join(' ');
    const hit = routes.find(([needle]) => line.includes(needle));
    return hit ? JSON.stringify(hit[1]) : '[]';
  };
  return { exec, calls };
}

const failing = (stderr) => async () => { throw new Error(stderr); };

// ---- GitHub fixtures (shaped like the REST API) ----
const GH_ISSUE_EVENTS = [
  { id: 9001, event: 'labeled', label: { name: 'ready' }, created_at: '2026-11-15T10:00:00Z', issue: { number: 42, html_url: 'https://github.com/acme/app/issues/42' } },
  { id: 9002, event: 'unlabeled', label: { name: 'ready' }, created_at: '2026-11-15T10:01:00Z', issue: { number: 43, html_url: 'https://github.com/acme/app/issues/43' } },
  { id: 9003, event: 'closed', created_at: '2026-11-15T10:02:00Z', issue: { number: 44, html_url: 'https://github.com/acme/app/issues/44' } },
];
const GH_COMMENTS = [
  { id: 5001, body: 'hey @orchestrator, fix the lint', html_url: 'https://github.com/acme/app/pull/7#issuecomment-5001', issue_url: 'https://api.github.com/repos/acme/app/issues/7', created_at: '2026-11-15T10:03:00Z', user: { login: 'eduardo' } },
  { id: 5002, body: 'on a plain issue', html_url: 'https://github.com/acme/app/issues/42#issuecomment-5002', issue_url: 'https://api.github.com/repos/acme/app/issues/42', created_at: '2026-11-15T10:04:00Z', user: { login: 'eduardo' } },
];
const GH_RUNS = {
  total_count: 2,
  workflow_runs: [
    { id: 3001, name: 'CI', status: 'completed', conclusion: 'failure', head_branch: 'main', head_sha: 'abc123', html_url: 'https://github.com/acme/app/actions/runs/3001', created_at: '2026-11-15T10:05:00Z' },
    { id: 3002, name: 'CI', status: 'completed', conclusion: 'success', head_branch: 'main', head_sha: 'def456', html_url: 'https://github.com/acme/app/actions/runs/3002', created_at: '2026-11-15T10:06:00Z' },
  ],
};
const GH_ROUTES = [['/issues/events', GH_ISSUE_EVENTS], ['/issues/comments', GH_COMMENTS], ['/actions/runs', GH_RUNS]];

const ofKind = (events, kind) => events.filter((e) => e.kind === kind);

test('#568 the GitHub reader calls `gh api` only', async () => {
  const { exec, calls } = fakeExec(GH_ROUTES);
  await load().readGithubEvents({ repo: 'acme/app', since: '2026-11-15T09:00:00Z', exec });
  assert.equal(calls.length > 0, true);
  assert.deepEqual([...new Set(calls.map((c) => `${c.cmd} ${c.args[0]}`))], ['gh api']);
});

test('#568 the GitHub reader turns a `labeled` issue event into one issue_labeled event', async () => {
  const { exec } = fakeExec(GH_ROUTES);
  const labeled = ofKind(await load().readGithubEvents({ repo: 'acme/app', since: null, exec }), 'issue_labeled');
  assert.equal(labeled.length, 1);
  assert.deepEqual([labeled[0].label, labeled[0].issue.number, labeled[0].url], ['ready', 42, 'https://github.com/acme/app/issues/42']);
  assert.equal(typeof labeled[0].id, 'string');
  assert.equal(labeled[0].id.includes('9001'), true);
});

test('#568 the GitHub reader turns a comment on a PR into a pr_comment event, not one on a plain issue', async () => {
  const { exec } = fakeExec(GH_ROUTES);
  const comments = ofKind(await load().readGithubEvents({ repo: 'acme/app', since: null, exec }), 'pr_comment');
  assert.equal(comments.length, 1);
  assert.deepEqual([comments[0].body, comments[0].pr.number, comments[0].url], ['hey @orchestrator, fix the lint', 7, 'https://github.com/acme/app/pull/7#issuecomment-5001']);
  assert.equal(comments[0].id.includes('5001'), true);
});

test('#568 the GitHub reader turns a failed Actions run into a ci_failed event with its branch, not a successful one', async () => {
  const { exec } = fakeExec(GH_ROUTES);
  const failed = ofKind(await load().readGithubEvents({ repo: 'acme/app', since: null, exec }), 'ci_failed');
  assert.equal(failed.length, 1);
  assert.deepEqual([failed[0].branch, failed[0].url], ['main', 'https://github.com/acme/app/actions/runs/3001']);
  assert.equal(failed[0].id.includes('3001'), true);
});

test('#568 the GitHub reader gives each event a distinct id', async () => {
  const { exec } = fakeExec(GH_ROUTES);
  const events = await load().readGithubEvents({ repo: 'acme/app', since: null, exec });
  assert.equal(events.length, 3);
  assert.equal(new Set(events.map((e) => e.id)).size, 3);
});

test('#568 the GitHub reader with nothing new reads no event', async () => {
  const { exec } = fakeExec([['/actions/runs', { total_count: 0, workflow_runs: [] }]]);
  assert.equal((await load().readGithubEvents({ repo: 'acme/app', since: null, exec })).length, 0);
});

test('#568 an HTTP 403 from `gh api` is a rate limit', async () => {
  const exec = failing('gh: API rate limit exceeded for user ID 1. (HTTP 403)');
  await assert.rejects(load().readGithubEvents({ repo: 'acme/app', since: null, exec }), (e) => e.code === 'RATE_LIMITED');
});

test('#568 an HTTP 429 from `gh api` is a rate limit', async () => {
  const exec = failing('gh: You have exceeded a secondary rate limit (HTTP 429)');
  await assert.rejects(load().readGithubEvents({ repo: 'acme/app', since: null, exec }), (e) => e.code === 'RATE_LIMITED');
});

test('#568 another `gh api` failure is not a rate limit', async () => {
  const exec = failing('gh: Not Found (HTTP 404)');
  await assert.rejects(load().readGithubEvents({ repo: 'acme/app', since: null, exec }), (e) => e.code !== 'RATE_LIMITED');
});

// ---- GitLab fixtures (shaped like the REST API) ----
const GL_LABEL_EVENTS = [
  { id: 7001, action: 'add', label: { id: 1, name: 'ready' }, resource_type: 'Issue', resource_id: 555, created_at: '2026-11-15T10:00:00Z' },
  { id: 7002, action: 'remove', label: { id: 1, name: 'ready' }, resource_type: 'Issue', resource_id: 555, created_at: '2026-11-15T10:01:00Z' },
];
const GL_ISSUES = [{ id: 555, iid: 12, web_url: 'https://gitlab.com/acme/app/-/issues/12', updated_at: '2026-11-15T10:01:00Z' }];
const GL_NOTES = [
  { id: 8001, body: '@orchestrator please rebase', system: false, noteable_type: 'MergeRequest', noteable_iid: 3, created_at: '2026-11-15T10:02:00Z', author: { username: 'eduardo' } },
  { id: 8002, body: 'added 1 commit', system: true, noteable_type: 'MergeRequest', noteable_iid: 3, created_at: '2026-11-15T10:03:00Z', author: { username: 'eduardo' } },
];
const GL_MRS = [{ id: 999, iid: 3, web_url: 'https://gitlab.com/acme/app/-/merge_requests/3', updated_at: '2026-11-15T10:03:00Z' }];
const GL_PIPELINES = [
  { id: 4001, iid: 50, status: 'failed', ref: 'main', sha: 'abc123', web_url: 'https://gitlab.com/acme/app/-/pipelines/4001', updated_at: '2026-11-15T10:04:00Z' },
  { id: 4002, iid: 51, status: 'success', ref: 'main', sha: 'def456', web_url: 'https://gitlab.com/acme/app/-/pipelines/4002', updated_at: '2026-11-15T10:05:00Z' },
];
// the more specific paths first: a label events or notes path also contains /issues or /merge_requests
const GL_ROUTES = [['resource_label_events', GL_LABEL_EVENTS], ['/notes', GL_NOTES], ['/issues', GL_ISSUES], ['/merge_requests', GL_MRS], ['/pipelines', GL_PIPELINES]];

test('#568 the GitLab reader calls `glab api` only', async () => {
  const { exec, calls } = fakeExec(GL_ROUTES);
  await load().readGitlabEvents({ project: 'acme/app', since: '2026-11-15T09:00:00Z', exec });
  assert.equal(calls.length > 0, true);
  assert.deepEqual([...new Set(calls.map((c) => `${c.cmd} ${c.args[0]}`))], ['glab api']);
});

test('#568 the GitLab reader turns an added label into one issue_labeled event with the issue\'s iid', async () => {
  const { exec } = fakeExec(GL_ROUTES);
  const labeled = ofKind(await load().readGitlabEvents({ project: 'acme/app', since: null, exec }), 'issue_labeled');
  assert.equal(labeled.length, 1);
  assert.deepEqual([labeled[0].label, labeled[0].issue.number], ['ready', 12]);
  assert.equal(labeled[0].id.includes('7001'), true);
});

test('#568 the GitLab reader turns a note on a merge request into a pr_comment event, not a system note', async () => {
  const { exec } = fakeExec(GL_ROUTES);
  const comments = ofKind(await load().readGitlabEvents({ project: 'acme/app', since: null, exec }), 'pr_comment');
  assert.equal(comments.length, 1);
  assert.deepEqual([comments[0].body, comments[0].pr.number], ['@orchestrator please rebase', 3]);
  assert.equal(comments[0].id.includes('8001'), true);
});

test('#568 the GitLab reader turns a failed pipeline into a ci_failed event with its ref, not a successful one', async () => {
  const { exec } = fakeExec(GL_ROUTES);
  const failed = ofKind(await load().readGitlabEvents({ project: 'acme/app', since: null, exec }), 'ci_failed');
  assert.equal(failed.length, 1);
  assert.deepEqual([failed[0].branch, failed[0].url], ['main', 'https://gitlab.com/acme/app/-/pipelines/4001']);
  assert.equal(failed[0].id.includes('4001'), true);
});

test('#568 an HTTP 429 from `glab api` is a rate limit', async () => {
  const exec = failing('glab: 429 Too Many Requests (HTTP 429)');
  await assert.rejects(load().readGitlabEvents({ project: 'acme/app', since: null, exec }), (e) => e.code === 'RATE_LIMITED');
});

test('#568 an HTTP 403 from `glab api` is a rate limit', async () => {
  const exec = failing('glab: 403 Forbidden (HTTP 403)');
  await assert.rejects(load().readGitlabEvents({ project: 'acme/app', since: null, exec }), (e) => e.code === 'RATE_LIMITED');
});
