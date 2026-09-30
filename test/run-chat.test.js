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

test('RunChatModel#sideOf: alternates left, right, left… for each new agent and keeps it; the orchestrator and the supervisor have none', () => {
  const model = new RunChatModel();
  assert.equal(model.sideOf('developer'), 'left');
  assert.equal(model.sideOf('reviewer'), 'right');
  assert.equal(model.sideOf('developer'), 'left'); // still its first side, not re-alternated
  assert.equal(model.sideOf('tester'), 'left');
  assert.equal(model.sideOf('orchestrator'), null);
  assert.equal(model.sideOf('supervisor'), null);
  assert.equal(model.sideOf('_supervisor'), null);
  assert.equal(model.sideOf(''), null);
});

test('run chat: each agent gets a side the first time it speaks and keeps it all run; system lines use no side', () => {
  const model = chatOf([
    { seq: 1, type: 'workflow.started', run_id: 'r1', workflow: 'wf', inputs: {} },
    { seq: 2, type: 'session.opened', session_id: 's1', session: { agent: 'developer', provider: 'claude', model: 'claude-opus-5-5' } },
    { seq: 3, type: 'session.message_sent', session_id: 's1', turn: 1, step_id: 'develop' },
    { seq: 4, type: 'session.message_received', session_id: 's1', turn: 1, step_id: 'develop', text: 'Done 1' },
    { seq: 5, type: 'step.transition', from: 'develop', to: 'review' },
    { seq: 6, type: 'session.opened', session_id: 's2', session: { agent: 'reviewer', provider: 'claude', model: 'claude-opus-5-5' } },
    { seq: 7, type: 'session.message_sent', session_id: 's2', turn: 1, step_id: 'review' },
    { seq: 8, type: 'session.message_received', session_id: 's2', turn: 1, step_id: 'review', text: 'Done 2' },
    { seq: 9, type: 'step.transition', from: 'review', to: 'develop' },
    { seq: 10, type: 'session.message_sent', session_id: 's1', turn: 2, step_id: 'develop' },
    { seq: 11, type: 'session.message_received', session_id: 's1', turn: 2, step_id: 'develop', text: 'Done again' },
  ]);
  const turns = kinds(model, 'turn');
  assert.deepEqual(turns.map((t) => [t.agent, t.side]), [
    ['developer', 'left'],
    ['reviewer', 'right'],
    ['developer', 'left'], // same side on its second turn
  ]);
  assert.ok(kinds(model, 'system').every((s) => s.side === undefined));
});

test('run chat: a fan-out\'s agents get their side in the step\'s own order, whichever answers first', () => {
  const model = chatOf([
    { seq: 1, type: 'workflow.started', run_id: 'r1', workflow: 'wf', inputs: {} },
    { seq: 2, type: 'step.started', step_id: 'compete', visit: 1, agent: 'b · a' },
    { seq: 3, type: 'session.opened', session_id: 's-a', session: { agent: 'a', provider: 'mock', model: 'model-a' } },
    { seq: 4, type: 'session.opened', session_id: 's-b', session: { agent: 'b', provider: 'mock', model: 'model-b' } },
    // a answers before b, although the step declares b first
    { seq: 5, type: 'session.message_sent', session_id: 's-a', turn: 1, step_id: 'compete' },
    { seq: 6, type: 'session.message_received', session_id: 's-a', turn: 1, step_id: 'compete', text: 'A done' },
    { seq: 7, type: 'session.message_sent', session_id: 's-b', turn: 1, step_id: 'compete' },
    { seq: 8, type: 'session.message_received', session_id: 's-b', turn: 1, step_id: 'compete', text: 'B done' },
  ]);
  const turns = kinds(model, 'turn');
  assert.equal(turns.find((t) => t.agent === 'b').side, 'left');
  assert.equal(turns.find((t) => t.agent === 'a').side, 'right');
});

test('run chat: a human gate reply keeps its own style, with no side', () => {
  const model = chatOf([
    { seq: 1, type: 'workflow.started', run_id: 'r1', workflow: 'wf', inputs: {} },
    { seq: 2, type: 'approval.requested', approval_id: 'g1', step_id: 'approve_merge', message: 'Merge?' },
    { seq: 3, type: 'approval.resolved', approval_id: 'g1', choice: true, by: 'user' },
  ]);
  const [reply] = kinds(model, 'reply');
  assert.equal('side' in reply, false);
});

