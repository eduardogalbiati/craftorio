// #805 "A local run says when its base is behind origin before it starts": acceptance tests written before the
// code, through the service's channels, on a real clone with a bare origin (test/worktree-helpers.js).
//
// Contract (the seam these tests assume):
// - A LOCAL run = a workflow whose orchestrator.worktree renders `remote` to false and `fork` not true with the
//   run's inputs. baseCheck = { base, state, ahead, behind, canUpdate }, state one of equal | ahead | behind |
//   diverged | no-remote | fetch-failed; canUpdate true only for `behind`.
// - run:start takes `baseChoice: 'update' | 'continue'` and keeps `params: 'payload'`. For a local run, simulated or
//   real (the check is the service's: a simulated run has no worktree):
//   - no baseChoice, behind: answers { confirm, baseCheck }, starts no run; confirm matches /\b3 commits behind origin\/main/.
//   - no baseChoice, diverged: { confirm, baseCheck }, canUpdate false, confirm matches /Backlog/ and says the base
//     was not moved; the local base stays where it was.
//   - equal, ahead, no-remote: starts, no question. fetch-failed: starts, a `warn` log /could not fetch origin\/main/.
//   - 'continue': starts, base not moved, a `warn` log /\b3 commits behind origin\/main/.
//   - 'update': fast-forwards the local base first (the branch and, when checked out, the working tree), then starts;
//     the log has an event matching /fast-forward/i. Never a merge commit. Checked out nowhere: the ref moves. With
//     uncommitted changes to tracked files the base and the edit stay (the outcome, an error or a warned run, is the
//     developer's: these tests take either). On a diverged base the base is not moved (same freedom).
//   - remote or fork run: no question, no fetch (origin/main in the repository is not moved by a simulated run:start).
// - roadmap:start params are ['projectId', 'simulated', 'stage', 'baseChoice']. A next item of a local workflow, its
//   inputs as the item's run would get them, project run defaults included:
//   - behind/diverged, no baseChoice, no decision: { confirm, baseCheck }, the roadmap stays `planned`, no run starts.
//   - baseChoice: as run:start, the roadmap runs and the item's run log says it.
//   - project.runDefaults.base_behind ('update' | 'continue', set with projects:update): roadmap:start asks nothing
//     and applies it.
//   - Unattended (a dispatch that is not a person's start: a running roadmap's next item): never asks. A stated
//     decision is applied, no decision = 'continue'; a diverged base is never moved: warn matching /diverged/i.
//   - no-remote / failed fetch: starts as today (failed fetch: a warn in the item's log). Remote items: no question.
//
// The unattended dispatch here is the service's own: stage 1's run waits at a gate (the base is equal when the
// roadmap starts), origin moves, the gate is answered, and the end of that run dispatches stage 2 (areas/runs.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { commit, fixture, git } = require('../worktree-helpers');
const { makeService, roadmapIssue, until, watchRuns } = require('./helpers');

const FILE = 'fixture-base-805.yaml';
const GATED = 'fixture-base-gated-805.yaml';

const WORKFLOW = (name, steps) => `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: ${name}
inputs:
  task: { type: string, required: true }
  repo_path: { type: string, required: true }
  base_branch: { type: string, default: main }
  mode: { type: string, enum: [local, remote, fork], default: local }
orchestrator:
  worktree:
    repo: "{{ inputs.repo_path }}"
    base: "{{ inputs.base_branch }}"
    remote: "{{ inputs.mode != 'local' }}"
    fork: "{{ inputs.mode == 'fork' }}"
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: work
    agent: a
    prompt: "{{ inputs.task }}"
${steps}`;
const GATE_STEP = `  - id: review
    type: human_approval
    message: "Accept the work?"
`;

