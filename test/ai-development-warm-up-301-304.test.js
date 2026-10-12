// workflows/ai-development-local-hero.yaml, #301 and #304 (acceptance tests, written before the code).
// #301: a read-only `warm_up` step (agent `mapper`, skill code-mapping) maps the code between red_check
// and develop, on the first visit only; develop starts from its map, and runs on without it when the
// mapper fails. #304: the suite step runs with `scope: affected`, and develop and the test step take
// the tests to run from the map (else the code → tests map instruction).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { WorkflowRun, loadWorkflow, evalExpr } = require('../src/engine/workflow');
const caps = require('../src/engine/capabilities');
// not from ./engine-helpers: requiring it registers that file's software-development matrix as tests here
process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';

const ROOT = path.join(__dirname, '..');
const WORKFLOW = path.join(ROOT, 'workflows', 'ai-development-local-hero.yaml');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

// a repository on main with one production file, and the run's branch checked out
function makeRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dev-warm-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  git(dir, 'init', '-q');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'module.exports = 1;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'switch', '-q', '-c', 'feat');
  return dir;
}

// A mock run of the workflow (the pattern of test/ai-development-local-hero.test.js). failAgent: that
// agent's turn fails, as when its CLI crashes. answers: { stepId: [[choice, feedback], ...] }.
// shapeOutput(name, output): the agent's answer as the model would give it (the mock cannot answer an
// empty tests_added, src/engine/providers.js).
async function runAiDev(t, { mockSequences = {}, failAgent, shapeOutput, inputs = {}, answers = {} } = {}) {
  const repo = makeRepo(t);
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dev-warm-runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const run = new WorkflowRun({
    file: WORKFLOW,
    inputs: { task: 'Add the feature', repo_path: repo, unit_tests: 'run_existing', e2e_tests: 'off', ...inputs },
    mock: true,
    runsDir,
    mockSequences: { verdict: ['approved'], suite: { red_check: ['fail'], suite: ['pass'] }, ...mockSequences },
  });
  if (failAgent) {
    const turnOf = run.runAgentStep.bind(run);
    run.runAgentStep = (step, st, name) => (name === failAgent ? Promise.reject(new Error(`${name} crashed (simulated)`)) : turnOf(step, st, name));
  }
  if (shapeOutput) {
    const turnOf = run.runAgentStep.bind(run);
    run.runAgentStep = async (step, st, name) => shapeOutput(name, await turnOf(step, st, name));
  }
  const events = [];
  const answered = {};
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') {
      const n = (answered[ev.step_id] = (answered[ev.step_id] || 0) + 1);
      const [choice, feedback] = (answers[ev.step_id] || [])[n - 1] || [ev.choices[0].id, undefined];
      setImmediate(() => run.resolveApproval(ev.approval_id, choice, 'user', feedback));
    }
  });
  await run.start();
  const transitions = events.filter((e) => e.type === 'step.transition').map((e) => `${e.from}>${e.to}`);
  const promptsOf = (step) => events.filter((e) => e.type === 'session.message_sent' && e.step_id === step).map((e) => e.prompt);
  const outputOf = (step) => events.find((e) => e.type === 'step.finished' && e.step_id === step && !e.error)?.output;
  return { events, transitions, promptsOf, outputOf, finished: events.find((e) => e.type === 'workflow.finished') };
}

const withoutSkills = (prompt) => String(prompt || '').replace(/<skill name="[^"]*"[\s\S]*?<\/skill>/g, '');
// today's develop prompt: `{{ test_map }}` renders the path of <run_dir>/test-map.md (writeTestMap)
const TEST_MAP_LINE = /Code → tests map of this checkout[^\n]*test-map\.md/;

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

// ------------------------------------------------------------------ #301: mock runs

