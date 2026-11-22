// Git worktree per run, through the engine (orchestrator.worktree in packages/engine/engine/workflow.js): mock
// runs of test/fixtures/worktree.yaml in throwaway repositories. Split from test/worktree.test.js (#305).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { samePath, canonicalPath } = require('../../engine/worktree');
const { WorkflowRun } = require('../../engine/workflow');
const { Recorder } = require('../../engine/recorder');
const supervisor = require('../../domains/supervisor/supervisor');
const { fixture, git, spelled, SPELLINGS } = require('../worktree-helpers');

// ---- engine -----------------------------------------------------------------------
// answer: what every human gate gets (true/false, or a choice id)
// onEvent(ev, run): sees every event first; returning true leaves a gate unanswered
async function runFixture({ inputs, worktreesDir, runsDir, resume, file = 'worktree.yaml', answer = true, stopProcesses, onEvent }) {
  const run = new WorkflowRun({ file: path.join(__dirname, '..', 'fixtures', file), inputs, mock: true, runsDir, worktreesDir, resume, stopProcesses });
  const rec = new Recorder(run.runDir);
  const events = [];
  run.on('event', (ev) => {
    rec.write(ev);
    events.push(ev);
    if (onEvent && onEvent(ev, run)) return;
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, answer));
  });
  await run.start(); // the recorder writes events.jsonl synchronously (#262): complete here
  return { run, events, finished: events.find((e) => e.type === 'workflow.finished') };
}

for (const spelling of SPELLINGS) test(`engine (${spelling} paths): agents work in the run worktree; removed on success; on failure the folder goes and the branch stays, and a resume recreates the folder from it`, { timeout: 60000 }, async (t) => {
  const f = spelled(t, spelling);
  if (!f) return;
  const runsDir = path.join(f.tmp, 'runs');

  const ok = await runFixture({ inputs: { repo_path: f.repo }, worktreesDir: f.worktrees, runsDir });
  assert.equal(ok.finished.status, 'success', ok.finished.error);
  const dir = path.join(f.worktrees, ok.run.runId);
  const sent = ok.events.find((e) => e.type === 'session.message_sent');
  // worktree_dir is the worktree itself, spelled canonically (no doubled or climbing segments)
  assert.equal(/work in (.+)$/m.exec(sent.prompt)?.[1].trim(), canonicalPath(dir));
  assert.ok(samePath(ok.finished.summary.sessions.find((s) => s.agent === 'a').cwd, dir));
  assert.equal(ok.finished.summary.worktree.removed, true);
  assert.ok(!fs.existsSync(dir));

  const bad = await runFixture({ inputs: { repo_path: f.repo, skill: 'does-not-exist' }, worktreesDir: f.worktrees, runsDir });
  assert.equal(bad.finished.status, 'failed');
  const kept = path.join(f.worktrees, bad.run.runId);
  assert.ok(!fs.existsSync(kept), 'no worktree folder is kept for an ended run');
  assert.equal(bad.finished.summary.worktree.removed, true);
  assert.ok(!bad.events.some((e) => e.type === 'worktree.kept'));
  const gone = bad.events.find((e) => e.type === 'worktree.removed');
  assert.ok(gone?.branch, 'the detached worktree got a branch');
  assert.equal(bad.finished.summary.worktree.branch, gone.branch);
  git(f.repo, 'rev-parse', '--verify', `refs/heads/${gone.branch}`); // the branch is kept

  // resume: the folder is recreated from the run's branch and the new run continues there
  const spec = supervisor.resumeSpec(path.join(runsDir, bad.run.runId), 'work');
  assert.ok(samePath(spec.worktree.dir, kept));
  assert.equal(spec.worktree.branch, gone.branch);
  const resumed = await runFixture({
    inputs: { repo_path: f.repo }, worktreesDir: f.worktrees, runsDir,
    resume: { runId: spec.runId, fromStep: 'work', steps: spec.steps, sessions: spec.sessions, worktree: spec.worktree },
  });
  assert.equal(resumed.finished.status, 'success', resumed.finished.error);
  assert.equal(resumed.events.find((e) => e.type === 'worktree.ready').recreated, true);
  assert.ok(samePath(resumed.finished.summary.sessions.find((s) => s.agent === 'a').cwd, kept));
  assert.ok(!fs.existsSync(kept), 'removed once the resumed run succeeds');
});

