// Releases (#260), internal details the acceptance tests do not cover: the release history file and
// the next release (src/releases.js), a Ship that origin rejects or whose tag exists elsewhere, the
// cut line's state through an edit, a release run and a resume (src/roadmap.js), and the engine's
// `ship:` transition (where it is accepted; a simulation pushes nothing). Throwaway repositories in
// os.tmpdir() with a local bare origin, as in test/releases-260.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const releases = require('../src/releases');
const roadmaps = require('../src/roadmap');
const { WorkflowRun, loadWorkflow } = require('../src/engine/workflow');
process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';

// No user git config (identity, hooks, aliases), as on CI.
const emptyConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gitcfg-')), 'config');
fs.writeFileSync(emptyConfig, '');
process.env.GIT_CONFIG_GLOBAL = emptyConfig;
process.env.GIT_CONFIG_NOSYSTEM = '1';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

function tmp(t, prefix) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
}

function commit(cwd, file, text, msg = file) {
  fs.writeFileSync(path.join(cwd, file), text);
  git(cwd, 'add', file);
  git(cwd, 'commit', '-q', '-m', msg);
  return git(cwd, 'rev-parse', 'HEAD');
}

// origin (bare) + repo (main checked out) with one local commit not pushed
function fixture(t) {
  const dir = tmp(t, 'release-int-');
  const origin = path.join(dir, 'origin.git');
  const repo = path.join(dir, 'repo');
  git(dir, 'init', '-q', '--bare', origin);
  git(dir, 'clone', '-q', origin, repo);
  git(repo, 'checkout', '-q', '-b', 'main');
  commit(repo, 'a.txt', 'a\n', 'init');
  git(repo, 'push', '-q', '-u', 'origin', 'main');
  const local = commit(repo, 'b.txt', 'b\n', 'Add a /health endpoint (#12)');
  return { dir, origin, repo, local };
}
const originTags = (f) => git(f.origin, 'tag', '--list');

// ---- src/releases.js ------------------------------------------------------------------------------

test('tagName: a release name as a git tag (#260)', () => {
  assert.equal(releases.tagName('  v1.4  '), 'v1.4');
  assert.equal(releases.tagName('Sprint 12: beta'), 'Sprint-12-beta');
  assert.equal(releases.tagName('..'), '');
});

test('the release history: recorded releases, the next notes, the released issues (#260)', (t) => {
  const dir = tmp(t, 'release-hist-');
  assert.deepEqual(releases.readReleases(dir, 'p'), { releases: [], next: { notes: '' } });
  releases.saveNextNotes(dir, 'p', '  My notes  ');
  assert.equal(releases.readReleases(dir, 'p').next.notes, 'My notes');
  releases.recordRelease(dir, 'p', { version: 'v1', tag: 'v1', date: '2026-01-01T00:00:00Z', issues: [{ number: 12, title: 'A' }] });
  releases.recordRelease(dir, 'p', { version: 'v2', tag: 'v2', date: '2026-02-01T00:00:00Z', issues: [{ number: 12, title: 'A' }, { number: 14, title: 'C' }] });
  const h = releases.readReleases(dir, 'p');
  assert.deepEqual(h.releases.map((r) => [r.version, r.status]), [['v1', 'shipped'], ['v2', 'shipped']]);
  assert.equal(h.next.notes, '', 'a shipped release starts the next one with empty notes');
  assert.equal(releases.lastRelease(h).version, 'v2');
  assert.throws(() => releases.recordRelease(dir, 'p', { version: '  ' }), /no version/);
});

test('nextRelease: the runs merged locally since the last release, their issues and the commits not pushed (#260)', () => {
  const run = (runId, finishedAt, issues, over = {}) => ({ runId, workflow: 'local-hero', status: 'success', mock: false, startedAt: finishedAt, finishedAt, issues, localMerge: { base: 'main' }, costUsd: 1.25, ...over });
  const next = releases.nextRelease({
    history: { releases: [{ version: 'v1', date: '2026-01-10T00:00:00Z' }], next: { notes: '' } },
    runs: [
      run('old', '2026-01-09T00:00:00Z', [{ number: 1, title: 'Before the release' }]),
      run('r2', '2026-01-12T00:00:00Z', [{ number: 3, title: 'Third' }]),
      run('r1', '2026-01-11T00:00:00Z', [{ number: 2 }]),
      run('sim', '2026-01-12T00:00:00Z', [{ number: 5, title: 'Simulated' }], { mock: true }),
      run('unmerged', '2026-01-12T00:00:00Z', [{ number: 6, title: 'Not merged' }], { localMerge: null }),
    ],
    local: { commits: [{ sha: 'a' }, { sha: 'b' }, { sha: 'c' }], issues: [4, 3] },
    issues: [{ number: 2, title: 'Second' }, { number: 4, title: 'Fourth' }],
    version: 'v2',
  });
  assert.deepEqual(next.issues, [{ number: 2, title: 'Second' }, { number: 3, title: 'Third' }, { number: 4, title: 'Fourth' }]);
  assert.deepEqual(next.runs.map((r) => r.runId), ['r1', 'r2']);
  assert.equal(next.commits, 3);
  assert.equal(next.cost, 2.5);
  assert.equal(next.generated, true);
  assert.ok(next.notes.includes('v2') && next.notes.includes('#4 Fourth'));
  const edited = releases.nextRelease({ history: { releases: [], next: { notes: 'Mine' } } });
  assert.equal(edited.notes, 'Mine');
  assert.equal(edited.generated, false);
});