test('ai-development-local-hero (#301): the normal path goes acceptance_tests, red_check, warm_up, develop, and the run succeeds', { timeout: 120000 }, async (t) => {
  const { transitions, finished } = await runAiDev(t);
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(transitions.slice(0, 4), [
    'acceptance_tests>red_check',
    'red_check>warm_up',
    'warm_up>develop',
    'develop>developer_screenshots',
  ]);
});

test('ai-development-local-hero (#301): a review fix round goes back to develop without a second warm_up', { timeout: 120000 }, async (t) => {
  const { transitions, promptsOf, finished } = await runAiDev(t, { mockSequences: { verdict: ['changes_requested', 'approved'] } });
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(transitions.filter((x) => x === 'code_review>develop').length, 1, 'one fix round');
  assert.equal(transitions.filter((x) => x.endsWith('>warm_up')).length, 1, 'warm_up is visited once');
  assert.equal(promptsOf('warm_up').length, 1, 'the mapper is called once');
  assert.equal(promptsOf('develop').length, 2);
});

test('ai-development-local-hero (#301): an owner\'s change request goes through the red check straight to develop, without a second warm_up', { timeout: 120000 }, async (t) => {
  const { transitions, finished } = await runAiDev(t, {
    inputs: { mode: 'validated', screenshots: 'off' },
    answers: { developer_check: [['changes', 'Move the Archive button into the menu'], ['approve']] },
    mockSequences: { suite: { red_check: ['fail', 'fail'], suite: ['pass'] }, criteria_changed: [true] },
  });
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(transitions.filter((x) => x === 'red_check>warm_up').length, 1, 'only the first red check goes to warm_up');
  assert.equal(transitions.filter((x) => x === 'red_check>develop').length, 1, 'the change request\'s red check goes straight to develop');
});

test('ai-development-local-hero (#301): the first develop prompt carries the mapper\'s map and says to read only the files it names, never re-map', { timeout: 120000 }, async (t) => {
  const { promptsOf, outputOf, finished } = await runAiDev(t);
  assert.equal(finished.status, 'success', finished.error);
  const warm = outputOf('warm_up');
  assert.ok(warm && warm.map, 'warm_up answered a map');
  const develop = withoutSkills(promptsOf('develop')[0]);
  assert.ok(develop.includes(warm.map), 'the map is in the develop prompt');
  assert.match(develop, /read only the files the map/i);
  assert.match(develop, /re-?map/i);
  assert.match(develop, /sub-agent[\s\S]{0,200}(lacks|missing|does not (cover|name))|(lacks|missing|does not (cover|name))[\s\S]{0,200}sub-agent/i, 'a sub-agent only for what the map lacks');
});

test('ai-development-local-hero (#301): a failed mapper does not fail the run: develop starts without a map, with a notice and the code → tests map', { timeout: 120000 }, async (t) => {
  const { transitions, promptsOf, finished } = await runAiDev(t, { failAgent: 'mapper' });
  assert.equal(finished.status, 'success', finished.error);
  assert.ok(transitions.includes('red_check>warm_up'), 'warm_up was tried');
  assert.ok(transitions.includes('warm_up>develop'), 'develop runs after the failed warm_up');
  const develop = withoutSkills(promptsOf('develop')[0]);
  assert.ok(develop, 'develop ran');
  assert.doesNotMatch(develop, /\(simulated\) map/, 'no map in the prompt');
  assert.match(develop, /without a map|no map/i, 'a one-line notice');
  assert.match(develop, TEST_MAP_LINE, 'today\'s code → tests map instruction applies');
});

