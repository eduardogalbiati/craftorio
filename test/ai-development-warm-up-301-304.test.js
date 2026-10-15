// workflows/ai-development-local-hero.yaml, #301 and #304 (acceptance tests, written before the code).
// #301: a read-only `warm_up` step (agent `mapper`, skill code-mapping) maps the code between red_check
// and develop, on the first visit only; develop starts from its map, and runs on without it when the
// mapper fails. #304: the suite step runs with `scope: affected`, and develop and the test step take
// the tests to run from the map (else the code → tests map instruction).
// Split by #306 (whole mock runs of a bundled workflow live in test/slow/, docs/agents/testing.md):
// its runs are in test/slow/ai-development-warm-up-301-304.slow.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun, loadWorkflow, evalExpr } = require('../src/engine/workflow');
const caps = require('../src/engine/capabilities');
process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';

const ROOT = path.join(__dirname, '..');
const WORKFLOW = path.join(ROOT, 'workflows', 'ai-development-local-hero.yaml');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

// ------------------------------------------------------------------ #301: loading

test('ai-development-local-hero (#301): a warm_up step "Warm Up" runs the mapper with the code → tests map and answers { map, files }', () => {
  const wf = loadWorkflow(WORKFLOW);
  const warm = wf.steps.find((s) => s.id === 'warm_up');
  assert.ok(warm, 'the workflow has a warm_up step');
  assert.equal(warm.agent, 'mapper');
  assert.equal(warm.display, 'Warm Up');
  assert.equal(warm.test_map, true);
  const schema = warm.output_schema;
  assert.equal(schema.properties.map?.type, 'string');
  assert.equal(schema.properties.files?.type, 'array');
  assert.equal(schema.properties.files.items?.type, 'string');
  for (const k of ['map', 'files']) assert.ok((schema.required || []).includes(k), `${k} is required`);
  // its prompt gets the task, the issues and the acceptance tests the test writer wrote
  assert.match(warm.prompt, /inputs\.task/);
  assert.match(warm.prompt, /inputs\.issues?/);
  assert.match(warm.prompt, /steps\.acceptance_tests\.output/);
});

test('ai-development-local-hero (#301): the mapper is a read-only, ephemeral agent with sub-agents and the code-mapping skill', () => {
  const wf = loadWorkflow(WORKFLOW);
  const mapper = wf.agents.mapper;
  assert.ok(mapper, 'the workflow declares a mapper agent');
  assert.equal(mapper.session, 'ephemeral');
  const c = caps.normalize(mapper.capabilities);
  assert.deepEqual([...c.tools].sort(), ['bash:git', 'read'], 'read and git only: no edit, no write, no other command');
  assert.equal(c.subagents, true);
  const warm = wf.steps.find((s) => s.id === 'warm_up');
  assert.ok([...(mapper.skills || []), ...((warm && warm.skills) || [])].includes('code-mapping'), 'the mapper follows the code-mapping skill');
  // Claude Code: no edit tools offered and no acceptEdits, so a write is refused by the CLI
  const { args } = caps.providerArgs('claude-code', { caps: c });
  const offered = args[args.indexOf('--tools') + 1].split(',');
  for (const tool of ['Edit', 'Write', 'NotebookEdit']) assert.ok(!offered.includes(tool), `no ${tool}`);
  assert.ok(!args.includes('acceptEdits'), 'no acceptEdits');
});

test('ai-development-local-hero (#301): the mapper runs on the developer\'s model and effort by default', (t) => {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dev-warm-model-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const run = new WorkflowRun({ file: WORKFLOW, inputs: { task: 'Add the feature', repo_path: runsDir }, mock: true, runsDir });
  assert.ok(run.wf.agents.mapper, 'the workflow declares a mapper agent');
  assert.equal(run.wf.agents.mapper.model, run.wf.agents.developer.model);
  assert.equal(run.wf.agents.mapper.effort || '', run.wf.agents.developer.effort || '');
});

