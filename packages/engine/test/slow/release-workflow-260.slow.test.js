// Releases (#260): the bundled workflows/release.yaml runs the whole unit suite and the whole E2E
// suite (no --grep) in `type: suite` steps without an agent while they are green; a red suite calls
// the developer with the history since the last release (runs, issues, decisions, handoff notes,
// commits); then a human-only gate `ship` offers Ship (push local main, tag) or Hold. Hold ends the
// run with nothing after the gate (nothing pushes without Ship). Mock runs as in
// test/ai-development-e2e.test.js; the gate is answered as in test/engine-helpers.js.
// Split by #306 (whole mock runs of a bundled workflow live in test/slow/, docs/agents/testing.md):
// the rest of this file's tests are in test/release-workflow-260.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { WorkflowRun, loadWorkflow } = require('../../engine/workflow');
process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';

const WORKFLOW = path.join(__dirname, '..', '..', '..', '..', 'workflows', 'release.yaml');
const load = () => loadWorkflow(WORKFLOW);
const stepById = (wf, id) => wf.steps.find((s) => s.id === id);

const suites = (wf) => wf.steps.filter((s) => s.type === 'suite');
const unitSuite = (wf) => suites(wf)[0];
const e2eSuite = (wf) => suites(wf).find((s) => s !== unitSuite(wf));
const agentOfStep = (step) => step?.agent || step?.delegate?.agent;

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

function makeRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-wf-repo-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  git(dir, 'init', '-q');
  fs.writeFileSync(path.join(dir, 'package.json'), '{ "name": "x", "scripts": { "test": "node --test" } }\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  return dir;
}

// A mock run of the release workflow. Every gate but `ship` takes its first choice; `ship` takes
// `shipAnswer` (default hold: a test never asks for a push). Returns the steps started in order.
async function runRelease(t, { mockSequences = {}, shipAnswer = 'hold' } = {}) {
  const wf = load();
  const repo = makeRepo(t);
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-wf-runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true, maxRetries: 5 }));
  // the required inputs: a folder for the path-like ones, a text for the others
  const inputs = {};
  for (const [k, def] of Object.entries(wf.inputs || {})) {
    if (def?.default !== undefined && def?.default !== '') continue;
    inputs[k] = /path|dir|repo|folder/i.test(k) ? repo : 'Release v1.0';
  }
  const run = new WorkflowRun({ file: WORKFLOW, inputs: { task: 'Release v1.0', repo_path: repo, project_path: repo, ...inputs, e2e_command: 'npm run test:e2e' }, mock: true, runsDir, mockSequences });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') {
      const answer = ev.step_id === 'ship' ? shipAnswer : ev.choices?.[0]?.id ?? true;
      setImmediate(() => run.resolveApproval(ev.approval_id, answer, 'user', ''));
    }
  });
  await run.start();
  const started = events.filter((e) => e.type === 'step.started').map((e) => e.step_id);
  const gates = events.filter((e) => e.type === 'approval.requested').map((e) => e.step_id);
  return { wf, events, started, gates, finished: events.find((e) => e.type === 'workflow.finished') };
}

test('release workflow (mock): a red unit suite visits the developer, then reaches the ship gate (#260)', { timeout: 120000 }, async (t) => {
  if (!fs.existsSync(WORKFLOW)) assert.fail('workflows/release.yaml does not exist');
  const wf = load();
  const unit = unitSuite(wf).id;
  const e2e = e2eSuite(wf)?.id;
  const { started, gates } = await runRelease(t, { mockSequences: { suite: { [unit]: ['fail', 'pass'], ...(e2e ? { [e2e]: ['pass'] } : {}) } } });
  const dev = started.findIndex((id) => agentOfStep(stepById(wf, id)) === 'developer');
  assert.ok(dev >= 0, `the developer was called (steps: ${started.join(', ')})`);
  assert.ok(gates.includes('ship'), `the run reached the ship gate (steps: ${started.join(', ')})`);
  assert.ok(started.lastIndexOf('ship') > dev, 'the ship gate comes after the developer');
});

test('release workflow (mock): all green, the developer is never called and the run reaches ship (#260)', { timeout: 120000 }, async (t) => {
  if (!fs.existsSync(WORKFLOW)) assert.fail('workflows/release.yaml does not exist');
  const wf = load();
  const suite = Object.fromEntries(suites(wf).map((s) => [s.id, ['pass']]));
  const { started, gates } = await runRelease(t, { mockSequences: { suite } });
  assert.deepEqual(started.filter((id) => agentOfStep(stepById(wf, id))), [], 'no agent step ran');
  assert.ok(gates.includes('ship'), `the run reached the ship gate (steps: ${started.join(', ')})`);
});

test('release workflow (mock): Hold ends the run with no step after the ship gate (#260)', { timeout: 120000 }, async (t) => {
  if (!fs.existsSync(WORKFLOW)) assert.fail('workflows/release.yaml does not exist');
  const wf = load();
  const suite = Object.fromEntries(suites(wf).map((s) => [s.id, ['pass']]));
  const { started, finished } = await runRelease(t, { mockSequences: { suite }, shipAnswer: 'hold' });
  const at = started.indexOf('ship');
  assert.ok(at >= 0, `the run reached the ship gate (steps: ${started.join(', ')})`);
  assert.deepEqual(started.slice(at + 1), [], 'nothing runs after Hold (no push, no tag)');
  assert.ok(finished, 'the run ended');
});
