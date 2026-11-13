// #795 (review): an orchestrator message's outcome for the statuses a check ends with besides pass/fail
// (`missing`, `broken`, `skipped`), the screenshot slot's wait (a log with no step id), and the suite's
// scope reason kept after the end. The helper shared with the Run screen (packages/shared/run-log-path.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { RunChatModel } = require('../views/runchat/run-chat-model');
const { runLogPath } = require('@multiagent/shared/run-log-path.js');

const T = (m, s = 0) => new Date(Date.UTC(2026, 10, 13, 15, m, s)).toISOString();
const chatOf = (events) => {
  const m = new RunChatModel();
  for (const ev of [{ seq: 0, type: 'workflow.started', run_id: 'r1', workflow: 'feature', ts: T(0) }, ...events]) m.apply(ev);
  return m;
};
const orch = (m, step) => m.items.filter((i) => i.kind === 'orchestrator' && i.step === step);

test('a check ending `missing` or `broken` is failed, with the first line of its message', () => {
  const m = chatOf([
    { seq: 1, type: 'step.started', step_id: 'testid_check', visit: 1, step_type: 'test_ids', agent: null, ts: T(1) },
    { seq: 2, type: 'log', level: 'warn', step_id: 'testid_check', message: 'testid_check: 2 test id(s) missing', ts: T(1, 2) },
    { seq: 3, type: 'step.finished', step_id: 'testid_check', visit: 1, ts: T(1, 3), output: { status: 'missing', missing: ['a', 'b'], message: '2 test id(s) the E2E step definitions use are not in fronts:\n- a\n- b' } },
    { seq: 4, type: 'step.started', step_id: 'red_check', visit: 1, step_type: 'suite', agent: null, ts: T(2) },
    { seq: 5, type: 'step.finished', step_id: 'red_check', visit: 1, ts: T(2, 9), output: { status: 'broken', message: 'Red check of 1 test file(s)\n- cannot run: x' } },
  ]);
  const [ids] = orch(m, 'testid_check');
  assert.equal(ids.state, 'failed');
  assert.equal(ids.summary, '2 test id(s) the E2E step definitions use are not in fronts:');
  assert.equal(orch(m, 'red_check')[0].state, 'failed');
});

test('a skipped check is not a failure and says why; a pass has no summary', () => {
  const m = chatOf([
    { seq: 1, type: 'step.started', step_id: 'baselines', visit: 1, step_type: 'visual_baselines', agent: null, ts: T(1) },
    { seq: 2, type: 'step.finished', step_id: 'baselines', visit: 1, ts: T(1, 1), output: { status: 'skipped', message: 'Baseline check skipped: the run names no issue.' } },
    { seq: 3, type: 'step.started', step_id: 'suite', visit: 1, step_type: 'suite', agent: null, ts: T(2) },
    { seq: 4, type: 'step.finished', step_id: 'suite', visit: 1, ts: T(3), output: { status: 'pass', message: 'ok' } },
  ]);
  assert.equal(orch(m, 'baselines')[0].state, 'passed');
  assert.equal(orch(m, 'baselines')[0].summary, 'Baseline check skipped: the run names no issue.');
  assert.equal(orch(m, 'suite')[0].summary, null);
});

test('the screenshot slot wait (no step id, "<step>: …") makes its step wait', () => {
  const m = chatOf([
    { seq: 1, type: 'step.started', step_id: 'screens', visit: 1, step_type: 'developer_screenshots', agent: null, ts: T(1) },
    { seq: 2, type: 'log', level: 'info', kind: 'screenshot_slot', message: 'screens: waiting for the screenshot slot (held by pid 42)', ts: T(1, 1) },
  ]);
  const [it] = orch(m, 'screens');
  assert.equal(it.state, 'waiting');
  assert.match(it.waitingReason, /screenshot slot/);
});

test('the suite selection reason and scope stay on the outcome', () => {
  const m = chatOf([
    { seq: 1, type: 'step.started', step_id: 'suite', visit: 1, step_type: 'suite', agent: null, ts: T(1) },
    { seq: 2, type: 'log', level: 'info', kind: 'suite', step_id: 'suite', message: 'suite: 12 affected file(s) of 3 changed\n- a.test.js: imports a', ts: T(1, 1) },
    { seq: 3, type: 'log', level: 'info', kind: 'suite', step_id: 'suite', status: 'pass', failures: 0, message: 'suite: The suite passed', ts: T(4) },
    { seq: 4, type: 'step.finished', step_id: 'suite', visit: 1, ts: T(4, 1), output: { status: 'pass', scope: 'affected', command: 'npm test', log: 'logs/suite-1.log' } },
  ]);
  const [it] = orch(m, 'suite');
  assert.equal(it.why, '12 affected file(s) of 3 changed');
  assert.equal(it.scope, 'affected');
});

test('runLogPath: relative to the run folder, null outside logs/', () => {
  assert.equal(runLogPath('C:\\runs\\r1\\logs\\suite-1.log'), 'logs/suite-1.log');
  assert.equal(runLogPath('/home/u/runs/r1/logs/e2e-1.log'), 'logs/e2e-1.log');
  assert.equal(runLogPath('logs/x.log'), 'logs/x.log');
  assert.equal(runLogPath('other.log'), null);
  assert.equal(runLogPath(''), null);
});

test('each state pill class of the orchestrator message has a style rule', () => {
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..', '..', '..');
  const src = fs.readFileSync(require('../../../scripts/source-tree').pageFile(root, 'views/runchat/runchat.js'), 'utf8');
  const map = /const ORCH_PILL = \{([^}]*)\}/.exec(src);
  assert.ok(map, 'runchat.js maps each state to a pill class');
  const classes = Array.from(map[1].matchAll(/'(pill-[\w-]+)'/g), (m) => m[1]);
  assert.deepEqual(classes.length >= 4, true);
  const css = ['packages/ui-kit/style.css', 'fronts/build/views/runchat/runchat.css']
    .map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
  const missing = classes.filter((c) => !new RegExp(`\\.${c}\\b[^{]*\\{`).test(css));
  assert.deepEqual(missing, []);
});
