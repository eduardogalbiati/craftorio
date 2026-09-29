const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun } = require('../src/engine/workflow');
const { Recorder } = require('../src/engine/recorder');
const { runEvents } = require('../src/runs');
const { RunChatModel, splitAnswer, providerType } = require('../src/renderer/run-chat-model.js');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.05';
const root = path.join(__dirname, '..');

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
    if (recorder) {
      if (!recorder.events.writableFinished) await new Promise((r) => recorder.events.once('finish', r));
      onRecorded(run.runDir);
    }
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

const FANOUT = path.join(__dirname, 'fixtures', 'fanout.yaml');

test('run chat: a fan-out step groups its parallel answers, then the next agent answers on its own', { timeout: 30000 }, async (t) => {
  const skills = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-'));
  t.after(() => fs.rmSync(skills, { recursive: true, force: true }));
  fs.mkdirSync(path.join(skills, 'demo'));
  fs.writeFileSync(path.join(skills, 'demo', 'SKILL.md'), '---\nname: demo\ndescription: x\n---\nWrite well.\n');
  const model = chatOf(await mockRun(FANOUT, { skillsDirs: [skills] }));
  const [start] = kinds(model, 'start');
  assert.equal(start.workflow, 'fixture-fanout');
  assert.equal(start.mock, true);

  const [group] = kinds(model, 'group');
  assert.deepEqual([group.stepId, group.agents, group.done], ['compete', ['a', 'b'], true]);
  const turns = kinds(model, 'turn');
  const grouped = turns.filter((t) => t.parent === group.id);
  assert.deepEqual(grouped.map((t) => t.agent).sort(), ['a', 'b']);
  assert.deepEqual(grouped.map((t) => t.model).sort(), ['model-a', 'model-b']);
  const judge = turns.find((t) => t.agent === 'judge');
  assert.equal(judge.stepId, 'judge');
  assert.equal(judge.parent, undefined);
  assert.ok(judge.text.length > 0);

  assert.ok(kinds(model, 'system').some((s) => s.text === 'compete → judge'));
  assert.equal(kinds(model, 'end')[0].status, 'success');
  assert.equal(model.active.size, 0);
});

test('run chat: a fan-out whose agents all fail ends as a failed group, not a running one', { timeout: 30000 }, async () => {
  const model = chatOf(await mockRun(FANOUT, { inputs: { doc_skill: 'does-not-exist' } }));
  const [group] = kinds(model, 'group');
  assert.deepEqual([group.done, group.error], [true, true]);
  assert.equal(kinds(model, 'turn').length, 0);
  assert.ok(kinds(model, 'system').some((s) => s.level === 'error' && /Skill not found: "does-not-exist"/.test(s.text)));
  const [end] = kinds(model, 'end');
  assert.equal(end.status, 'failed');
  assert.match(end.error, /only 0\/2 agents responded/);
});

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
  assert.deepEqual(gate.resolved, { choice: 'stop', label: stop.label });
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

test('run chat: a gate still open when the run ends is closed, not answered', () => {
  const model = chatOf([
    { seq: 1, type: 'workflow.started', run_id: 'r1', workflow: 'wf', inputs: { task: 'Fix #3' }, ts: '2026-09-29T10:00:00Z' },
    { seq: 2, type: 'approval.requested', run_id: 'r1', approval_id: 'g1', step_id: 'human_review', message: 'Merge?' },
  ]);
  assert.equal(model.pendingGates().length, 1);
  assert.deepEqual(model.pendingGates()[0].choices.map((c) => c.id), [true, false]);
  model.apply({ seq: 3, type: 'workflow.finished', run_id: 'r1', status: 'cancelled', error: 'Stopped' });
  const [gate] = kinds(model, 'gate');
  assert.deepEqual([gate.resolved, gate.closed], [null, true]);
  assert.equal(kinds(model, 'reply').length, 0);
});

test('run chat: events seen twice (replay, then live) are applied once', () => {
  const model = new RunChatModel();
  const started = { seq: 1, type: 'workflow.started', run_id: 'r1', workflow: 'wf', inputs: {} };
  const log = { seq: 2, type: 'log', level: 'warn', message: 'Invalid output in review' };
  assert.equal(model.apply(started).length, 1);
  assert.equal(model.apply(log).length, 1);
  assert.deepEqual(model.apply(log), []);
  assert.deepEqual(model.apply(started), []);
  assert.equal(model.items.length, 2);
});

