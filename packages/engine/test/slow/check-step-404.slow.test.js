// Acceptance tests for #404, mock runs of workflows/feature.yaml: after develop, a
// step with no agent runs the project's check command (the `check_command` input, or the project's
// own `check` script from its package.json). A failure goes back to develop with the findings,
// never to the test writer; after its rounds are used up it goes to the gate as before; a project
// without a check command skips the step. The check command is a real, local and free script of
// the temporary repository (like the test-id check reads real files in a mock run).
// The definition's tests are in test/check-step-404.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { WorkflowRun, loadWorkflow } = require('../../engine/workflow');
process.env.CRAFTORIO_MOCK_DELAY_SCALE = '0.02';

const WORKFLOW = path.join(__dirname, '..', '..', '..', '..', 'workflows', 'feature.yaml');
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const write = (dir, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};

// the project's rule check: one finding until the developer adds src/fixed.txt
const CHECK_JS = [
  "const fs = require('fs');",
  "if (fs.existsSync('src/fixed.txt')) { console.log('checks: pass'); process.exit(0); }",
  "console.log('zz-rule: src/app.js breaks the planted rule 404 (add src/fixed.txt)');",
  'process.exit(1);',
  '',
].join('\n');

// the id of the agent-less step that runs the check command
const wf = loadWorkflow(WORKFLOW);
const checkStep = wf.steps.find((s) => !s.agent && /inputs\.check_command/.test(JSON.stringify({ ...s, transitions: undefined, prompt: undefined })));
const CHECK = checkStep ? checkStep.id : '(no check step)';
const gates = new Set(wf.steps.filter((s) => s.type === 'human_approval').map((s) => s.id));
const testWriterSteps = new Set(wf.steps.filter((s) => s.agent === 'test_writer').map((s) => s.id));

// a repository on main with one production file and the check script; `checkScript: false` leaves
// the package.json without a `check` script
function makeRepo(t, { checkScript = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-step-repo-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  git(dir, 'init', '-q');
  write(dir, 'src/app.js', 'module.exports = 1;\n');
  write(dir, 'check.js', CHECK_JS);
  const scripts = checkScript ? { check: 'node check.js' } : {};
  write(dir, 'package.json', `${JSON.stringify({ name: 'check-step-fixture', version: '1.0.0', private: true, scripts }, null, 2)}\n`);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'switch', '-q', '-c', 'feat');
  return dir;
}

// the developer's fix of the planted finding, committed
function fix(repo) {
  write(repo, 'src/fixed.txt', 'fixed\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'develop: fix the planted rule');
}

const ownText = (prompt) => String(prompt || '').replace(/<skill name="[^"]*"[\s\S]*?<\/skill>/g, '');

// the developer's commit that breaks the planted rule again (a later round)
function unfix(repo) {
  git(repo, 'rm', '-q', 'src/fixed.txt');
  git(repo, 'commit', '-q', '-m', 'develop: break the planted rule again');
}

// `answers: { stepId: [choice, ...] }`: the owner's choice per visit of a gate (default: the first one)
async function runLocalHero(t, { repoOptions, inputs = {}, onTurn, answers = {}, mockSequences = {} } = {}) {
  assert.ok(checkStep, 'workflows/feature.yaml has no agent-less step running {{ inputs.check_command }}');
  const repo = makeRepo(t, repoOptions);
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-step-runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const run = new WorkflowRun({
    file: WORKFLOW,
    inputs: { task: 'Add the feature', repo_path: repo, unit_tests: 'run_existing', e2e_tests: 'off', ...inputs },
    mock: true,
    runsDir,
    mockSequences: { verdict: ['approved'], suite: { red_check: ['fail'], suite: ['pass'] }, ...mockSequences },
  });
  const events = [];
  const answered = {};
  let turn = 0;
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') {
      const n = (answered[ev.step_id] = (answered[ev.step_id] || 0) + 1);
      const choice = (answers[ev.step_id] || [])[n - 1] || ev.choices[0].id;
      setImmediate(() => run.resolveApproval(ev.approval_id, choice, 'user', undefined));
    }
    if (ev.type === 'session.message_sent' && ev.step_id === 'develop' && onTurn) onTurn(repo, ++turn);
  });
  await run.start();
  const transitions = events.filter((e) => e.type === 'step.transition').map((e) => `${e.from}>${e.to}`);
  const prompts = events.filter((e) => e.type === 'session.message_sent' && e.step_id === 'develop').map((e) => ownText(e.prompt));
  return { events, transitions, prompts, finished: events.find((e) => e.type === 'workflow.finished') };
}