// A service with a project on a real clone. makeService first: its cleanup stops the runs before the clone goes.
// `canonical`: the folder's real path (a symlinked spelling is prepareWorktree's concern, not this issue's).
async function project(t, issues = [1]) {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, FILE), WORKFLOW('fixture-base-805', ''));
  fs.writeFileSync(path.join(ws.workflows, GATED), WORKFLOW('fixture-base-gated-805', GATE_STEP));
  const f = fixture(t, 'canonical');
  const p = await api['projects:create']({ name: 'demo', folder: f.repo });
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({ projectId: p.id, platform: 'github', repo: 'https://github.com/o/r', issues: issues.map(roadmapIssue) }));
  return { service, api, f, projectId: p.id };
}

// what makes the local base behind, ahead or diverged
function originMoves(f, count = 3) {
  for (let i = 0; i < count; i++) commit(f.other, `remote-${i}.txt`, `${i}\n`);
  git(f.other, 'push', '-q', 'origin', 'main');
  return git(f.other, 'rev-parse', 'HEAD');
}
const localCommit = (f) => commit(f.repo, 'local.txt', 'only here\n');
const mainOf = (f) => git(f.repo, 'rev-parse', 'refs/heads/main');
const originMainOf = (f) => git(f.repo, 'rev-parse', 'refs/remotes/origin/main');
const missingOrigin = (f) => git(f.repo, 'remote', 'set-url', 'origin', path.join(f.tmp, 'no-such-origin.git'));

const startRun = ({ api, f }, extra = {}, inputs = {}) => api['run:start']({ file: FILE, inputs: { task: 'Do it', repo_path: f.repo, ...inputs }, mock: true, ...extra });

// the run's log once it ended, as "level: message" lines
async function logOf(api, runId) {
  await until(() => !api['runs:active']().some((r) => r.runId === runId));
  return api['runs:events']({ runId }).filter((e) => e.type === 'log').map((e) => `${e.level}: ${e.message}`);
}
const warnings = (lines) => lines.filter((l) => l.startsWith('warn: '));
const hasLine = (lines, re) => lines.some((l) => re.test(l));

async function seedRoadmap(c, stages = [[FILE]]) {
  let number = 0;
  await c.api['roadmap:save']({
    projectId: c.projectId,
    stages: stages.map((files) => ({ items: files.map((workflow) => ({ workflow, number: (number += 1), mock: true })) })),
  });
}
const view = ({ api, projectId }) => api['roadmap:get']({ projectId });
const itemRun = (c, stage = 0) => view(c).stages[stage].items[0].runId ?? null;
const startRoadmap = (c, extra = {}) => c.api['roadmap:start']({ projectId: c.projectId, simulated: true, ...extra });
const decide = ({ api, projectId }, base_behind) => api['projects:update']({ id: projectId, patch: { runDefaults: { base_behind } } });

// A roadmap's item that started: its run's log, the answer's question never there
async function startedItem(c, answer) {
  assert.equal(answer?.confirm, undefined, `no question: ${answer?.confirm}`);
  const runId = itemRun(c);
  assert.equal(typeof runId, 'string', 'the item has a run');
  return logOf(c.api, runId);
}

// A running roadmap's next item: stage 1 waits at its gate on an equal base, `change` moves the repositories, the
// gate is answered, and the end of that run dispatches stage 2 with no person there
async function unattendedItem(c, change) {
  const { gates } = watchRuns(c.service);
  await seedRoadmap(c, [[GATED], [FILE]]);
  assert.equal((await startRoadmap(c))?.confirm, undefined, 'an equal base asks nothing');
  const first = itemRun(c);
  await until(() => gates.has(first));
  change();
  c.api['approval:resolve']({ runId: first, id: gates.get(first), answer: true });
  await until(() => !!itemRun(c, 1));
  return logOf(c.api, itemRun(c, 1));
}

// ---- run:start: the question -------------------------------------------------------------------------------