test('historyText names the issues, the runs with their folders and the commits (#260)', () => {
  const text = releases.historyText(
    { since: '2026-01-10T00:00:00Z', issues: [{ number: 2, title: 'Second' }], runs: [{ runId: 'r1', workflow: 'local-hero', title: 'Second' }] },
    { runsDir: path.join('ws', 'runs'), commits: [{ sha: '0123456789abcdef', subject: 'Fix it' }] },
  );
  assert.ok(text.includes('#2 Second'));
  assert.ok(text.includes(path.join('ws', 'runs', 'r1')));
  assert.ok(text.includes('01234567 Fix it'));
});

test('testResults reads the unit and E2E suite outputs of a release run (#260)', () => {
  const steps = { unit: { output: { kind: 'suite', status: 'pass', passed: 412, failed: 0 } }, e2e: { output: { kind: 'suite', status: 'fail' } }, ship: { output: { choice: 'ship' } } };
  assert.deepEqual(releases.testResults(steps), { unit: { status: 'pass', passed: 412, failed: 0 }, e2e: { status: 'fail' } });
  assert.deepEqual(releases.testResults({}), {});
});

test('shipRelease: a push origin rejects ships nothing and tags nothing (#260)', async (t) => {
  const f = fixture(t);
  // origin/main moved: another clone pushed a commit
  const other = path.join(f.dir, 'other');
  git(f.dir, 'clone', '-q', f.origin, other);
  commit(other, 'c.txt', 'c\n', 'elsewhere');
  git(other, 'push', '-q', 'origin', 'HEAD:main');
  const moved = git(f.origin, 'rev-parse', 'refs/heads/main');
  await assert.rejects(releases.shipRelease({ repo: f.repo, base: 'main', tag: 'v1.2.0' }), /update the local main/);
  assert.equal(git(f.origin, 'rev-parse', 'refs/heads/main'), moved, 'origin/main is untouched');
  assert.equal(originTags(f), '');
  assert.equal(git(f.repo, 'tag', '--list'), '');
});

test('shipRelease: a tag that exists at another commit is refused; shipping twice is safe (#260)', async (t) => {
  const f = fixture(t);
  git(f.repo, 'tag', 'v1', 'HEAD~1');
  await assert.rejects(releases.shipRelease({ repo: f.repo, base: 'main', tag: 'v1' }), /already names another commit/);
  assert.equal(originTags(f), '');
  assert.notEqual(git(f.origin, 'rev-parse', 'refs/heads/main'), f.local, 'a refused tag pushes nothing');
  // the local base is not the commit the release was checked on: nothing goes out either
  await assert.rejects(releases.shipRelease({ repo: f.repo, base: 'main', tag: 'v2', expect: git(f.repo, 'rev-parse', 'HEAD~1') }), /not at the commit the release was checked on/);
  assert.notEqual(git(f.origin, 'rev-parse', 'refs/heads/main'), f.local);
  const first = await releases.shipRelease({ repo: f.repo, base: 'main', tag: 'Sprint 12' });
  assert.equal(first.tag, 'Sprint-12');
  assert.equal(first.pushed, true);
  const again = await releases.shipRelease({ repo: f.repo, base: 'main', tag: 'Sprint 12' });
  assert.equal(again.pushed, false, 'nothing left to push');
  assert.equal(git(f.origin, 'rev-parse', 'refs/tags/Sprint-12^{commit}'), f.local);
  await assert.rejects(releases.shipRelease({ repo: f.repo, base: 'main', tag: '  ' }), /name or version/);
});

// ---- src/roadmap.js: the cut line's state -----------------------------------------------------------

const stageOf = (id, number, over = {}) => ({ id, name: '', items: [{ id: `i${number}`, workflow: 'a.yaml', number }], ...over });