test('run chat: tool calls and thinking are kept with the turn and say what the agent is doing', () => {
  const model = chatOf([
    { seq: 1, type: 'workflow.started', run_id: 'r1', workflow: 'wf', inputs: {} },
    { seq: 2, type: 'session.opened', session_id: 's1', session: { agent: 'developer', provider: 'claude', model: 'claude-opus-5-5' } },
    { seq: 3, type: 'step.started', step_id: 'develop', visit: 1, agent: 'developer' },
    { seq: 4, type: 'session.message_sent', session_id: 's1', turn: 1, step_id: 'develop' },
    { seq: 5, type: 'session.stream', session_id: 's1', turn: 1, item: { kind: 'thinking', text: 'Read the ' } },
    { seq: 6, type: 'session.stream', session_id: 's1', turn: 1, item: { kind: 'thinking', text: 'tests first.' } },
    { seq: 7, type: 'session.stream', session_id: 's1', turn: 1, item: { kind: 'tool_call', name: 'Bash', input: { command: 'npm test' } } },
  ]);
  assert.deepEqual([...model.active.values()].map((a) => [a.agent, a.stepId, a.state]), [['developer', 'develop', 'reading']]);
  model.apply({ seq: 8, type: 'session.stream', session_id: 's1', turn: 1, item: { kind: 'tool_result', is_error: true, output: 'boom' } });
  model.apply({ seq: 9, type: 'session.message_received', session_id: 's1', turn: 1, step_id: 'develop', text: 'Done.', usage: { input: 1200, cache_read: 300, output: 80 }, cost_usd: 0.25, duration_ms: 4000 });
  const [turn] = kinds(model, 'turn');
  assert.deepEqual(turn.activity, [
    { kind: 'thinking', text: 'Read the tests first.' },
    { kind: 'tool', name: 'Bash', input: '{"command":"npm test"}', error: true },
  ]);
  assert.deepEqual([turn.tokensIn, turn.tokensOut, turn.cost], [1500, 80, 0.25]);
  assert.equal(model.active.size, 0);
  assert.equal(model.run.cost, 0.25);
});

test('run chat: the supervisor shows its decision, not its raw turn', () => {
  const model = chatOf([
    { seq: 1, type: 'workflow.started', run_id: 'r1', workflow: 'wf', inputs: {} },
    { seq: 2, type: 'session.opened', session_id: 'sup', session: { agent: '_supervisor', provider: 'claude', model: 'claude-opus-5-5' } },
    { seq: 3, type: 'supervisor.started', step_id: 'review', error: 'Invalid output' },
    { seq: 4, type: 'session.message_sent', session_id: 'sup', turn: 1, step_id: 'review:supervisor' },
    { seq: 5, type: 'session.message_received', session_id: 'sup', turn: 1, step_id: 'review:supervisor', text: '{"action":"retry"}' },
  ]);
  assert.equal(model.active.get('supervisor:review').state, 'reading');
  model.apply({ seq: 6, type: 'supervisor.decision', step_id: 'review', action: 'retry', explanation: 'The JSON was cut.', instruction: 'Answer again.' });
  assert.equal(kinds(model, 'turn').length, 0);
  const [d] = kinds(model, 'supervisor');
  assert.deepEqual([d.action, d.explanation, d.instruction], ['retry', 'The JSON was cut.', 'Answer again.']);
  assert.equal(model.active.size, 0);
});

test('splitAnswer separates the prose, the structured output and the decision log', () => {
  const text = 'Implemented it.\n\n```decisions\nimplement | a | b | c | ok\n```\n\n```json\n{"branch": "x"}\n```\n';
  assert.deepEqual(splitAnswer(text), { prose: 'Implemented it.', json: '{"branch": "x"}', decisions: 'implement | a | b | c | ok' });
  assert.deepEqual(splitAnswer('Just text with `json` inline'), { prose: 'Just text with `json` inline', json: null, decisions: null });
  // an unclosed block stays in the prose
  assert.equal(splitAnswer('Start\n```json\n{"a":1').json, null);
  assert.deepEqual(splitAnswer(''), { prose: '', json: null, decisions: null });
});

test('providerType maps workflow provider keys to the CLI types the robots use', () => {
  assert.deepEqual(['claude', 'codex', 'grok', 'codex-cli', 'engine', undefined].map((p) => providerType(p)), ['claude-code', 'codex-cli', 'grok-cli', 'codex-cli', 'engine', '']);
  // simulated sessions: the model tells which CLI the agent stands for
  assert.deepEqual(['claude-opus-5-5', 'gpt-6-luna', 'grok-4.7', 'model-a', ''].map((m) => providerType('mock', m)), ['claude-code', 'codex-cli', 'grok-cli', 'mock', 'mock']);
  assert.equal(providerType('codex', 'claude-opus-5-5'), 'codex-cli');
});
