// Backlog (src/domains/backlog/backlog.js): repository URLs, issue fetching per platform and the sync cache.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const backlog = require('../../src/domains/backlog/backlog');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backlog-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'backlog');
}

// A fake CLI runner that records its calls and answers with `out`.
function fakeExec(out) {
  const calls = [];
  const exec = async (cli, args) => { calls.push([cli, ...args]); return JSON.stringify(out); };
  return { exec, calls };
}

const GH_ISSUE = {
  number: 29, title: 'Backlog screen', state: 'OPEN', url: 'https://github.com/o/r/issues/29',
  labels: [{ name: 'enhancement', color: 'a2eeef' }], author: { login: 'eduardo' }, assignees: [{ login: 'bot' }],
  body: '- [x] one\n- [ ] two\n  - [X] nested\n* [ ] three\nnot - [x] a task', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-02T00:00:00Z',
};

test('repository URLs in https, ssh and scp-like forms', () => {
  assert.deepEqual(backlog.parseRepoUrl('https://github.com/o/r.git'), { host: 'github.com', path: 'o/r' });
  assert.deepEqual(backlog.parseRepoUrl('git@github.com:o/r.git'), { host: 'github.com', path: 'o/r' });
  assert.deepEqual(backlog.parseRepoUrl('ssh://git@gitlab.example.com:2222/group/sub/r.git'), { host: 'gitlab.example.com', path: 'group/sub/r' });
  assert.deepEqual(backlog.parseRepoUrl('https://user@GitLab.com/g/r/'), { host: 'gitlab.com', path: 'g/r' });
  assert.equal(backlog.parseRepoUrl('C:/code/r'), null);
  assert.equal(backlog.parseRepoUrl('https://github.com/only-owner'), null);
  assert.equal(backlog.parseRepoUrl(''), null);
});

test('task-list progress counts checked and unchecked boxes only', () => {
  assert.deepEqual(backlog.taskProgress(GH_ISSUE.body), { done: 2, total: 4 });
  assert.deepEqual(backlog.taskProgress(''), { done: 0, total: 0 });
  assert.deepEqual(backlog.taskProgress(null), { done: 0, total: 0 });
});

test('GitHub issues come from gh and are normalized', async () => {
  const { exec, calls } = fakeExec([GH_ISSUE]);
  const [issue] = await backlog.fetchIssues({ platform: 'github', repo: 'git@github.com:o/r.git', exec });
  assert.equal(calls[0][0], 'gh');
  assert.deepEqual(calls[0].slice(1, 7), ['issue', 'list', '--repo', 'o/r', '--state', 'all']);
  assert.deepEqual(issue, {
    number: 29, title: 'Backlog screen', state: 'open', labels: [{ name: 'enhancement', color: '#a2eeef' }],
    url: 'https://github.com/o/r/issues/29', author: 'eduardo', assignees: ['bot'], body: GH_ISSUE.body,
    tasks: { done: 2, total: 4 }, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-02T00:00:00Z',
  });
});

test('GitHub Enterprise and self-hosted GitLab pass the host along', async () => {
  const gh = fakeExec([]);
  await backlog.fetchIssues({ platform: 'github', repo: 'https://ghe.corp/o/r', exec: gh.exec });
  assert.equal(gh.calls[0][4], 'ghe.corp/o/r');
  const gl = fakeExec([]);
  await backlog.fetchIssues({ platform: 'gitlab', repo: 'git@gitlab.corp:g/sub/r.git', exec: gl.exec });
  assert.equal(gl.calls[0][0], 'glab');
  assert.equal(gl.calls[0][4], 'https://gitlab.corp/g/sub/r');
});

test('GitLab issues come from glab and are normalized', async () => {
  const { exec, calls } = fakeExec([{
    iid: 7, title: 'Fix', state: 'closed', labels: ['bug'], web_url: 'https://gitlab.com/g/r/-/issues/7',
    author: { username: 'ana' }, assignees: [], description: '- [x] done', created_at: 'c', updated_at: 'u',
  }, { iid: 8, title: 'New', state: 'opened', labels: [], web_url: 'w', author: null, description: null }]);
  const issues = await backlog.fetchIssues({ platform: 'gitlab', repo: 'https://gitlab.com/g/r.git', exec });
  assert.deepEqual(calls[0].slice(0, 5), ['glab', 'issue', 'list', '--repo', 'g/r']);
  assert.ok(calls[0].includes('--all'));
  assert.deepEqual(issues.map((i) => [i.number, i.state, i.labels, i.author, i.tasks.total]), [[7, 'closed', [{ name: 'bug', color: null }], 'ana', 1], [8, 'open', [], null, 0]]);
  assert.equal(issues[1].body, '');
});

test('a repository on a known host refuses the other platforms; Bitbucket has no sync yet', async () => {
  const { exec, calls } = fakeExec([]);
  await assert.rejects(backlog.fetchIssues({ platform: 'gitlab', repo: 'git@github.com:o/r.git', exec }), /on github\.com; pick GitHub/);
  await assert.rejects(backlog.fetchIssues({ platform: 'bitbucket', repo: 'https://bitbucket.org/o/r', exec }), /Bitbucket sync is not available yet/);
  await assert.rejects(backlog.fetchIssues({ platform: 'svn', repo: 'https://github.com/o/r', exec }), /Unknown backlog platform/);
  await assert.rejects(backlog.fetchIssues({ platform: 'github', repo: 'C:/code/r', exec }), /not a recognizable git URL/);
  assert.equal(calls.length, 0);
});

test('sync caches the issues per project, newest update first', async (t) => {
  const dir = tmp(t);
  assert.equal(backlog.readBacklog(dir, 'p'), null);
  const older = { ...GH_ISSUE, number: 1, updatedAt: '2026-08-01T00:00:00Z' };
  const { exec } = fakeExec([older, GH_ISSUE]);
  const data = await backlog.syncBacklog({ dir, project: { id: 'p', repo: 'https://github.com/o/r' }, platform: 'github', exec });
  assert.deepEqual(data.issues.map((i) => i.number), [29, 1]);
  assert.equal(data.platform, 'github');
  assert.deepEqual(backlog.readBacklog(dir, 'p'), data);
  await assert.rejects(backlog.syncBacklog({ dir, project: { id: 'q', repo: null }, platform: 'github', exec }), /has no repository/);
  // project ids never reach outside the backlog folder
  assert.deepEqual(backlog.readBacklog(dir, '../../p'), data);
});

// ---- open PRs/MRs ------------------------------------------------------------------------------
// A fake CLI runner answering per subcommand ("issue" / "pr" / "mr"); an Error answer rejects.
function routedExec(answers) {
  const calls = [];
  const exec = async (cli, args) => {
    calls.push([cli, ...args]);
    const out = typeof answers[args[0]] === 'function' ? answers[args[0]](args) : answers[args[0]];
    if (out instanceof Error) throw out;
    return JSON.stringify(out ?? []);
  };
  return { exec, calls };
}

test('a PR refers to issues by closing keyword, link, title "#n" or closing reference', () => {
  const url = 'https://github.com/o/r/issues/';
  assert.deepEqual(backlog.referencedIssues({ title: 'Warn before assigning (#35)', body: '' }, url), [35]);
  assert.deepEqual(backlog.referencedIssues({ title: 'x', body: 'Fixes #12, #13 and #14.\nCloses: #2' }, url), [2, 12, 13, 14]);
  assert.deepEqual(backlog.referencedIssues({ title: 'x', body: 'See https://github.com/o/r/issues/50 for context' }, url), [50]);
  assert.deepEqual(backlog.referencedIssues({ title: 'x', body: '', closing: [7] }, url), [7]);
  // mentions without a keyword, other repositories, MR refs and look-alikes do not count
  assert.deepEqual(backlog.referencedIssues({
    title: 'Follow-up of !4 and a/#5, &#6;',
    body: 'Related to #40. Fixes o/other#41. https://github.com/o/other/issues/42 https://github.com/o/r/pull/43',
  }, url), []);
  assert.deepEqual(backlog.referencedIssues({ title: 'Ünïcode ✓ (#9)', body: null }, url), [9]);
});

