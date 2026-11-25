// #73 acceptance, written before the code: a run that merges locally (`merge: local`, then push_main) closes the local
// issues (#35) it implements, with the run and the merge commit in each issue's record; a failed, stopped or simulated
// run closes none; with no remote push_main is "merged locally, this project has no remote", never a warning.
//
// Seams (existing channels of the service): projects:create / projects:update, backlog:create-issue, backlog:get,
// backlog:restore, backlog:file-local, roadmap:save / roadmap:start / roadmap:get, run:start, run:stop,
// approval:resolve, and the pushed run events. The runs are real (allowRealRuns) and have no agents: a gate, whose
// Approve commits on a branch (a transition action) and merges it into the local base of a throwaway repository.
// The issue's record is read as JSON of backlog:get's issue without its run links (`runs`), so no field name is assumed.
// No network: origin is a bare repository in a temp folder; a github.com URL is only the project's `repo`.
process.env.CRAFTORIO_MOCK_DELAY_SCALE ??= '0.05';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const backlog = require('../../domains/backlog/backlog');
const { allowRealRuns, gitRepo, makeService, until, watchRuns } = require('./helpers');

// No user git config (identity, hooks), as on CI: the runs' git processes inherit it.
const cfgFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gitcfg-73-')), 'config');
fs.writeFileSync(cfgFile, '');
process.env.GIT_CONFIG_GLOBAL = cfgFile;
process.env.GIT_CONFIG_NOSYSTEM = '1';

const REPO = 'https://github.com/o/field-notes';
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

// `check` (after the merge): Approve ends well, Reject ends the run as failed although it merged
const workflow = (name, checked) => `apiVersion: craftorio/v1
kind: Workflow
metadata:
  name: ${name}
inputs:
  task: { type: string, default: "" }
  branch: { type: string, default: feat/one }
  project_path: { type: string, required: true }
orchestrator:
  worktree:
    repo: "{{ inputs.project_path }}"
    base: main
    remote: false
agents: {}
steps:
  - id: land
    type: human_approval
    message: "Land it?"
    transitions:
      - when: "approved"
        action: 'git switch -c {{ inputs.branch }} && git -c user.name=t -c user.email=t@t commit --allow-empty -q -m "work on {{ inputs.branch }}"'
        merge: local
        goto: push_main
      - when: "rejected"
        goto: end
        status: failed
  - id: push_main
    type: push_base
    transitions:
      - when: "true"
        goto: ${checked ? 'check' : 'end'}
${checked ? `  - id: check
    type: human_approval
    message: "All good?"
    transitions:
      - when: "approved"
        goto: end
      - when: "rejected"
        goto: end
        status: failed
` : ''}`;

async function setup(t) {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-land.yaml'), workflow('fixture-land', false));
  fs.writeFileSync(path.join(ws.workflows, 'fixture-land-check.yaml'), workflow('fixture-land-check', true));
  const repo = gitRepo(t);
  const p = await api['projects:create']({ name: 'field notes', folder: repo.dir });
  const events = [];
  service.events.on('run:event', (ev) => events.push(ev));
  const watched = watchRuns(service);
  return { service, api, ws, repo, p, events, ...watched };
}

const issuesOf = async (f) => (await f.api['backlog:get']({ projectId: f.p.id }))?.issues || [];
const byTitle = async (f, title) => (await issuesOf(f)).find((i) => i.title === title);
async function create(f, title) {
  await f.api['backlog:create-issue']({ projectId: f.p.id, title, body: 'Do it.' });
  return byTitle(f, title);
}
const record = ({ runs: _runs, ...issue }) => JSON.stringify(issue);
const refs = (...issues) => issues.map((i) => ({ number: i.number, url: i.url || '', title: i.title }));

async function startRun(f, { issues, branch = 'feat/one', file = 'fixture-land.yaml', mock = false }) {
  const started = await f.api['run:start']({ file, inputs: { task: 'Do it', branch, project_path: f.p.folder || f.repo.dir }, mock, projectId: f.p.id, issues, confirmed: true });
  assert.equal(typeof started?.runId, 'string', `the run started: ${JSON.stringify(started)}`);
  await until(() => f.gates.has(started.runId));
  return started.runId;
}
async function answer(f, runId, yes = true) {
  const id = f.gates.get(runId);
  f.api['approval:resolve']({ runId, id, answer: yes });
  await until(() => f.finished.has(runId) || f.gates.get(runId) !== id);
}
async function landed(f, options) {
  const runId = await startRun(f, options);
  await answer(f, runId);
  await until(() => f.finished.has(runId));
  assert.equal(f.finished.get(runId), 'success', JSON.stringify(f.events.filter((e) => e.run_id === runId).slice(-3)));
  return runId;
}
const mergeCommit = (f, runId) => f.events.find((e) => e.run_id === runId && e.type === 'worktree.merged')?.commit;
// the issue as the Backlog shows it once the run's end was handled
async function settledIssue(f, title, state) {
  for (let i = 0; i < 60; i++) {
    const issue = await byTitle(f, title);
    if (issue?.state === state) return issue;
    await new Promise((r) => setTimeout(r, 50));
  }
  return byTitle(f, title);
}
const settle = () => new Promise((r) => setTimeout(r, 400));

