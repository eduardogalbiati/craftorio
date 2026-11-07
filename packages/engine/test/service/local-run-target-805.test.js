// #805, internals of the local base check the acceptance tests do not reach: which runs count as local
// (areas/local-push.js localRunTarget), the run's base checkout, and fastForwardBase's refusals.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { checkLocalBase, fastForwardBase, prepareBaseWorktree, prepareWorktree } = require('../../engine/worktree');
const { commit, fixture, git, logger } = require('../worktree-helpers');
const { makeService, until } = require('./helpers');

const WORKFLOW = `apiVersion: multiagent/v1
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