// #202: cancelling a run (here at its human gate) removes its worktree folder and scratch; the
// uncommitted work is a WIP commit on the run's branch; Resume recreates the folder from that
// branch, tells the agent about the previous attempt's work, and the run goes on.
test('engine: a cancelled run leaves no worktree folder and no scratch, its branch has the WIP commit; Resume recreates the folder with that work and continues', { timeout: 60000 }, async (t) => {
  const f = fixture(t);
  const runsDir = path.join(f.tmp, 'runs');
  let workDir = null;
  const cancelled = await runFixture({
    file: 'gate-end.yaml', inputs: { repo_path: f.repo }, worktreesDir: f.worktrees, runsDir,
    onEvent: (ev, run) => {
      if (ev.type === 'worktree.ready') workDir = ev.work_dir || ev.dir;
      if (ev.type !== 'approval.requested') return false;
      // what the agent left uncommitted, and the scratch its checks used
      fs.writeFileSync(path.join(workDir, 'wip.txt'), 'work in progress\n');
      fs.mkdirSync(path.join(run.runDir, 'scratch', 'workspace'), { recursive: true });
      fs.writeFileSync(path.join(run.runDir, 'scratch', 'workspace', 'settings.json'), '{}');
      setImmediate(() => run.stop());
      return true;
    },
  });
  assert.equal(cancelled.finished.status, 'cancelled');
  const dir = path.join(f.worktrees, cancelled.run.runId);
  assert.ok(!fs.existsSync(dir), 'no worktree folder is kept');
  assert.ok(!fs.existsSync(path.join(cancelled.run.runDir, 'scratch')), 'the run\'s scratch is removed with it');
  const removed = cancelled.events.find((e) => e.type === 'worktree.removed');
  assert.ok(removed?.branch && removed.wip_commit, JSON.stringify(removed));
  assert.equal(git(f.repo, 'rev-parse', `refs/heads/${removed.branch}`), removed.wip_commit);
  const message = git(f.repo, 'log', '-1', '--format=%B', removed.wip_commit);
  assert.match(message, /WIP/);
  assert.ok(message.includes(cancelled.run.runId), `the message names the run: ${message}`);
  assert.equal(git(f.repo, 'show', `${removed.wip_commit}:wip.txt`), 'work in progress');
  assert.equal(cancelled.finished.summary.worktree.removed, true);

  const spec = supervisor.resumeSpec(cancelled.run.runDir, 'work');
  let atReady = null;
  const resumed = await runFixture({
    file: 'gate-end.yaml', inputs: { repo_path: f.repo }, worktreesDir: f.worktrees, runsDir, answer: true,
    resume: { runId: spec.runId, fromStep: 'work', steps: spec.steps, sessions: spec.sessions, worktree: spec.worktree },
    onEvent: (ev) => {
      if (ev.type === 'worktree.ready') {
        const wd = ev.work_dir || ev.dir;
        atReady = {
          recreated: ev.recreated, exists: fs.existsSync(wd),
          wip: fs.existsSync(path.join(wd, 'wip.txt')) ? fs.readFileSync(path.join(wd, 'wip.txt'), 'utf8') : null,
          branch: git(ev.dir, 'rev-parse', '--abbrev-ref', 'HEAD'),
        };
      }
      return false;
    },
  });
  assert.equal(resumed.finished.status, 'success', resumed.finished.error);
  assert.deepEqual(atReady, { recreated: true, exists: true, wip: 'work in progress\n', branch: removed.branch });
  const sent = resumed.events.find((e) => e.type === 'session.message_sent');
  assert.match(sent.prompt, /uncommitted work from the previous attempt/i);
  assert.ok(!fs.existsSync(dir), 'removed again once the resumed run succeeds');
});

