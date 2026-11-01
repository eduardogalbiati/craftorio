// #380: a merge conflict in a test file must not stop AI Development. Acceptance tests, written first:
// - packages/engine/engine (protect_files): a protected file the turn's rebase had in conflict may change when the
//   resolution only combines the two sides (every line comes from the base's or the branch's
//   version); a resolution that writes a new line is still refused.
// - workflows/feature.yaml: such a resolution goes to the test writer (resolve_merge
//   routes to it), and the developer keeps its protect_files.
// - packages/engine/engine/run/supervision.js: when the supervisor says a retry would fail the same way
//   (`retry_would_fail` in its decision) and names where to go on (`goto`), its gate offers that way
//   forward instead of a blind Retry, and it still waits for the person.
// - packages/engine/domains/po/product-owner.js: two groups of one stage naming the same feature file are flagged as a
//   conflict, as shared hot source files are (#150), and the skill says so.
// Runs are mock runs on a git repository in a temp folder (as test/protect-files.test.js);
// `onTurn` plays the CLI's side effects (the rebase and its resolution) before the turn is answered.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { WorkflowRun, loadWorkflow } = require('../engine/workflow');
const supervisor = require('../domains/supervisor/supervisor');
const productOwner = require('../domains/po/product-owner');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.05';
process.env.MULTIAGENT_SIMULATION_ONLY = '1'; // tests never call real models

const root = path.join(__dirname, '..', '..', '..');
const FEATURE = 'features/a.feature';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', '-c', 'core.editor=true', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

function write(dir, file, text) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
}

function commit(dir, message, files) {
  for (const [f, text] of Object.entries(files)) {
    write(dir, f, text);
    git(dir, 'add', f);
  }
  git(dir, 'commit', '-q', '-m', message);
}

const BASE = 'Feature: A\n  Scenario: one\n    Given one\n';
const MAIN_SIDE = '  Scenario: from main\n    Given the other run\n';
const BRANCH_SIDE = '  Scenario: from the branch\n    Given this run\n';

// main and the branch `feat` both appended a scenario to the protected feature file: rebasing
// `feat` onto main conflicts in it. `feat` is checked out.
function makeRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-380-repo-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  git(dir, 'init', '-q');
  commit(dir, 'base', { 'src/app.js': 'module.exports = 1;\n', [FEATURE]: BASE });
  git(dir, 'switch', '-q', '-c', 'feat');
  commit(dir, 'branch scenario', { 'src/app.js': 'module.exports = 2;\n', [FEATURE]: BASE + BRANCH_SIDE });
  git(dir, 'switch', '-q', 'main');
  commit(dir, 'another run merged first', { [FEATURE]: BASE + MAIN_SIDE });
  git(dir, 'switch', '-q', 'feat');
  return dir;
}

// The developer's turn: `git rebase main`, the conflicted feature file written as `resolved`, then
// `git rebase --continue`.
function rebaseAndResolve(repo, resolved) {
  try {
    git(repo, 'rebase', 'main');
    assert.fail('the fixture must conflict');
  } catch (e) {
    if (e.code === 'ERR_ASSERTION') throw e;
  }
  write(repo, FEATURE, resolved);
  git(repo, 'add', FEATURE);
  git(repo, 'rebase', '--continue');
}

// A mock run of one step `resolve_merge` (as in ai-development-local-hero: the developer, edits_tests:
// true, protect_files on the agent), on a run whose base branch is the local main.
// `stopOnRefusal` (#456): the run is stopped at the first protected refusal, so a test about it does not
// wait for the two send-backs that follow (each one a full protect_files check, seconds on a busy machine).
async function runResolve(t, onTurn, { stopOnRefusal = false } = {}) {
  const repo = makeRepo(t);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-380-wf-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, [
    'inputs:',
    '  repo_path: { type: string, required: true }',
    'orchestrator:',
    '  provider: claude',
    '  model: m',
    '  worktree: { repo: "{{ inputs.repo_path }}", base: main, remote: false }',
    'providers:',
    '  claude: { type: claude-code, command: claude }',
    'defaults:',
    '  working_dir: "{{ inputs.repo_path }}"',
    'agents:',
    `  developer: { provider: claude, model: m, session: handoff, protect_files: ${JSON.stringify([FEATURE])}, capabilities: { tools: [read, edit, write, bash:git] } }`,
    'steps:',
    '  - id: resolve_merge',
    '    agent: developer',
    '    edits_tests: true',
    '    prompt: "Rebase onto main and resolve the conflicts."',
    '    output_schema: { type: object, required: [summary], properties: { summary: { type: string } } }',
    '    transitions:',
    '      - { when: "true", goto: end }',
    '',
  ].join('\n'));
  const run = new WorkflowRun({ file, inputs: { repo_path: repo }, mock: true, runsDir: path.join(dir, 'runs'), skillsDirs: [] });
  const events = [];
  let turn = 0;
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'session.message_sent' && ev.step_id === 'resolve_merge') onTurn(repo, ++turn);
    if (stopOnRefusal && ev.type === 'tests.refused' && ev.protected) run.stop();
  });
  await run.start();
  return { events, finished: events.find((e) => e.type === 'workflow.finished'), repo };
}

