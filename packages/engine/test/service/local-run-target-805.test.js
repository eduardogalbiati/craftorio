// #805, internals of the local base check the acceptance tests do not reach: which runs count as local
// (areas/local-push.js localRunTarget), the run's base checkout, and fastForwardBase's refusals.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { checkLocalBase, fastForwardBase, prepareBaseWorktree, prepareWorktree } = require('../../engine/worktree');
const { localStatus } = require('../../domains/local/local-push');
const { commit, fixture, git, logger } = require('../worktree-helpers');
const { makeService, roadmapIssue, until } = require('./helpers');

const WORKFLOW = `apiVersion: craftorio/v1
kind: Workflow
metadata:
  name: fixture-target-805
inputs:
  task: { type: string, required: true }
  repo_path: { type: string, default: "" }
  base_branch: { type: string, default: main }
  mode: { type: string, enum: [local, remote], default: local }
orchestrator:
  worktree:
    repo: "{{ inputs.repo_path }}"
    base: "{{ inputs.base_branch }}"
    remote: "{{ inputs.mode != 'local' }}"
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: work
    agent: a
    prompt: "{{ inputs.task }}"
`;

function originMoves(f, count = 2) {
  for (let i = 0; i < count; i++) commit(f.other, `remote-${i}.txt`, `${i}\n`);
  git(f.other, 'push', '-q', 'origin', 'main');
}

test('#805 a local run\'s target: the inputs over the workflow\'s defaults; none for a remote run or an empty repository', async (t) => {
  const { service, api } = makeService(t);
  const file = 'fixture-target-805.yaml';
  fs.writeFileSync(path.join(service.workspace().workflows, file), WORKFLOW);
  const start = (inputs) => api['run:start']({ file, inputs: { task: 'x', ...inputs }, mock: true });
  const startsAtOnce = async (inputs) => {
    assert.equal(typeof (await start(inputs)).runId, 'string');
    await until(() => !api['runs:active']().length);
  };
  const f = fixture(t, 'canonical');
  originMoves(f);
  assert.equal((await start({ repo_path: f.repo })).baseCheck?.behind, 2, 'the mode and the base came from the defaults');
  await startsAtOnce({ repo_path: f.repo, mode: 'remote' });
  await startsAtOnce({ repo_path: '' });
});

test('#805 an old workflow name counts as the workflow it means: Write & Review and AI Arena runs are local', async (t) => {
  const { api } = makeService(t);
  const f = fixture(t, 'canonical');
  originMoves(f);
  for (const file of ['writer-reviewer.yaml', 'ai-arena.yaml']) {
    const answer = await api['run:start']({ file, inputs: { project_path: f.repo, base_branch: 'main' }, mock: true });
    assert.deepEqual(answer.baseCheck, { base: 'main', state: 'behind', ahead: 0, behind: 2, canUpdate: true }, file);
    assert.equal(answer.runId, undefined, file);
  }
});

test('#805 the run\'s base checkout does not compare again: no second fetch, no second warning', async (t) => {
  const f = fixture(t);
  originMoves(f);
  const { lines, log } = logger();
  const info = await prepareBaseWorktree({ repo: f.repo, base: 'main', dir: path.join(f.worktrees, 'run-805-base'), remote: false, log });
  assert.equal(info.baseCheck, undefined);
  assert.deepEqual(lines.filter((l) => l.startsWith('warn: ')), []);
});

test('#805 a reused or resumed worktree is not compared', async (t) => {
  const f = fixture(t);
  const dir = path.join(f.worktrees, 'run-805');
  await prepareWorktree({ repo: f.repo, base: 'main', dir, remote: false });
  originMoves(f);
  const { lines, log } = logger();
  const again = await prepareWorktree({ repo: f.repo, base: 'main', dir, remote: false, log });
  assert.equal(again.reused, true);
  assert.equal(again.baseCheck, undefined);
  assert.deepEqual(lines.filter((l) => l.startsWith('warn: ')), []);
});

test('#805 checkLocalBase has nothing to compare for a base that is not a local branch or not a valid name', async (t) => {
  const f = fixture(t);
  assert.equal(await checkLocalBase({ repo: f.repo, base: 'no-such-branch' }), null);
  assert.equal(await checkLocalBase({ repo: f.repo, base: '--upload-pack=x' }), null);
  assert.equal(await checkLocalBase({ repo: path.join(f.tmp, 'nowhere'), base: 'main' }), null);
});