test('GitHub open PRs come from gh with the issues they refer to', async () => {
  const { exec, calls } = routedExec({ pr: [
    { number: 33, title: 'Concurrent runs (#32)', url: 'https://github.com/o/r/pull/33', isDraft: false, body: '', closingIssuesReferences: [{ number: 30 }] },
    { number: 34, title: 'WIP', url: 'https://github.com/o/r/pull/34', isDraft: true, body: 'Resolves https://github.com/o/r/issues/31' },
  ] });
  const prs = await backlog.fetchOpenPullRequests({ platform: 'github', repo: 'git@github.com:o/r.git', exec });
  assert.deepEqual(calls[0].slice(0, 7), ['gh', 'pr', 'list', '--repo', 'o/r', '--state', 'open']);
  assert.deepEqual(prs, [
    { number: 33, title: 'Concurrent runs (#32)', url: 'https://github.com/o/r/pull/33', draft: false, issues: [30, 32] },
    { number: 34, title: 'WIP', url: 'https://github.com/o/r/pull/34', draft: true, issues: [31] },
  ]);
});

test('an older gh without closing references still reads the PRs; other gh errors surface', async () => {
  const old = routedExec({ pr: (args) => (args.at(-1).includes('closingIssuesReferences')
    ? new Error('gh pr list failed: Unknown JSON field: "closingIssuesReferences"')
    : [{ number: 3, title: 'Fix (#1)', url: 'u3', body: '' }]) });
  assert.deepEqual((await backlog.fetchOpenPullRequests({ platform: 'github', repo: 'https://github.com/o/r', exec: old.exec })).map((p) => p.issues), [[1]]);
  assert.equal(old.calls.length, 2);
  const down = routedExec({ pr: new Error('gh pr list failed: not logged in') });
  await assert.rejects(backlog.fetchOpenPullRequests({ platform: 'github', repo: 'https://github.com/o/r', exec: down.exec }), /not logged in/);
});

test('GitLab open MRs come from glab with the issues they refer to', async () => {
  const { exec, calls } = routedExec({ mr: [
    { iid: 4, title: 'Draft: login', web_url: 'https://gitlab.corp/g/r/-/merge_requests/4', draft: true, description: 'Closes #7 and https://gitlab.corp/g/r/-/issues/8' },
  ] });
  const prs = await backlog.fetchOpenPullRequests({ platform: 'gitlab', repo: 'git@gitlab.corp:g/r.git', exec });
  assert.deepEqual(calls[0].slice(0, 5), ['glab', 'mr', 'list', '--repo', 'https://gitlab.corp/g/r']);
  assert.deepEqual(prs, [{ number: 4, title: 'Draft: login', url: 'https://gitlab.corp/g/r/-/merge_requests/4', draft: true, issues: [7, 8] }]);
});

test('sync shows each issue its open PRs; PRs that cannot be read leave a note, not an error', async (t) => {
  const dir = tmp(t);
  const project = { id: 'p', repo: 'https://github.com/o/r' };
  const issues = [{ ...GH_ISSUE, number: 32 }, { ...GH_ISSUE, number: 35 }];
  const ok = routedExec({ issue: issues, pr: [{ number: 33, title: 'Concurrent runs (#32)', url: 'https://github.com/o/r/pull/33', isDraft: false, body: '' }] });
  let data = await backlog.syncBacklog({ dir, project, platform: 'github', exec: ok.exec });
  const by = () => Object.fromEntries(data.issues.map((i) => [i.number, i.pullRequests]));
  assert.deepEqual(by(), { 32: [{ number: 33, title: 'Concurrent runs (#32)', url: 'https://github.com/o/r/pull/33', draft: false }], 35: [] });
  assert.equal(data.pullRequestsError, null);

  const noPrs = routedExec({ issue: issues, pr: new Error('gh pr list failed: HTTP 502') });
  data = await backlog.syncBacklog({ dir, project, platform: 'github', exec: noPrs.exec });
  assert.deepEqual(by(), { 32: [], 35: [] });
  assert.match(data.pullRequestsError, /HTTP 502/);
});

// ---- epics (#138): read alongside the issues and PRs, cached with the rest -----------------------

test('sync reads an epic and its sub-issues into the cache (src/domains/backlog/epics.js readEpics)', async (t) => {
  const dir = tmp(t);
  const project = { id: 'p', repo: 'https://github.com/o/r' };
  const epicIssue = { ...GH_ISSUE, number: 40, title: 'Theme epic', labels: [{ name: 'epic', color: '5319e7' }] };
  const memberA = { ...GH_ISSUE, number: 41, title: 'Member A' };
  const memberB = { ...GH_ISSUE, number: 42, title: 'Member B', state: 'CLOSED' };
  const exec = routedExec({
    issue: [epicIssue, memberA, memberB],
    pr: [],
    api: (args) => (args.join(' ').includes('sub_issues') ? [{ number: 41 }, { number: 42 }] : []),
  });
  const data = await backlog.syncBacklog({ dir, project, platform: 'github', exec: exec.exec });
  assert.equal(data.epicsError, null);
  assert.equal(data.epics.length, 1);
  assert.deepEqual(data.epics[0].members, [41, 42]);
  assert.deepEqual(data.epics[0].progress, { open: 1, closed: 1, total: 2 });
  const epicOf = Object.fromEntries(data.issues.map((i) => [i.number, i.epic]));
  assert.equal(epicOf[41], '#40');
  assert.equal(epicOf[42], '#40');
  assert.equal(data.issues.find((i) => i.number === 40).isEpic, true);
  assert.deepEqual(backlog.readBacklog(dir, 'p').epics, data.epics); // cached like the rest
});

test('right before a queued issue starts: only PRs opened since it was assigned skip it, and the queue says why', async (t) => {
  const dir = tmp(t);
  const pr = (number, issue) => ({ number, title: `PR ${number} (#${issue})`, url: `https://github.com/o/r/pull/${number}`, body: '' });
  // #1 was assigned anyway with PR 10 open; #2 had none
  let q = backlog.enqueue(dir, 'p', { workflow: 'sd.yaml', issues: [
    { number: 1, url: 'i1', title: 'One', pullRequests: [{ number: 10, url: 'https://github.com/o/r/pull/10' }] },
    { number: 2, url: 'i2', title: 'Two' },
  ] });
  const check = (item, answer) => backlog.newPullRequests({ item, platform: 'github', repo: 'https://github.com/o/r', exec: routedExec({ pr: answer }).exec });
  assert.deepEqual(await check(q.items[0], [pr(10, 1)]), []);
  assert.deepEqual(await check(q.items[1], [pr(10, 1)]), []);
  assert.deepEqual((await check(q.items[1], [pr(10, 1), pr(11, 2)])).map((p) => p.number), [11]);
  assert.deepEqual(await check(q.items[1], new Error('offline')), []); // the check failing lets it start

  q = backlog.skipQueued(dir, 'p', 2, 'open PR #11 since it was queued');
  assert.deepEqual(q.items.map((x) => x.number), [1]);
  assert.deepEqual(q.skipped.map((s) => [s.number, s.title, s.reason]), [[2, 'Two', 'open PR #11 since it was queued']]);
  assert.equal(backlog.nextQueued(dir).item.number, 1);
  // assigning it again, or dismissing it, clears the note
  q = backlog.enqueue(dir, 'p', { workflow: 'sd.yaml', issues: [{ number: 2, url: 'i2', title: 'Two' }] });
  assert.deepEqual(q.skipped, []);
  backlog.skipQueued(dir, 'p', 2, 'again');
  assert.deepEqual(backlog.unqueue(dir, 'p', 2).skipped, []);
});

