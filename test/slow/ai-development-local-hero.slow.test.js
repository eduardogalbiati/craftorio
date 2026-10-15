// workflows/ai-development-local-hero.yaml (#220): the tests-first workflow. Mock runs of the whole
// flow (acceptance tests → red check → develop → review → suite → merge), on a git repository in a
// temp folder so the developer's turn can change files; the mock writes no real code.
// Split by #306 (whole mock runs of a bundled workflow live in test/slow/, docs/agents/testing.md):
// the rest of this file's tests are in test/ai-development-local-hero.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { WorkflowRun } = require('../../src/engine/workflow');
process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';

const WORKFLOW = path.join(__dirname, '..', '..', 'workflows', 'ai-development-local-hero.yaml');
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

// a repository on main with one production file, and the run's branch checked out: the developer's
// commits must not be on main, or the guard reads them as part of the base (changedTestFiles ^main)
function makeRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dev-repo-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  git(dir, 'init', '-q');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'module.exports = 1;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'switch', '-q', '-c', 'feat');
  return dir;
}

// A mock run of the workflow. `mockSequences` shapes the mock's answers (suite.red_check: the red
// check's runner result per visit); `onTurn(repo, n)` plays the developer's side effects before its n-th turn.
// `answers: { stepId: [[choice, feedback], ...] }`: the owner's answer per visit of a gate (default: the
// first choice); `beforeAnswer(stepId, n)` runs just before the n-th answer of a gate (e.g. a long wait).
async function runAiDev(t, { mockSequences = {}, onTurn, failAgent, inputs = {}, answers = {}, beforeAnswer } = {}) {
  const repo = makeRepo(t);
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dev-runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const run = new WorkflowRun({
    file: WORKFLOW,
    // the paths below are the lean ones (no extra test step, no E2E); the defaults are pinned by their own test
    inputs: { task: 'Add the feature', repo_path: repo, unit_tests: 'run_existing', e2e_tests: 'off', ...inputs },
    mock: true,
    runsDir,
    // the reviewer approves the change on its first look, unless a test says otherwise
    mockSequences: { verdict: ['approved'], ...mockSequences },
  });
  // failAgent: that agent's turn fails, as when its CLI crashes (the boundary of the mock provider)
  if (failAgent) {
    const turnOf = run.runAgentStep.bind(run);
    run.runAgentStep = (step, st, name) => (name === failAgent ? Promise.reject(new Error(`${name} crashed (simulated)`)) : turnOf(step, st, name));
  }
  const events = [];
  let turn = 0;
  const answered = {};
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') {
      const n = (answered[ev.step_id] = (answered[ev.step_id] || 0) + 1);
      const [choice, feedback] = (answers[ev.step_id] || [])[n - 1] || [ev.choices[0].id, undefined];
      setImmediate(() => {
        if (beforeAnswer) beforeAnswer(ev.step_id, n);
        run.resolveApproval(ev.approval_id, choice, 'user', feedback);
      });
    }
    if (ev.type === 'session.message_sent' && ev.step_id === 'develop' && onTurn) onTurn(repo, ++turn);
  });
  await run.start();
  const transitions = events.filter((e) => e.type === 'step.transition').map((e) => `${e.from}>${e.to}`);
  const promptsOf = (step) => events.filter((e) => e.type === 'session.message_sent' && e.step_id === step).map((e) => e.prompt);
  const prompts = promptsOf('develop');
  return { events, transitions, prompts, promptsOf, finished: events.find((e) => e.type === 'workflow.finished'), repo };
}

// Folded in by #306 (same run, assertions included here): "ai-development-local-hero (#301): the
// normal path goes acceptance_tests, red_check, warm_up, develop, and the run succeeds".
test('ai-development-local-hero: the normal path runs the acceptance tests, the red check, develop, review, suite, then merges', { timeout: 120000 }, async (t) => {
  const { transitions, finished, prompts } = await runAiDev(t, { mockSequences: { suite: { red_check: ['fail'], suite: ['pass'] } } });
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(transitions, [
    'acceptance_tests>red_check',
    'red_check>warm_up',
    'warm_up>develop',
    // #151: the mock developer lists one screen, so its screenshots are taken in automatic mode too
    'develop>developer_screenshots',
    'developer_screenshots>code_review',
    'code_review>suite',
    'suite>build',
    'build>evidence',
    'evidence>verify_change',
    'verify_change>end',
  ]);
  // the developer is given the acceptance tests the test writer wrote (the mock's placeholder name)
  assert.match(prompts[0], /Acceptance tests \(written before the code, from the task\): \(simulated\) tests_added\./);
});