test('#404 run: a failing check goes back to develop with its findings; after the fix the run goes on to the review', { timeout: 120000 }, async (t) => {
  const { events, transitions, prompts, finished } = await runLocalHero(t, { onTurn: (repo, n) => n === 2 && fix(repo) });
  assert.equal(finished.status, 'success', finished.error);
  const firstDevelop = transitions.findIndex((x) => x.startsWith('develop>'));
  const review = transitions.findIndex((x) => x.endsWith('>code_review'));
  const firstCheck = transitions.findIndex((x) => x.endsWith(`>${CHECK}`));
  assert.ok(firstCheck > firstDevelop && firstCheck < review, `the check runs after develop and before the review (got ${transitions.join(', ')})`);
  assert.equal(transitions.filter((x) => x === `${CHECK}>develop`).length, 1, `once back to develop: the second check passes (got ${transitions.join(', ')})`);
  assert.ok(!transitions.some((x) => x.startsWith(`${CHECK}>`) && testWriterSteps.has(x.split('>')[1])), 'never to the test writer');
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /breaks the planted rule 404/, 'the developer is given the check\'s findings');
  assert.equal(events.filter((e) => e.type === 'session.message_sent' && e.step_id === CHECK).length, 0, 'the check makes no model call');
});

test('#404 run: a check that keeps failing returns to develop a bounded number of times, then goes to a human gate', { timeout: 180000 }, async (t) => {
  // the check_command input, on a project whose package.json has no check script
  const { events, transitions, finished } = await runLocalHero(t, { repoOptions: { checkScript: false }, inputs: { check_command: 'node check.js' } });
  assert.ok(finished, 'the run ends');
  const back = transitions.filter((x) => x === `${CHECK}>develop`).length;
  assert.ok(back >= 1 && back <= 3, `back to develop between 1 and 3 times (got ${back}: ${transitions.join(', ')})`);
  const toGate = transitions.find((x) => x.startsWith(`${CHECK}>`) && gates.has(x.split('>')[1]));
  assert.ok(toGate, `after the rounds the check goes to a human gate (got ${transitions.join(', ')})`);
  assert.ok(events.some((e) => e.type === 'approval.requested' && e.step_id === toGate.split('>')[1]), 'the gate asks the owner');
});

test('#404 run: a project without a check command skips the step and does not return to develop', { timeout: 120000 }, async (t) => {
  const { events, transitions, finished } = await runLocalHero(t, { repoOptions: { checkScript: false } });
  assert.equal(finished.status, 'success', finished.error);
  assert.ok(!transitions.includes(`${CHECK}>develop`), `no return to develop (got ${transitions.join(', ')})`);
  assert.ok(transitions.some((x) => x.endsWith('>code_review')), 'the run reaches the review');
  const done = events.find((e) => e.type === 'step.finished' && e.step_id === CHECK);
  if (done) assert.match(JSON.stringify(done.output || {}), /skip/i, 'a visited check step notes that it was skipped');
});

// Tests added after the change (the step is rule_check, its gate check_failed)

test('#404 run: stopping at check_failed ends the run as failed, without a review', { timeout: 180000 }, async (t) => {
  const { transitions, finished } = await runLocalHero(t, { answers: { check_failed: ['stop'] } });
  assert.ok(transitions.includes(`${CHECK}>check_failed`), `the check reaches its gate (got ${transitions.join(', ')})`);
  assert.equal(finished.status, 'failed');
  assert.ok(!transitions.some((x) => x.endsWith('>code_review')), `no review after stop (got ${transitions.join(', ')})`);
});

test('#404 run: a pass gives the next review round its two returns again', { timeout: 180000 }, async (t) => {
  // round 1: two failing checks, fixed on the third turn; the review asks for changes; the fourth
  // turn breaks the rule again and the fifth fixes it
  const onTurn = (repo, n) => (n === 3 || n === 5 ? fix(repo) : n === 4 ? unfix(repo) : null);
  const { events, transitions, finished } = await runLocalHero(t, { onTurn, mockSequences: { verdict: ['changes_requested', 'approved'] } });
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(transitions.filter((x) => x === `${CHECK}>develop`).length, 3, `two returns in round 1, one in round 2 (got ${transitions.join(', ')})`);
  assert.ok(!events.some((e) => e.type === 'approval.requested' && e.step_id === 'check_failed'), 'the gate is never asked');
});

test('#404 run: in validated mode the rule checks run before the owner tries the change', { timeout: 180000 }, async (t) => {
  const { transitions, finished } = await runLocalHero(t, { inputs: { mode: 'validated', screenshots: 'off' }, onTurn: (repo, n) => n === 1 && fix(repo) });
  assert.ok(finished, 'the run ends');
  const toGate = transitions.indexOf('rule_check>developer_check');
  assert.ok(toGate >= 0, `rule_check goes on to developer_check (got ${transitions.join(', ')})`);
  assert.ok(transitions.slice(0, toGate).includes('develop>rule_check'), 'right after develop');
});
