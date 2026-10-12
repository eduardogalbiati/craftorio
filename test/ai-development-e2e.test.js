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
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { WorkflowRun, loadWorkflow } = require('../src/engine/workflow');
// not from ./engine-helpers: requiring it registers that file's software-development matrix as tests here
process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';

const WORKFLOW = path.join(__dirname, '..', 'workflows', 'ai-development-local-hero.yaml');
const ISSUE = 'https://github.com/acme/app/issues/223';
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

function makeRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dev-e2e-repo-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  git(dir, 'init', '-q');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'module.exports = 1;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'switch', '-q', '-c', 'feat');
  return dir;
}

// the prompt without its injected skills (their text mentions tags and sub-agents in general)
const ownText = (prompt) => String(prompt || '').replace(/<skill name="[^"]*"[\s\S]*?<\/skill>/g, '');

// A mock run with E2E written and run (unless `inputs` says otherwise). `mockSequences.suite.e2e`:
// the E2E step's runner result per visit; `e2e_scope`, `heal_status`: the agents' answers per visit.
async function runAiDevE2e(t, { inputs = {}, mockSequences = {}, onTurn } = {}) {
  const repo = makeRepo(t);
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dev-e2e-runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const run = new WorkflowRun({
    file: WORKFLOW,
    inputs: { task: 'Show the backlog as a kanban board', issue: ISSUE, repo_path: repo, e2e_tests: 'write_and_run', unit_tests: 'run_existing', ...inputs },
    mock: true,
    runsDir,
    mockSequences: { verdict: ['approved'], e2e_scope: ['scenarios'], ...mockSequences },
  });
  const events = [];
  const agentOf = new Map();
  let turn = 0;
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'session.opened') agentOf.set(ev.session_id, ev.session?.agent);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, ev.choices[0].id, 'user', undefined));
    if (ev.type === 'session.message_sent' && ev.step_id === 'develop' && onTurn) onTurn(repo, ++turn);
  });
  await run.start();
  const transitions = events.filter((e) => e.type === 'step.transition').map((e) => `${e.from}>${e.to}`);
  // every prompt sent, in order, with the agent that received it
  const sent = events.filter((e) => e.type === 'session.message_sent').map((e) => ({ step: e.step_id, agent: agentOf.get(e.session_id), prompt: e.prompt }));
  const promptsOf = (step) => sent.filter((s) => s.step === step).map((s) => s.prompt);
  return { events, transitions, sent, promptsOf, finished: events.find((e) => e.type === 'workflow.finished'), repo };
}

const GREEN = { red_check: ['fail'], suite: ['pass'], e2e: ['pass'] };

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

test('ai-development e2e: a UI issue gets its scenarios written first, run by the machine after the suite, green without an agent', { timeout: 120000 }, async (t) => {
  const { transitions, sent, finished } = await runAiDevE2e(t, { mockSequences: { suite: GREEN } });
  assert.equal(finished.status, 'success', finished.error);
  // #246: the test id check after develop (test/testid-check-246.test.js) is left out of this path
  const route = transitions.join(',').replace(/develop>testid_check,testid_check>/g, 'develop>').split(',');
  assert.deepEqual(route, [
    'acceptance_tests>red_check',
    'red_check>warm_up',
    'warm_up>develop',
    // #151: the mock developer lists one screen: captured for the ui_reviewer in automatic mode too
    'develop>developer_screenshots',
    'developer_screenshots>code_review',
    'code_review>suite',
    'suite>e2e',
    'e2e>build',
    'build>evidence',
    'evidence>verify_change',
    'verify_change>end',
  ]);
  assert.equal(sent.filter((s) => s.step === 'heal').length, 0, 'no healer turn on a green run');
});

