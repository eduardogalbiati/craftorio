// Run progress by step groups: the step trail rebuilt from run events, the chips of the runs
// list, the trail read from a run folder and written by the engine into summary.json.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { StepTrail, trailOf, progressGroups, hydrationEvents } = require('../src/renderer/run-progress-model');
const runs = require('../src/runs');
const { WorkflowRun } = require('../src/engine/workflow');
const { Recorder } = require('../src/engine/recorder');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.05';

let seq = 0;
const ev = (type, data = {}) => ({ seq: ++seq, ts: `2026-09-29T10:00:${String(seq % 60).padStart(2, '0')}Z`, type, ...data });
const opened = (id, agent, provider, model) => ev('session.opened', { session_id: id, session: { agent, provider, model } });
const turn = (id, step, cost = 0.1, duration = 1000) => [
  ev('session.message_sent', { session_id: id, step_id: step, turn: 1 }),
  ev('session.message_received', { session_id: id, step_id: step, turn: 1, cost_usd: cost, duration_ms: duration }),
];
const started = (step, visit, agent, type = 'agent') => ev('step.started', { step_id: step, visit, agent, step_type: type });
const finished = (step, extra = {}) => ev('step.finished', { step_id: step, duration_ms: 2000, ...extra });

const GROUPS = [
  { name: 'Develop', steps: ['develop'] },
  { name: 'Review', steps: ['code_review', 'human_review'] },
  { name: 'Validate', steps: ['test', 'build'] },
  { name: 'Deploy', steps: ['deploy'] },
];

// develop → code_review → develop (fix) → code_review → human_review (waiting)
function devRun() {
  return [
    ev('workflow.started', { workflow: 'software-development' }),
    opened('orchestrator', 'orchestrator', 'engine', 'engine'),
    opened('s1', 'developer', 'claude', 'claude-opus-5-5'),
    opened('s2', 'reviewer', 'codex', 'gpt-6'),
    started('develop', 1, 'developer'), ...turn('s1', 'develop', 0.5), finished('develop'),
    started('code_review', 1, 'reviewer'), ...turn('s2', 'code_review', 0.25), finished('code_review'),
    started('develop', 2, 'developer'), ...turn('s1', 'develop', 0.5), finished('develop'),
    started('code_review', 2, 'reviewer'), ...turn('s2', 'code_review', 0.25), finished('code_review'),
    started('human_review', 1, null, 'human_approval'),
    ev('approval.requested', { approval_id: 'a1', step_id: 'human_review' }),
  ];
}

test('the trail lists each step visit with its agents, provider, model and cost', () => {
  const steps = trailOf(devRun());
  assert.deepEqual(steps.map((s) => `${s.step}#${s.visit}:${s.status}`), [
    'develop#1:done', 'code_review#1:done', 'develop#2:done', 'code_review#2:done', 'human_review#1:waiting',
  ]);
  assert.deepEqual(steps[0].agents, [{ agent: 'developer', provider: 'claude', model: 'claude-opus-5-5', cost: 0.5, durationMs: 1000 }]);
  assert.equal(steps[0].durationMs, 2000);
  assert.deepEqual(steps[4].agents, []); // a human gate has no agent
});

test('the trail ignores events it already applied and the supervisor turns', () => {
  const t = new StepTrail();
  const events = [opened('s1', 'developer', 'claude', 'claude-opus-5-5'), started('develop', 1, 'developer'), ...turn('s1', 'develop:supervisor', 3)];
  for (const e of [...events, ...events]) t.apply(e);
  assert.equal(t.steps.length, 1);
  assert.equal(t.steps[0].cost, 0);
});

test('only the visited groups show, in order, a return to a group counted', () => {
  const chips = progressGroups(trailOf(devRun()), GROUPS, 'running');
  assert.deepEqual(chips.map((c) => [c.name, c.round, c.status]), [
    ['Develop', 1, 'done'], ['Review', 1, 'done'], ['Develop', 2, 'done'], ['Review', 2, 'waiting'],
  ]);
  // code_review then human_review stay in one chip, with the reviewer and the person
  const last = chips[3];
  assert.deepEqual(last.steps.map((s) => s.step), ['code_review', 'human_review']);
  assert.deepEqual(last.agents.map((a) => [a.agent, !!a.human]), [['reviewer', false], ['You', true]]);
  assert.equal(last.current, 'human_review');
  assert.equal(chips[0].agents[0].model, 'claude-opus-5-5');
});