// #120: an agent of a run with a worktree never writes a simulated run or a screenshot into the
// owner's own workspace: it gets CRAFTORIO_WORKSPACE pointing at a scratch workspace of its own,
// under the run's folder, created on the first agent turn and removed with the worktree.
test('engine: an agent of a run with a worktree gets CRAFTORIO_WORKSPACE in its environment, pointing at the run\'s own scratch workspace; removed once the worktree is removed', { timeout: 30000 }, async (t) => {
  const f = fixture(t);
  const runsDir = path.join(f.tmp, 'runs');
  // the "CLI" is node + a fake that calls no model: lift the simulation-only guard for this test
  const guard = process.env.CRAFTORIO_SIMULATION_ONLY;
  delete process.env.CRAFTORIO_SIMULATION_ONLY;
  t.after(() => { if (guard !== undefined) process.env.CRAFTORIO_SIMULATION_ONLY = guard; });
  const fake = path.join(__dirname, '..', 'fixtures', 'fake-claude.js').replace(/\\/g, '/');
  const file = path.join(f.tmp, 'wf.yaml');
  fs.writeFileSync(file, [
    'providers:',
    `  claude: { type: claude-code, command: node, args: ["${fake}", "-p"] }`,
    'inputs:',
    '  repo_path: { type: string, required: true }',
    'orchestrator:',
    '  worktree: { repo: "{{ inputs.repo_path }}", base: main }',
    'agents:',
    '  dev: { provider: claude, model: fake, session: handoff, capabilities: { tools: [read, bash:git] } }',
    'steps:',
    '  - { id: work, agent: dev, prompt: "Do it." }',
  ].join('\n'));
  const run = new WorkflowRun({ file, inputs: { repo_path: f.repo }, runsDir, worktreesDir: f.worktrees });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);

  const scratchWorkspaceDir = path.join(run.runDir, 'scratch', 'workspace');
  const received = events.find((e) => e.type === 'session.message_received');
  assert.ok(received.text.includes(`CRAFTORIO_WORKSPACE: ${scratchWorkspaceDir}`), received.text);
  // the scratch workspace goes with the worktree once the run succeeds (never left for the owner to find)
  assert.ok(!fs.existsSync(path.join(run.runDir, 'scratch')));
});

test('engine: `goto: end` + `status` sets the outcome; a rejected failure gate is failed, its worktree folder goes and its branch stays', { timeout: 60000 }, async (t) => {
  const f = fixture(t);
  const runsDir = path.join(f.tmp, 'runs');

  // approved: plain `goto: end` → success, worktree removed
  const ok = await runFixture({ file: 'gate-end.yaml', inputs: { repo_path: f.repo }, worktreesDir: f.worktrees, runsDir, answer: true });
  assert.equal(ok.finished.status, 'success', ok.finished.error);
  assert.equal(ok.finished.error, null);
  assert.equal(ok.finished.summary.status, 'success');
  assert.equal(ok.finished.summary.worktree.removed, true);
  assert.ok(!fs.existsSync(path.join(f.worktrees, ok.run.runId)));

  // rejected: `goto: end` + `status: failed` → failed; the branch keeps the work for a resume
  const bad = await runFixture({ file: 'gate-end.yaml', inputs: { repo_path: f.repo }, worktreesDir: f.worktrees, runsDir, answer: false });
  assert.equal(bad.finished.status, 'failed');
  assert.equal(bad.finished.summary.status, 'failed');
  assert.match(bad.finished.error, /ended as failed at step "work_failed" \(rejected\)/);
  const end = bad.events.find((e) => e.type === 'step.transition' && e.from === 'work_failed');
  assert.deepEqual([end.to, end.status], ['end', 'failed']);
  assert.equal(bad.finished.summary.worktree.removed, true);
  assert.ok(!bad.events.some((e) => e.type === 'worktree.kept'));
  assert.ok(!fs.existsSync(path.join(f.worktrees, bad.run.runId)));
  const gone = bad.events.find((e) => e.type === 'worktree.removed');
  git(f.repo, 'rev-parse', '--verify', `refs/heads/${gone.branch}`); // the branch is kept
  // summary.json and the runs list agree (the UI reads them)
  assert.equal(JSON.parse(fs.readFileSync(path.join(bad.run.runDir, 'summary.json'), 'utf8')).status, 'failed');
  const listed = require('../../domains/run/runs').readRun(runsDir, bad.run.runId);
  assert.equal(listed.status, 'failed');
  assert.match(listed.error, /work_failed/);
});