test('ai-development-local-hero: an acceptance test that already passes is reported to develop as already green', { timeout: 120000 }, async (t) => {
  const { transitions, finished, prompts } = await runAiDev(t, { mockSequences: { suite: { red_check: ['pass'], suite: ['pass'] } } });
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(transitions.slice(1, 3), ['red_check>warm_up', 'warm_up>develop'], 'a green check goes on to develop (through Warm Up, #301)');
  assert.match(prompts[0], /already green/, 'the develop prompt names the tests that already pass');
});

test('ai-development-local-hero: acceptance tests that cannot run go back to the test writer once, then on to develop', { timeout: 120000 }, async (t) => {
  const { transitions, finished } = await runAiDev(t, { mockSequences: { suite: { red_check: ['broken', 'fail'], suite: ['pass'] } } });
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(transitions.slice(0, 5), [
    'acceptance_tests>red_check',
    'red_check>acceptance_tests',
    'acceptance_tests>red_check',
    'red_check>warm_up',
    'warm_up>develop',
  ]);
});

test('ai-development-local-hero: acceptance tests still broken after the one send-back go on to develop, not round again', { timeout: 120000 }, async (t) => {
  const { transitions, finished } = await runAiDev(t, { mockSequences: { suite: { red_check: ['broken', 'broken'], suite: ['pass'] } } });
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(transitions.filter((x) => x === 'red_check>acceptance_tests').length, 1);
  assert.equal(transitions.filter((x) => x === 'acceptance_tests>red_check').length, 2);
  assert.ok(transitions.includes('red_check>develop'));
});

test('ai-development-local-hero: a developer turn that changes an acceptance test is refused, and the developer\'s own test file is not', { timeout: 120000 }, async (t) => {
  // the protected file is the one the test writer's step reports (the mock's placeholder name)
  const acceptance = '(simulated) tests_added';
  const { events, finished, prompts } = await runAiDev(t, {
    mockSequences: { suite: { red_check: ['fail'], suite: ['pass'] } },
    onTurn(repo, n) {
      if (n === 1) {
        fs.writeFileSync(path.join(repo, acceptance), 'changed by the developer\n');
        fs.writeFileSync(path.join(repo, 'test-own.test.js'), "require('node:test');\n");
        git(repo, 'add', '-A');
        git(repo, 'commit', '-q', '-m', 'develop: change the acceptance test');
      }
      if (n === 2) {
        git(repo, 'rm', '-q', acceptance);
        git(repo, 'commit', '-q', '-m', 'put the acceptance test back');
      }
    },
  });
  assert.equal(finished.status, 'success', finished.error);
  const refused = events.filter((e) => e.type === 'tests.refused');
  assert.equal(refused.length, 1);
  assert.equal(refused[0].protected, true);
  assert.equal(refused[0].agent, 'developer');
  assert.deepEqual(refused[0].files, ['(simulated) tests_added'], 'only the acceptance test is refused');
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /- \(simulated\) tests_added/);
});

test('ai-development-local-hero: the developer may add its own test file: the protection does not cover it', { timeout: 120000 }, async (t) => {
  const { events, finished } = await runAiDev(t, {
    mockSequences: { suite: { red_check: ['fail'], suite: ['pass'] } },
    onTurn(repo, n) {
      if (n === 1) {
        fs.writeFileSync(path.join(repo, 'test-own.test.js'), "require('node:test');\n");
        git(repo, 'add', '-A');
        git(repo, 'commit', '-q', '-m', 'develop: its own internal test');
      }
    },
  });
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(events.filter((e) => e.type === 'tests.refused').length, 0);
});