test('the last group shows the running step, then how the run ended', () => {
  const events = [...devRun(), ev('approval.resolved', { approval_id: 'a1', choice: 'true' }), finished('human_review'),
    opened('s3', 'tester', 'grok', 'grok-5'), started('test', 1, 'tester'), ev('session.message_sent', { session_id: 's3', step_id: 'test', turn: 1 })];
  const running = progressGroups(trailOf(events), GROUPS, 'running').at(-1);
  assert.deepEqual([running.name, running.status, running.current], ['Validate', 'running', 'test']);
  assert.deepEqual(running.agents.map((a) => [a.agent, a.provider, a.model]), [['tester', 'grok', 'grok-5']]);

  const failed = [...events, finished('test', { error: true }), ev('workflow.finished', { status: 'failed' })];
  assert.deepEqual(progressGroups(trailOf(failed), GROUPS, 'failed').at(-1).status, 'failed');
  // stopped by the user in the middle of a step
  const cancelled = [...events, ev('workflow.finished', { status: 'cancelled' })];
  assert.equal(progressGroups(trailOf(cancelled), GROUPS, 'cancelled').at(-1).status, 'stopped');
  // the app closed during the run: interrupted
  assert.equal(progressGroups(trailOf(events), GROUPS, 'interrupted').at(-1).status, 'stopped');
  const ok = [...events, ev('session.message_received', { session_id: 's3', step_id: 'test', turn: 1 }), finished('test'), ev('workflow.finished', { status: 'success' })];
  assert.deepEqual(progressGroups(trailOf(ok), GROUPS, 'success').map((c) => c.status), ['done', 'done', 'done', 'done', 'done']);
});

test('a fan-out step shows every agent that worked in it', () => {
  const events = [
    opened('a', 'opus', 'claude', 'claude-opus-5-5'), opened('b', 'gpt', 'codex', 'gpt-6'),
    started('compete', 1, 'opus · gpt'), ...turn('a', 'compete:opus', 1), ...turn('b', 'compete:gpt', 2), finished('compete'),
  ];
  const [chip] = progressGroups(trailOf(events), [{ name: 'Proposals', steps: ['compete'] }], 'success');
  assert.deepEqual(chip.agents.map((a) => [a.agent, a.provider, a.cost]), [['opus', 'claude', 1], ['gpt', 'codex', 2]]);
  assert.equal(chip.cost, 3);
});

test('without groups each visited step is a chip of its own, a step looping on itself kept in one', () => {
  const events = [
    opened('w', 'writer', 'claude', 'claude-opus-5-5'), opened('r', 'reviewer', 'grok', 'grok-5'),
    started('write', 1, 'writer'), finished('write'),
    started('review', 1, 'reviewer'), finished('review'),
    started('review', 2, 'reviewer'), finished('review'),
    started('write', 2, 'writer'), finished('write'),
  ];
  const chips = progressGroups(trailOf(events), undefined, 'success');
  assert.deepEqual(chips.map((c) => [c.name, c.grouped, c.round, c.steps.length]), [
    ['write', false, 1, 1], ['review', false, 1, 2], ['write', false, 2, 1],
  ]);
  assert.deepEqual(progressGroups([], GROUPS, 'running'), []);
});

test('a run picked up mid-way replays its recorded events, then only the live ones not on disk yet', () => {
  const ts = (s) => `2026-09-29T10:00:0${s}.000Z`;
  const recorded = [
    { type: 'workflow.started', ts: ts(0), workflow: 'software-development' },
    { type: 'step.started', ts: ts(1), step_id: 'develop', visit: 1 },
    { type: 'step.finished', ts: ts(2), step_id: 'develop' },
    { type: 'log', ts: ts(3), message: 'token <REDACTED>' },
  ];
  const live = [
    { type: 'log', ts: ts(3), message: 'token abc123' }, // the same event, redacted on disk
    { type: 'step.started', ts: ts(4), step_id: 'code_review', visit: 1 },
  ];
  const out = hydrationEvents(recorded, live);
  assert.deepEqual(out.map((e) => [e.type, e.step_id ?? e.message ?? e.workflow]), [
    ['workflow.started', 'software-development'], ['step.started', 'develop'], ['step.finished', 'develop'],
    ['log', 'token <REDACTED>'], ['step.started', 'code_review'],
  ]);
  // the replayed trail holds the step that ran before the window opened
  assert.deepEqual(trailOf(out).map((s) => s.step), ['develop', 'code_review']);
});