test('engine: processes left in the worktree are stopped after each agent step and before the worktree is removed', { timeout: 60000 }, async (t) => {
  const f = fixture(t);
  const runsDir = path.join(f.tmp, 'runs');
  const calls = [];
  // the process table is the boundary: this one has an electron.exe left by the `work` step
  const stopProcesses = async (dir) => {
    calls.push({ dir, removed: !fs.existsSync(dir) });
    return calls.length > 1 ? [] : [{ pid: 4242, exe: path.join(dir, 'node_modules', 'electron', 'dist', 'electron.exe'), reason: 'executable', stopped: true }];
  };
  const r = await runFixture({ file: 'gate-end.yaml', inputs: { repo_path: f.repo }, worktreesDir: f.worktrees, runsDir, answer: true, stopProcesses });
  assert.equal(r.finished.status, 'success', r.finished.error);
  const dir = path.join(f.worktrees, r.run.runId);
  // after the agent step `work` and at the end of the run; not after the human gate
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => samePath(c.dir, dir) && !c.removed), 'the worktree still exists when its processes are stopped');
  const ev = r.events.find((e) => e.type === 'worktree.processes_stopped');
  assert.equal(ev.after, 'step work');
  assert.deepEqual(ev.processes.map((p) => [p.pid, path.basename(p.exe), p.reason, p.stopped]), [[4242, 'electron.exe', 'executable', true]]);
  const warn = r.events.find((e) => e.type === 'log' && e.kind === 'worktree_processes');
  assert.match(warn.message, /stopped 1 process\(es\) left running .* after step work: electron\.exe \(pid 4242\)/);

  // a failing check only warns: the run goes on
  const failing = await runFixture({ inputs: { repo_path: f.repo }, worktreesDir: f.worktrees, runsDir, stopProcesses: async () => { throw new Error('no access'); } });
  assert.equal(failing.finished.status, 'success', failing.finished.error);
  assert.ok(failing.events.some((e) => e.type === 'log' && e.level === 'warn' && /could not check for processes left .*no access/.test(e.message)));
});

test('engine: processes left in the worktree are also stopped after a delegation', { timeout: 60000 }, async (t) => {
  const f = fixture(t);
  const runsDir = path.join(f.tmp, 'runs');
  const calls = [];
  // a process left running by the delegated agent (2nd call only): step build (visit 1) ->
  // delegation to dev -> step build (visit 2, exhausted, no delegate this time) -> run end
  const stopProcesses = async (dir) => {
    calls.push(dir);
    return calls.length === 2 ? [{ pid: 5555, exe: path.join(dir, 'node_modules', '.bin', 'watch'), reason: 'executable', stopped: true }] : [];
  };
  const r = await runFixture({ file: 'worktree-delegate.yaml', inputs: { repo_path: f.repo }, worktreesDir: f.worktrees, runsDir, stopProcesses });
  assert.equal(r.finished.status, 'success', r.finished.error);
  const dir = path.join(f.worktrees, r.run.runId);
  assert.equal(calls.length, 4);
  assert.ok(calls.every((c) => samePath(c, dir)));
  const ev = r.events.find((e) => e.type === 'worktree.processes_stopped');
  assert.equal(ev.after, 'build delegation to dev');
  assert.deepEqual(ev.processes.map((p) => [p.pid, p.reason, p.stopped]), [[5555, 'executable', true]]);
});

test('engine: without worktreesDir (simulation) or outside git, worktree_dir is the repository folder', { timeout: 30000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nogit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const runsDir = path.join(dir, 'runs');
  for (const worktreesDir of [null, path.join(dir, 'worktrees')]) {
    const r = await runFixture({ inputs: { repo_path: dir }, worktreesDir, runsDir });
    assert.equal(r.finished.status, 'success', r.finished.error);
    assert.ok(samePath(r.finished.summary.sessions.find((s) => s.agent === 'a').cwd, dir));
    assert.ok(!r.events.some((e) => e.type === 'worktree.ready'));
    assert.ok(!fs.existsSync(path.join(dir, 'worktrees')));
  }
});
