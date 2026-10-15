// Acceptance tests for #223: E2E in workflows/ai-development-local-hero.yaml. With e2e_tests on, the
// test writer writes the issue's BDD scenarios first (with the unit acceptance tests, two sub-agents
// in parallel), the developer may not change them, a step without an agent (`e2e`) runs the issue's
// scenarios plus @smoke after the suite, and an agent (the healer) is called only for a red scenario.
// Mock runs on a git repository in a temp folder, as in test/ai-development-local-hero.test.js.
//
// The interface these tests fix (the issue leaves the names open):
//   - acceptance_tests output: `e2e_scope` (scenarios | none) says whether the issue got scenarios,
//     `e2e_files` lists the .feature files and step definitions written (locked for the developer);
//   - step `e2e`: `type: suite`, no agent, its command filtered to @issue-<n> and @smoke;
//   - step `heal`: an agent other than the developer, output `heal_status` (healed | app | ...) and
//     `failure_report` (the evidence handed to the developer for a product bug).
// Split by #306 (whole mock runs of a bundled workflow live in test/slow/, docs/agents/testing.md):
// its runs are in test/slow/ai-development-e2e.slow.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadWorkflow } = require('../src/engine/workflow');
process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';

const WORKFLOW = path.join(__dirname, '..', 'workflows', 'ai-development-local-hero.yaml');

test('ai-development e2e: the e2e step has no agent and runs only the issue\'s scenarios and the @smoke journeys', () => {
  const wf = loadWorkflow(WORKFLOW);
  const e2e = wf.steps.find((s) => s.id === 'e2e');
  assert.ok(e2e, 'the workflow has an e2e step');
  assert.equal(e2e.type, 'suite', 'it is run by the orchestrator, like the suite step (#177)');
  assert.equal(e2e.agent, undefined);
  const command = String(e2e.command || '');
  assert.match(command, /@issue-/, `the command selects the issue's scenarios (got "${command}")`);
  assert.match(command, /@smoke/, `the command also runs the @smoke journeys (got "${command}")`);
});