// ---- protect_files: a conflicted test file resolved as a pure combination ------------------------------

test('protect_files: a conflicted protected test file resolved by combining both sides is accepted', { timeout: 60000 }, async (t) => {
  const { events, finished, repo } = await runResolve(t, (r, n) => {
    if (n === 1) rebaseAndResolve(r, BASE + MAIN_SIDE + BRANCH_SIDE);
  });
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(events.filter((e) => e.type === 'tests.refused' && e.protected).length, 0, 'a pure combination is not refused');
  assert.equal(events.filter((e) => e.type === 'session.message_sent' && e.step_id === 'resolve_merge').length, 1, 'no send-back');
  assert.equal(fs.readFileSync(path.join(repo, FEATURE), 'utf8'), BASE + MAIN_SIDE + BRANCH_SIDE);
});

test('protect_files: a conflicted protected test file resolved with a new line is still refused, naming the file', { timeout: 60000 }, async (t) => {
  const { events, finished } = await runResolve(t, (r, n) => {
    if (n === 1) rebaseAndResolve(r, BASE + MAIN_SIDE + BRANCH_SIDE + '    And a step neither side wrote\n');
  }, { stopOnRefusal: true });
  // #456: Stop pressed at the refusal ends the run there: no send-back turn, no further check
  assert.equal(finished.status, 'cancelled');
  assert.equal(events.filter((e) => e.type === 'session.message_sent' && e.step_id === 'resolve_merge').length, 1, 'a stopped run sends nothing back');
  const refused = events.filter((e) => e.type === 'tests.refused' && e.protected);
  assert.equal(refused.length, 1, 'the resolution that writes a new test line is refused (the run stops there)');
  assert.deepEqual(refused[0].files, [FEATURE]);
  assert.equal(refused[0].attempt, 1);
});

// ---- workflows/feature.yaml: a real test change goes to the test writer --------------

const AI_DEV = path.join(root, 'workflows', 'feature.yaml');

test('ai-development: resolve_merge routes a test conflict that needs new lines to the test writer, with the conflict', () => {
  const wf = loadWorkflow(AI_DEV);
  const step = (id) => wf.steps.find((s) => s.id === id);
  const resolve = step('resolve_merge');
  // either a delegate to the test writer, or a goto to a step the test writer runs
  const routes = (resolve.transitions || []).flatMap((tr) => {
    const out = [];
    if (tr.delegate && tr.delegate.agent === 'test_writer') out.push(String(tr.delegate.prompt || ''));
    for (const target of [tr.goto, tr.on_exhausted]) {
      const s = target && step(target);
      if (s && s.agent === 'test_writer') out.push(String(s.prompt || ''));
    }
    return out;
  });
  assert.ok(routes.length >= 1, 'a transition of resolve_merge leads to the test writer');
  assert.ok(routes.some((p) => /conflict/i.test(p)), 'the test writer gets the conflict');
});

test('ai-development: the developer still never writes tests in resolve_merge (protect_files stays on the developer)', () => {
  const wf = loadWorkflow(AI_DEV);
  const resolve = wf.steps.find((s) => s.id === 'resolve_merge');
  assert.equal(resolve.agent, 'developer');
  assert.ok(wf.agents.developer.protect_files, 'the developer keeps its protect_files');
});

// ---- packages/engine/engine/run/supervision.js: the supervisor's gate is not a dead end ------------------------------

const SUP_WF = `
apiVersion: multiagent/v1
kind: Workflow
metadata: { name: fixture-supervisor-380 }
orchestrator:
  provider: claude
  model: m
  supervisor: { enabled: true, max_interventions: 2 }
providers:
  claude: { type: claude-code, command: claude }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: check
    agent: a
    prompt: "check"
    output_schema:
      type: object
      required: [verdict]
      properties: { verdict: { type: string, enum: [pass, issues] } }
    transitions:
      - { when: "true", goto: after }
  - id: after
    agent: a
    prompt: "after"
`;