test('run chat: a run replayed from disk gets the same agent sides as the live run', { timeout: 30000 }, async (t) => {
  const skills = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-'));
  t.after(() => fs.rmSync(skills, { recursive: true, force: true }));
  fs.mkdirSync(path.join(skills, 'demo'));
  fs.writeFileSync(path.join(skills, 'demo', 'SKILL.md'), '---\nname: demo\ndescription: x\n---\nWrite well.\n');
  let replay;
  const live = chatOf(await mockRun(FANOUT, {
    skillsDirs: [skills], onRecorded: (runDir) => { replay = chatOf(runEvents(runDir, { activity: true })); },
  }));
  const sides = (model) => kinds(model, 'turn').map((t) => [t.agent, t.side]).sort();
  assert.deepEqual(sides(replay), sides(live));
  assert.ok(sides(live).length > 0);
});

test('run chat: a turn carries the hover card data recorded on the run (provider, model, effort, session mode)', () => {
  const model = chatOf([
    { seq: 1, type: 'workflow.started', run_id: 'r1', workflow: 'wf', inputs: {} },
    { seq: 2, type: 'session.opened', session_id: 's1', session: { agent: 'developer', provider: 'claude', model: 'claude-opus-5-5', effort: 'high', mode: 'persistent' } },
    { seq: 3, type: 'session.message_sent', session_id: 's1', turn: 1, step_id: 'develop' },
    { seq: 4, type: 'session.message_received', session_id: 's1', turn: 1, step_id: 'develop', text: 'Done.' },
  ]);
  const [turn] = kinds(model, 'turn');
  assert.deepEqual([turn.provider, turn.model, turn.effort, turn.mode], ['claude', 'claude-opus-5-5', 'high', 'persistent']);
});

test('run chat: a turn without a recorded effort or session mode carries null, not "undefined"', () => {
  const model = chatOf([
    { seq: 1, type: 'workflow.started', run_id: 'r1', workflow: 'wf', inputs: {} },
    { seq: 2, type: 'session.opened', session_id: 's1', session: { agent: 'developer', provider: 'claude', model: 'claude-opus-5-5' } },
    { seq: 3, type: 'session.message_sent', session_id: 's1', turn: 1, step_id: 'develop' },
    { seq: 4, type: 'session.message_received', session_id: 's1', turn: 1, step_id: 'develop', text: 'Done.' },
  ]);
  const [turn] = kinds(model, 'turn');
  assert.deepEqual([turn.effort, turn.mode], [null, null]);
});

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

test('run chat: a gate\'s Run locally / diff tools (local_preview, work_dir, diff_base) are kept on the gate item, none of them when the event has none', () => {
  const withTools = chatOf([
    { seq: 1, type: 'workflow.started', run_id: 'r1', workflow: 'wf', inputs: {} },
    {
      seq: 2, type: 'approval.requested', run_id: 'r1', approval_id: 'g1', step_id: 'developer_check', message: 'Try it',
      local_preview: { command: 'npm start' }, work_dir: 'C:\\work\\wt', diff_base: 'origin/main',
    },
  ]);
  const [gate] = kinds(withTools, 'gate');
  assert.deepEqual(gate.localPreview, { command: 'npm start' });
  assert.equal(gate.workDir, 'C:\\work\\wt');
  assert.equal(gate.diffBase, 'origin/main');

  const withoutTools = chatOf([
    { seq: 1, type: 'workflow.started', run_id: 'r1', workflow: 'wf', inputs: {} },
    { seq: 2, type: 'approval.requested', run_id: 'r1', approval_id: 'g2', step_id: 'human_review', message: 'Merge?' },
  ]);
  const [gate2] = kinds(withoutTools, 'gate');
  assert.deepEqual([gate2.localPreview, gate2.workDir, gate2.diffBase], [null, null, null]);
});

test('run chat: the run and its start message carry every issue; a run recorded with one `issue` shows a list of one', () => {
  const group = [{ number: 65, url: 'https://github.com/o/r/issues/65', title: 'Checkboxes' }, { number: 53, url: 'https://github.com/o/r/issues/53', title: 'Scrollbars' }];
  const grouped = chatOf([{ seq: 1, type: 'workflow.started', run_id: 'r1', workflow: 'wf', inputs: {}, issues: group }]);
  assert.deepEqual(grouped.run.issues, group);
  assert.deepEqual(kinds(grouped, 'start')[0].issues, group);

  const single = chatOf([{ seq: 1, type: 'workflow.started', run_id: 'r1', workflow: 'wf', inputs: {}, issue: group[0] }]);
  assert.deepEqual(single.run.issues, [group[0]]);
  assert.deepEqual(kinds(single, 'start')[0].issues, [group[0]]);

  const none = chatOf([{ seq: 1, type: 'workflow.started', run_id: 'r1', workflow: 'wf', inputs: {} }]);
  assert.deepEqual(none.run.issues, []);
});