test('issues link to the runs that mention them and land in a kanban column', () => {
  const issue = (number, state) => ({ number, state, url: `https://github.com/o/r/issues/${number}` });
  const runs = [
    { runId: 'a', workflow: 'software-development', status: 'success', startedAt: '2026-09-01', task: 'Implement https://github.com/o/r/issues/1' },
    { runId: 'b', workflow: 'software-development', status: 'running', startedAt: '2026-09-03', inputs: { task: 'Fix #1 and #22' } },
    { runId: 'c', workflow: 'software-development', status: 'cancelled', startedAt: '2026-09-02', task: 'Try #2' },
    { runId: 'd', workflow: 'software-development', status: 'running', startedAt: '2026-09-04', task: 'Simulated #3', mock: true },
    { runId: 'e', workflow: 'x', status: 'success', startedAt: '2026-09-05', task: 'Not #10, not a/#3, not &#3; and PR#4' },
  ];
  const out = backlog.linkRuns([issue(1, 'open'), issue(2, 'open'), issue(3, 'open'), issue(4, 'closed'), issue(22, 'open')], runs);
  const by = Object.fromEntries(out.map((i) => [i.number, i]));
  assert.deepEqual(by[1].runs.map((r) => r.runId), ['b', 'a']); // newest first
  assert.deepEqual(by[1].runs[0], { runId: 'b', workflow: 'software-development', status: 'running', startedAt: '2026-09-03', mock: false, waiting: false });
  assert.equal(by[1].column, 'in_progress');
  assert.equal(by[1].queued, null);
  assert.equal(by[2].column, 'todo'); // its only run was cancelled
  assert.deepEqual(by[3].runs, []); // simulated and look-alike mentions don't count
  assert.equal(by[3].column, 'todo');
  assert.equal(by[4].column, 'done');
  assert.deepEqual(by[22].runs.map((r) => r.runId), ['b']);
});

test('an open issue merged locally stays in Local until its work is pushed; only closed on the platform is Done', () => {
  const issue = (number, state = 'open') => ({ number, state, url: `https://github.com/o/r/issues/${number}` });
  const run = (runId, number, localMerge) => ({ runId, workflow: 'local-hero', status: 'success', startedAt: `2026-09-1${runId.length}`, issues: [{ number, url: `https://github.com/o/r/issues/${number}` }], localMerge });
  const merge = (commit) => ({ branch: 'feat/x', base: 'main', commit });
  const runs = [
    run('a', 1, merge('aaa111')), // its commit is among the unpushed ones
    run('bb', 2, merge('old222')), // rebased by an update: found by "Closes #2" in the unpushed commits
    run('ccc', 3, merge('ccc333')), // pushed: neither its commit nor a "Closes #3" is left, open until a sync
    run('dddd', 4, merge('ddd444')), // closed on GitHub
    run('eeeee', 5, null), // a PR workflow: its PR isn't merged, the issue is still open
  ];
  const local = { base: 'main', ahead: 2, commits: [{ sha: 'aaa111', subject: 'A', issues: [1] }, { sha: 'new222', subject: 'B', issues: [2] }], issues: [1, 2] };
  const col = (l) => Object.fromEntries(backlog.linkRuns([issue(1), issue(2), issue(3), issue(4, 'closed'), issue(5)], runs, null, l).map((i) => [i.number, i.column]));
  assert.deepEqual(col(local), { 1: 'local', 2: 'local', 3: 'in_progress', 4: 'done', 5: 'in_progress' });
  // never checked, or the check failed: a local merge is assumed not pushed
  assert.deepEqual(col(null), { 1: 'local', 2: 'local', 3: 'local', 4: 'done', 5: 'in_progress' });
  assert.deepEqual(col({ error: 'origin/main not found', commits: [], issues: [] }), { 1: 'local', 2: 'local', 3: 'local', 4: 'done', 5: 'in_progress' });
  // everything pushed: Done only once the platform closes them
  assert.deepEqual(col({ base: 'main', ahead: 0, commits: [], issues: [] }), { 1: 'in_progress', 2: 'in_progress', 3: 'in_progress', 4: 'done', 5: 'in_progress' });
  const [one] = backlog.linkRuns([issue(1)], runs, null, local);
  assert.deepEqual(one.runs[0].localMerge, { branch: 'feat/x', base: 'main', commit: 'aaa111' });
});

test('a run the supervisor sent back after a failed merge carries its recovery record onto the issue card', () => {
  const issue = (number) => ({ number, state: 'open', url: `https://github.com/o/r/issues/${number}` });
  const runs = [
    { runId: 'a', workflow: 'software-development', status: 'waiting', startedAt: '2026-09-30', issues: [{ number: 1, url: 'https://github.com/o/r/issues/1' }], recovery: 'went back to resolve_conflict at 00:10 UTC because PR #64 conflicted with main after the #35 merge' },
    { runId: 'b', workflow: 'software-development', status: 'success', startedAt: '2026-09-29', issues: [{ number: 2, url: 'https://github.com/o/r/issues/2' }] },
  ];
  const by = Object.fromEntries(backlog.linkRuns([issue(1), issue(2)], runs).map((i) => [i.number, i]));
  assert.match(by[1].runs[0].recovery, /^went back to resolve_conflict/);
  assert.ok(!('recovery' in by[2].runs[0]));
});

test('the push status of a project is cached next to its backlog', (t) => {
  const dir = tmp(t);
  assert.equal(backlog.readLocal(dir, 'p'), null);
  backlog.writeLocal(dir, 'p', { base: 'main', ahead: 1, commits: [], issues: [7] });
  assert.deepEqual(backlog.readLocal(dir, 'p'), { base: 'main', ahead: 1, commits: [], issues: [7] });
  assert.equal(backlog.readBacklog(dir, 'p'), null); // its own file, not the synced issues
});

test('a run started for an issue links to it even when simulated; only a real one picks the column', () => {
  const issue = (number) => ({ number, state: 'open', url: `https://github.com/o/r/issues/${number}` });
  const run = (runId, number, extra) => ({ runId, workflow: 'w', startedAt: `2026-09-0${runId.length}`, issue: { number, url: `https://github.com/o/r/issues/${number}` }, ...extra });
  const out = backlog.linkRuns([issue(1), issue(2), issue(3), issue(4), issue(5)], [
    run('a', 1, { status: 'running', waiting: true, mock: true }),
    run('b', 2, { status: 'success' }),
    run('c', 3, { status: 'failed' }),
    // started for #5 but its task mentions #4: only the explicit link counts
    run('d', 5, { status: 'running', task: 'Also see #4' }),
  ], { items: [{ number: 4, workflow: 'software-development.yaml', workflowName: 'software-development', mock: true }] });
  const by = Object.fromEntries(out.map((i) => [i.number, i]));
  assert.equal(by[1].column, 'todo'); // its only run is a simulation
  assert.equal(by[1].runs[0].mock, true); // but it still shows in the issue's history
  assert.equal(by[2].column, 'in_progress'); // succeeded, still open on the platform
  assert.equal(by[3].column, 'in_progress');
  assert.deepEqual(by[4].runs, []);
  assert.deepEqual(by[4].queued, { position: 1, workflow: 'software-development', mock: true }); // still shows the queued badge
  assert.equal(by[4].column, 'todo'); // a simulated queue item doesn't move it either
  assert.equal(by[5].column, 'in_progress');
});

