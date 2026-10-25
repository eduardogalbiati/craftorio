// Acceptance tests for #404 on the definition of workflows/ai-development-local-hero.yaml: the
// developer runs the project's check command before its final answer and records the result; a
// step with no agent runs the check command after develop and sends a failure back to develop
// (never to the test writer); the command is the `check_command` input. The runs of the step are
// in test/slow/check-step-404.slow.test.js.
// Seam: the loaded workflow (loadWorkflow). The check step is found by what it runs (the input),
// not by its id.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadWorkflow } = require('../engine/workflow');

const WORKFLOW = path.join(__dirname, '..', '..', '..', 'workflows', 'ai-development-local-hero.yaml');
const runsCheckCommand = (step) => /inputs\.check_command/.test(JSON.stringify({ ...step, transitions: undefined, prompt: undefined }));
const checkStepOf = (wf) => wf.steps.find((s) => !s.agent && runsCheckCommand(s));
const gotos = (step) => (step.transitions || []).map((tr) => tr.goto).filter(Boolean);

test('#404: the workflow has a check_command input that defaults to the project\'s own check script', () => {
  const wf = loadWorkflow(WORKFLOW);
  const input = wf.inputs.check_command;
  assert.ok(input, 'no check_command input');
  assert.equal(input.default || '', '', 'empty by default: the step finds the project\'s check script');
  assert.match(String(input.description || ''), /package\.json/, 'the description says where the default comes from');
  assert.match(String(input.description || ''), /\bcheck\b/);
});

test('#404: a step with no agent runs the check command and is reached from develop', () => {
  const wf = loadWorkflow(WORKFLOW);
  const check = checkStepOf(wf);
  assert.ok(check, 'no agent-less step runs {{ inputs.check_command }}');
  // reachable from develop through agent-less steps only (no review or test turn in between)
  const byId = Object.fromEntries(wf.steps.map((s) => [s.id, s]));
  const seen = new Set();
  const queue = gotos(byId.develop);
  let found = false;
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id) || !byId[id]) continue;
    seen.add(id);
    if (id === check.id) { found = true; break; }
    if (!byId[id].agent && byId[id].type !== 'human_approval') queue.push(...gotos(byId[id]));
  }
  assert.ok(found, `${check.id} is not reached from develop before another agent's turn`);
});

test('#404: a failing check goes back to develop, never to the test writer, and has a way out of the loop', () => {
  const wf = loadWorkflow(WORKFLOW);
  const check = checkStepOf(wf);
  assert.ok(check, 'no check step');
  const targets = gotos(check);
  assert.ok(targets.includes('develop'), `the check step does not route to develop (routes: ${targets.join(', ')})`);
  const testWriterSteps = wf.steps.filter((s) => s.agent === 'test_writer').map((s) => s.id);
  assert.deepEqual(targets.filter((id) => testWriterSteps.includes(id)), [], 'a check failure must not go to the test writer');
  assert.ok(targets.some((id) => id !== 'develop'), 'the check step has a route other than develop (pass, or rounds used up)');
});

test('#404: the developer is told to run the check command before its final answer and records the result', () => {
  const wf = loadWorkflow(WORKFLOW);
  const develop = wf.steps.find((s) => s.id === 'develop');
  const text = `${wf.agents.developer.system_prompt || ''}\n${develop.prompt || ''}`;
  assert.match(text, /check_command|check command/i, 'the developer\'s instructions do not name the check command');
  const props = ((develop.output_schema || {}).properties) || {};
  assert.ok(props.checks, `develop's output has no checks field (fields: ${Object.keys(props).join(', ')})`);
});
