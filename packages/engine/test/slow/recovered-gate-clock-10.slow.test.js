// #10 (acceptance tests, written before the code): whole simulated runs recovered at a human gate
// (#607, `recover: { runId, events, worktree }`) after a long wait, then answered by the owner. The
// clock is faked (node:test mock timers, Date only): the recovered run starts from its original
// workflow.started, so the gate clock it rebuilds from its events is what keeps the wait out of
// max_total_duration (#416).
//   - a run with 2h of work and 12h at its gate, recovered and answered, goes on to the gate's next step;
//   - a run whose work alone passed the limit is still stopped when its gate is answered;
//   - the release workflow (workflows/release.yaml) recovered at Ship the next morning ships when the
//     owner answers Ship (a simulation: the summary's release, nothing pushed).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { WorkflowRun } = require('../../engine/workflow');

process.env.CRAFTORIO_MOCK_DELAY_SCALE = '0.02';
const { tempWorkflow } = require('../engine-helpers');

const H = 3600e3;
const NIGHT = 12 * H; // the wait at the gate before the owner answers, across the app's restart
const T0 = Date.parse('2026-11-15T13:58:24Z');
const YAML = `apiVersion: craftorio/v1
kind: Workflow
metadata: { name: recovered-gate-clock-10 }
orchestrator:
  limits:
    max_total_duration: 8h
    max_total_cost_usd: 5
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: develop
    agent: a
    prompt: "do it"
  - id: test_failed
    type: human_approval
    message: "The tests failed. Continue?"
  - id: build
    agent: a
    prompt: "build it"
`;

// `workMs` of develop, then test_failed asked and left open (the app died while it waited)
function logAtGate(workMs) {
  const at = (ms) => new Date(T0 + ms).toISOString();
  return [
    { seq: 1, type: 'workflow.started', ts: at(0), mock: true },
    { seq: 2, type: 'step.started', ts: at(0), step_id: 'develop', visit: 1 },
    { seq: 3, type: 'step.finished', ts: at(workMs), step_id: 'develop', visit: 1, output: { text: 'done' } },
    { seq: 4, type: 'step.started', ts: at(workMs), step_id: 'test_failed', visit: 1 },
    { seq: 5, type: 'approval.requested', ts: at(workMs), approval_id: 'a1', step_id: 'test_failed', message: 'The tests failed. Continue?' },
  ];
}

// the run rebuilt from `events` at `now` (ms after T0); the owner answers each gate it asks (`answers`
// by step id, else true) as a person would (by 'user')
async function recoverAndAnswer(t, { file, events, now, inputs = {}, answers = {}, worktree = null }) {
  t.mock.timers.enable({ apis: ['Date'], now: T0 + now });
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-10-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true, maxRetries: 5 }));
  const run = new WorkflowRun({ file, inputs, mock: true, runsDir, recover: { runId: 'r10', events, worktree } });
  const emitted = [];
  run.on('event', (ev) => {
    emitted.push(ev);
    if (ev.type === 'approval.requested') {
      const answer = ev.step_id in answers ? answers[ev.step_id] : ev.choices?.[0]?.id ?? true;
      setImmediate(() => run.resolveApproval(ev.approval_id, answer, 'user', ''));
    }
  });
  await run.start();
  return { emitted, finished: emitted.find((e) => e.type === 'workflow.finished') };
}

test('#10 a run recovered after 2h of work and 12h at its gate goes on to the next step when the owner answers', { timeout: 60000 }, async (t) => {
  const { file } = tempWorkflow(t, YAML);
  const events = logAtGate(2 * H);
  const { emitted, finished } = await recoverAndAnswer(t, { file, events, now: 2 * H + NIGHT });
  // the log the run leaves, replayed (a later recovery), gives the same gate time as the live run
  const { gateClockFromEvents } = require('../../engine/run/resume');
  const replay = gateClockFromEvents([...events, ...emitted]);
  assert.equal(replay.since, null, 'no gate left open in the finished run\'s log');
  assert.equal(replay.total, NIGHT, 'replayed gate time');
  assert.deepEqual(replay.gateWaits, finished?.summary?.timing?.gates, 'replayed waits per gate = the summary\'s');
  assert.equal(emitted.some((e) => e.type === 'run.recovered' && e.step_id === 'test_failed'), true, 'recovered at the gate');
  assert.equal(emitted.some((e) => e.type === 'limit.exceeded'), false, 'no limit.exceeded after the answer');
  assert.equal(emitted.some((e) => e.type === 'step.started' && e.step_id === 'build'), true, 'build ran after the gate');
  assert.equal(finished?.status, 'success', finished?.error);
  // the summary's timing keeps the 12h waited before the recovery
  assert.ok(finished.summary.timing.gate_wait_ms >= NIGHT, `gate_wait_ms ${finished.summary.timing.gate_wait_ms}`);
});