test('a simulated run never decides an issue\'s column, whatever its status', () => {
  const issue = (number, state = 'open') => ({ number, state, url: `https://github.com/o/r/issues/${number}` });
  const run = (runId, number, extra) => ({ runId, workflow: 'w', startedAt: `2026-09-0${runId.length}`, mock: true, issue: { number, url: `https://github.com/o/r/issues/${number}` }, ...extra });
  const runs = [
    run('a', 1, { status: 'success' }),
    run('bb', 2, { status: 'failed' }),
    run('ccc', 3, { status: 'interrupted' }),
    run('dddd', 4, { status: 'running', waiting: true }), // stopped at a human gate
    run('eeeee', 5, { status: 'success' }),
  ];
  const out = backlog.linkRuns([issue(1), issue(2), issue(3), issue(4), issue(5, 'closed')], runs);
  const by = Object.fromEntries(out.map((i) => [i.number, i]));
  assert.equal(by[1].column, 'todo');
  assert.equal(by[2].column, 'todo');
  assert.equal(by[3].column, 'todo');
  assert.equal(by[4].column, 'todo');
  assert.equal(by[5].column, 'done'); // closed on the platform, simulation or not
  for (const n of [1, 2, 3, 4, 5]) assert.equal(by[n].runs[0].mock, true); // kept in the history
});

test('a real run decides the column even when a newer simulated run is linked', () => {
  const issue = { number: 1, state: 'open', url: 'https://github.com/o/r/issues/1' };
  const runs = [
    { runId: 'a', workflow: 'w', status: 'running', waiting: true, startedAt: '2026-09-01', issue: { number: 1, url: issue.url } }, // real, older, waiting at a gate
    { runId: 'bb', workflow: 'w', status: 'success', startedAt: '2026-09-02', mock: true, issue: { number: 1, url: issue.url } }, // simulated, newer, success
  ];
  const [out] = backlog.linkRuns([issue], runs);
  assert.equal(out.column, 'waiting'); // the real (older) run decides, not the newer simulation
  assert.deepEqual(out.runs.map((r) => r.runId), ['bb', 'a']); // the history still lists both, newest first
});

test('a queued simulation leaves the column as it would be without it; a real queue item moves it', () => {
  const issue = (number) => ({ number, state: 'open', url: `https://github.com/o/r/issues/${number}` });
  const queue = { items: [
    { number: 1, workflow: 'w.yaml', workflowName: 'w', mock: true },
    { number: 2, workflow: 'w.yaml', workflowName: 'w', mock: false },
  ] };
  const out = backlog.linkRuns([issue(1), issue(2)], [], queue);
  const by = Object.fromEntries(out.map((i) => [i.number, i]));
  assert.equal(by[1].column, 'todo');
  assert.deepEqual(by[1].queued, { position: 1, workflow: 'w', mock: true }); // still shows the queued badge
  assert.equal(by[2].column, 'in_progress');
  assert.deepEqual(by[2].queued, { position: 2, workflow: 'w', mock: false });
});

test('linkRuns passes a run\'s title and PR through to its history (#84)', () => {
  const issue = { number: 1, state: 'open', url: 'https://github.com/o/r/issues/1' };
  const pr = { number: 42, url: 'https://github.com/o/r/pull/42', state: 'ready' };
  const run = { runId: 'a', workflow: 'w', status: 'success', startedAt: '2026-09-01', issue: { number: 1, url: issue.url }, title: 'Fix the bug', customTitle: null, pr };
  const [out] = backlog.linkRuns([issue], [run]);
  assert.equal(out.runs[0].title, 'Fix the bug');
  assert.equal(out.runs[0].customTitle, null);
  assert.deepEqual(out.runs[0].pr, pr);
});

test('linkRuns: a run with no title or PR carries neither (no undefined fields leaking in)', () => {
  const issue = { number: 1, state: 'open', url: 'https://github.com/o/r/issues/1' };
  const run = { runId: 'a', workflow: 'w', status: 'success', startedAt: '2026-09-01', issue: { number: 1, url: issue.url } };
  const [out] = backlog.linkRuns([issue], [run]);
  assert.ok(!('title' in out.runs[0]));
  assert.ok(!('pr' in out.runs[0]));
});

test('the queue: enqueue skips duplicates and remembers inputs, next item across projects, pause', (t) => {
  const dir = tmp(t);
  const issue = (number) => ({ number, url: `u${number}`, title: `T${number}`, body: `B${number}` });
  assert.deepEqual(backlog.readQueue(dir, 'p'), { paused: false, error: null, inputs: {}, items: [], skipped: [] });
  assert.equal(backlog.nextQueued(dir), null);

  backlog.setPaused(dir, 'p', true, 'stopped');
  let q = backlog.enqueue(dir, 'p', { issues: [issue(1), issue(2)], workflow: 'sd.yaml', inputs: { language: 'go' } });
  assert.equal(q.paused, false); // assigning resumes the queue
  assert.equal(q.error, null);
  q = backlog.enqueue(dir, 'p', { issues: [issue(2), issue(3)], workflow: 'sd.yaml', inputs: { language: 'js' }, mock: true });
  assert.deepEqual(q.items.map((x) => [x.number, x.inputs.language, x.mock]), [[1, 'go', false], [2, 'go', false], [3, 'js', true]]);
  assert.deepEqual(q.inputs, { 'sd.yaml': { language: 'js' } });

  backlog.enqueue(dir, 'other', { issues: [issue(9)], workflow: 'sd.yaml' });
  assert.deepEqual(backlog.queuedProjects(dir).sort(), ['other', 'p']); // #162: Keep awake sums work across these
  assert.deepEqual(backlog.nextQueued(dir), { projectId: 'p', item: q.items[0] }); // the oldest first
  assert.equal(backlog.nextQueued(dir, (projectId) => projectId !== 'p').projectId, 'other'); // p at its limit of runs
  assert.equal(backlog.nextQueued(dir, () => false), null);
  backlog.setPaused(dir, 'p', true, 'why');
  assert.equal(backlog.nextQueued(dir).projectId, 'other');
  assert.equal(backlog.readQueue(dir, 'p').error, 'why');

  backlog.unqueue(dir, 'other', 9);
  assert.equal(backlog.nextQueued(dir), null);
  backlog.setPaused(dir, 'p', false);
  backlog.pauseAll(dir, 'restarted');
  assert.deepEqual([backlog.readQueue(dir, 'p').paused, backlog.readQueue(dir, 'p').error], [true, 'restarted']);
  assert.equal(backlog.readQueue(dir, 'other').paused, false); // nothing waiting there
});

test('a group is one queue item; removing an issue leaves the group or cancels it; a skip keeps the rest', async (t) => {
  const dir = tmp(t);
  const issue = (number, extra) => ({ number, url: `https://github.com/o/r/issues/${number}`, title: `T${number}`, body: `B${number}`, ...extra });
  backlog.enqueue(dir, 'p', { issues: [issue(9)], workflow: 'sd.yaml' });
  let q = backlog.enqueue(dir, 'p', { issues: [issue(65), issue(9), issue(53), issue(77)], workflow: 'sd.yaml', group: true });
  // #9 was already queued: the group is the other three, in the order given
  assert.deepEqual(q.items.map((x) => [x.number, (x.issues || []).map((i) => i.number)]), [[9, []], [65, [65, 53, 77]]]);
  assert.deepEqual(backlog.itemIssues(q.items[1]).map((i) => i.title), ['T65', 'T53', 'T77']);
  // a group of one is a plain item
  assert.equal(backlog.enqueue(dir, 'other', { issues: [issue(1)], workflow: 'sd.yaml', group: true }).items[0].issues, undefined);

  q = backlog.unqueue(dir, 'p', 65); // leaves the group: the group goes on with #53 and #77, headed by #53
  assert.deepEqual(q.items.map((x) => [x.number, x.title, (x.issues || []).map((i) => i.number)]), [[9, 'T9', []], [53, 'T53', [53, 77]]]);
  q = backlog.unqueue(dir, 'p', 77, { cancelGroup: true }); // the whole group
  assert.deepEqual(q.items.map((x) => x.number), [9]);

  q = backlog.enqueue(dir, 'p', { issues: [issue(1), issue(2, { pullRequests: [{ url: 'https://github.com/o/r/pull/10' }] }), issue(3)], workflow: 'sd.yaml', group: true });
  const exec = routedExec({ pr: [
    { number: 10, title: 'Old (#2)', url: 'https://github.com/o/r/pull/10', body: '' },
    { number: 11, title: 'New (#3)', url: 'https://github.com/o/r/pull/11', body: '' },
  ] }).exec;
  const prs = await backlog.newPullRequests({ item: q.items[1], platform: 'github', repo: 'https://github.com/o/r', exec });
  assert.deepEqual(prs.map((p) => [p.number, p.issue]), [[11, 3]]); // PR 10 was known when #2 was assigned
  q = backlog.skipQueued(dir, 'p', 3, 'open PR #11 since it was queued');
  assert.deepEqual(q.items.map((x) => [x.number, (x.issues || []).map((i) => i.number)]), [[9, []], [1, [1, 2]]]);
  assert.deepEqual(q.skipped.map((s) => [s.number, s.title]), [[3, 'T3']]);
});