test('run chat: the orchestrator\'s own checks (wait:) show as lines saying whether the agent is called', () => {
  const model = chatOf([
    { seq: 1, type: 'workflow.started', run_id: 'r1', workflow: 'wf', inputs: {} },
    { seq: 2, type: 'step.probe', run_id: 'r1', step_id: 'ci', probe: 'pr_checks', state: 'pending', detail: '2 of 3 checks still running', action: 'poll' },
    { seq: 3, type: 'step.probe', run_id: 'r1', step_id: 'ci', probe: 'pr_checks', state: 'failed', detail: 'checks failed: test', action: 'agent' },
  ]);
  const lines = kinds(model, 'system').map((it) => it.text).filter((x) => /Orchestrator check/.test(x));
  assert.deepEqual(lines, [
    'Orchestrator check (pr_checks) on ci: 2 of 3 checks still running · no agent turn',
    'Orchestrator check (pr_checks) on ci: checks failed: test · calling ci\'s agent',
  ]);
});

test('run chat: a `check:`/`precheck:` merge probe shows when it runs, not just poll/output/agent', () => {
  const model = chatOf([
    { seq: 1, type: 'workflow.started', run_id: 'r1', workflow: 'wf', inputs: {} },
    { seq: 2, type: 'step.probe', run_id: 'r1', step_id: 'approve_merge', probe: 'pr_mergeable', state: 'passed', detail: 'mergeable', action: 'check' },
    { seq: 3, type: 'step.probe', run_id: 'r1', step_id: 'approve_merge', probe: 'pr_mergeable', state: 'passed', detail: 'mergeable', action: 'precheck' },
  ]);
  const lines = kinds(model, 'system').map((it) => it.text).filter((x) => /Orchestrator check/.test(x));
  assert.deepEqual(lines, [
    'Orchestrator check (pr_mergeable) on approve_merge: mergeable · before asking for approval',
    'Orchestrator check (pr_mergeable) on approve_merge: mergeable · right before the merge',
  ]);
});

test('run chat: an approval withdrawn by the engine\'s check shows why, not as a human decision', () => {
  const model = chatOf([
    { seq: 1, type: 'workflow.started', run_id: 'r1', workflow: 'wf', inputs: {} },
    { seq: 2, type: 'approval.requested', approval_id: 'a1', step_id: 'approve_merge', message: 'Merge?', choices: null },
    { seq: 3, type: 'approval.resolved', approval_id: 'a1', withdrawn: true, by: 'check', reason: 'conflict: the PR now conflicts with main' },
  ]);
  const [gate] = kinds(model, 'gate');
  assert.deepEqual(gate.resolved, { choice: 'withdrawn', label: 'Withdrawn before anyone answered: conflict: the PR now conflicts with main' });
});

test('run chat: a supervisor recovery from a failed merge shows its record ("went back to..."), not the raw explanation', () => {
  const model = chatOf([
    { seq: 1, type: 'workflow.started', run_id: 'r1', workflow: 'wf', inputs: {} },
    { seq: 2, type: 'supervisor.started', step_id: 'approve_merge', kind: 'action_error', error: 'not mergeable' },
    {
      seq: 3, type: 'supervisor.decision', step_id: 'approve_merge', kind: 'action_error', action: 'goto', goto: 'resolve_conflict',
      explanation: 'the PR conflicts with main after another merge', record: 'went back to resolve_conflict at 00:10 UTC because the PR conflicts with main after another merge',
    },
  ]);
  const [d] = kinds(model, 'supervisor');
  assert.equal(d.explanation, 'went back to resolve_conflict at 00:10 UTC because the PR conflicts with main after another merge');
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

test('run chat: turns carry their handoff note and context; a max_context rotation shows as a line', { timeout: 60000 }, async () => {
  const events = await mockRun(path.join(__dirname, 'fixtures', 'handoff.yaml'), { mockSequences: { verdict: ['changes_requested', 'changes_requested', 'approved'] } });
  const model = chatOf(events);
  const turns = kinds(model, 'turn');
  assert.equal(turns.length, 6);
  assert.ok(turns.every((it) => /^- Goal: simulated goal/.test(it.handoff)));
  assert.ok(turns.every((it) => !it.text.includes('```handoff')));
  assert.deepEqual(turns.filter((it) => it.agent === 'reviewer').map((it) => [it.context.start, it.context.peak, it.fresh]), [[20000, 40000, true], [50000, 70000, false], [20000, 40000, true]]);
  assert.ok(kinds(model, 'system').some((it) => /\[reviewer\] context reached 70k/.test(it.text)));
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
