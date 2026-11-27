// #7: a resume never takes over the worktree of a run that is still running, and the processes the
// engine stops in a worktree never include another live run's. Mock runs of test/fixtures/gate-end.yaml
// in throwaway repositories (test/worktree-helpers.js); run A waits at its gate, still running, while
// run B resumes it. The process table is real: a detached node process stands for A's work (its
// command line names a path inside the worktree, and on Linux/macOS its cwd is the worktree), and B is
// given the engine's real stopProcessesIn, so a wrongly stopped process is really gone.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { samePath } = require('../../engine/worktree');
const { WorkflowRun } = require('../../engine/workflow');
const { Recorder } = require('../../engine/recorder');
const { stopProcessesIn } = require('../../engine/processes');
const supervisor = require('../../domains/supervisor/supervisor');
const { fixture } = require('../worktree-helpers');

const FILE = path.join(__dirname, '..', 'fixtures', 'gate-end.yaml');

function startRun({ runsDir, worktreesDir, inputs, resume, stopProcesses, holdGate = false, onEvent }) {
  const run = new WorkflowRun({ file: FILE, inputs, mock: true, runsDir, worktreesDir, resume, stopProcesses });
  const rec = new Recorder(run.runDir);
  const events = [];
  run.on('event', (ev) => {
    rec.write(ev);
    events.push(ev);
    if (onEvent) onEvent(ev, run);
    if (ev.type === 'approval.requested' && !holdGate) setImmediate(() => run.resolveApproval(ev.approval_id, true));
  });
  const done = run.start();
  return { run, events, done };
}

async function until(fn, ms = 30000) {
  const end = Date.now() + ms;
  while (!fn()) {
    assert.ok(Date.now() < end, 'timed out waiting');
    await new Promise((r) => setTimeout(r, 50));
  }
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

// A detached node process (not a child of this test: its launcher exits at once) whose command line
// names a path inside `dir` and whose cwd is `dir`. Killed after the test.
function processIn(t, dir) {
  const tools = fs.mkdtempSync(path.join(os.tmpdir(), 'live-run-7-'));
  t.after(() => fs.rmSync(tools, { recursive: true, force: true, maxRetries: 3 }));
  fs.writeFileSync(path.join(tools, 'hold.js'), 'setInterval(() => {}, 1000);\n');
  fs.writeFileSync(path.join(tools, 'launch.js'), [
    "const { spawn } = require('child_process');",
    "const path = require('path');",
    'const [dir] = process.argv.slice(2);',
    "const c = spawn(process.execPath, [path.join(__dirname, 'hold.js'), path.join(dir, 'in-progress.txt')], { cwd: dir, detached: true, stdio: 'ignore', windowsHide: true });",
    'c.unref();',
    'process.stdout.write(String(c.pid));',
    '',
  ].join('\n'));
  const out = spawnSync(process.execPath, [path.join(tools, 'launch.js'), dir], { encoding: 'utf8' });
  const pid = Number(out.stdout);
  assert.ok(Number.isInteger(pid) && pid > 0, `launched a process in the worktree: ${out.stderr}`);
  t.after(() => { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } });
  return pid;
}

const ownerRecord = (pid) => ({ pid, host: os.hostname(), started_at: new Date().toISOString(), heartbeat_at: new Date().toISOString() });

// Run A: a real run, its worktree prepared by the engine, left waiting at its gate (still running).
async function runningRunA(t, f, runsDir) {
  const a = startRun({ runsDir, worktreesDir: f.worktrees, inputs: { repo_path: f.repo }, holdGate: true });
  t.after(async () => { try { a.run.stop(); } catch { /* ended */ } await a.done.catch(() => {}); });
  await until(() => a.events.some((e) => e.type === 'approval.requested'));
  const dir = a.events.find((e) => e.type === 'worktree.ready').dir;
  assert.ok(fs.existsSync(dir), "A's worktree exists");
  return { ...a, dir };
}

function resumeOf(runsDir, runA) {
  const spec = supervisor.resumeSpec(path.join(runsDir, runA.run.runId), 'work');
  assert.ok(samePath(spec.worktree.dir, runA.dir), "the resume spec points at A's worktree");
  return { runId: spec.runId, fromStep: 'work', steps: spec.steps, sessions: spec.sessions, worktree: spec.worktree };
}