test('a run started for several issues links to each of them; runs recorded with one `issue` still link', () => {
  const issue = (number) => ({ number, state: 'open', url: `https://github.com/o/r/issues/${number}` });
  const ref = (number) => ({ number, url: `https://github.com/o/r/issues/${number}`, title: `T${number}` });
  const out = backlog.linkRuns([issue(53), issue(65), issue(77), issue(8), issue(9), issue(10)], [
    { runId: 'group', workflow: 'w', status: 'running', waiting: true, startedAt: '2026-09-02', issues: [ref(53), ref(65), ref(77)], task: 'mentions #8' },
    { runId: 'old', workflow: 'w', status: 'success', startedAt: '2026-09-01', issue: ref(8) },
  ], { items: [{ number: 9, url: ref(9).url, workflow: 'w.yaml', issues: [ref(9), ref(10)] }] });
  const by = Object.fromEntries(out.map((i) => [i.number, i]));
  assert.deepEqual([53, 65, 77].map((n) => [by[n].column, by[n].runs[0].runId]), [['waiting', 'group'], ['waiting', 'group'], ['waiting', 'group']]);
  assert.deepEqual(by[65].runs[0].groupedWith, [53, 77]);
  assert.deepEqual(by[8].runs.map((r) => r.runId), ['old']); // a started-for run's text mentions don't count
  assert.equal(by[8].runs[0].groupedWith, undefined);
  assert.equal(by[8].column, 'in_progress'); // succeeded, still open
  assert.deepEqual([by[9].queued, by[10].queued.groupedWith, by[10].column], [{ position: 1, workflow: 'w.yaml', mock: false, groupedWith: [10] }, [9], 'in_progress']);
});

test('a queued group becomes one task listing every issue, with `issues` next to `issue`', () => {
  const ref = (number, body) => ({ number, url: `https://github.com/o/r/issues/${number}`, title: `Fix ${number}`, body });
  const item = { ...ref(65, 'Checkboxes'), issues: [ref(65, 'Checkboxes'), ref(53, 'Scrollbars'), ref(77, '')], inputs: { language: 'js' } };
  const wf = { inputs: { task: {}, repo_path: { type: 'string' }, language: {}, issue: {}, issues: { type: 'array' } } };
  const inputs = backlog.runInputs(item, wf, 'C:/repo');
  assert.equal(inputs.task, [
    'Implement these 3 issues together (#65, #53, #77).',
    'They ship together in one branch and one PR/MR that closes every one of them. Account for each issue: '
      + 'say what was done for each one, and if one cannot be done, say which and why (never drop it silently).',
    '## 1. #65 Fix 65\n\nIssue: https://github.com/o/r/issues/65\n\nCheckboxes',
    '## 2. #53 Fix 53\n\nIssue: https://github.com/o/r/issues/53\n\nScrollbars',
    '## 3. #77 Fix 77\n\nIssue: https://github.com/o/r/issues/77',
  ].join('\n\n'));
  assert.equal(inputs.issue, 'https://github.com/o/r/issues/65');
  assert.deepEqual(inputs.issues, ['https://github.com/o/r/issues/65', 'https://github.com/o/r/issues/53', 'https://github.com/o/r/issues/77']);
  assert.deepEqual([inputs.repo_path, inputs.language], ['C:/repo', 'js']);
  // a single issue: `issues` is a list of one
  assert.deepEqual(backlog.runInputs(ref(7, 'x'), wf, 'C:/repo').issues, ['https://github.com/o/r/issues/7']);
});

test('a Write & Review run enriching an issue is shown on its card and never decides the column', () => {
  const issue = (number) => ({ number, state: 'open', url: `https://github.com/o/r/issues/${number}` });
  const runs = [
    { runId: 'enrich', workflow: 'writer-reviewer', status: 'success', startedAt: '2026-09-02', issues: [{ number: 1, url: 'https://github.com/o/r/issues/1' }] },
  ];
  const [out] = backlog.linkRuns([issue(1)], runs);
  assert.equal(out.runs[0].enrich, true);
  assert.equal(out.column, 'todo'); // only a Write & Review run: the issue is still untouched
});

test('a real implementation run still decides the column alongside an enrich run', () => {
  const issue = { number: 1, state: 'open', url: 'https://github.com/o/r/issues/1' };
  const runs = [
    { runId: 'enrich', workflow: 'writer-reviewer', status: 'success', startedAt: '2026-09-03', issues: [{ number: 1, url: issue.url }] },
    { runId: 'impl', workflow: 'software-development', status: 'success', startedAt: '2026-09-01', issues: [{ number: 1, url: issue.url }] },
  ];
  const [out] = backlog.linkRuns([issue], runs);
  assert.equal(out.column, 'in_progress');
  assert.deepEqual(out.runs.map((r) => [r.runId, !!r.enrich]), [['enrich', true], ['impl', false]]);
});

// Issue tracker: what a "create and queue" run asks to queue (#81) is now the chain mechanism's
// `queue` action (src/renderer/chain-model.js queueBatches, test/chain-model.test.js): filedToQueue
// and the service's queueFiledIssues are gone (#134).

// ---- save a document to its issue (#103) --------------------------------------------------------
test('issueSaveBody: replace keeps the original at the end in a collapsed <details> block', () => {
  const body = backlog.issueSaveBody({ mode: 'replace', document: '# Enriched\n\nBody.', original: 'Original text.' });
  assert.equal(body, '# Enriched\n\nBody.\n\n<details><summary>Original description</summary>\n\nOriginal text.\n\n</details>\n');
});

test('issueSaveBody: replace without an original gives the document only', () => {
  assert.equal(backlog.issueSaveBody({ mode: 'replace', document: 'Doc.', original: '' }), 'Doc.\n');
  assert.equal(backlog.issueSaveBody({ mode: 'replace', document: 'Doc.' }), 'Doc.\n');
});

test('issueSaveBody: saving again never nests the original block', () => {
  const already = 'New doc 1.\n\n<details><summary>Original description</summary>\n\nOriginal text.\n\n</details>\n';
  const body = backlog.issueSaveBody({ mode: 'replace', document: 'New doc 2.', original: already });
  assert.equal(body, 'New doc 2.\n\n<details><summary>Original description</summary>\n\nOriginal text.\n\n</details>\n');
});

test('issueSaveBody: a comment is the document only, whatever the original', () => {
  assert.equal(backlog.issueSaveBody({ mode: 'comment', document: 'An RFC.', original: 'Kept as is.' }), 'An RFC.\n');
});

