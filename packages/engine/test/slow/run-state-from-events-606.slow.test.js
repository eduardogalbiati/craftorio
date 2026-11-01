// #606 acceptance: a run's resume state is a pure function of its event log. Whole mock runs, each
// recorded like the app records it; runStateFromEvents over the recorded events.jsonl (and
// summary.json) must give the state the WorkflowRun held in memory. The seam is described in
// test/run-state-606.js; the hand-written logs are in test/run/run-state-from-events-606.test.js.
// This file: a small inline workflow (vars, a gate answered or left open by a pause) and the bundled
// workflows that need no repository; run-state-from-events-dev-606.slow.test.js has the ones that do.
process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { root, readLog, liveState, replayState, recordedRun } = require('../run-state-606');

const FIXTURE = `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: fixture-run-state-606
agents:
  dev: { provider: claude, model: m }
steps:
  - id: plan
    agent: dev
    prompt: "plan the work"
    transitions:
      - when: "true"
        set: { planned: "yes", round: "1" }
        goto: work
  - id: work
    agent: dev
    prompt: "do the work"
  - id: review
    type: human_approval
    message: "ok?"
`;

// `set:` values YAML reads as a number and a boolean, next to a string
const TYPED_SET = FIXTURE.replace('set: { planned: "yes", round: "1" }', 'set: { planned: "yes", round: 2, retry: true }');

function fixtureFile(t, text = FIXTURE) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-state-606-wf-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'fixture-run-state-606.yaml');
  fs.writeFileSync(file, text);
  return file;
}

const bundled = (name) => path.join(root, 'workflows', name);

// the replay of the run's log gives what the run held in memory
function assertReplayMatches(run) {
  const live = liveState(run);
  assert.deepEqual(replayState(run, live), live);
  return live;
}

test('a finished run: its log gives its visits, the vars its transitions set, no next step and no open gate', async (t) => {
  const run = await recordedRun(t, { file: fixtureFile(t) });
  const live = assertReplayMatches(run);
  assert.deepEqual(live.visits, { plan: 1, work: 1, review: 1 });
  assert.deepEqual(live.vars, { planned: 'yes', round: '1' });
  assert.equal(live.nextStep, null);
  assert.equal(live.openGate, null);
});

test('a run paused at its gate: its log gives the gate to ask again as the next step, the finished visits and the vars', async (t) => {
  const run = await recordedRun(t, { file: fixtureFile(t), pauseAt: 'review' });
  const live = assertReplayMatches(run);
  assert.equal(live.nextStep, 'review');
  assert.equal(live.openGate, 'review');
  assert.deepEqual(live.visits, { plan: 1, work: 1 });
  assert.deepEqual(live.vars, { planned: 'yes', round: '1' });
});

test('a `set:` of a number and a boolean is recorded on its transition as the run holds it in its vars', async (t) => {
  const run = await recordedRun(t, { file: fixtureFile(t, TYPED_SET) });
  const recorded = readLog(run.runDir).events.filter((ev) => ev.type === 'step.transition' && ev.set).map((ev) => ev.set);
  assert.deepEqual(recorded, [{ planned: 'yes', round: 2, retry: true }]);
  assert.deepEqual({ ...run.ctx.vars }, { planned: 'yes', round: 2, retry: true });
  assertReplayMatches(run);
});

test('run-retrospective: the replay of its mock run gives the in-memory state', async (t) => {
  // the run it looks back on: a finished run in the same runs folder
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-state-606-retro-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true, maxRetries: 5 }));
  const previous = '20261026-120000-aaaa0606';
  fs.mkdirSync(path.join(runsDir, previous));
  fs.writeFileSync(path.join(runsDir, previous, 'events.jsonl'), `${JSON.stringify({ seq: 1, type: 'workflow.started', workflow: 'writer-reviewer' })}\n`);
  const run = await recordedRun(t, { file: bundled('retrospective.yaml'), inputs: { run_id: previous }, options: { runsDir, skillsDirs: [] } });
  assertReplayMatches(run);
});

test('writer-reviewer: the replay of its mock run gives the in-memory state', async (t) => {
  const run = await recordedRun(t, { file: bundled('writer-reviewer.yaml'), inputs: { prompt: 'A one-page PRD', goal: 'Every requirement is testable' } });
  assertReplayMatches(run);
});

test('ai-arena: the replay of its mock run gives the in-memory state', async (t) => {
  const run = await recordedRun(t, {
    file: bundled('ai-arena.yaml'),
    inputs: { task: 'A PRD', contender_4_provider: 'none', peer_review: 'yes' },
    mockSequences: { verdict: ['issues', 'pass'] },
  });
  assertReplayMatches(run);
});

test('backlog-refresh: the replay of its mock run gives the in-memory state', async (t) => {
  const run = await recordedRun(t, { file: bundled('backlog-refresh.yaml'), inputs: { project_path: 'C:/proj', git_platform: 'gh' } });
  assertReplayMatches(run);
});

test('issue-tracker: the replay of its mock run gives the in-memory state', async (t) => {
  const run = await recordedRun(t, { file: bundled('issue-tracker.yaml'), inputs: { request: 'The run list should show the cost of each run', project_path: root } });
  assertReplayMatches(run);
});