// #303 (replaces #179's self-review check): the develop turn ends at green acceptance tests and a
// commit; the review of the diff is the code_review step's, in its own session
test('ai-development-local-hero (#303): a mock run asks the developer for no self-review of its diff; code_review reviews it', { timeout: 120000 }, async (t) => {
  const { events, finished, prompts } = await runAiDev(t, { mockSequences: { suite: { red_check: ['fail'], suite: ['pass'] } } });
  assert.equal(finished.status, 'success', finished.error);
  assert.doesNotMatch(prompts[0], /git diff [^\s`{]+\.\.\.HEAD/, 'the develop prompt does not ask to read the branch diff');
  assert.doesNotMatch(prompts[0], /Fix what you find with a new commit/i, 'no self-review fix commit');
  assert.doesNotMatch(prompts[0], /<skill name="code-review"/, 'the develop prompt does not carry the code-review skill');
  // #151: code_review also runs the UI Reviewer; the code reviewer's own session is the one that reviews
  const reviewer = events.find((e) => e.type === 'session.opened' && e.session.agent === 'reviewer');
  assert.ok(reviewer, 'the reviewer has a session');
  const review = events.find((e) => e.type === 'session.message_sent' && e.step_id === 'code_review' && e.session_id === reviewer.session_id);
  assert.ok(review, 'code_review ran');
  assert.match(review.prompt, /git diff [^\s`{]+\.\.\.[^\s`{]+/, 'the reviewer reads the branch diff');
});

// the sessions a step opened, by agent: { reviewer: [session ids], ui_reviewer: [...] }
function sessionsOf(events, stepId) {
  const out = {};
  for (const e of events) if (e.type === 'session.opened' && e.session.step_id === stepId) (out[e.session.agent] ||= []).push(e.session_id);
  return out;
}

test('ai-development-local-hero (#151): a mock run with a UI change takes the screenshots, then runs the reviewer and the ui_reviewer in parallel', { timeout: 120000 }, async (t) => {
  const { events, transitions, finished } = await runAiDev(t, { mockSequences: { suite: { red_check: ['fail'], suite: ['pass'] } } });
  assert.equal(finished.status, 'success', finished.error);
  assert.ok(transitions.indexOf('develop>developer_screenshots') >= 0, 'the screenshots run after develop');
  assert.ok(transitions.indexOf('developer_screenshots>code_review') > transitions.indexOf('develop>developer_screenshots'), 'then the review, without the owner\'s gate');
  assert.ok(!transitions.includes('developer_screenshots>developer_check'), 'automatic mode has no developer_check gate');
  const sessions = sessionsOf(events, 'code_review');
  assert.ok(sessions.reviewer?.length, 'the reviewer ran in code_review');
  assert.ok(sessions.ui_reviewer?.length, 'the ui_reviewer ran in code_review');
  // in parallel: both agents are sent their prompt before either answers
  const ids = [...sessions.reviewer, ...sessions.ui_reviewer];
  const firstAnswer = events.findIndex((e) => e.type === 'session.message_received' && ids.includes(e.session_id));
  const sent = (id) => events.findIndex((e) => e.type === 'session.message_sent' && e.session_id === id);
  assert.ok(firstAnswer > 0, 'the review agents answered');
  assert.ok(sent(sessions.reviewer[0]) < firstAnswer && sent(sessions.ui_reviewer[0]) < firstAnswer, 'both prompts are sent before the first answer');
  // the UI Reviewer reviews against both skills: they are in its prompt
  const uiPrompt = events.find((e) => e.type === 'session.message_sent' && e.session_id === sessions.ui_reviewer[0]).prompt;
  assert.match(uiPrompt, /<skill name="ui-conventions"/);
  assert.match(uiPrompt, /<skill name="design-system"/);
  // #387: its answer carries the per-screen lines its own schema requires, so it is not dropped as failed
  const review = events.find((e) => e.type === 'step.finished' && e.step_id === 'code_review');
  assert.deepEqual([...review.output.succeeded].sort(), ['reviewer', 'ui_reviewer']);
  const screens = review.output.results.ui_reviewer.screens;
  assert.equal(Array.isArray(screens) && screens.length >= 1, true);
  assert.equal(typeof screens[0].message, 'string');
  assert.equal(typeof screens[0].weakness, 'string');
});

test('ai-development-local-hero (#151): a blocking UI finding goes back to develop once, and the second review comes before test, suite, E2E and build', { timeout: 120000 }, async (t) => {
  // the mock's ui_findings: one blocking finding on every look (src/engine/providers.js)
  const { transitions, finished, prompts } = await runAiDev(t, { mockSequences: { suite: { red_check: ['fail'], suite: ['pass'] }, ui_findings: true } });
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(transitions.filter((x) => x === 'code_review>develop').length, 1, 'one UI fix round, then the run goes on');
  const back = transitions.indexOf('code_review>develop');
  const later = transitions.findIndex((x) => /^(test|suite|e2e|build|evidence)>/.test(x) || /^code_review>(test|suite|e2e|build)$/.test(x));
  assert.ok(back >= 0 && later > back, 'the UI fix round happens before any test/suite/E2E/build');
  assert.equal(transitions.filter((x) => x === 'developer_screenshots>code_review').length, 2, 'the fixed change is captured and reviewed again');
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /\(simulated\) problem/, 'the developer is given the blocking UI finding');
});

test('ai-development-local-hero (#151): code findings and a blocking UI finding reach develop together, in one turn', { timeout: 120000 }, async (t) => {
  const { transitions, finished, prompts } = await runAiDev(t, {
    mockSequences: { suite: { red_check: ['fail'], suite: ['pass'] }, verdict: ['changes_requested', 'approved'], ui_findings: true },
  });
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(transitions.filter((x) => x === 'code_review>develop').length, 1, 'one fix round for both reviews');
  assert.match(prompts[1], /\(simulated\) description/, 'the code reviewer\'s finding');
  assert.match(prompts[1], /\(simulated\) problem/, 'the UI Reviewer\'s blocking finding');
});

test('ai-development-local-hero (#151): in a mock run, evidence\'s output carries no UI verdict even when the UI review blocks', { timeout: 120000 }, async (t) => {
  const { events, finished } = await runAiDev(t, { mockSequences: { suite: { red_check: ['fail'], suite: ['pass'] }, ui_findings: true } });
  assert.equal(finished.status, 'success', finished.error);
  const evidence = events.filter((e) => e.type === 'step.finished' && e.step_id === 'evidence');
  assert.equal(evidence.length, 1, 'evidence runs once: it sends nothing back to develop');
  assert.equal(evidence[0].output.ui_findings, undefined);
});

// #151 review round: the one UI round, then a code-only round; fan-out visits are told apart for stalls
const UI_THEN_CODE = { suite: { red_check: ['fail'], suite: ['pass'] }, verdict: ['approved', 'changes_requested', 'approved'], ui_findings: true };

test('ai-development-local-hero (#151): after the UI round, a code-only fix round does not show develop the UI findings again', { timeout: 120000 }, async (t) => {
  const { transitions, finished, prompts } = await runAiDev(t, { mockSequences: UI_THEN_CODE });
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(transitions.filter((x) => x === 'code_review>develop').length, 2, 'the UI round, then the code round');
  assert.equal(prompts.length, 3);
  assert.match(prompts[1], /\(simulated\) problem/, 'the UI round shows the blocking UI finding');
  assert.match(prompts[2], /\(simulated\) description/, 'the code round shows the reviewer\'s finding');
  assert.doesNotMatch(prompts[2], /\(simulated\) problem/, 'the UI findings are not sent a second time');
});

test('ai-development-local-hero (#151): code_review visits with different reviewer verdicts are not a same-answer stall', { timeout: 120000 }, async (t) => {
  const { events, transitions, finished } = await runAiDev(t, { mockSequences: UI_THEN_CODE });
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(transitions.filter((x) => x === 'developer_screenshots>code_review').length, 3, 'code_review is visited 3 times');
  const stalls = events.filter((e) => e.type === 'log' && e.kind === 'stall' && e.stall === 'same_output' && e.step_id === 'code_review');
  assert.deepEqual(stalls.map((e) => e.message), []);
});

test('ai-development-local-hero (#151): a failed ui_reviewer does not block the run: the reviewer\'s approval goes on to the suite', { timeout: 120000 }, async (t) => {
  const { events, transitions, finished } = await runAiDev(t, { mockSequences: { suite: { red_check: ['fail'], suite: ['pass'] } }, failAgent: 'ui_reviewer' });
  assert.equal(finished.status, 'success', finished.error);
  assert.ok(transitions.includes('code_review>suite'), 'the run goes on after the review');
  assert.ok(transitions.includes('suite>build'));
  const review = events.find((e) => e.type === 'step.finished' && e.step_id === 'code_review');
  assert.deepEqual(review.output.failed.map((f) => f.agent), ['ui_reviewer']);
  assert.deepEqual(review.output.succeeded, ['reviewer']);
});

test('ai-development-local-hero (#151): a failed reviewer fails code_review even though the ui_reviewer answered', { timeout: 120000 }, async (t) => {
  const { events, transitions, finished } = await runAiDev(t, { mockSequences: { suite: { red_check: ['fail'], suite: ['pass'] } }, failAgent: 'reviewer' });
  assert.ok(!transitions.some((x) => /^code_review>(suite|test|e2e|build)$/.test(x)), 'no approval without the code reviewer');
  const reviews = events.filter((e) => e.type === 'step.finished' && e.step_id === 'code_review');
  assert.ok(reviews.length && reviews.every((e) => e.error === true), 'code_review only finishes as failed');
  assert.ok(events.some((e) => /required: reviewer/.test(String(e.message || e.error || ''))), 'the failure names the required reviewer');
  assert.notEqual(finished?.status, 'success');
});

// #247 (acceptance tests, written before the code): Ask for changes at the owner's validation gate
// goes to the test writer first. It triages the request: criteria changed → it updates the affected
// acceptance tests and scenarios, the red check runs on them, then develop; a simple change → nothing
// changes and the run goes straight to develop. The output gains `criteria_changed` and `criteria_note`.
const REQUEST = 'Move the Archive button into the three-dots menu at the top right of the card';
const VALIDATED = { mode: 'validated', screenshots: 'off' };
const withoutSkills = (prompt) => String(prompt || '').replace(/<skill name="[^"]*"[\s\S]*?<\/skill>/g, '');

test('ai-development-local-hero (#247): changed criteria: acceptance_tests, the red check on the changed tests, then develop with the owner\'s request and the test writer\'s note', { timeout: 120000 }, async (t) => {
  const { transitions, prompts, finished } = await runAiDev(t, {
    inputs: VALIDATED,
    answers: { developer_check: [['changes', REQUEST], ['approve']] },
    mockSequences: { suite: { red_check: ['fail', 'fail'], suite: ['pass'] }, criteria_changed: [true] },
  });
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(transitions.slice(0, 9), [
    'acceptance_tests>red_check',
    'red_check>warm_up',
    'warm_up>develop',
    'develop>developer_check',
    'developer_check>acceptance_tests',
    'acceptance_tests>red_check',
    'red_check>develop',
    'develop>developer_check',
    'developer_check>code_review',
  ]);
  assert.equal(prompts.length, 2);
  assert.ok(prompts[1].includes(REQUEST), 'the developer still receives the owner\'s request');
  assert.match(prompts[1], /\(simulated\) criteria_note/, 'and the test writer\'s note on what changed in the tests');
});

test('ai-development-local-hero (#247): a simple change no test covers goes from acceptance_tests straight to develop, with no red check', { timeout: 120000 }, async (t) => {
  const { transitions, prompts, finished } = await runAiDev(t, {
    inputs: VALIDATED,
    answers: { developer_check: [['changes', REQUEST], ['approve']] },
    // false on every visit: the first visit (not from the gate) still goes to the red check
    mockSequences: { suite: { red_check: ['fail'], suite: ['pass'] }, criteria_changed: [false] },
  });
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(transitions.slice(0, 7), [
    'acceptance_tests>red_check',
    'red_check>warm_up',
    'warm_up>develop',
    'develop>developer_check',
    'developer_check>acceptance_tests',
    'acceptance_tests>develop',
    'develop>developer_check',
  ]);
  assert.equal(transitions.filter((x) => x === 'acceptance_tests>red_check').length, 1, 'the red check runs only after the first visit');
  assert.ok(prompts[1].includes(REQUEST), 'the developer receives the owner\'s request');
});

test('ai-development-local-hero (#247): on the visit from the gate the acceptance prompt quotes the owner\'s request and asks for a triage first', { timeout: 120000 }, async (t) => {
  const { promptsOf, finished } = await runAiDev(t, {
    inputs: VALIDATED,
    answers: { developer_check: [['changes', REQUEST], ['approve']] },
    mockSequences: { suite: { red_check: ['fail'], suite: ['pass'] }, criteria_changed: [false] },
  });
  assert.equal(finished.status, 'success', finished.error);
  const [first, fromGate] = promptsOf('acceptance_tests').map(withoutSkills);
  assert.ok(fromGate, 'acceptance_tests ran a second time');
  assert.ok(!first.includes(REQUEST), 'the first visit has no owner request');
  assert.ok(fromGate.includes(REQUEST), 'the owner\'s request is quoted');
  assert.match(fromGate, /validat/i, 'it says the request comes from the owner\'s validation');
  assert.match(fromGate, /triage/i, 'a quick triage first');
  assert.match(fromGate, /criteria_changed/, 'the answer says whether the criteria changed');
  assert.match(fromGate, /weaken/i, 'it never weakens a test to make the current code pass');
  // a short wait: the test writer's session is resumed (the prompt cache is still warm)
  assert.doesNotMatch(fromGate, /<handoff_note>/);
});

test('ai-development-local-hero (#247): changed tests the red check cannot run go back to the test writer once, are checked again, then develop gets the owner\'s request', { timeout: 120000 }, async (t) => {
  const { transitions, prompts, promptsOf, finished } = await runAiDev(t, {
    inputs: VALIDATED,
    answers: { developer_check: [['changes', REQUEST], ['approve']] },
    mockSequences: { suite: { red_check: ['fail', 'broken', 'fail'], suite: ['pass'] }, criteria_changed: [true] },
  });
  assert.equal(finished.status, 'success', finished.error);
  const gate = transitions.indexOf('developer_check>acceptance_tests');
  assert.deepEqual(transitions.slice(gate, gate + 6), [
    'developer_check>acceptance_tests',
    'acceptance_tests>red_check',
    'red_check>acceptance_tests',
    'acceptance_tests>red_check',
    'red_check>develop',
    'develop>developer_check',
  ]);
  const fix = withoutSkills(promptsOf('acceptance_tests')[2]);
  assert.match(fix, /cannot run/, 'the test writer is told which changed files cannot run');
  assert.equal(prompts.length, 2);
  assert.ok(prompts[1].includes(REQUEST), 'the developer still receives the owner\'s request after the detour');
});

test('ai-development-local-hero (#247): after a gate wait longer than the prompt cache, the visit from the gate starts a fresh test-writer session from its handoff note', { timeout: 120000 }, async (t) => {
  const { events, promptsOf, finished } = await runAiDev(t, {
    inputs: VALIDATED,
    answers: { developer_check: [['changes', REQUEST], ['approve']] },
    mockSequences: { suite: { red_check: ['fail'], suite: ['pass'] }, criteria_changed: [false] },
    // the owner answers 7 hours later (the run of #238 waited 6.8 h)
    beforeAnswer(stepId, n) {
      if (stepId === 'developer_check' && n === 1) t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 7 * 3600e3 });
    },
  });
  assert.equal(finished.status, 'success', finished.error);
  const fromGate = promptsOf('acceptance_tests')[1];
  assert.ok(fromGate, 'acceptance_tests ran a second time');
  assert.match(fromGate, /<handoff_note>/, 'a fresh session that starts from the test writer\'s handoff note');
  assert.ok(fromGate.includes(REQUEST), 'with the owner\'s request');
  const rotation = events.filter((e) => e.type === 'log' && e.kind === 'idle_rotation');
  assert.deepEqual(rotation.map((e) => [e.agent, e.step_id]), [['test_writer', 'acceptance_tests']], 'the run notes the fresh start once, for the test writer only');
});