test('issueSaveBody: CRLF is normalized', () => {
  const body = backlog.issueSaveBody({ mode: 'replace', document: 'Doc.\r\nLine 2.', original: 'Old.\r\nLine 2.' });
  assert.equal(body, 'Doc.\nLine 2.\n\n<details><summary>Original description</summary>\n\nOld.\nLine 2.\n\n</details>\n');
});

test('issueSaveCommand: GitHub replace/comment call gh with --body-file; Enterprise prepends the host', () => {
  const file = 'C:/run/issue-save.md';
  const replace = backlog.issueSaveCommand({ platform: 'github', repo: 'https://github.com/o/r', number: 29, mode: 'replace', file, text: 'x' });
  assert.deepEqual(replace, { cli: 'gh', args: ['issue', 'edit', '29', '--repo', 'o/r', '--body-file', file], display: `gh issue edit 29 --repo o/r --body-file ${file}` });
  const comment = backlog.issueSaveCommand({ platform: 'github', repo: 'https://github.com/o/r', number: 29, mode: 'comment', file, text: 'x' });
  assert.deepEqual(comment.args, ['issue', 'comment', '29', '--repo', 'o/r', '--body-file', file]);
  const ghe = backlog.issueSaveCommand({ platform: 'github', repo: 'https://ghe.corp/o/r', number: 1, mode: 'replace', file, text: 'x' });
  assert.ok(ghe.args.includes('ghe.corp/o/r'));
});

test('issueSaveCommand: GitLab replace/comment pass the text as an argument; a self-hosted GitLab gives an https:// target', () => {
  const replace = backlog.issueSaveCommand({ platform: 'gitlab', repo: 'https://gitlab.com/g/r', number: 7, mode: 'replace', text: 'the body' });
  assert.deepEqual(replace.args, ['issue', 'update', '7', '--repo', 'g/r', '--description', 'the body']);
  const comment = backlog.issueSaveCommand({ platform: 'gitlab', repo: 'https://gitlab.com/g/r', number: 7, mode: 'comment', text: 'the body' });
  assert.deepEqual(comment.args, ['issue', 'note', '7', '--repo', 'g/r', '--message', 'the body']);
  const selfHosted = backlog.issueSaveCommand({ platform: 'gitlab', repo: 'git@gitlab.corp:g/sub/r.git', number: 7, mode: 'replace', text: 'x' });
  assert.ok(selfHosted.args.includes('https://gitlab.corp/g/sub/r'));
});

test('issueSaveCommand: an unknown mode throws; Bitbucket has no CLI to save with; the text never appears in the display', () => {
  assert.throws(() => backlog.issueSaveCommand({ platform: 'github', repo: 'https://github.com/o/r', number: 1, mode: 'delete', file: 'f', text: 'x' }), /Unknown save mode: delete/);
  assert.throws(() => backlog.issueSaveCommand({ platform: 'bitbucket', repo: 'https://bitbucket.org/o/r', number: 1, mode: 'replace', text: 'x' }), /needs GitHub or GitLab/);
  const secret = 'the full document text';
  const cmd = backlog.issueSaveCommand({ platform: 'gitlab', repo: 'https://gitlab.com/g/r', number: 7, mode: 'comment', text: secret });
  assert.ok(!cmd.display.includes(secret));
  assert.match(cmd.display, /<document>/);
});

function savesTmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-save-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeDoc(runDir, text = '# Enriched issue\n\nBody.') {
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'document.md'), text);
}

