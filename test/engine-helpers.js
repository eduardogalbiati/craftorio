const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun, loadWorkflow, extractJson, validateSchema, evalExpr, render } = require('../src/engine/workflow');
const evidence = require('../src/evidence');


const root = path.join(__dirname, '..');
async function runLoopBlocked(t, mockSequences) {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const run = new WorkflowRun({ file: path.join(__dirname, 'fixtures', 'loop-blocked.yaml'), inputs: {}, mock: true, runsDir, mockSequences });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, false));
  });
  await run.start();
  return { run, events, finished: events.find((e) => e.type === 'workflow.finished') };
}
async function runConditionalAction(t, cleanup) {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const run = new WorkflowRun({ file: path.join(__dirname, 'fixtures', 'conditional-action.yaml'), inputs: { cleanup }, mock: true, runsDir, skillsDirs: [] });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, true));
  });
  await run.start();
  return events.filter((e) => e.type === 'action.executed');
}
// Full software-development flow in mock mode. Gates get `answers[step]` (default: approve /
// first choice), like --auto-approve. `answers[step]` (and `feedback[step]`) may be a list, one
// per visit to that gate (shifted as it is visited again; the last one repeats past the end).
async function runSoftwareDevelopment({ mockSequences, answers = {}, feedback = {}, inputs = {}, issues, file = 'software-development.yaml' }) {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  const run = new WorkflowRun({
    file: path.join(root, 'workflows', file),
    inputs: { task: 'Engine test', repo_path: root, ...inputs },
    mock: true,
    runsDir,
    mockSequences,
    issues,
  });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') {
      const a = answers[ev.step_id];
      const answer = Array.isArray(a) ? a.shift() ?? (ev.choices ? ev.choices[0].id : true) : a ?? (ev.choices ? ev.choices[0].id : true);
      const f = feedback[ev.step_id];
      const text = Array.isArray(f) ? f.shift() : f;
      setImmediate(() => run.resolveApproval(ev.approval_id, answer, 'user', text));
    }
  });
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  const transitions = events.filter((e) => e.type === 'step.transition').map((e) => `${e.from}>${e.to}`);
  fs.rmSync(runsDir, { recursive: true, force: true });
  return { events, finished, transitions };
}
const GROUP = [53, 65, 77].map((n) => ({ number: n, url: `https://github.com/o/r/issues/${n}`, title: `T${n}` }));
// `type: run` inputs (run-retrospective): "latest", a real id, or refused before the run starts.
function runsWith(t, runs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-input-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [id, workflow] of runs) {
    fs.mkdirSync(path.join(dir, id));
    fs.writeFileSync(path.join(dir, id, 'events.jsonl'), `${JSON.stringify({ seq: 1, type: 'workflow.started', workflow })}\n`);
  }
  return dir;
}
const retro = (runsDir, runId) => new WorkflowRun({ file: path.join(root, 'workflows', 'run-retrospective.yaml'), inputs: { run_id: runId }, mock: true, runsDir, skillsDirs: [] });
// ---------------------------------------------------------------------------
// writer-reviewer: the writer and the reviewer are picked at run time (templated agents)
async function runWriterReviewer({ inputs = {}, mockSequences, answers = {}, feedback = {} } = {}) {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  const run = new WorkflowRun({
    file: path.join(root, 'workflows', 'writer-reviewer.yaml'),
    inputs: { prompt: 'A one-page PRD', goal: 'Every requirement is testable', ...inputs },
    mock: true, runsDir, mockSequences,
  });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') {
      // answers[step]: a choice id, or a list of them (one per visit); feedback[step]: the text typed
      const a = answers[ev.step_id];
      const answer = Array.isArray(a) ? a.shift() ?? ev.choices[0].id : a ?? ev.choices[0].id;
      const f = feedback[ev.step_id];
      setImmediate(() => run.resolveApproval(ev.approval_id, answer, 'user', Array.isArray(f) ? f.shift() : f));
    }
  });
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  const transitions = events.filter((e) => e.type === 'step.transition').map((e) => `${e.from}>${e.to}`);
  const files = (rel) => fs.readFileSync(path.join(run.runDir, rel), 'utf8');
  return { run, events, finished, transitions, files, cleanup: () => fs.rmSync(runsDir, { recursive: true, force: true }) };
}
// ---------------------------------------------------------------------------
// ai-arena: up to five contender slots picked at run time; `enabled` leaves the unused ones out
function arenaRun(inputs = {}, mockSequences) {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  const cleanup = () => fs.rmSync(runsDir, { recursive: true, force: true });
  try {
    return { run: new WorkflowRun({ file: path.join(root, 'workflows', 'ai-arena.yaml'), inputs: { task: 'A PRD', ...inputs }, mock: true, runsDir, mockSequences }), cleanup };
  } catch (e) { cleanup(); throw e; }
}
// ---------------------------------------------------------------------------
// backlog-refresh (#161): review -> apply safe fixes -> scope gate (decision gate) -> apply closes
function backlogRefreshRun(inputs = {}, mockSequences) {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  const cleanup = () => fs.rmSync(runsDir, { recursive: true, force: true });
  try {
    return { run: new WorkflowRun({ file: path.join(root, 'workflows', 'backlog-refresh.yaml'), inputs: { project_path: 'C:/proj', ...inputs }, mock: true, runsDir, mockSequences }), cleanup };
  } catch (e) { cleanup(); throw e; }
}
// A small workflow file in a temp folder; returns its path.
function tempWorkflow(t, yaml) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, yaml);
  return { dir, file };
}
async function runWith(file, { mock, answer, cwd }) {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  const run = new WorkflowRun({ file, inputs: { task: 't', dir: cwd || '' }, mock, runsDir });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, answer(ev)));
  });
  await run.start();
  fs.rmSync(runsDir, { recursive: true, force: true });
  return { events, finished: events.find((e) => e.type === 'workflow.finished') };
}
// ---- #174: `type: workflow` step - a child run, once or for each item of a list --------------
// Pure scheduling/templating pieces (validateWorkflowStep, resolveValue, itemFiles, schedule,
// file-overlap grouping, nesting depth) are unit-tested directly in test/workflow-step.test.js,
// with fake startChild promises. These tests exercise the real wiring through WorkflowRun: the
// events a `type: workflow` step emits, on_error/transitions reading output.status, a child's
// human gate blocking the parent, and the parent/child summary links.