test('#805 run:start on a local base behind origin asks with the count and starts no run', async (t) => {
  const c = await project(t);
  const local = mainOf(c.f);
  originMoves(c.f);
  const answer = await startRun(c);
  assert.match(String(answer.confirm), /\b3 commits behind origin\/main/);
  assert.deepEqual(answer.baseCheck, { base: 'main', state: 'behind', ahead: 0, behind: 3, canUpdate: true });
  assert.equal(answer.runId, undefined);
  assert.equal(c.api['runs:active']().length, 0);
  assert.equal(mainOf(c.f), local);
});

test('#805 run:start on a diverged base asks without an update, names the Backlog and leaves the base where it was', async (t) => {
  const c = await project(t);
  const local = localCommit(c.f);
  originMoves(c.f);
  const answer = await startRun(c);
  assert.match(String(answer.confirm), /Backlog/);
  assert.match(String(answer.confirm), /not (been )?moved/i);
  assert.deepEqual(answer.baseCheck, { base: 'main', state: 'diverged', ahead: 1, behind: 3, canUpdate: false });
  assert.equal(answer.runId, undefined);
  assert.equal(c.api['runs:active']().length, 0);
  assert.equal(mainOf(c.f), local);
});

// ---- run:start: nothing to ask -----------------------------------------------------------------------------

for (const [what, prepare] of [
  ['equal to origin', () => {}],
  ['ahead of origin', localCommit],
  ['with no origin remote', (f) => git(f.repo, 'remote', 'remove', 'origin')],
]) {
  test(`#805 run:start on a local base ${what} starts without a question or a warning`, async (t) => {
    const c = await project(t);
    prepare(c.f);
    const answer = await startRun(c);
    assert.equal(answer.confirm, undefined);
    assert.equal(typeof answer.runId, 'string');
    assert.deepEqual(warnings(await logOf(c.api, answer.runId)), []);
  });
}

test('#805 run:start when the fetch fails starts, and the run\'s log warns it could not fetch', async (t) => {
  const c = await project(t);
  missingOrigin(c.f);
  const answer = await startRun(c);
  assert.equal(answer.confirm, undefined);
  assert.match(warnings(await logOf(c.api, answer.runId)).join('\n'), /could not fetch origin\/main/);
});

// ---- run:start: the choice ---------------------------------------------------------------------------------

test('#805 run:start with Continue starts from the base as it is, and the run\'s log warns with the count', async (t) => {
  const c = await project(t);
  const local = mainOf(c.f);
  originMoves(c.f);
  const answer = await startRun(c, { baseChoice: 'continue' });
  assert.equal(answer.confirm, undefined);
  assert.match(warnings(await logOf(c.api, answer.runId)).join('\n'), /\b3 commits behind origin\/main/);
  assert.equal(mainOf(c.f), local);
});

test('#805 run:start with Update fast-forwards the checked-out base and its files, with no merge commit, then starts', async (t) => {
  const c = await project(t);
  const tip = originMoves(c.f);
  const answer = await startRun(c, { baseChoice: 'update' });
  assert.equal(answer.confirm, undefined);
  assert.equal(hasLine(await logOf(c.api, answer.runId), /fast-forward/i), true);
  assert.equal(mainOf(c.f), tip);
  assert.equal(fs.existsSync(path.join(c.f.repo, 'remote-2.txt')), true, 'the working tree moved too');
  assert.equal(git(c.f.repo, 'rev-list', '--merges', 'main'), '');
  assert.equal(git(c.f.repo, 'rev-list', '--count', 'main'), '4');
});

test('#805 run:start with Update moves the ref of a base checked out nowhere and leaves the checkout on its branch', async (t) => {
  const c = await project(t);
  git(c.f.repo, 'switch', '-q', '-c', 'elsewhere');
  const tip = originMoves(c.f);
  const answer = await startRun(c, { baseChoice: 'update' });
  assert.equal(answer.confirm, undefined);
  await logOf(c.api, answer.runId);
  assert.equal(mainOf(c.f), tip);
  assert.equal(git(c.f.repo, 'symbolic-ref', '--short', 'HEAD'), 'elsewhere');
  assert.equal(fs.existsSync(path.join(c.f.repo, 'remote-2.txt')), false);
});