test('saveRunToIssue: preview never calls the CLI and returns the body and the command', async (t) => {
  const runDir = savesTmp(t);
  writeDoc(runDir);
  const { exec, calls } = fakeExec('irrelevant');
  const run = { runDir, status: 'success', issues: [{ number: 29, url: 'https://github.com/o/r/issues/29', title: 'Backlog screen' }] };
  const out = await backlog.saveRunToIssue({ run, mode: 'replace', preview: true, platform: 'github', repo: 'https://github.com/o/r', cached: { body: 'Original.' }, exec });
  assert.equal(out.preview, true);
  assert.equal(calls.length, 0);
  assert.match(out.body, /^# Enriched issue/);
  assert.match(out.body, /<details><summary>Original description<\/summary>\n\nOriginal\./);
  assert.match(out.command, /^gh issue edit 29 --repo o\/r --body-file/);
  assert.equal(fs.existsSync(path.join(runDir, 'issue-saves.json')), false);
});

test('saveRunToIssue: a simulated run only previews, even without preview:true', async (t) => {
  const runDir = savesTmp(t);
  writeDoc(runDir);
  const { exec, calls } = fakeExec('irrelevant');
  const run = { runDir, status: 'success', mock: true, issues: [{ number: 29, url: 'https://github.com/o/r/issues/29' }] };
  const out = await backlog.saveRunToIssue({ run, mode: 'comment', preview: false, platform: 'github', repo: 'https://github.com/o/r', exec });
  assert.equal(out.preview, true);
  assert.equal(calls.length, 0);
  assert.equal(fs.existsSync(path.join(runDir, 'issue-saves.json')), false);
});

test('saveRunToIssue: replace reads the issue again first (the kept original is the current body) and records the save', async (t) => {
  const runDir = savesTmp(t);
  writeDoc(runDir, '# Enriched\n\nFresh content.');
  const calls = [];
  const exec = async (cli, args) => {
    calls.push([cli, ...args]);
    if (args[0] === 'issue' && args[1] === 'view') {
      return JSON.stringify({ number: 29, title: 'Backlog screen', state: 'OPEN', url: 'https://github.com/o/r/issues/29', labels: [], body: 'The current description.', assignees: [] });
    }
    return '';
  };
  const run = { runDir, status: 'success', issues: [{ number: 29, url: 'https://github.com/o/r/issues/29', title: 'Backlog screen' }] };
  const out = await backlog.saveRunToIssue({ run, mode: 'replace', preview: false, platform: 'github', repo: 'https://github.com/o/r', cached: { body: 'A stale cached body.' }, exec });
  assert.ok(calls.some((c) => c[0] === 'gh' && c[1] === 'issue' && c[2] === 'view'));
  assert.ok(calls.some((c) => c[0] === 'gh' && c[1] === 'issue' && c[2] === 'edit'));
  assert.match(out.body, /The current description\./); // the fresh body, not the stale cache
  assert.equal(out.saved.number, 29);
  assert.equal(out.saved.mode, 'replace');
  assert.equal(out.saved.platform, 'github');
  assert.equal(fs.readFileSync(path.join(runDir, 'issue-save.md'), 'utf8'), out.body);
  assert.deepEqual(backlog.readIssueSaves(runDir), [out.saved]);
});

test('saveRunToIssue: comment mode does not read the issue first and records the comment URL from stdout', async (t) => {
  const runDir = savesTmp(t);
  writeDoc(runDir);
  const calls = [];
  const exec = async (cli, args) => { calls.push([cli, ...args]); return 'created https://github.com/o/r/issues/29#issuecomment-1\n'; };
  const run = { runDir, status: 'success', issues: [{ number: 29, url: 'https://github.com/o/r/issues/29' }] };
  const out = await backlog.saveRunToIssue({ run, mode: 'comment', preview: false, platform: 'github', repo: 'https://github.com/o/r', exec });
  assert.ok(!calls.some((c) => c[1] === 'view'));
  assert.equal(out.saved.commentUrl, 'https://github.com/o/r/issues/29#issuecomment-1');
});

test('saveRunToIssue: a successful save refreshes the project\'s cached issue (its pull requests are kept)', async (t) => {
  const runDir = savesTmp(t);
  writeDoc(runDir);
  const dir = savesTmp(t);
  fs.writeFileSync(path.join(dir, 'p.json'), JSON.stringify({
    projectId: 'p', platform: 'github', repo: 'https://github.com/o/r',
    issues: [{ number: 29, title: 'Old title', state: 'open', url: 'https://github.com/o/r/issues/29', body: 'old', pullRequests: [{ number: 5, title: 'A PR', url: 'u', draft: false }] }],
  }));
  const exec = async (cli, args) => {
    if (args[0] === 'issue' && (args[1] === 'edit' || args[1] === 'view')) {
      if (args[1] === 'view') return JSON.stringify({ number: 29, title: 'New title', state: 'OPEN', url: 'https://github.com/o/r/issues/29', labels: [], body: 'New body', assignees: [] });
      return '';
    }
    return '';
  };
  const run = { runDir, status: 'success', issues: [{ number: 29, url: 'https://github.com/o/r/issues/29' }] };
  await backlog.saveRunToIssue({ run, mode: 'replace', preview: false, platform: 'github', repo: 'https://github.com/o/r', exec, dir, projectId: 'p' });
  const cache = backlog.readBacklog(dir, 'p');
  assert.equal(cache.issues[0].title, 'New title');
  assert.equal(cache.issues[0].body, 'New body');
  assert.deepEqual(cache.issues[0].pullRequests, [{ number: 5, title: 'A PR', url: 'u', draft: false }]);
});

test('saveRunToIssue: a failing refresh still records the save, with refreshError set', async (t) => {
  const runDir = savesTmp(t);
  writeDoc(runDir);
  const dir = savesTmp(t); // no project cache file: fetchIssue after the save will fail to update it
  let calls = 0;
  const exec = async (cli, args) => {
    calls += 1;
    if (args[1] === 'view') throw new Error('gh issue view failed: not found');
    return '';
  };
  const run = { runDir, status: 'success', issues: [{ number: 29, url: 'https://github.com/o/r/issues/29' }] };
  const out = await backlog.saveRunToIssue({ run, mode: 'comment', preview: false, platform: 'github', repo: 'https://github.com/o/r', exec, dir, projectId: 'missing' });
  assert.ok(out.saved);
  assert.match(out.refreshError, /not found/);
});

test('saveRunToIssue: refuses a run with no issue, a run that did not succeed, or a missing/empty document', async (t) => {
  const runDir = savesTmp(t);
  const { exec } = fakeExec('x');
  await assert.rejects(backlog.saveRunToIssue({ run: { runDir, status: 'success', issues: [] }, preview: true, platform: 'github', repo: 'r', exec }), /not started from an issue/);
  await assert.rejects(backlog.saveRunToIssue({ run: { runDir, status: 'running', issues: [{ number: 1, url: 'u' }] }, preview: true, platform: 'github', repo: 'r', exec }), /Only an accepted document/);
  await assert.rejects(backlog.saveRunToIssue({ run: { runDir, status: 'success', issues: [{ number: 1, url: 'u' }] }, preview: true, platform: 'github', repo: 'r', exec }), /has no document\.md/);
  writeDoc(runDir, '   \n  ');
  await assert.rejects(backlog.saveRunToIssue({ run: { runDir, status: 'success', issues: [{ number: 1, url: 'u' }] }, preview: true, platform: 'github', repo: 'r', exec }), /document\.md is empty/);
});

test('saveRunToIssue: an exec error (e.g. no auth) propagates and nothing is recorded', async (t) => {
  const runDir = savesTmp(t);
  writeDoc(runDir);
  const exec = async () => { throw new Error('gh issue edit failed: not authenticated'); };
  const run = { runDir, status: 'success', issues: [{ number: 29, url: 'https://github.com/o/r/issues/29' }] };
  await assert.rejects(backlog.saveRunToIssue({ run, mode: 'comment', preview: false, platform: 'github', repo: 'https://github.com/o/r', exec }), /not authenticated/);
  assert.equal(fs.existsSync(path.join(runDir, 'issue-saves.json')), false);
});

test('readIssueSaves: [] when the run has never saved to an issue', (t) => {
  const runDir = savesTmp(t);
  assert.deepEqual(backlog.readIssueSaves(runDir), []);
});

test('a queued issue becomes the run inputs: task, project folder and issue', () => {
  const item = { number: 7, url: 'https://github.com/o/r/issues/7', title: 'Add X', body: 'Details', inputs: { language: 'go', repo_path: '' } };
  const wf = { inputs: { task: {}, repo_path: { type: 'string' }, language: {}, issue: {}, run_id: { type: 'run' } } };
  assert.deepEqual(backlog.runInputs(item, wf, 'C:/repo'), {
    task: 'Add X\n\nIssue: https://github.com/o/r/issues/7\n\nDetails', repo_path: 'C:/repo', language: 'go', issue: 'https://github.com/o/r/issues/7',
  });
  // no `issue` input: the URL is only in the task
  assert.equal(backlog.runInputs(item, { inputs: { task: {} } }, 'C:/repo').issue, undefined);
});

// ---- the platform is the source of truth (#168): a fresh read right before a start ---------------

// A fake `gh issue view <n>` runner: `byNumber[n]` answers the call, or it throws when `byNumber[n]`
// is an Error; unlisted numbers throw "no such issue".
function issueViewExec(byNumber) {
  const calls = [];
  const exec = async (cli, args) => {
    calls.push([cli, ...args]);
    const n = Number(args[2]);
    const a = byNumber[n];
    if (a === undefined) throw new Error(`no such issue: ${n}`);
    if (a instanceof Error) throw a;
    return JSON.stringify({ number: n, state: 'OPEN', labels: [], ...a });
  };
  return { exec, calls };
}

test('freshIssues: the platform read wins over a stale, closed cache (the platform is the source of truth)', async () => {
  const item = { number: 1, url: 'https://github.com/o/r/issues/1', title: 'Old title', body: 'Old body', updatedAt: '2026-09-01T00:00:00Z', knownPullRequests: ['https://github.com/o/r/pull/9'] };
  const cache = { syncedAt: '2026-09-20T08:00:00Z', issues: [{ number: 1, state: 'closed', title: 'Cached title', body: 'Cached body', url: 'https://github.com/o/r/issues/1', updatedAt: '2026-09-15T00:00:00Z' }] };
  const { exec } = issueViewExec({ 1: { title: 'Fresh title', body: 'Fresh body', state: 'OPEN', url: 'https://github.com/o/r/issues/1', updatedAt: '2026-10-01T12:00:00Z' } });
  const { issues, warnings } = await backlog.freshIssues({ item, platform: 'github', repo: 'https://github.com/o/r', cache, fromPlatform: true, exec });
  assert.deepEqual(warnings, []);
  assert.deepEqual(issues, [{
    number: 1, url: 'https://github.com/o/r/issues/1', title: 'Fresh title', body: 'Fresh body', labels: [],
    updatedAt: '2026-10-01T12:00:00Z', knownPullRequests: ['https://github.com/o/r/pull/9'], state: 'open',
  }]);
});

test('freshIssues: a platform read that fails falls back to the synced cache when it is newer than the item\'s copy, and warns', async () => {
  const item = { number: 1, url: 'u', title: 'Copy title', body: 'Copy body', updatedAt: '2026-09-10T00:00:00Z', knownPullRequests: [] };
  const cache = { syncedAt: '2026-09-20T08:30:00Z', issues: [{ number: 1, state: 'open', title: 'Synced title', body: 'Synced body', url: 'https://github.com/o/r/issues/1', updatedAt: '2026-09-25T00:00:00Z' }] };
  const { exec } = issueViewExec({ 1: new Error('gh: not authenticated') });
  const { issues, warnings } = await backlog.freshIssues({ item, platform: 'github', repo: 'https://github.com/o/r', cache, fromPlatform: true, exec });
  assert.deepEqual(issues, [{
    number: 1, url: 'https://github.com/o/r/issues/1', title: 'Synced title', body: 'Synced body', labels: [],
    updatedAt: '2026-09-25T00:00:00Z', knownPullRequests: [], state: 'open', fallback: 'cache', cachedAt: '2026-09-20T08:30:00Z',
  }]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^Issue #1 read from the cache of \d{2}:\d{2}: gh: not authenticated$/);
});

test('freshIssues: a platform read that fails falls back to the item\'s own copy when the cache has no newer version', async () => {
  const item = { number: 1, url: 'u', title: 'Copy title', body: 'Copy body', updatedAt: '2026-09-25T00:00:00Z', knownPullRequests: [] };
  const cache = { syncedAt: '2026-09-20T08:00:00Z', issues: [{ number: 1, state: 'open', title: 'Stale cached', body: 'Stale body', url: 'https://github.com/o/r/issues/1', updatedAt: '2026-09-10T00:00:00Z' }] };
  const { exec } = issueViewExec({ 1: new Error('offline') });
  const { issues, warnings } = await backlog.freshIssues({ item, platform: 'github', repo: 'https://github.com/o/r', cache, fromPlatform: true, exec });
  assert.deepEqual(issues, [{
    number: 1, url: 'u', title: 'Copy title', body: 'Copy body', labels: [],
    updatedAt: '2026-09-25T00:00:00Z', knownPullRequests: [], state: 'open', fallback: 'copy',
  }]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^Issue #1 read from the copy saved with the planned item \(the cache has no newer version\): offline$/);
});

test('freshIssues: fromPlatform false (a simulation, or a project with no repository) never calls the CLI; no warning, no fallback marker', async () => {
  const item = { number: 1, url: 'u', title: 'Copy', body: 'copy body', updatedAt: '2026-09-10T00:00:00Z', knownPullRequests: [] };
  const cache = { syncedAt: 'x', issues: [{ number: 1, state: 'closed', title: 'Cached', body: 'cached body', url: 'ucached', updatedAt: '2026-09-20T00:00:00Z' }] };
  let called = false;
  const exec = async () => { called = true; throw new Error('should not be called'); };
  const { issues, warnings } = await backlog.freshIssues({ item, platform: 'github', repo: 'r', cache, fromPlatform: false, exec });
  assert.equal(called, false);
  assert.deepEqual(warnings, []);
  assert.deepEqual(issues, [{ number: 1, url: 'ucached', title: 'Cached', body: 'cached body', labels: [], updatedAt: '2026-09-20T00:00:00Z', knownPullRequests: [], state: 'closed' }]);
});

test('freshIssues: a group\'s issues are read independently, each with its own fallback', async () => {
  const item = {
    number: 1, url: 'u1', title: 't1', body: 'b1', updatedAt: null,
    issues: [
      { number: 1, url: 'u1', title: 'Old1', body: 'Old body1', knownPullRequests: [] },
      { number: 2, url: 'u2', title: 'Old2', body: 'Old body2', updatedAt: '2026-09-01T00:00:00Z', knownPullRequests: [] },
    ],
  };
  const cache = { syncedAt: '2026-09-20T00:00:00Z', issues: [{ number: 2, state: 'open', title: 'Cached2', body: 'Cached body2', url: 'u2', updatedAt: '2026-09-15T00:00:00Z' }] };
  const { exec } = issueViewExec({ 1: { title: 'Fresh1', body: 'Fresh body1', state: 'OPEN', url: 'u1', updatedAt: '2026-10-01T00:00:00Z' }, 2: new Error('offline') });
  const { issues, warnings } = await backlog.freshIssues({ item, platform: 'github', repo: 'https://github.com/o/r', cache, fromPlatform: true, exec });
  assert.deepEqual(issues.map((i) => i.title), ['Fresh1', 'Cached2']);
  assert.equal(issues[0].fallback, undefined);
  assert.equal(issues[1].fallback, 'cache');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^Issue #2 read from the cache/);
});

test('recordedIssues: number/url/title/updatedAt only, plus fallback and cachedAt when there was a fallback', () => {
  const issues = [
    { number: 1, url: 'u1', title: 't1', body: 'b', labels: [], state: 'open', updatedAt: '2026-10-01T00:00:00Z' },
    { number: 2, url: 'u2', title: 't2', body: 'b', labels: [], state: 'open', updatedAt: '2026-09-01T00:00:00Z', fallback: 'cache', cachedAt: '2026-09-20T00:00:00Z' },
  ];
  assert.deepEqual(backlog.recordedIssues(issues), [
    { number: 1, url: 'u1', title: 't1', updatedAt: '2026-10-01T00:00:00Z' },
    { number: 2, url: 'u2', title: 't2', updatedAt: '2026-09-01T00:00:00Z', fallback: 'cache', cachedAt: '2026-09-20T00:00:00Z' },
  ]);
});

test('withSyncedText: a copy takes the synced title/body/labels/updatedAt (its own url when the sync has none); without a sync it is unchanged', () => {
  const copy = { number: 1, url: 'old-url', title: 'Old', body: 'old body', labels: [{ name: 'a' }], updatedAt: '2026-09-01T00:00:00Z', knownPullRequests: ['p'] };
  const synced = { title: 'New', body: 'new body', labels: [{ name: 'b' }], updatedAt: '2026-10-01T00:00:00Z' }; // no url
  assert.deepEqual(backlog.withSyncedText(copy, synced), { ...copy, title: 'New', body: 'new body', labels: [{ name: 'b' }], updatedAt: '2026-10-01T00:00:00Z' });
  assert.deepEqual(backlog.withSyncedText(copy, null), copy);
});

test('refreshQueuedCopies: brings the queued copies up to a sync; a no-op (no write) once they already match', (t) => {
  const dir = tmp(t);
  backlog.enqueue(dir, 'p', {
    workflow: 'w.yaml',
    issues: [{ number: 1, url: 'u1', title: 'Old', body: 'old' }, { number: 2, url: 'u2', title: 'Old2', body: 'old2' }],
  });
  const synced = [
    { number: 1, title: 'New title', body: 'new body', url: 'u1', labels: [], updatedAt: '2026-10-01T00:00:00Z' },
    { number: 2, title: 'New2', body: 'new2', url: 'u2', labels: [], updatedAt: '2026-10-01T00:00:00Z' },
  ];
  assert.equal(backlog.refreshQueuedCopies(dir, 'p', synced), true);
  const q = backlog.readQueue(dir, 'p');
  assert.deepEqual(q.items.map((i) => i.title), ['New title', 'New2']);
  assert.equal(backlog.refreshQueuedCopies(dir, 'p', synced), false); // already up to date: nothing written
});

test('the platform is the source of truth: a sync and a fresh pre-start read never write back to it (no edit/create/close/comment call)', async (t) => {
  const dir = tmp(t);
  const calls = [];
  const exec = async (cli, args) => {
    calls.push([cli, ...args]);
    if (args[0] === 'issue' && args[1] === 'list') return JSON.stringify([GH_ISSUE]);
    if (args[0] === 'pr' && args[1] === 'list') return JSON.stringify([]);
    if (args[0] === 'issue' && args[1] === 'view') return JSON.stringify(GH_ISSUE);
    return '[]'; // epics / sub-issues reads (gh api ...)
  };
  const project = { id: 'p', repo: 'https://github.com/o/r' };
  await backlog.syncBacklog({ dir, project, platform: 'github', exec });
  const cache = backlog.readBacklog(dir, 'p');
  await backlog.freshIssues({
    item: { number: GH_ISSUE.number, url: GH_ISSUE.url, title: GH_ISSUE.title, body: GH_ISSUE.body },
    platform: 'github', repo: project.repo, cache, fromPlatform: true, exec,
  });
  assert.ok(calls.length > 0);
  const writeVerbs = ['edit', 'create', 'close', 'comment', 'update', 'note'];
  assert.ok(!calls.some(([, , verb]) => writeVerbs.includes(verb)), JSON.stringify(calls));
});
