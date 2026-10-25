// #414: a run's temp folder (<run dir>/tmp), through the engine. An agent of a run with a worktree
// gets TMP, TEMP and TMPDIR pointing at it (and may write there: --add-dir); the folder goes when
// the run ends, whatever the end (success, failure, cancel), and stays while the run waits at a gate.
//
// Seams: WorkflowRun (src/engine/workflow.js) on throwaway repositories: a run whose "CLI" is
// test/fixtures/fake-claude.js (it answers with its arguments, its temp variables and whether the
// folder exists), and mock runs of test/fixtures/gate-end.yaml whose `tmp` is seeded the way a test
// of the run would fill it.
// Assumption: a mock run's agents start no process, so the end-of-run removal is checked on a `tmp`
// the test writes itself, at worktree.ready.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { samePath } = require('../../src/engine/worktree');
const { WorkflowRun } = require('../../src/engine/workflow');
const { Recorder } = require('../../src/engine/recorder');
const supervisor = require('../../src/domains/supervisor/supervisor');
const { fixture } = require('../worktree-helpers');

test('#414 engine: an agent of a run with a worktree gets TMP, TEMP and TMPDIR set to <run dir>/tmp, which exists during its turn and is one of its --add-dir folders; removed once the run succeeds', { timeout: 30000 }, async (t) => {
  const f = fixture(t);
  const runsDir = path.join(f.tmp, 'runs');
  // the "CLI" is node + a fake that calls no model: lift the simulation-only guard for this test
  const guard = process.env.MULTIAGENT_SIMULATION_ONLY;
  delete process.env.MULTIAGENT_SIMULATION_ONLY;
  t.after(() => { if (guard !== undefined) process.env.MULTIAGENT_SIMULATION_ONLY = guard; });
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

  const tmp = path.join(run.runDir, 'tmp');
  const text = events.find((e) => e.type === 'session.message_received').text;
  const value = (name) => new RegExp(`^${name}: (.*)$`, 'm').exec(text)?.[1].trim();
  for (const name of ['TMP', 'TEMP', 'TMPDIR']) {
    const v = value(name);
    assert.ok(v && v !== 'undefined' && samePath(v, tmp), `${name} is the run's tmp folder (${tmp}), got ${v}`);
  }
  assert.equal(value('TMP exists'), 'true', 'the folder exists while the agent runs');
  const args = JSON.parse(value('args'));
  const added = args.flatMap((a, i) => (a === '--add-dir' ? [args[i + 1]] : []));
  assert.ok(added.some((d) => samePath(d, tmp)), `--add-dir folders: ${JSON.stringify(added)}`);
  // the temp folder goes once the run ends (never left for the owner to find)
  assert.equal(fs.existsSync(tmp), false);
});

// gate-end.yaml: work, then a human gate; approved → success, rejected → failed, stopped → cancelled
async function gateRun(f, runsDir, { answer, stop = false }) {
  const run = new WorkflowRun({ file: path.join(__dirname, '..', 'fixtures', 'gate-end.yaml'), inputs: { repo_path: f.repo }, mock: true, runsDir, worktreesDir: f.worktrees });
  const rec = new Recorder(run.runDir);
  const events = [];
  let atGate = null;
  const tmp = path.join(run.runDir, 'tmp');
  run.on('event', (ev) => {
    rec.write(ev);
    events.push(ev);
    if (ev.type === 'worktree.ready') {
      // what a test of the run leaves in its temp folder
      fs.mkdirSync(path.join(tmp, 'service-ws-a1b2'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'service-ws-a1b2', 'settings.json'), '{}');
    }
    if (ev.type !== 'approval.requested') return;
    atGate = fs.existsSync(path.join(tmp, 'service-ws-a1b2', 'settings.json'));
    setImmediate(() => (stop ? run.stop() : run.resolveApproval(ev.approval_id, answer)));
  });
  await run.start();
  return { run, tmp, atGate, finished: events.find((e) => e.type === 'workflow.finished') };
}

