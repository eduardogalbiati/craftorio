// Releases (#260): the bundled workflows/release.yaml runs the whole unit suite and the whole E2E
// suite (no --grep) in `type: suite` steps without an agent while they are green; a red suite calls
// the developer with the history since the last release (runs, issues, decisions, handoff notes,
// commits); then a human-only gate `ship` offers Ship (push local main, tag) or Hold. Hold ends the
// run with nothing after the gate (nothing pushes without Ship). Mock runs as in
// test/ai-development-e2e.test.js; the gate is answered as in test/engine-helpers.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { WorkflowRun, loadWorkflow } = require('../src/engine/workflow');
process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';

const WORKFLOW = path.join(__dirname, '..', 'workflows', 'release.yaml');
const load = () => loadWorkflow(WORKFLOW);
const stepById = (wf, id) => wf.steps.find((s) => s.id === id);
// the command of a step, its `{{ inputs.x }}` resolved to that input's default
const commandOf = (wf, step) => String(step.command || '').replace(/\{\{\s*inputs\.(\w+)\s*\}\}/g, (_, k) => String(wf.inputs?.[k]?.default ?? ''));
const suites = (wf) => wf.steps.filter((s) => s.type === 'suite');
const unitSuite = (wf) => suites(wf)[0];
const e2eSuite = (wf) => suites(wf).find((s) => s !== unitSuite(wf));
const agentOfStep = (step) => step?.agent || step?.delegate?.agent;
// where a transition leads (its goto, or the step it delegates to)
const targets = (wf, t) => [t.goto && t.goto !== 'end' ? stepById(wf, t.goto) : null].filter(Boolean);

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
  const run = new WorkflowRun({ file: WORKFLOW, inputs: { task: 'Release v1.0', repo_path: repo, project_path: repo, ...inputs }, mock: true, runsDir, mockSequences });
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

test('release workflow: the first step runs the whole unit suite without an agent (#260)', () => {
  const wf = load();
  const first = wf.steps[0];
  assert.equal(first.type, 'suite', `the first step (${first.id}) is a suite step`);
  assert.equal(first.agent, undefined);
  assert.equal(first.files, undefined, 'the whole suite, not a list of files');
  assert.ok(!['affected', 'files'].includes(String(first.scope || 'full')), 'the whole suite, not the affected tests');
  assert.doesNotMatch(commandOf(wf, first), /e2e|playwright|--grep/, 'the unit suite');
});

test('release workflow: another suite step runs the whole E2E suite, without --grep (#260)', () => {
  const wf = load();
  const e2e = e2eSuite(wf);
  assert.ok(e2e, 'a second suite step');
  assert.equal(e2e.agent, undefined);
  const command = commandOf(wf, e2e);
  assert.match(command, /e2e|playwright/, `it runs the E2E suite (got "${command}")`);
  assert.doesNotMatch(command, /--grep/, 'the whole E2E suite');
});

test('release workflow: a green suite goes on without any agent step (#260)', () => {
  const wf = load();
  assert.equal(suites(wf).length >= 2, true, 'a unit suite and an E2E suite');
  for (const suite of suites(wf)) {
    const passes = (suite.transitions || []).filter((t) => /pass/.test(String(t.when)));
    for (const t of passes) {
      assert.equal(t.delegate, undefined, `a green ${suite.id} calls no agent (${t.when})`);
      // #290: the read-only `review` step (the release summary) may follow the last green suite
      for (const next of targets(wf, t).filter((s) => s.id !== 'review')) assert.equal(agentOfStep(next), undefined, `a green ${suite.id} goes to a suite or a gate, not to ${next.id}`);
    }
  }
});

test('release workflow: a red suite calls the developer with the history since the last release (#260)', () => {
  const wf = load();
  for (const suite of suites(wf)) {
    const fails = (suite.transitions || []).filter((t) => /fail/.test(String(t.when)));
    assert.ok(fails.length > 0, `a transition for a red ${suite.id}`);
    const devSteps = fails.flatMap((t) => targets(wf, t)).filter((s) => agentOfStep(s) === 'developer');
    assert.ok(devSteps.length > 0, `a red ${suite.id} reaches a step of the developer`);
    for (const step of devSteps) {
      const prompt = String(step.prompt || '').toLowerCase();
      for (const word of ['since the last release', 'runs', 'issues', 'decisions', 'handoff notes', 'commits']) {
        assert.ok(prompt.includes(word), `the ${step.id} prompt mentions "${word}"`);
      }
    }
  }
});

test('release workflow: a human gate `ship` offers Ship and Hold (#260)', () => {
  const wf = load();
  const ship = stepById(wf, 'ship');
  assert.ok(ship, 'a step `ship`');
  assert.equal(ship.type, 'human_approval');
  const choices = (ship.choices || []).map((c) => ({ id: c.id, label: c.label }));
  assert.deepEqual(choices.filter((c) => ['ship', 'hold'].includes(c.id)), [{ id: 'ship', label: 'Ship' }, { id: 'hold', label: 'Hold' }]);
});

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