test('a resume of a run whose owner is alive does not reuse its worktree and stops none of its processes', { timeout: 90000 }, async (t) => {
  const f = fixture(t);
  const runsDir = path.join(f.tmp, 'runs');
  const a = await runningRunA(t, f, runsDir);
  // A is owned by another live process on this machine (the terminal that started it)
  const worker = processIn(t, a.dir);
  fs.writeFileSync(path.join(a.run.runDir, 'owner.json'), JSON.stringify(ownerRecord(worker)));

  const stopped = [];
  const stopProcesses = async (dir, o) => { stopped.push(dir); return stopProcessesIn(dir, o); };
  const b = startRun({ runsDir, worktreesDir: f.worktrees, inputs: { repo_path: f.repo }, resume: resumeOf(runsDir, a), stopProcesses });
  await b.done;

  const finished = b.events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished === undefined, false, 'B ended');
  const reused = b.events.filter((e) => e.type === 'worktree.ready' && samePath(e.dir, a.dir));
  assert.equal(reused.length, 0, `B did not take over A's worktree (B: ${finished.status} ${finished.error || ''})`);
  assert.equal(stopped.filter((d) => samePath(d, a.dir)).length, 0, "B never stopped processes in A's worktree");
  assert.equal(b.events.filter((e) => e.type === 'worktree.processes_stopped' && samePath(e.dir, a.dir)).length, 0);
  assert.equal(alive(worker), true, "A's process is still running");
  assert.ok(fs.existsSync(a.dir), "A's worktree is still there");
});

test('with no owner file, a resume checks the worktree for live processes and leaves them running instead of reusing it', { timeout: 90000 }, async (t) => {
  const f = fixture(t);
  const runsDir = path.join(f.tmp, 'runs');
  const a = await runningRunA(t, f, runsDir);
  // A was started by a runner that left no owner.json (the bug of #7): only its live process tells
  fs.rmSync(path.join(a.run.runDir, 'owner.json'), { force: true });
  const worker = processIn(t, a.dir);

  const b = startRun({ runsDir, worktreesDir: f.worktrees, inputs: { repo_path: f.repo }, resume: resumeOf(runsDir, a), stopProcesses: stopProcessesIn });
  await b.done;

  const finished = b.events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished === undefined, false, 'B ended');
  assert.equal(alive(worker), true, `the live process in A's worktree was not stopped (B: ${finished.status} ${finished.error || ''})`);
  assert.equal(b.events.filter((e) => e.type === 'worktree.processes_stopped' && samePath(e.dir, a.dir)).length, 0);
  const reused = b.events.filter((e) => e.type === 'worktree.ready' && samePath(e.dir, a.dir));
  assert.equal(reused.length, 0, "B did not reuse a worktree with live processes in it");
});

test("the processes stopped after a step never include another live run's process", { timeout: 90000 }, async (t) => {
  const f = fixture(t);
  const runsDir = path.join(f.tmp, 'runs');
  let other = null;
  // a process working in B's worktree that is the owner of another live run (C)
  const onEvent = (ev) => {
    if (ev.type !== 'worktree.ready' || other) return;
    other = processIn(t, ev.dir);
    const cDir = path.join(runsDir, '20261122-150206-cccccccc');
    fs.mkdirSync(cDir, { recursive: true });
    fs.writeFileSync(path.join(cDir, 'events.jsonl'), JSON.stringify({ ts: new Date().toISOString(), type: 'workflow.started', workflow: 'fixture' }) + '\n');
    fs.writeFileSync(path.join(cDir, 'owner.json'), JSON.stringify(ownerRecord(other)));
  };
  const b = startRun({ runsDir, worktreesDir: f.worktrees, inputs: { repo_path: f.repo }, stopProcesses: stopProcessesIn, onEvent });
  await b.done;

  assert.equal(Number.isInteger(other), true, 'the other run\'s process was started in B\'s worktree');
  assert.equal(alive(other), true, "the other live run's process is still running");
  const listed = b.events.filter((e) => e.type === 'worktree.processes_stopped').flatMap((e) => e.processes.filter((p) => p.stopped).map((p) => p.pid));
  assert.equal(listed.includes(other), false, "worktree.processes_stopped does not report the other run's process as stopped");
});