test('#805 fastForwardBase refuses a base with commits of its own and a dirty checkout, and says why', async (t) => {
  const f = fixture(t);
  originMoves(f);
  await checkLocalBase({ repo: f.repo, base: 'main' });
  const local = git(f.repo, 'rev-parse', 'main');
  fs.writeFileSync(path.join(f.repo, 'a.txt'), 'my edit\n');
  const dirty = await fastForwardBase({ repo: f.repo, base: 'main' });
  assert.equal(dirty.moved, false);
  assert.match(dirty.reason, /uncommitted changes/);
  git(f.repo, 'checkout', '--', 'a.txt');
  commit(f.repo, 'local.txt', 'only here\n');
  const own = await fastForwardBase({ repo: f.repo, base: 'main' });
  assert.equal(own.moved, false);
  assert.match(own.reason, /commits that are not in origin\/main/);
  assert.notEqual(git(f.repo, 'rev-parse', 'main'), local);
  assert.equal(git(f.repo, 'rev-list', '--merges', 'main'), '');
});

test('#805 a failed fetch still compares with the last fetch, in the check and in the Backlog\'s status alike', async (t) => {
  const f = fixture(t);
  originMoves(f);
  await checkLocalBase({ repo: f.repo, base: 'main' }); // origin/main is 2 ahead here
  git(f.repo, 'remote', 'set-url', 'origin', path.join(f.tmp, 'no-such-origin.git'));
  const check = await checkLocalBase({ repo: f.repo, base: 'main' });
  assert.equal(check.state, 'fetch-failed');
  assert.equal(check.behind, 2);
  assert.equal(check.canUpdate, false);
  const status = await localStatus({ repo: f.repo, base: 'main' });
  assert.ok(status.fetchError);
  assert.equal(status.behind, check.behind);
});

test('#805 fastForwardBase moves to any target, and a base checked out nowhere moves by compare-and-swap', async (t) => {
  const f = fixture(t);
  originMoves(f);
  await checkLocalBase({ repo: f.repo, base: 'main' });
  git(f.repo, 'switch', '-q', '-c', 'elsewhere');
  git(f.repo, 'update-ref', 'refs/remotes/upstream/main', 'refs/remotes/origin/main');
  const moved = await fastForwardBase({ repo: f.repo, base: 'main', target: 'refs/remotes/upstream/main' });
  assert.equal(moved.moved, true);
  assert.equal(git(f.repo, 'rev-parse', 'main'), moved.commit);
  const unknown = await fastForwardBase({ repo: f.repo, base: 'main', target: 'refs/remotes/upstream/dev' });
  assert.deepEqual(unknown, { moved: false, reason: 'upstream/dev is not known here' });
});

// The race, through the git on the PATH (a shell script, so not on Windows): main moves to `commitId` just before the
// first `git update-ref` runs. No hook can do it: reference-transaction fires once the ref is locked and its old value checked.
function moveBeforeUpdateRef(t, f, commitId) {
  const real = path.join(git(f.repo, '--exec-path'), 'git');
  const bin = path.join(f.tmp, 'bin');
  const mark = path.join(f.tmp, 'moved-meanwhile');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\nif [ "$1" = update-ref ] && [ ! -e "${mark}" ]; then\n  : > "${mark}"\n  "${real}" update-ref refs/heads/main ${commitId}\nfi\nexec "${real}" "$@"\n`, { mode: 0o755 });
  const before = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${before}`;
  t.after(() => { process.env.PATH = before; });
  return mark;
}

test('#805 fastForwardBase: a base that moves after it was read keeps its commits, the compare-and-swap fails', { skip: process.platform === 'win32' }, async (t) => {
  const f = fixture(t);
  originMoves(f);
  await checkLocalBase({ repo: f.repo, base: 'main' });
  git(f.repo, 'switch', '-q', '-c', 'elsewhere'); // main checked out nowhere: the ref is moved
  const merged = commit(f.repo, 'merged.txt', 'a merge that landed meanwhile\n');
  const mark = moveBeforeUpdateRef(t, f, merged);
  const out = await fastForwardBase({ repo: f.repo, base: 'main' });
  assert.equal(fs.existsSync(mark), true, 'main moved during the update');
  assert.equal(out.moved, false);
  assert.match(out.reason, /update-ref/);
  assert.equal(git(f.repo, 'rev-parse', 'main'), merged, 'the commit that landed meanwhile stays');
});

