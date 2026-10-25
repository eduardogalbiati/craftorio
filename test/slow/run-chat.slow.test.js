// Split by #306 (whole mock runs of a bundled workflow live in test/slow/, docs/agents/testing.md):
// the rest of this file's tests are in test/run-chat.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun } = require('@multiagent/engine/engine/workflow');
const { Recorder } = require('@multiagent/engine/engine/recorder');
const { runEvents } = require('@multiagent/engine/domains/run/runs');
const { RunChatModel, splitAnswer } = require('../../src/renderer/views/runchat/run-chat-model.js');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.05';

const root = path.join(__dirname, '..', '..');

// Runs a workflow in simulation and returns its events; gates get answers[step] (default: the
// first choice) with feedback[step].
// `onRecorded(runDir)`: the run is also written to disk as the app does (events.jsonl), then
// handed over before the folder is removed.
async function mockRun(file, { inputs = {}, mockSequences, answers = {}, feedback = {}, skillsDirs = [], onRecorded } = {}) {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  try {
    const run = new WorkflowRun({ file, inputs, mock: true, runsDir, skillsDirs, mockSequences });
    const recorder = onRecorded && new Recorder(run.runDir);
    const events = [];
    run.on('event', (ev) => {
      recorder?.write(ev);
      events.push(ev);
      if (ev.type === 'approval.requested') {
        const answer = ev.step_id in answers ? answers[ev.step_id] : ev.choices ? ev.choices[0].id : true;
        setImmediate(() => run.resolveApproval(ev.approval_id, answer, 'user', feedback[ev.step_id]));
      }
    });
    await run.start();
    // the recorder writes events.jsonl synchronously (#262): complete once the run has finished
    if (recorder) onRecorded(run.runDir);
    return events;
  } finally {
    fs.rmSync(runsDir, { recursive: true, force: true });
  }
}

function chatOf(events) {
  const model = new RunChatModel();
  for (const ev of events) model.apply(ev);
  return model;
}
const kinds = (model, kind) => model.items.filter((it) => it.kind === kind);

test('run chat: loops back show as loop lines, gates keep the chosen answer and the feedback', { timeout: 60000 }, async () => {
  const events = await mockRun(path.join(root, 'workflows', 'writer-reviewer.yaml'), {
    inputs: { prompt: 'A one-page PRD', goal: 'Every requirement is testable', max_rounds: 2 },
    mockSequences: { score: [4] }, answers: { out_of_rounds: 'stop' }, feedback: { out_of_rounds: 'Too vague, stop here.' },
  });
  const model = chatOf(events);

  assert.ok(kinds(model, 'system').some((s) => s.level === 'loop' && s.text.startsWith('↺ review → write')));
  const reviews = kinds(model, 'turn').filter((t) => t.stepId === 'review');
  assert.deepEqual(reviews.map((t) => t.visit), [1, 2]);
  // the reviewer answers with the step's JSON: shown as the structured answer, not as prose
  assert.ok(splitAnswer(reviews[0].text).json);

  const [gate] = kinds(model, 'gate');
  assert.equal(gate.stepId, 'out_of_rounds');
  assert.ok(gate.choices.some((c) => c.id === 'stop'));
  const stop = gate.choices.find((c) => c.id === 'stop');
  assert.deepEqual(gate.resolved, { choice: 'stop', label: stop.label, intent: null });
  const [reply] = kinds(model, 'reply');
  assert.deepEqual([reply.label, reply.feedback, reply.by], [stop.label, 'Too vague, stop here.', 'user']);
  assert.deepEqual(model.pendingGates(), []);
  assert.equal(kinds(model, 'end')[0].status, 'cancelled');
});

test('run chat: a replayed run shows the same tool calls and thinking as the live one', { timeout: 120000 }, async () => {
  let replay;
  const live = chatOf(await mockRun(path.join(root, 'workflows', 'software-development.yaml'), {
    inputs: { task: 'Add a /health endpoint', repo_path: root },
    onRecorded: (runDir) => { replay = chatOf(runEvents(runDir, { activity: true })); },
  }));
  const activity = (model) => kinds(model, 'turn').map((t) => [t.agent, t.stepId, t.activity]);
  assert.ok(kinds(live, 'turn').some((t) => t.activity.some((a) => a.kind === 'tool')), 'the simulated agents use tools');
  assert.ok(kinds(live, 'turn').some((t) => t.activity.some((a) => a.kind === 'thinking')), 'the simulated agents think');
  assert.deepEqual(activity(replay), activity(live));
});