test('without a recorded workflow.started only the live events are applied', () => {
  const live = [{ type: 'step.started', ts: '2026-09-29T10:00:04.000Z', step_id: 'test', visit: 1 }];
  assert.deepEqual(hydrationEvents([], live), live);
  assert.deepEqual(hydrationEvents([{ type: 'log', ts: 'x' }], []), []);
});

// ---- on disk ------------------------------------------------------------------------------
const jl = (...objs) => objs.map((o) => JSON.stringify(o)).join('\n') + '\n';

test('readRun takes the progress from summary.json, else rebuilds it from the events', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-progress-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const events = devRun().map((e) => (e.type === 'workflow.started' ? { ...e, groups: GROUPS } : e));
  fs.mkdirSync(path.join(root, 'live'));
  fs.writeFileSync(path.join(root, 'live', 'events.jsonl'), jl(...events));
  const live = runs.readRun(root, 'live');
  assert.equal(live.status, 'interrupted');
  assert.deepEqual(live.groups, GROUPS);
  assert.deepEqual(live.progress.map((s) => s.step), ['develop', 'code_review', 'develop', 'code_review', 'human_review']);
  // the file grows: the cached trail is replaced
  fs.appendFileSync(path.join(root, 'live', 'events.jsonl'), jl(ev('approval.resolved', { approval_id: 'a1' }), finished('human_review')));
  assert.equal(runs.readRun(root, 'live').progress.at(-1).status, 'done');

  // finished: summary.progress wins over the events
  fs.mkdirSync(path.join(root, 'done'));
  fs.writeFileSync(path.join(root, 'done', 'events.jsonl'), jl(...events));
  fs.writeFileSync(path.join(root, 'done', 'summary.json'), JSON.stringify({ status: 'success', sessions: [], progress: [{ step: 'deploy', visit: 1, status: 'done', agents: [] }] }));
  const done = runs.readRun(root, 'done');
  assert.deepEqual(done.progress.map((s) => s.step), ['deploy']);
  assert.deepEqual(done.groups, GROUPS); // from workflow.started
  // recorded before summary.progress existed: from the events
  fs.writeFileSync(path.join(root, 'done', 'summary.json'), JSON.stringify({ status: 'success', sessions: [] }));
  assert.equal(runs.readRun(root, 'done').progress.length, 5);
});

test('the engine records the groups and the step trail in summary.json', { timeout: 60000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-progress-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'grouped.yaml');
  fs.writeFileSync(file, [
    'metadata: { name: grouped }',
    'agents: { dev: { provider: claude, model: claude-opus-5-5 } }',
    'groups:',
    '  - { name: Build, steps: [one, two] }',
    'steps:',
    '  - id: one',
    '    agent: dev',
    '    prompt: first',
    '  - id: two',
    '    agent: dev',
    '    prompt: second',
    '  - id: gate',
    '    type: human_approval',
    '    message: ok?',
    '',
  ].join('\n'));
  const runsDir = path.join(dir, 'runs');
  const run = new WorkflowRun({ file, inputs: {}, mock: true, runsDir });
  const rec = new Recorder(run.runDir);
  const events = [];
  run.on('event', (e) => {
    rec.write(e);
    events.push(e);
    if (e.type === 'approval.requested') setImmediate(() => run.resolveApproval(e.approval_id, true));
  });
  await run.start();
  if (!rec.events.writableFinished) await new Promise((r) => rec.events.once('finish', r));
  assert.equal(events.find((e) => e.type === 'workflow.finished').status, 'success');
  assert.deepEqual(events[0].groups, [{ name: 'Build', steps: ['one', 'two'] }]);

  const summary = JSON.parse(fs.readFileSync(path.join(run.runDir, 'summary.json'), 'utf8'));
  assert.deepEqual(summary.groups, [{ name: 'Build', steps: ['one', 'two'] }]);
  assert.deepEqual(summary.progress.map((s) => [s.step, s.status]), [['one', 'done'], ['two', 'done'], ['gate', 'done']]);
  assert.equal(summary.progress[0].agents[0].agent, 'dev');
  assert.equal(summary.progress[0].agents[0].model, 'claude-opus-5-5');
  const chips = progressGroups(summary.progress, summary.groups, summary.status);
  assert.deepEqual(chips.map((c) => [c.name, c.grouped, c.status]), [['Build', true, 'done'], ['gate', false, 'done']]);
});