test('#73 a run that merged locally closes its local issue, with the run and the commit in its record, in the done column', async (t) => {
  const f = await setup(t);
  const issue = await create(f, 'Add a contribution guide');
  allowRealRuns(t, f.api);
  const runId = await landed(f, { issues: refs(issue) });
  const commit = mergeCommit(f, runId);
  assert.match(String(commit), /^[0-9a-f]{40}$/);
  const closed = await settledIssue(f, issue.title, 'closed');
  assert.equal(closed.state, 'closed');
  assert.equal(closed.column, 'done');
  assert.equal(record(closed).includes(runId), true, `the record names the run: ${record(closed)}`);
  assert.equal(record(closed).includes(commit), true, `the record names the commit: ${record(closed)}`);
});

test('#73 a run for a group of local issues closes each of them and leaves the others open', async (t) => {
  const f = await setup(t);
  const one = await create(f, 'Issue one');
  const two = await create(f, 'Issue two');
  await create(f, 'Unrelated issue');
  allowRealRuns(t, f.api);
  await landed(f, { issues: refs(one, two) });
  const states = [await settledIssue(f, one.title, 'closed'), await settledIssue(f, two.title, 'closed'), await byTitle(f, 'Unrelated issue')].map((i) => i.state);
  assert.deepEqual(states, ['closed', 'closed', 'open']);
});

test('#73 a run that merged and then ended as failed closes no local issue', async (t) => {
  const f = await setup(t);
  const issue = await create(f, 'Issue one');
  allowRealRuns(t, f.api);
  const runId = await startRun(f, { issues: refs(issue), file: 'fixture-land-check.yaml' });
  await answer(f, runId);
  assert.ok(mergeCommit(f, runId), 'it merged before its last gate');
  await answer(f, runId, false);
  await until(() => f.finished.has(runId));
  assert.equal(f.finished.get(runId), 'failed');
  await settle();
  assert.equal((await byTitle(f, issue.title)).state, 'open');
});

test('#73 a run that merged and was stopped closes no local issue', async (t) => {
  const f = await setup(t);
  const issue = await create(f, 'Issue one');
  allowRealRuns(t, f.api);
  const runId = await startRun(f, { issues: refs(issue), file: 'fixture-land-check.yaml' });
  await answer(f, runId);
  assert.ok(mergeCommit(f, runId), 'it merged before it was stopped');
  f.api['run:stop']({ runId });
  await until(() => f.finished.has(runId));
  assert.notEqual(f.finished.get(runId), 'success');
  await settle();
  assert.equal((await byTitle(f, issue.title)).state, 'open');
});

test('#73 a simulated run closes no local issue', async (t) => {
  const f = await setup(t);
  const issue = await create(f, 'Issue one');
  await landed(f, { issues: refs(issue), mock: true });
  await settle();
  assert.equal((await byTitle(f, issue.title)).state, 'open');
});

test('#73 the Backlog and the roadmap agree: a roadmap item whose run merged is done and its local issue closed', async (t) => {
  const f = await setup(t);
  const issue = await create(f, 'Issue one');
  await f.api['roadmap:save']({ projectId: f.p.id, stages: [{ items: [{ workflow: 'fixture-land.yaml', number: issue.number, mock: false }] }] });
  allowRealRuns(t, f.api);
  await f.api['roadmap:start']({ projectId: f.p.id, simulated: false });
  const run = f.api['runs:active']()[0];
  assert.ok(run, 'the roadmap started the item');
  await until(() => f.gates.has(run.runId));
  await answer(f, run.runId);
  await until(() => f.finished.has(run.runId));
  assert.equal(f.finished.get(run.runId), 'success');
  const closed = await settledIssue(f, issue.title, 'closed');
  const item = f.api['roadmap:get']({ projectId: f.p.id }).stages[0].items[0];
  assert.deepEqual([item.status, closed.state, closed.column], ['done', 'closed', 'done']);
});