test('ai-development e2e: the acceptance tests step asks for the issue\'s scenarios in parallel with the unit tests, from the criteria', { timeout: 120000 }, async (t) => {
  const { promptsOf } = await runAiDevE2e(t, { mockSequences: { suite: GREEN } });
  const full = promptsOf('acceptance_tests')[0];
  assert.match(full, /<skill name="e2e-test-writer-js"/, 'the E2E test skill is loaded for the scenarios');
  const prompt = ownText(full);
  assert.match(prompt, /@issue-223/, 'the scenarios are tagged with the issue number');
  assert.match(prompt, /features\/[^\s]*\.feature/, 'the scenarios go to features/*.feature');
  assert.match(prompt, /sub-?agents?/i, 'unit and E2E go to sub-agents');
  assert.match(prompt, /parallel/i, 'the two sub-agents run in parallel');
  assert.match(prompt, /reus/i, 'existing steps are reused first');
  assert.match(prompt, /data-testid/, 'new locators may not exist yet: the developer adds the test ids');
  assert.match(prompt, /engine|docs|refactor/i, 'an issue without user-visible behaviour gets no scenario');
  assert.match(prompt, /e2e_scope/, 'the answer says whether scenarios were written');
});

test('ai-development e2e: with E2E off the acceptance tests step asks for no scenario', { timeout: 120000 }, async (t) => {
  const { promptsOf, transitions, finished } = await runAiDevE2e(t, { inputs: { e2e_tests: 'off' }, mockSequences: { suite: { red_check: ['fail'], suite: ['pass'] } } });
  assert.equal(finished.status, 'success', finished.error);
  const full = promptsOf('acceptance_tests')[0];
  assert.doesNotMatch(full, /<skill name="e2e-test-writer-js"/);
  assert.doesNotMatch(ownText(full), /@issue-223/);
  assert.ok(!transitions.some((x) => x.includes('e2e')), 'no e2e step when E2E is off');
});

test('ai-development e2e: an engine issue (no scenario) skips the e2e step', { timeout: 120000 }, async (t) => {
  const { transitions, sent, finished } = await runAiDevE2e(t, { mockSequences: { e2e_scope: ['none'], suite: GREEN } });
  assert.equal(finished.status, 'success', finished.error);
  // the scenarios are written first (acceptance_tests): no test writer turn after the review either
  assert.ok(transitions.includes('code_review>suite'), `the review goes to the suite (got ${transitions.join(', ')})`);
  assert.ok(transitions.includes('suite>build'), `the suite goes straight to the build (got ${transitions.join(', ')})`);
  assert.ok(!transitions.some((x) => /(^|>)(e2e|heal)(>|$)/.test(x)), 'neither the e2e step nor the healer runs');
  assert.equal(sent.filter((s) => s.step === 'heal').length, 0);
});

test('ai-development e2e: the developer is told to add the test ids, and a turn that changes a scenario file is refused', { timeout: 120000 }, async (t) => {
  // the scenario files are the ones the test writer reports (the mock's placeholder name)
  const scenario = '(simulated) e2e_files';
  const { events, finished, promptsOf } = await runAiDevE2e(t, {
    mockSequences: { suite: GREEN },
    onTurn(repo, n) {
      if (n === 1) {
        fs.writeFileSync(path.join(repo, scenario), 'changed by the developer\n');
        git(repo, 'add', '-A');
        git(repo, 'commit', '-q', '-m', 'develop: change the scenario');
      }
      if (n === 2) {
        git(repo, 'rm', '-q', scenario);
        git(repo, 'commit', '-q', '-m', 'put the scenario back');
      }
    },
  });
  assert.equal(finished.status, 'success', finished.error);
  const first = ownText(promptsOf('develop')[0]);
  assert.match(first, /\(simulated\) e2e_files/, 'the developer is given the scenarios to make pass');
  assert.match(first, /data-testid/, 'the developer adds the test ids the scenarios use');
  const refused = events.filter((e) => e.type === 'tests.refused');
  assert.equal(refused.length, 1);
  assert.equal(refused[0].protected, true);
  assert.equal(refused[0].agent, 'developer');
  assert.deepEqual(refused[0].files, [scenario]);
});

