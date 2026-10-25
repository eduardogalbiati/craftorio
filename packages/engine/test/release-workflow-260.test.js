// Releases (#260): the bundled workflows/release.yaml runs the whole unit suite and the whole E2E
// suite (no --grep) in `type: suite` steps without an agent while they are green; a red suite calls
// the developer with the history since the last release (runs, issues, decisions, handoff notes,
// commits); then a human-only gate `ship` offers Ship (push local main, tag) or Hold. Hold ends the
// run with nothing after the gate (nothing pushes without Ship). Mock runs as in
// test/ai-development-e2e.test.js; the gate is answered as in test/engine-helpers.js.
// Split by #306 (whole mock runs of a bundled workflow live in test/slow/, docs/agents/testing.md):
// its runs are in test/slow/release-workflow-260.slow.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadWorkflow } = require('../engine/workflow');
process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';

const WORKFLOW = path.join(__dirname, '..', '..', '..', 'workflows', 'release.yaml');
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

test('release workflow: the first suite step runs the whole unit suite without an agent, right after the version step (#260, #325)', () => {
  const wf = load();
  // #325: the release's version is written first (no agent), then the unit suite
  assert.equal(wf.steps[0].type, 'release_version');
  assert.deepEqual(wf.steps[0].transitions.map((t) => t.goto), ['unit']);
  const first = wf.steps.find((s) => s.type === 'suite');
  assert.equal(first.id, 'unit');
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