test('#73 with no remote push_main ends "merged locally, this project has no remote", with no warning', async (t) => {
  const f = await setup(t);
  const issue = await create(f, 'Issue one');
  allowRealRuns(t, f.api);
  const runId = await landed(f, { issues: refs(issue) });
  const output = f.events.find((e) => e.run_id === runId && e.type === 'step.finished' && e.step_id === 'push_main')?.output;
  assert.equal(output?.pushed, false);
  assert.match(String(output.summary), /merged locally/i);
  assert.match(String(output.summary), /no remote/i);
  assert.doesNotMatch(String(output.summary), /could not push/i);
  const warned = f.events.filter((e) => e.run_id === runId && e.type === 'log' && e.step_id === 'push_main' && e.level === 'warn').map((e) => e.message);
  assert.deepEqual(warned, []);
});

// ---- a project with a remote that has local issues ------------------------------------------------------

async function withRemote(t, f) {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-origin-73-'));
  t.after(() => fs.rmSync(bare, { recursive: true, force: true, maxRetries: 3 }));
  git(bare, 'init', '-q', '--bare');
  git(f.repo.dir, 'remote', 'add', 'origin', bare);
  git(f.repo.dir, 'push', '-q', '-u', 'origin', 'main');
  t.mock.method(backlog, 'syncBacklog', async ({ dir, project }) => backlog.readBacklog(dir, project.id)); // never the platform
  await f.api['projects:update']({ id: f.p.id, patch: { repo: REPO } });
  return bare;
}

test('#73 on a project with a remote, a run for its local issue pushes as before and closes that issue', async (t) => {
  const f = await setup(t);
  const issue = await create(f, 'Issue one');
  const bare = await withRemote(t, f);
  allowRealRuns(t, f.api);
  const runId = await landed(f, { issues: refs(issue) });
  const output = f.events.find((e) => e.run_id === runId && e.type === 'step.finished' && e.step_id === 'push_main')?.output;
  assert.equal(output?.pushed, true, JSON.stringify(output));
  assert.equal(git(bare, 'rev-parse', 'refs/heads/main'), mergeCommit(f, runId));
  assert.equal((await settledIssue(f, issue.title, 'closed')).state, 'closed');
});

test('#73 on a project with a remote, a run for the platform\'s issue leaves the local issue of the same number open', async (t) => {
  const f = await setup(t);
  const local = await create(f, 'Local issue');
  await withRemote(t, f);
  const platform = { number: local.number, title: 'Platform issue', state: 'open', url: `${REPO}/issues/${local.number}`, body: '', labels: [], assignees: [], tasks: { done: 0, total: 0 } };
  fs.writeFileSync(path.join(f.ws.backlog, `${f.p.id}.json`), JSON.stringify({ projectId: f.p.id, platform: 'github', repo: REPO, issues: [platform] }));
  allowRealRuns(t, f.api);
  await landed(f, { issues: refs(platform) });
  await settle();
  assert.equal((await byTitle(f, 'Local issue')).state, 'open');
});

// ---- reopened, and a remote added later ------------------------------------------------------------------

test('#73 an issue a person reopened stays open until a new run on it merges, which closes it again', async (t) => {
  const f = await setup(t);
  const issue = await create(f, 'Issue one');
  const other = await create(f, 'Issue two');
  allowRealRuns(t, f.api);
  await landed(f, { issues: refs(issue), branch: 'feat/one' });
  assert.equal((await settledIssue(f, issue.title, 'closed')).state, 'closed', 'closed by its run');
  await f.api['backlog:restore']({ projectId: f.p.id, numbers: [issue.number] });
  assert.equal((await byTitle(f, issue.title)).state, 'open', 'reopened');
  await landed(f, { issues: refs(other), branch: 'feat/two' });
  assert.equal((await settledIssue(f, other.title, 'closed')).state, 'closed');
  const reopened = await byTitle(f, issue.title);
  assert.deepEqual([reopened.state, reopened.column === 'done'], ['open', false], 'another run\'s merge leaves it open');
  const again = await landed(f, { issues: refs(issue), branch: 'feat/three' });
  const closed = await settledIssue(f, issue.title, 'closed');
  assert.equal(closed.state, 'closed');
  assert.equal(record(closed).includes(again), true, `the record names the new run: ${record(closed)}`);
});

test('#73 a remote added later: the closed local issue stays closed and is not offered for filing', async (t) => {
  const f = await setup(t);
  const issue = await create(f, 'Closed by its run');
  await create(f, 'Still open');
  allowRealRuns(t, f.api);
  await landed(f, { issues: refs(issue) });
  assert.equal((await settledIssue(f, issue.title, 'closed')).state, 'closed', 'closed by its run');
  t.mock.method(backlog, 'syncBacklog', async ({ dir, project }) => backlog.readBacklog(dir, project.id));
  await f.api['projects:update']({ id: f.p.id, patch: { repo: REPO } });
  const preview = await f.api['backlog:file-local']({ projectId: f.p.id, preview: true });
  assert.deepEqual(preview.issues.map((i) => i.title), ['Still open']);
  assert.equal((await byTitle(f, issue.title)).state, 'closed');
});