test('ai-development-local-hero (#301): red_check goes to warm_up on the first visit, and warm_up goes to develop', () => {
  const wf = loadWorkflow(WORKFLOW);
  const red = wf.steps.find((s) => s.id === 'red_check');
  const first = { inputs: {}, vars: {}, steps: {}, output: { status: 'fail' } };
  const tr = red.transitions.find((x) => x.when === undefined || evalExpr(x.when, first));
  assert.equal(tr.goto, 'warm_up');
  const warm = wf.steps.find((s) => s.id === 'warm_up');
  assert.ok(warm, 'the workflow has a warm_up step');
  assert.ok((warm.transitions || []).some((x) => x.goto === 'develop'), 'warm_up goes on to develop');
});

// ------------------------------------------------------------------ #304: the affected suite

test('ai-development-local-hero (#304): the suite step runs with scope affected, and its transitions are unchanged', () => {
  const suite = loadWorkflow(WORKFLOW).steps.find((s) => s.id === 'suite');
  assert.equal(suite.scope, 'affected');
  assert.equal(suite.type, 'suite');
  // #396 added the owner's policy (a red only outside the change goes on) before the fix rounds
  assert.deepEqual(suite.transitions.map((tr) => tr.goto), ['e2e', 'build', 'test_failed', 'e2e', 'build', 'test', 'suite']);
  assert.deepEqual(suite.transitions.map((tr) => tr.when), [
    "output.status == 'pass' and inputs.e2e_tests == 'write_and_run' and steps.acceptance_tests.output.e2e_scope == 'scenarios'",
    "output.status == 'pass'",
    "output.status == 'blocked'",
    "output.status == 'fail' and output.in_change == 0 and inputs.suite_red_outside_change == 'continue' and inputs.e2e_tests == 'write_and_run' and steps.acceptance_tests.output.e2e_scope == 'scenarios'",
    "output.status == 'fail' and output.in_change == 0 and inputs.suite_red_outside_change == 'continue'",
    "output.status == 'fail' and inputs.unit_tests == 'write_and_run'",
    "output.status == 'fail'",
  ]);
});

// ------------------------------------------------------------------ skill and docs

test('ai-development-local-hero (#301, #304): the code-mapping skill describes the map: per issue, line numbers, tests per file, a run-tests block, a size cap', () => {
  const skills = require('../src/skills');
  const ids = skills.listSkills(path.join(ROOT, 'skills')).map((s) => s.id);
  assert.ok(ids.includes('code-mapping'), 'the skill library lists code-mapping');
  const text = read('skills', 'code-mapping', 'SKILL.md');
  assert.match(text, /^---\r?\nname: code-mapping\r?\n/);
  assert.match(text, /line numbers?/i);
  assert.match(text, /per issue|each issue/i);
  assert.match(text, /300 lines/);
  assert.match(text, /```run-tests/);
  assert.match(text, /node --test/);
  assert.match(text, /no test reaches it/);
  assert.match(text, /direct[\s\S]{0,200}transitive/i, 'direct tests first, then transitive');
  assert.match(text, /never the whole suite/i);
  assert.match(text, /acceptance tests?/i);
  assert.match(text, /convention/i);
});

test('ai-development-local-hero (#301, #304): the docs name the mapper as read-only and the workflow header describes Warm Up and the affected suite', () => {
  const doc = read('docs', 'agents', 'capabilities.md');
  const section = doc.slice(doc.indexOf('## Read-only agents'), doc.indexOf('\n## ', doc.indexOf('## Read-only agents') + 1));
  assert.match(section, /mapper/, 'capabilities.md lists the mapper among the read-only agents');
  const header = read('workflows', 'ai-development-local-hero.yaml').split(/\napiVersion:/)[0];
  assert.match(header, /Warm Up/);
  assert.match(header, /scope:? affected|affected scope/i);
});