test('an edit keeps the cut line\'s release state under the same name, never takes it from the edit, and a rename starts over (#260)', (t) => {
  const dir = tmp(t, 'roadmap-line-');
  const [s1] = roadmaps.saveStages(dir, 'p', [stageOf(null, 1, { release: { name: 'v1', status: 'shipped' } }), stageOf(null, 2)]).stages;
  assert.deepEqual(s1.release, { name: 'v1' }, 'an edit cannot mark a release shipped');
  roadmaps.setRelease(dir, 'p', s1.id, { status: 'running', runId: 'r9' });
  const kept = roadmaps.saveStages(dir, 'p', roadmaps.readRoadmap(dir, 'p').stages.map((s) => ({ ...s, release: s.release && { name: ' v1 ' } }))).stages[0];
  assert.deepEqual(kept.release, { name: 'v1', status: 'running', runId: 'r9' });
  const renamed = roadmaps.saveStages(dir, 'p', roadmaps.readRoadmap(dir, 'p').stages.map((s) => ({ ...s, release: s.release && { name: 'v2' } }))).stages[0];
  assert.deepEqual(renamed.release, { name: 'v2' });
  assert.equal(roadmaps.setRelease(dir, 'p', 'no-such-stage', { status: 'shipped' }), null);
});

test('a held release pauses a running roadmap at its line; a resumed release run takes the line and the roadmap waits again (#260)', (t) => {
  const dir = tmp(t, 'roadmap-line-');
  const [s1] = roadmaps.saveStages(dir, 'p', [stageOf(null, 1, { release: { name: 'v1' } }), stageOf(null, 2)]).stages;
  roadmaps.setState(dir, 'p', 'running');
  roadmaps.takeRelease(dir, 'p', s1.id, 'r1');
  const held = roadmaps.holdRelease(dir, 'p', s1.id, 'held', 'Release v1 was not shipped');
  assert.deepEqual(held.stages[0].release, { name: 'v1', status: 'held', runId: 'r1' });
  assert.deepEqual([held.state, held.error, held.releaseHold], ['paused', 'Release v1 was not shipped', s1.id]);
  const after = roadmaps.adoptResumed(dir, 'p', 'r1', 'r2');
  assert.deepEqual(after.stages[0].release, { name: 'v1', status: 'running', runId: 'r2' });
  assert.deepEqual([after.state, after.error, after.releaseHold], ['running', null, null]);
});

test('a pause of the owner\'s is not undone by a release run that takes the line (#260)', (t) => {
  const dir = tmp(t, 'roadmap-line-');
  const [s1] = roadmaps.saveStages(dir, 'p', [stageOf(null, 1, { release: { name: 'v1' } }), stageOf(null, 2)]).stages;
  roadmaps.setState(dir, 'p', 'running');
  roadmaps.takeRelease(dir, 'p', s1.id, 'r1');
  roadmaps.holdRelease(dir, 'p', s1.id, 'failed', 'Release v1 was not shipped');
  roadmaps.setState(dir, 'p', 'paused');
  const after = roadmaps.takeRelease(dir, 'p', s1.id, 'r2');
  assert.equal(after.state, 'paused');
  assert.equal(after.stages[0].release.runId, 'r2');
  // a held line of a roadmap that is not running only records the outcome
  roadmaps.setState(dir, 'p', 'planned');
  assert.equal(roadmaps.holdRelease(dir, 'p', s1.id, 'held', 'x').state, 'planned');
  assert.equal(roadmaps.takeRelease(dir, 'p', 'no-such-stage', 'r3'), null);
});

test('advance: a cut line after the last stage keeps the roadmap open; a stage run on its own ignores cut lines (#260)', () => {
  const item = (id, status) => ({ id, workflow: 'w.yaml', number: 1, issues: [{ number: 1 }], status, runId: null, runs: [], error: null });
  const base = { state: 'running', simulated: false, error: null, pausedBy: null, scope: null };
  const last = roadmaps.advance({ ...base, stages: [{ id: 's1', release: { name: 'v1' }, items: [item('i1', 'done')] }] }, { runOf: () => null });
  assert.deepEqual(last.release, { stage: 's1', name: 'v1' });
  assert.equal(last.roadmap.state, 'running');
  const scoped = roadmaps.advance({
    ...base, scope: { stage: 's2' },
    stages: [{ id: 's1', release: { name: 'v1' }, items: [item('i1', 'done')] }, { id: 's2', items: [item('i2', 'planned')] }],
  }, { runOf: () => null });
  assert.deepEqual(scoped.start.map((x) => x.id), ['i2']);
  assert.equal(scoped.release, undefined);
});

// ---- the engine's `ship:` transition ------------------------------------------------------------------

const SHIP_WORKFLOW = (gate) => `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: fixture-ship
inputs:
  repo_path: { type: string, required: true }
orchestrator:
  worktree: { repo: "{{ inputs.repo_path }}", base: main, remote: false }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
${gate}
`;
const GATE = (extra = '') => `  - id: ship
    type: human_approval${extra}
    message: "Ship?"
    choices:
      - { id: ship, label: Ship }
      - { id: hold, label: Hold }
    transitions:
      - when: "choice == 'ship'"
        ship: { tag: "v1" }
        goto: end
      - when: "choice == 'hold'"
        goto: end
        status: cancelled`;