test('ai-development e2e: a red scenario healed by a locator fix goes back to the e2e step, without the developer', { timeout: 120000 }, async (t) => {
  const { transitions, sent, finished } = await runAiDevE2e(t, { mockSequences: { suite: { ...GREEN, e2e: ['fail', 'pass'] }, heal_status: ['healed'] } });
  assert.equal(finished.status, 'success', finished.error);
  const i = transitions.indexOf('e2e>heal');
  assert.ok(i >= 0, `a red scenario goes to the healer (got ${transitions.join(', ')})`);
  assert.equal(transitions[i + 1], 'heal>e2e', 'a healed scenario runs again');
  assert.equal(transitions[i + 2], 'e2e>build');
  const heal = sent.filter((s) => s.step === 'heal');
  assert.equal(heal.length, 1);
  assert.notEqual(heal[0].agent, 'developer', 'the healer is its own agent');
  const fromHeal = sent.findIndex((s) => s.step === 'heal');
  assert.ok(!sent.slice(fromHeal + 1).some((s) => s.agent === 'developer'), 'a healed locator needs no developer turn');
});

test('ai-development e2e: the healer reads the failure, the trace and the accessibility snapshot, and never weakens an assertion', { timeout: 120000 }, async (t) => {
  const { promptsOf } = await runAiDevE2e(t, { mockSequences: { suite: { ...GREEN, e2e: ['fail', 'pass'] }, heal_status: ['healed'] } });
  const prompt = ownText(promptsOf('heal')[0]);
  assert.ok(prompt, 'the healer got a prompt');
  assert.match(prompt, /trace/i, 'the Playwright trace');
  assert.match(prompt, /accessibility snapshot|aria snapshot/i, 'the accessibility snapshot at the failing step');
  assert.match(prompt, /locator/i);
  assert.match(prompt, /wait/i);
  assert.match(prompt, /never (weaken|remove)[^.]*assertion/i, 'assertions are never weakened or removed');
  assert.doesNotMatch(prompt, /\.png\b/, 'no screenshot by default');
});

test('ai-development e2e: a red scenario that is a product bug goes to the developer with the healer\'s evidence, then runs again', { timeout: 120000 }, async (t) => {
  const { transitions, sent, finished } = await runAiDevE2e(t, { mockSequences: { suite: { ...GREEN, e2e: ['fail', 'pass'] }, heal_status: ['app'] } });
  assert.equal(finished.status, 'success', finished.error);
  assert.ok(transitions.includes('e2e>heal'));
  const fromHeal = sent.findIndex((s) => s.step === 'heal');
  const toDeveloper = sent.slice(fromHeal + 1).find((s) => s.agent === 'developer');
  assert.ok(toDeveloper, 'the developer gets a turn after the healer');
  // the healer's failure_report (the mock's text) is the evidence
  assert.match(toDeveloper.prompt, /validateSchema accepts an invalid enum/);
  const lastE2e = transitions.lastIndexOf('e2e>build');
  assert.ok(lastE2e > transitions.indexOf('e2e>heal'), 'the scenarios run again after the fix, then the build');
});

test('ai-development e2e: after 2 healing rounds a still red scenario stops at the test_failed gate, with an E2E summary', { timeout: 120000 }, async (t) => {
  const { events, transitions, sent, finished } = await runAiDevE2e(t, { mockSequences: { suite: { ...GREEN, e2e: ['fail'] }, heal_status: ['healed'] } });
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(sent.filter((s) => s.step === 'heal').length, 2, 'at most 2 healing rounds');
  assert.ok(transitions.includes('e2e>test_failed'), `then the test_failed gate (got ${transitions.join(', ')})`);
  const gate = events.find((e) => e.type === 'approval.requested' && e.step_id === 'test_failed');
  assert.ok(gate, 'the gate is asked');
  assert.match(JSON.stringify(gate.brief || ''), /scenario|E2E/i, 'the gate summary is about the E2E run');
});

test('ai-development e2e: the evidence uses the E2E run\'s screenshots and traces when the issue has scenarios', { timeout: 120000 }, async (t) => {
  const ui = await runAiDevE2e(t, { mockSequences: { suite: GREEN } });
  const uiEvidence = ownText(ui.promptsOf('evidence')[0]);
  assert.match(uiEvidence, /E2E/, 'the evidence step is pointed at the E2E run');
  assert.match(uiEvidence, /trace/i, 'with its trace links');

  const engine = await runAiDevE2e(t, { mockSequences: { e2e_scope: ['none'], suite: GREEN } });
  assert.doesNotMatch(ownText(engine.promptsOf('evidence')[0]), /trace/i, 'no E2E run, no trace');
});