test('#805 run:start with Update on a checkout with uncommitted changes keeps the base and the edit', async (t) => {
  const c = await project(t);
  const local = mainOf(c.f);
  originMoves(c.f);
  fs.writeFileSync(path.join(c.f.repo, 'a.txt'), 'my edit\n');
  await startRun(c, { baseChoice: 'update' }).catch(() => null);
  assert.equal(mainOf(c.f), local);
  assert.equal(fs.readFileSync(path.join(c.f.repo, 'a.txt'), 'utf8'), 'my edit\n');
});

test('#805 run:start with Update on a diverged base does not move it', async (t) => {
  const c = await project(t);
  const local = localCommit(c.f);
  originMoves(c.f);
  await startRun(c, { baseChoice: 'update' }).catch(() => null);
  assert.equal(mainOf(c.f), local);
  assert.equal(git(c.f.repo, 'rev-list', '--merges', 'main'), '');
});

// ---- run:start: runs that are not local --------------------------------------------------------------------

for (const mode of ['remote', 'fork']) {
  test(`#805 unchanged: a ${mode} run on a base behind origin starts without a question and fetches nothing`, async (t) => {
    const c = await project(t);
    const known = originMainOf(c.f);
    originMoves(c.f);
    const answer = await startRun(c, {}, { mode });
    assert.equal(answer.confirm, undefined);
    assert.equal(typeof answer.runId, 'string');
    await logOf(c.api, answer.runId);
    assert.equal(originMainOf(c.f), known);
  });
}

// ---- roadmap:start: a person starts it ---------------------------------------------------------------------

test('#805 roadmap:start takes baseChoice as its last positional parameter', async (t) => {
  const { service } = makeService(t);
  assert.deepEqual(service.manifest.find((e) => e.channel === 'roadmap:start').params, ['projectId', 'simulated', 'stage', 'baseChoice']);
});

test('#805 roadmap:start on a base behind origin asks, the roadmap stays planned and no run starts', async (t) => {
  const c = await project(t);
  await seedRoadmap(c);
  originMoves(c.f);
  const answer = await startRoadmap(c);
  assert.match(String(answer?.confirm), /\b3 commits behind origin\/main/);
  assert.deepEqual(answer?.baseCheck, { base: 'main', state: 'behind', ahead: 0, behind: 3, canUpdate: true });
  assert.equal(view(c).state, 'planned');
  assert.equal(itemRun(c), null);
  assert.equal(c.api['runs:active']().length, 0);
});

test('#805 roadmap:start on a diverged base asks with no update, and the roadmap stays planned', async (t) => {
  const c = await project(t);
  await seedRoadmap(c);
  localCommit(c.f);
  originMoves(c.f);
  const answer = await startRoadmap(c);
  assert.match(String(answer?.confirm), /Backlog/);
  assert.equal(answer?.baseCheck?.canUpdate, false);
  assert.equal(view(c).state, 'planned');
  assert.equal(itemRun(c), null);
});

test('#805 roadmap:start with Continue runs the item from the base as it is, its log warning with the count', async (t) => {
  const c = await project(t);
  await seedRoadmap(c);
  const local = mainOf(c.f);
  originMoves(c.f);
  const lines = await startedItem(c, await startRoadmap(c, { baseChoice: 'continue' }));
  assert.match(warnings(lines).join('\n'), /\b3 commits behind origin\/main/);
  assert.equal(mainOf(c.f), local);
});

test('#805 roadmap:start with Update fast-forwards the base first, and the item\'s log says so', async (t) => {
  const c = await project(t);
  await seedRoadmap(c);
  const tip = originMoves(c.f);
  const lines = await startedItem(c, await startRoadmap(c, { baseChoice: 'update' }));
  assert.equal(hasLine(lines, /fast-forward/i), true);
  assert.equal(mainOf(c.f), tip);
});