function workflowFile(t, text) {
  const file = path.join(tmp(t, 'ship-wf-'), 'fixture-ship.yaml');
  fs.writeFileSync(file, text);
  return file;
}

test('loadWorkflow accepts ship: only on a human gate nobody else answers (#260)', (t) => {
  assert.ok(loadWorkflow(workflowFile(t, SHIP_WORKFLOW(GATE()))));
  assert.throws(() => loadWorkflow(workflowFile(t, SHIP_WORKFLOW(GATE('\n    kind: escalation')))), /ship belongs to a human gate/);
  assert.throws(() => loadWorkflow(workflowFile(t, SHIP_WORKFLOW(GATE('\n    timeout: 10m')))), /ship belongs to a human gate/);
  const agentStep = `  - id: work
    agent: a
    prompt: "do it"
    transitions:
      - when: "true"
        ship: { tag: "v1" }
        goto: end`;
  assert.throws(() => loadWorkflow(workflowFile(t, SHIP_WORKFLOW(agentStep))), /ship belongs to a human gate/);
  assert.throws(() => loadWorkflow(workflowFile(t, SHIP_WORKFLOW(GATE()).replace('ship: { tag: "v1" }', 'ship: {}'))), /ship needs a tag/);
});

test('release.yaml: its suites never wave a failure through as failing on the base too, and a project without an E2E suite skips it (#260)', () => {
  const wf = loadWorkflow(path.join(__dirname, '..', 'workflows', 'release.yaml'));
  const suites = wf.steps.filter((s) => s.type === 'suite');
  assert.deepEqual(suites.map((s) => [s.id, s.base_check]), [['unit', false], ['e2e', false]]);
  const skip = wf.steps[0].transitions.find((t) => /inputs\.e2e_suite == 'skip'/.test(t.when));
  assert.equal(skip.goto, 'ship');
  assert.ok(wf.steps[0].transitions.indexOf(skip) < wf.steps[0].transitions.findIndex((t) => t.goto === 'e2e'), 'checked before the transition to the E2E suite');
});

// shipGuard on a run built by hand (a real run cannot start in tests): who answered, and whether the
// local base moved since the worktree's commit.
test('shipGuard: only the owner\'s answer ships, and never a local base that moved since the suites ran (#260)', (t) => {
  const f = fixture(t);
  const run = new WorkflowRun({ file: workflowFile(t, SHIP_WORKFLOW(GATE())), inputs: { repo_path: f.repo }, mock: true, runsDir: tmp(t, 'ship-runs-') });
  const step = { id: 'ship' };
  run.shipGuard(step); // a simulation: nothing to guard
  run.mock = false;
  // the run's worktree: detached at the local main
  const wt = path.join(f.dir, 'wt');
  git(f.repo, 'worktree', 'add', '-q', '--detach', wt, 'main');
  run.worktree = { repo: f.repo, dir: wt, base: 'main' };
  for (const by of ['auto', 'supervisor', 'timeout', 'unknown', undefined]) {
    run.ctx.steps.ship = { answeredBy: by };
    assert.throws(() => run.shipGuard(step), (e) => e.fatal === true && /only the owner's own answer/.test(e.message), `answered by ${by}`);
  }
  run.ctx.steps.ship = { answeredBy: 'user' };
  run.shipGuard(step); // the base is the worktree's commit
  commit(wt, 'fix.txt', 'fix\n', 'a fix on the worktree');
  run.shipGuard(step); // the worktree is ahead of the base: its fix merges, then ships
  commit(f.repo, 'other.txt', 'x\n', 'another run merged');
  assert.throws(() => run.shipGuard(step), (e) => !e.fatal && /has commits this run did not check/.test(e.message));
});

test('a simulated Ship pushes nothing: the action is skipped and the summary says simulated (#260)', { timeout: 60000 }, async (t) => {
  const f = fixture(t);
  const pushedBefore = git(f.origin, 'rev-parse', 'refs/heads/main');
  const run = new WorkflowRun({ file: workflowFile(t, SHIP_WORKFLOW(GATE())), inputs: { repo_path: f.repo }, mock: true, runsDir: tmp(t, 'ship-runs-') });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, 'ship', 'user', ''));
  });
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success');
  assert.deepEqual(finished.summary.release, { tag: 'v1', simulated: true });
  const action = events.find((e) => e.type === 'action.executed');
  assert.equal(action.skipped, true);
  assert.equal(action.command, 'ship: v1');
  assert.equal(git(f.origin, 'rev-parse', 'refs/heads/main'), pushedBefore, 'origin/main has not moved');
  assert.equal(originTags(f), '');
});