test('#10 a recovered run whose work alone passed max_total_duration is still stopped at its gate', { timeout: 60000 }, async (t) => {
  const { file } = tempWorkflow(t, YAML);
  const { emitted, finished } = await recoverAndAnswer(t, { file, events: logAtGate(9 * H), now: 10 * H });
  const ev = emitted.find((e) => e.type === 'limit.exceeded');
  assert.equal(ev?.limit, 'max_total_duration');
  assert.equal(emitted.some((e) => e.type === 'step.started' && e.step_id === 'build'), false, 'build never ran');
  assert.notEqual(finished?.status, 'success');
});

// --- the release workflow, recovered at Ship -------------------------------------------------------

const RELEASE = path.join(__dirname, '..', '..', '..', '..', 'workflows', 'release.yaml');
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

function makeRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-10-repo-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  git(dir, 'init', '-q');
  fs.writeFileSync(path.join(dir, 'package.json'), '{ "name": "x", "scripts": { "test": "node --test" } }\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  return dir;
}

// a mock release run up to its Ship gate (2h of work: the clock moves on its first suite), returning
// the log as it stood when Ship opened; the run itself is then held (nothing ships)
async function releaseLogAtShip(t, repo) {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-10-runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true, maxRetries: 5 }));
  const inputs = { task: 'Release v1.5.0', repo_path: repo, project_path: repo, e2e_command: 'npm run test:e2e' };
  const run = new WorkflowRun({ file: RELEASE, inputs, mock: true, runsDir });
  const events = [];
  let atShip = null;
  let worked = false;
  run.on('event', (ev) => {
    events.push(structuredClone(ev));
    if (ev.type === 'step.started' && !worked) { worked = true; t.mock.timers.tick(2 * H); }
    if (ev.type !== 'approval.requested') return;
    if (ev.step_id === 'ship') atShip ??= events.map((e) => structuredClone(e));
    const answer = ev.step_id === 'ship' ? 'hold' : ev.choices?.[0]?.id ?? true;
    setImmediate(() => run.resolveApproval(ev.approval_id, answer, 'user', ''));
  });
  await run.start();
  assert.ok(atShip, `the release run reached Ship (steps: ${events.filter((e) => e.type === 'step.started').map((e) => e.step_id).join(', ')})`);
  t.mock.timers.reset();
  return { inputs, events: atShip };
}

test('#10 the release run stopped at Ship and recovered the next morning ships when the owner answers Ship', { timeout: 120000 }, async (t) => {
  const repo = makeRepo(t);
  const { inputs, events } = await releaseLogAtShip(t, repo);
  // Ship opened 2h after the start; the owner answers 12h later, after the app restarted
  const shipOpened = Date.parse(events.filter((e) => e.type === 'approval.requested' && e.step_id === 'ship').at(-1).ts) - T0;
  const { emitted, finished } = await recoverAndAnswer(t, { file: RELEASE, inputs, events, now: shipOpened + NIGHT, answers: { ship: 'ship' } });
  assert.equal(emitted.some((e) => e.type === 'run.recovered' && e.step_id === 'ship' && e.gate === true), true, 'recovered at Ship');
  assert.equal(emitted.some((e) => e.type === 'limit.exceeded'), false, 'answering Ship did not trip max_total_duration');
  assert.equal(finished?.status, 'success', finished?.error);
  assert.ok(finished.summary.release, 'the summary records the release (Ship ran: push, tag, history)');
  assert.ok(finished.summary.timing.gate_wait_ms >= NIGHT, `gate_wait_ms ${finished.summary.timing.gate_wait_ms}`);
});