test('#414 engine: a run\'s tmp stays while it waits at a gate and goes when it ends, whether it succeeds, fails or is cancelled', { timeout: 90000 }, async (t) => {
  const f = fixture(t);
  const runsDir = path.join(f.tmp, 'runs');
  for (const [end, opts] of [['success', { answer: true }], ['failed', { answer: false }], ['cancelled', { stop: true }]]) {
    const r = await gateRun(f, runsDir, opts);
    assert.equal(r.finished.status, end, r.finished.error);
    assert.equal(r.atGate, true, `${end}: the run keeps its tmp while it waits at the gate`);
    assert.equal(fs.existsSync(r.tmp), false, `${end}: the run's tmp is removed when it ends`);
  }
});

test('#414 engine: a run without a worktree loses its tmp when it ends too', { timeout: 30000 }, async (t) => {
  const f = fixture(t);
  const runsDir = path.join(f.tmp, 'runs');
  const file = path.join(f.tmp, 'no-worktree.yaml');
  fs.writeFileSync(file, [
    'agents:',
    '  a: { provider: claude, model: m, session: ephemeral }',
    'steps:',
    '  - { id: work, agent: a, prompt: "Do it." }',
  ].join('\n'));
  const run = new WorkflowRun({ file, inputs: {}, mock: true, runsDir });
  const tmp = path.join(run.runDir, 'tmp');
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type !== 'step.started') return;
    // what a suite of the run left in its temp folder
    fs.mkdirSync(path.join(tmp, 'gitcfg-x1y2'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'gitcfg-x1y2', 'config'), '');
  });
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(fs.existsSync(tmp), false, 'the run\'s tmp is removed when it ends');
});

test('#414 engine: a resumed run gets a fresh tmp of its own (its new run folder), and its agent\'s TMP points there, not at the earlier run\'s', { timeout: 60000 }, async (t) => {
  const f = fixture(t);
  const runsDir = path.join(f.tmp, 'runs');
  const guard = process.env.MULTIAGENT_SIMULATION_ONLY;
  delete process.env.MULTIAGENT_SIMULATION_ONLY;
  t.after(() => { if (guard !== undefined) process.env.MULTIAGENT_SIMULATION_ONLY = guard; });
  const fake = path.join(__dirname, '..', 'fixtures', 'fake-claude.js').replace(/\\/g, '/');
  const file = path.join(f.tmp, 'wf-gate.yaml');
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
    '  - { id: review, type: human_approval, message: "Approve?" }',
  ].join('\n'));
  const start = async (opts, onGate) => {
    const run = new WorkflowRun({ file, inputs: { repo_path: f.repo }, runsDir, worktreesDir: f.worktrees, ...opts });
    const rec = new Recorder(run.runDir);
    const events = [];
    run.on('event', (ev) => {
      rec.write(ev);
      events.push(ev);
      if (ev.type === 'approval.requested') setImmediate(() => onGate(run, ev));
    });
    await run.start();
    const text = events.find((e) => e.type === 'session.message_received')?.text || '';
    return { run, finished: events.find((e) => e.type === 'workflow.finished'), tmpVar: /^TMP: (.*)$/m.exec(text)?.[1].trim() };
  };

  // the first attempt is cancelled at its gate, with a test's leftovers in its tmp
  const first = await start({}, (run) => {
    fs.writeFileSync(path.join(run.runDir, 'tmp', 'leftover.txt'), 'x');
    run.stop();
  });
  assert.equal(first.finished.status, 'cancelled', first.finished.error);
  const spec = supervisor.resumeSpec(first.run.runDir, 'work');
  let resumedAtGate = null;
  const resumed = await start({ resume: { runId: spec.runId, fromStep: 'work', steps: spec.steps, sessions: spec.sessions, worktree: spec.worktree } }, (run, ev) => {
    resumedAtGate = fs.readdirSync(path.join(run.runDir, 'tmp'));
    run.resolveApproval(ev.approval_id, true);
  });
  assert.equal(resumed.finished.status, 'success', resumed.finished.error);
  assert.ok(!samePath(resumed.run.runDir, first.run.runDir), 'the resumed run has its own folder');
  const freshTmp = path.join(resumed.run.runDir, 'tmp');
  assert.ok(resumed.tmpVar && samePath(resumed.tmpVar, freshTmp), `the resumed agent's TMP is ${freshTmp}, got ${resumed.tmpVar}`);
  assert.deepEqual(resumedAtGate, [], 'nothing of the earlier attempt is in the resumed run\'s tmp');
  assert.equal(fs.existsSync(path.join(first.run.runDir, 'tmp')), false, 'the cancelled attempt\'s tmp is gone');
});
