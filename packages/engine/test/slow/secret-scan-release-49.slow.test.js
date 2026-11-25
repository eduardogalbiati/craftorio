// #49, mock runs of workflows/release.yaml with a fake gitleaks: the scan comes before the Ship gate, the gate says
// "secrets not scanned" without gitleaks, and a secret that stays goes to the developer twice, then to a gate, never
// to Ship. Acceptance tests written before the code. The routes are in ../secret-scan-workflows-49.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { WorkflowRun, loadWorkflow } = require('../../engine/workflow');
const { FILES, ROOT, commit, git, installGitleaks, plainGit, planted, removeGitleaks, scanStep, tmp } = require('../helpers/fake-gitleaks');
process.env.CRAFTORIO_MOCK_DELAY_SCALE = '0.02';

plainGit();
const LIMIT = { timeout: 120000 };
const WORKFLOW = path.join(ROOT, ...FILES.release.split('/'));

// the Ship gate always answers Hold, another one its Stop: nothing is ever pushed
async function runRelease(t, files = {}) {
  const wf = loadWorkflow(WORKFLOW);
  const scan = scanStep(wf, 'release').id;
  const repo = tmp(t, 'repo');
  git(repo, 'init', '-q', '-b', 'main');
  commit(repo, 'base', { 'package.json': '{ "name": "x", "scripts": { "test": "node --test" } }\n', ...files });
  const run = new WorkflowRun({
    file: WORKFLOW, inputs: { task: 'Release v1.0', repo_path: repo, e2e_suite: 'skip' }, mock: true, runsDir: tmp(t, 'runs'),
    mockSequences: { suite: { unit: ['pass'] } },
  });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type !== 'approval.requested') return;
    const choice = ev.choices?.find((c) => /hold|stop/.test(c.id))?.id ?? ev.choices?.[0]?.id ?? true;
    setImmediate(() => run.resolveApproval(ev.approval_id, choice, 'user', ''));
  });
  await run.start();
  return {
    scan, events,
    started: events.filter((e) => e.type === 'step.started').map((e) => e.step_id),
    transitions: events.filter((e) => e.type === 'step.transition').map((e) => `${e.from}>${e.to}`),
    gates: events.filter((e) => e.type === 'approval.requested'),
  };
}

test('#49 release run: the scan runs before the Ship gate, with no agent', LIMIT, async (t) => {
  const { calls } = installGitleaks(t);
  const { scan, started, gates, events } = await runRelease(t);
  assert.deepEqual(gates.map((g) => g.step_id), ['ship']);
  assert.equal(started.includes(scan) && started.indexOf(scan) < started.indexOf('ship'), true, started.join(', '));
  assert.equal(calls().length > 0, true, 'gitleaks was called');
  assert.equal(events.some((e) => e.type === 'session.message_sent' && e.step_id === scan), false, 'the scan makes no model call');
});

test('#49 release run: without gitleaks the Ship gate says "secrets not scanned"', LIMIT, async (t) => {
  removeGitleaks(t);
  const { gates } = await runRelease(t);
  assert.deepEqual(gates.map((g) => g.step_id), ['ship']);
  assert.match(JSON.stringify(gates[0]), /secrets not scanned/i);
});

test('#49 release run: a secret that stays goes to the developer twice, then to a gate, never to Ship', LIMIT, async (t) => {
  installGitleaks(t);
  const value = planted();
  const { scan, transitions, gates, events } = await runRelease(t, { 'old.txt': `${value}\n` });
  assert.equal(transitions.filter((x) => x === `${scan}>fix`).length, 2, transitions.join(', '));
  assert.equal(gates.length, 1);
  assert.equal(transitions.includes(`${scan}>${gates[0].step_id}`), true, transitions.join(', '));
  assert.notEqual(gates[0].step_id, 'ship');
  assert.equal(JSON.stringify(events).includes(value), false, 'an event holds the value');
});