test('#805 an input\'s old name counts in a local run\'s target, as it does for the run', async (t) => {
  const { service, api } = makeService(t);
  const file = 'fixture-target-was-805.yaml';
  fs.writeFileSync(path.join(service.workspace().workflows, file), WORKFLOW.replace('base_branch: { type: string, default: main }', 'base_branch: { type: string, default: no-such-branch, was: base }'));
  const f = fixture(t, 'canonical');
  originMoves(f);
  const answer = await api['run:start']({ file, inputs: { task: 'x', repo_path: f.repo, base: 'main' }, mock: true });
  assert.equal(answer.baseCheck?.behind, 2);
});

// A project on a clone behind origin, with one issue and a local workflow
async function behindProject(t) {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const file = 'fixture-target-805.yaml';
  fs.writeFileSync(path.join(ws.workflows, file), WORKFLOW);
  const f = fixture(t, 'canonical');
  const { id: projectId } = await api['projects:create']({ name: 'demo', folder: f.repo });
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, `${projectId}.json`), JSON.stringify({ projectId, platform: 'github', repo: 'https://github.com/o/r', issues: [roadmapIssue(1)] }));
  originMoves(f);
  return { api, f, file, projectId };
}
const dirty = (f) => fs.writeFileSync(path.join(f.repo, 'a.txt'), 'my edit\n');

test('#805 a person\'s Update that is refused is an error and starts nothing: run:start', async (t) => {
  const { api, f, file } = await behindProject(t);
  dirty(f);
  await assert.rejects(api['run:start']({ file, inputs: { task: 'x', repo_path: f.repo }, mock: true, baseChoice: 'update' }), /uncommitted changes/);
  assert.deepEqual(api['runs:active'](), []);
});

test('#805 a person\'s Update that is refused is an error and starts nothing: the Roadmap\'s Start', async (t) => {
  const { api, f, file, projectId } = await behindProject(t);
  await api['roadmap:save']({ projectId, stages: [{ items: [{ workflow: file, number: 1, mock: true, inputs: { repo_path: f.repo } }] }] });
  dirty(f);
  await assert.rejects(api['roadmap:start']({ projectId, simulated: true, baseChoice: 'update' }), /uncommitted changes/);
  assert.equal(api['roadmap:get']({ projectId }).state, 'planned');
  assert.deepEqual(api['runs:active'](), []);
});

test('#805 Run now of Assign asks about the base: the stage is planned, the answer names it and its Start goes on', async (t) => {
  const { api, f, file, projectId } = await behindProject(t);
  const answer = await api['backlog:assign']({ projectId, numbers: [1], workflow: file, inputs: { repo_path: f.repo }, mock: true, runNow: true });
  assert.equal(answer.baseCheck?.behind, 2);
  const stage = api['roadmap:get']({ projectId }).stages.find((s) => s.id === answer.stage);
  assert.equal(stage.items[0].runId ?? null, null, 'planned, not started');
  assert.deepEqual(answer.issues.map((i) => i.number), [1], 'the answer is the Backlog too');
  await api['roadmap:start']({ projectId, simulated: false, stage: answer.stage, baseChoice: 'continue' });
  await until(() => api['roadmap:get']({ projectId }).stages.find((s) => s.id === answer.stage).items[0].runId);
});

test('#805 a pipeline asks about its first stage\'s local base, and starts with the choice', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const file = 'fixture-target-805.yaml';
  fs.writeFileSync(path.join(ws.workflows, file), WORKFLOW);
  fs.mkdirSync(ws.pipelines, { recursive: true });
  fs.writeFileSync(path.join(ws.pipelines, 'fixture-805.yaml'), `name: fixture\nstages:\n  - workflow: ${file}\n  - workflow: ${file}\n`);
  const f = fixture(t, 'canonical');
  originMoves(f);
  const opts = { file: 'fixture-805.yaml', inputs: { task: 'x', repo_path: f.repo }, mock: true };
  const asked = await api['pipelines:run'](opts);
  assert.equal(asked.baseCheck?.behind, 2);
  assert.equal(asked.runId, undefined);
  const started = await api['pipelines:run']({ ...opts, baseChoice: 'continue' });
  assert.equal(typeof started.runId, 'string');
  await until(() => !api['runs:active']().length);
});

test('#805 a run that goes on from a base behind answers its baseCheck, for the screens that do not ask', async (t) => {
  const { api, f, file } = await behindProject(t);
  const answer = await api['run:start']({ file, inputs: { task: 'x', repo_path: f.repo }, mock: true, baseChoice: 'continue' });
  assert.equal(typeof answer.runId, 'string');
  assert.equal(answer.baseCheck?.behind, 2);
  await until(() => !api['runs:active']().length);
});