test('ai-development-local-hero (#301): a task with nothing testable goes to develop without Warm Up, and develop gets no map and no Warm Up notice', { timeout: 120000 }, async (t) => {
  const { transitions, promptsOf } = await runAiDev(t, {
    shapeOutput: (name, out) => (name === 'test_writer' ? { ...out, tests_added: [] } : out),
  });
  assert.equal(transitions[0], 'acceptance_tests>develop', 'no acceptance test: no red check');
  assert.ok(!transitions.some((x) => x.includes('warm_up')), 'and no Warm Up');
  const develop = withoutSkills(promptsOf('develop')[0]);
  assert.ok(develop, 'develop ran');
  assert.doesNotMatch(develop, /<warm_up_map>/);
  assert.doesNotMatch(develop, /without a map/i, 'no Warm Up failed: no notice');
  // (the code → tests map line sits in the acceptance tests' block, on main too: not asserted here)
});

// ------------------------------------------------------------------ #304: the affected suite

test('ai-development-local-hero (#304): the suite step runs with scope affected, and its transitions are unchanged', () => {
  const suite = loadWorkflow(WORKFLOW).steps.find((s) => s.id === 'suite');
  assert.equal(suite.scope, 'affected');
  assert.equal(suite.type, 'suite');
  assert.deepEqual(suite.transitions.map((tr) => tr.goto), ['e2e', 'build', 'test_failed', 'test', 'suite']);
  assert.deepEqual(suite.transitions.map((tr) => tr.when), [
    "output.status == 'pass' and inputs.e2e_tests == 'write_and_run' and steps.acceptance_tests.output.e2e_scope == 'scenarios'",
    "output.status == 'pass'",
    "output.status == 'blocked'",
    "output.status == 'fail' and inputs.unit_tests == 'write_and_run'",
    "output.status == 'fail'",
  ]);
});

test('ai-development-local-hero (#304): a mock run runs the affected test files, then the whole suite once', { timeout: 120000 }, async (t) => {
  const { events, finished } = await runAiDev(t);
  assert.equal(finished.status, 'success', finished.error);
  const suite = events.find((e) => e.type === 'step.finished' && e.step_id === 'suite').output;
  assert.equal(suite.selection?.mode, 'affected', 'the suite output says which files and why');
  assert.ok(suite.affected, 'the affected files ran first');
  assert.equal(suite.scope, 'full', 'then the whole suite ran, once the affected files passed');
  assert.equal(finished.summary.suite_runs.affected, 1);
  assert.equal(finished.summary.suite_runs.engine, 1);
});

test('ai-development-local-hero (#304): develop\'s first prompt and the test step\'s prompt take the tests to run from the warm-up map', { timeout: 120000 }, async (t) => {
  const { promptsOf, outputOf, finished } = await runAiDev(t, { inputs: { unit_tests: 'write_and_run' }, mockSequences: { tests_status: ['pass'] } });
  assert.equal(finished.status, 'success', finished.error);
  const warm = outputOf('warm_up');
  assert.ok(warm && warm.map, 'warm_up answered a map');
  const develop = withoutSkills(promptsOf('develop')[0]);
  const testPrompt = withoutSkills(promptsOf('test')[0]);
  assert.ok(testPrompt, 'the test step ran');
  for (const [name, p] of [['develop', develop], ['test', testPrompt]]) {
    assert.match(p, /tests to run/i, `${name}: names the tests to run`);
    assert.ok(p.includes(warm.map), `${name}: from the warm-up map`);
  }
});

test('ai-development-local-hero (#304): without a map, develop and the test step fall back to the code → tests map', { timeout: 120000 }, async (t) => {
  const { promptsOf, finished } = await runAiDev(t, { failAgent: 'mapper', inputs: { unit_tests: 'write_and_run' }, mockSequences: { tests_status: ['pass'] } });
  assert.equal(finished.status, 'success', finished.error);
  const develop = withoutSkills(promptsOf('develop')[0]);
  const testPrompt = withoutSkills(promptsOf('test')[0]);
  assert.ok(testPrompt, 'the test step ran');
  assert.match(develop, TEST_MAP_LINE);
  assert.match(testPrompt, /test-map\.md/, 'the test step is given the code → tests map (test_map: true)');
  assert.doesNotMatch(testPrompt, /\(simulated\) map/);
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
