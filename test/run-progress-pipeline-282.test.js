// #282: the fixed stations of a workflow's pipeline (RunProgress.workflowStations) and what a run's
// trail did at each (RunProgress.pipeline): internal details of the roadmap card's Workflow band.
const test = require('node:test');
const assert = require('node:assert/strict');
const { pipeline, workflowStations } = require('../src/shared/run-progress-model');

const STEPS = [
  { id: 'acceptance_tests', type: 'agent', agent: 'test_writer' },
  { id: 'develop', type: 'agent', agent: 'developer', transitions: [{ goto: 'developer_check', when: "inputs.mode == 'validated' and output.committed" }, { goto: 'code_review' }] },
  { id: 'developer_check', type: 'human_approval' },
  { id: 'code_review', type: 'agent', agents: ['reviewer_a', 'reviewer_b'] },
  { id: 'human_review', type: 'human_approval' },
  { id: 'test', type: 'agent', agent: 'test_writer' },
  { id: 'sign_off', type: 'human_approval' },
  { id: 'stuck', type: 'human_approval' },
];
const GROUPS = [
  { name: 'Develop', steps: ['develop', 'developer_check'] },
  { name: 'Review', steps: ['code_review', 'human_review'] },
  { name: 'Validate', steps: ['test'] },
  { name: 'Sign off', steps: ['sign_off'] },
];
const names = (list) => list.map((st) => (st.gate ? `gate:${st.name}` : st.name));
const states = (list) => list.map((st) => st.state);
const entry = (step, status = 'done', extra = {}) => ({ step, status, type: 'agent', agents: [{ agent: step, provider: 'claude', cost: 1, durationMs: 1000 }], ...extra });

test('#282 stations: one per group and per step in no group, in the workflow\'s order; a human gate in no group is none', () => {
  const list = workflowStations({ steps: STEPS, groups: GROUPS, mode: 'auto' });
  assert.deepEqual(names(list), ['acceptance_tests', 'Develop', 'Review', 'Validate', 'Sign off']);
  assert.deepEqual(list.map((st) => st.grouped), [false, true, true, true, true]);
  assert.equal(list.at(-1).human, true, 'a group of human gates only is a station of the owner');
  assert.deepEqual(list[1].steps, ['develop', 'developer_check'], 'in Automatic the gate step stays with its group');
});

test('#282 stations: the mode\'s gate is a station right after the one that holds it, whatever the quotes or spaces of its condition', () => {
  const list = workflowStations({ steps: STEPS, groups: GROUPS, mode: 'validated' });
  assert.deepEqual(names(list), ['acceptance_tests', 'Develop', 'gate:developer_check', 'Review', 'Validate', 'Sign off']);
  assert.deepEqual(list[2].host, { name: 'Develop', grouped: true });
  assert.deepEqual(list[1].steps, ['develop'], 'the gate step leaves its group\'s station');
  const spaced = STEPS.map((s) => (s.id === 'develop' ? { ...s, transitions: [{ goto: 'developer_check', when: 'inputs.mode=="validated"' }] } : s));
  assert.ok(workflowStations({ steps: spaced, groups: GROUPS, mode: 'validated' }).some((st) => st.gate));
  assert.ok(!workflowStations({ steps: STEPS, groups: GROUPS, mode: 'valid' }).some((st) => st.gate), 'another mode is not a prefix match');
  assert.ok(!workflowStations({ steps: STEPS, groups: GROUPS }).some((st) => st.gate), 'no mode, no gate');
});

test('#282 stations: a gate reached from a step in no group follows that step; no steps, no stations', () => {
  const steps = [{ id: 'write', type: 'agent', transitions: [{ goto: 'check', when: "inputs.mode == 'validated'" }] }, { id: 'check', type: 'human_approval' }, { id: 'publish', type: 'agent' }];
  assert.deepEqual(names(workflowStations({ steps, groups: [], mode: 'validated' })), ['write', 'gate:check', 'publish']);
  assert.deepEqual(workflowStations({}), []);
});

test('#282 pipeline: no trail: every station is to do, the mode\'s gate a gate', () => {
  assert.deepEqual(states(pipeline({ steps: STEPS, groups: GROUPS, mode: 'validated' })), ['todo', 'todo', 'gate', 'todo', 'todo', 'todo']);
});

test('#282 pipeline: a run at work: done before it, running with its round and agents, to do after it', () => {
  const list = pipeline({ steps: STEPS, groups: GROUPS, mode: 'auto', status: 'running', progress: [entry('acceptance_tests'), entry('develop'), entry('code_review', 'running')] });
  assert.deepEqual(states(list), ['done', 'done', 'running', 'todo', 'todo']);
  assert.equal(list[2].current, 'code_review');
  assert.equal(list[2].round, 1);
  assert.deepEqual(list[1].agents.map((a) => a.agent), ['develop']);
});

test('#282 pipeline: a fix round: the station at work counts its rounds, the one that sent the run back says so', () => {
  const progress = [entry('acceptance_tests'), entry('develop'), entry('code_review'), entry('develop', 'running')];
  const list = pipeline({ steps: STEPS, groups: GROUPS, mode: 'auto', status: 'running', progress, sentBackBy: 'code_review' });
  assert.deepEqual(states(list), ['done', 'running', 'back', 'todo', 'todo']);
  assert.equal(list[1].round, 2);
  assert.equal(list[1].agents.length, 1, 'the same agent over two rounds is one avatar');
  assert.equal(list[1].agents[0].cost, 2);
});

test('#282 pipeline: waiting at the mode\'s gate, at a group\'s gate, and at a gate of no station', () => {
  const gate = (step) => entry(step, 'waiting', { type: 'human_approval', agents: [] });
  const atMode = pipeline({ steps: STEPS, groups: GROUPS, mode: 'validated', status: 'running', progress: [entry('develop'), gate('developer_check')] });
  assert.deepEqual(states(atMode), ['skipped', 'done', 'waiting', 'todo', 'todo', 'todo']);
  const atGroup = pipeline({ steps: STEPS, groups: GROUPS, mode: 'auto', status: 'running', progress: [entry('develop'), entry('code_review'), gate('human_review')] });
  assert.deepEqual(states(atGroup), ['skipped', 'done', 'waiting', 'todo', 'todo']);
  const off = pipeline({ steps: STEPS, groups: GROUPS, mode: 'auto', status: 'running', progress: [entry('develop'), gate('stuck')] });
  assert.deepEqual(states(off), ['skipped', 'waiting', 'todo', 'todo', 'todo'], 'the run stays on the last station it entered');
});

test('#282 pipeline: a run that ended: failed where it stopped; after a success every visited station is done, the others were not run', () => {
  const failed = pipeline({ steps: STEPS, groups: GROUPS, mode: 'auto', status: 'failed', progress: [entry('develop'), entry('code_review'), entry('test', 'failed')] });
  assert.deepEqual(states(failed), ['skipped', 'done', 'done', 'failed', 'todo']);
  const done = pipeline({ steps: STEPS, groups: GROUPS, mode: 'validated', status: 'success', progress: [entry('acceptance_tests'), entry('develop'), entry('code_review'), entry('test')] });
  assert.deepEqual(states(done), ['done', 'done', 'skipped', 'done', 'done', 'skipped']);
  const stopped = pipeline({ steps: STEPS, groups: GROUPS, mode: 'auto', status: 'cancelled', progress: [entry('develop', 'running')] });
  assert.deepEqual(states(stopped), ['skipped', 'stopped', 'todo', 'todo', 'todo']);
});