async function until(fn, timeoutMs = 20000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for the condition');
    await new Promise((r) => setTimeout(r, 10));
  }
}
const CHILD_ECHO_YAML = `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: child-echo }
inputs:
  n: { type: number, default: 0 }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: work
    agent: a
    prompt: "echo {{ inputs.n }}"
outputs:
  n:
    type: number
    value: "{{ inputs.n }}"
`;
// A single step with no on_error: the missing skill fails the step, and nothing catches it, so
// the whole child run ends failed (same mechanism as the fanout/on-error fixtures).
const CHILD_FAIL_YAML = `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: child-fail }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: work
    agent: a
    skills: [does-not-exist]
    prompt: "do it"
`;
const CHILD_GATE_YAML = `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: child-gate }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: work
    agent: a
    prompt: "do it"
  - id: review
    type: human_approval
    message: "ok?"
`;
// ---- #203: unit_tests x e2e_tests -----------------------------------------------------------

for (const unit_tests of ['write_and_run', 'run_existing', 'off']) {
  for (const e2e_tests of ['off', 'write', 'write_and_run']) {
    const testVisited = e2e_tests !== 'off' || unit_tests === 'write_and_run';
    const suiteVisited = unit_tests !== 'off';
    test(`software-development: unit_tests=${unit_tests} x e2e_tests=${e2e_tests}: test visited=${testVisited}, suite visited=${suiteVisited}`, { timeout: 120000 }, async () => {
      const { finished } = await runSoftwareDevelopment({
        inputs: { unit_tests, e2e_tests },
        mockSequences: { verdict: ['approved'], preview_status: ['success'], tests_status: ['pass'], suite: { suite: ['pass'] } },
      });
      assert.equal(finished.status, 'success', finished.error);
      assert.equal(finished.summary.steps.test.visits > 0, testVisited, 'test step');
      assert.equal(finished.summary.steps.suite.visits > 0, suiteVisited, 'suite step');
    });
  }
}

module.exports = { root, retro, runLoopBlocked, runConditionalAction, runSoftwareDevelopment, GROUP, runsWith, runWriterReviewer, arenaRun, backlogRefreshRun, tempWorkflow, runWith, until, CHILD_ECHO_YAML, CHILD_FAIL_YAML, CHILD_GATE_YAML };