test('#805 a project\'s stated decision "update": roadmap:start asks nothing and the base moves', async (t) => {
  const c = await project(t);
  await seedRoadmap(c);
  await decide(c, 'update');
  const tip = originMoves(c.f);
  const lines = await startedItem(c, await startRoadmap(c));
  assert.equal(hasLine(lines, /fast-forward/i), true);
  assert.equal(mainOf(c.f), tip);
});

test('#805 a project\'s stated decision "continue": roadmap:start asks nothing and the base stays, the item\'s log warning', async (t) => {
  const c = await project(t);
  await seedRoadmap(c);
  await decide(c, 'continue');
  const local = mainOf(c.f);
  originMoves(c.f);
  const lines = await startedItem(c, await startRoadmap(c));
  assert.match(warnings(lines).join('\n'), /\b3 commits behind origin\/main/);
  assert.equal(mainOf(c.f), local);
});

test('#805 a roadmap on a repository with no origin remote starts without a question', async (t) => {
  const c = await project(t);
  await seedRoadmap(c);
  git(c.f.repo, 'remote', 'remove', 'origin');
  assert.deepEqual(warnings(await startedItem(c, await startRoadmap(c))), []);
});

test('#805 a roadmap whose fetch fails starts, and the item\'s log warns it could not fetch', async (t) => {
  const c = await project(t);
  await seedRoadmap(c);
  missingOrigin(c.f);
  const lines = await startedItem(c, await startRoadmap(c));
  assert.match(warnings(lines).join('\n'), /could not fetch origin\/main/);
});

test('#805 unchanged: a roadmap of remote items (the project\'s run default) asks nothing and fetches nothing', async (t) => {
  const c = await project(t);
  await seedRoadmap(c);
  await c.api['projects:update']({ id: c.projectId, patch: { runDefaults: { mode: 'remote' } } });
  const known = originMainOf(c.f);
  originMoves(c.f);
  const answer = await startRoadmap(c);
  assert.equal(answer?.confirm, undefined);
  const runId = itemRun(c);
  await logOf(c.api, runId);
  assert.equal(c.api['runs:events']({ runId }).find((e) => e.type === 'workflow.started').inputs.mode, 'remote');
  assert.equal(originMainOf(c.f), known);
});

// ---- a running roadmap's next item: nobody to ask ----------------------------------------------------------

test('#805 unattended, no decision stated: the next item goes on from the base as it is and its log warns with the count', async (t) => {
  const c = await project(t, [1, 2]);
  const local = mainOf(c.f);
  const lines = await unattendedItem(c, () => originMoves(c.f));
  assert.match(warnings(lines).join('\n'), /\b3 commits behind origin\/main/);
  assert.equal(mainOf(c.f), local);
});

test('#805 unattended, decision "update": the next item starts from the base fast-forwarded', async (t) => {
  const c = await project(t, [1, 2]);
  await decide(c, 'update');
  let tip = null;
  const lines = await unattendedItem(c, () => { tip = originMoves(c.f); });
  assert.equal(hasLine(lines, /fast-forward/i), true);
  assert.equal(mainOf(c.f), tip);
});

test('#805 unattended, decision "update" on a diverged base: it is not moved and the item\'s log says it diverged', async (t) => {
  const c = await project(t, [1, 2]);
  await decide(c, 'update');
  let local = null;
  const lines = await unattendedItem(c, () => { local = localCommit(c.f); originMoves(c.f); });
  assert.match(warnings(lines).join('\n'), /diverged/i);
  assert.equal(mainOf(c.f), local);
});

// ---- the project's decision --------------------------------------------------------------------------------

test('#805 projects:update keeps base_behind in the project\'s run defaults', async (t) => {
  const c = await project(t);
  const updated = await decide(c, 'update');
  assert.equal(updated.runDefaults?.base_behind, 'update');
  const listed = (await c.api['projects:list']()).find((p) => p.id === c.projectId);
  assert.equal(listed.runDefaults?.base_behind, 'update');
});
