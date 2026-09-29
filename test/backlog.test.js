// Backlog (src/backlog.js): repository URLs, issue fetching per platform and the sync cache.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const backlog = require('../src/backlog');

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
  assert.deepEqual(backlog.readBacklog(dir, '../p'), data);
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
  assert.deepEqual(by[1].runs[0], { runId: 'b', workflow: 'software-development', status: 'running', startedAt: '2026-09-03' });
  assert.equal(by[1].column, 'in_progress');
  assert.equal(by[2].column, 'todo'); // its only run was cancelled
  assert.deepEqual(by[3].runs, []); // simulated and look-alike mentions don't count
  assert.equal(by[3].column, 'todo');
  assert.equal(by[4].column, 'done');
  assert.deepEqual(by[22].runs.map((r) => r.runId), ['b']);
});