// `check` never answers valid json; the supervisor answers `decision` once.
function supervisedRun(t, decision) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sup-380-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, SUP_WF);
  const run = new WorkflowRun({ file, inputs: {}, mock: true, runsDir: path.join(dir, 'runs') });
  let asked = 0;
  run.sendToAgent = async (agent, prompt) => {
    if (agent === 'supervisor') {
      asked++;
      const d = asked === 1 ? decision : { explanation: 'give up', action: 'fail' };
      return { text: '```json\n' + JSON.stringify(d) + '\n```' };
    }
    if (prompt.includes('after')) return { text: 'done' };
    return { text: 'no json' };
  };
  return run;
}

test('supervisor: the failure decision can say that a retry would fail the same way', () => {
  assert.equal(supervisor.DECISION_SCHEMA.properties.retry_would_fail?.type, 'boolean');
});

test('supervisor gate: when a retry would fail the same way, the gate offers the supervisor\'s way forward instead of Retry, and waits for the person', { timeout: 30000 }, async (t) => {
  const run = supervisedRun(t, {
    explanation: 'The prompt and the guard contradict each other: a retry would fail the same way.',
    action: 'ask_human', retry_would_fail: true, goto: 'after',
  });
  const events = [];
  let gate = null;
  run.on('event', (e) => {
    events.push(e);
    if (e.type === 'approval.requested' && !gate) {
      gate = { id: e.approval_id, choices: (e.choices || []).map((c) => ({ id: c.id, label: String(c.label || '') })), at: events.length };
      const forward = gate.choices.find((c) => c.id !== 'stop' && c.id !== 'retry');
      setImmediate(() => run.resolveApproval(e.approval_id, forward ? forward.id : 'stop'));
    }
  });
  await run.start();
  assert.ok(gate, 'the supervisor asks the person');
  const ids = gate.choices.map((c) => c.id);
  assert.equal(ids.includes('retry'), false, `no blind Retry: ${ids.join(', ')}`);
  assert.ok(ids.includes('stop'), 'stopping stays possible');
  const forward = gate.choices.find((c) => c.id !== 'stop');
  assert.ok(forward, 'a way forward is offered');
  assert.match(forward.label, /after/, 'the way forward names the step it resumes from');
  // nobody but the person answered the gate: no step started between the question and the answer
  const answeredAt = events.findIndex((e) => e.type === 'approval.resolved');
  assert.ok(answeredAt >= gate.at, 'the gate is answered after it was asked');
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);
  assert.ok(events.some((e) => e.type === 'step.started' && e.step_id === 'after'), 'the run resumed from the step the supervisor named');
  assert.equal(events.filter((e) => e.type === 'step.started' && e.step_id === 'check').length, 1, 'the failing step was not retried');
});

test('supervisor gate: without retry_would_fail, Retry is still offered (control)', { timeout: 30000 }, async (t) => {
  const run = supervisedRun(t, { explanation: 'Needs a person.', action: 'ask_human' });
  let ids = null;
  run.on('event', (e) => {
    if (e.type === 'approval.requested' && !ids) {
      ids = (e.choices || []).map((c) => c.id);
      setImmediate(() => run.resolveApproval(e.approval_id, 'stop'));
    }
  });
  await run.start();
  assert.deepEqual(ids, ['retry', 'stop']);
});

// ---- packages/engine/domains/po/product-owner.js: placement warns about shared test files -----------------------------------

const LONG = ' It needs a few changes in the module, described here in enough words to be implemented without guessing anything.';
// Two to-do issues of different areas (two groups) that both add scenarios to the same feature file.
const SHARED_FEATURE = {
  projectId: 'demo',
  issues: [
    { number: 1, state: 'open', title: 'Show the plan in Architecture', labels: [{ name: 'area:architecture' }], body: `Add scenarios to fronts/analyser/features/architecture.feature for the plan view.${LONG}` },
    { number: 2, state: 'open', title: 'Filter the Architecture tab', labels: [{ name: 'area:filters' }], body: `Add scenarios to fronts/analyser/features/architecture.feature for the filter.${LONG}` },
  ],
};
const SPEED = 1; // every group of a stage runs at once
test('placement: two groups of one stage adding scenarios to the same feature file are flagged as a conflict naming that file', () => {
  // no conflict map: the feature file is not a hot file, it is flagged because both items add to it
  const answer = productOwner.mockAnswer({ data: SHARED_FEATURE, calibration: SPEED });
  const conflict = (answer.conflicts || []).find((c) => [...c.issues].sort().join(',') === '1,2');
  assert.ok(conflict, 'a conflict between #1 and #2');
  assert.ok(conflict.files.includes('fronts/analyser/features/architecture.feature'), `files: ${conflict.files}`);
});

test('the backlog-product-owner skill flags items of one stage that add scenarios to the same feature file', () => {
  const text = fs.readFileSync(path.join(root, 'skills', 'backlog-product-owner', 'SKILL.md'), 'utf8');
  assert.match(text, /\.feature\b/);
  assert.match(text, /scenarios?/i);
});
