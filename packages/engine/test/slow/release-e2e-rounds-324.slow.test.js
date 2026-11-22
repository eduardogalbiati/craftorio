// Focused E2E rounds in a release (#324): workflows/release.yaml's first `e2e` visit runs the whole
// E2E suite; after a fix, a later visit runs only the files that failed in the previous E2E round
// (their `failures[].file`) with `scope: files` and a selection that says why ("failed in round 1");
// when that focused run passes, the whole suite runs right after in the same visit, and only a green
// whole run leads to review / ship; a focused run that fails goes to fix without the whole run. A
// command that cannot be filtered runs the whole suite and the output says so. The unit step keeps
// running the whole unit suite every round. The release summary's prompt tells focused rounds from
// whole ones.
// Observed through a mock WorkflowRun's events (step.started, step.finished outputs,
// session.message_sent prompts), harness as in test/slow/release-summary-290.slow.test.js. The mock
// suite's failures name its own simulated files: the tests compare the focused selection with the
// files round 1 reported, whatever they are. Shape of a focused-then-whole visit: as `scope: affected`
// (#212), the visit's output is the whole run's, with the focused run under `affected`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { WorkflowRun, loadWorkflow } = require('../../engine/workflow');
process.env.CRAFTORIO_MOCK_DELAY_SCALE = '0.02';

const WORKFLOW = path.join(__dirname, '..', '..', '..', '..', 'workflows', 'release.yaml');

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

function makeRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-e2e-repo-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  git(dir, 'init', '-q');
  fs.writeFileSync(path.join(dir, 'package.json'), '{ "name": "x", "scripts": { "test": "node --test", "test:e2e": "bddgen && playwright test" } }\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  return dir;
}

// Every gate but `ship` takes its first choice; `ship` is held (a test never pushes).
async function runRelease(t, { mockSequences = {}, inputs: extra = {} } = {}) {
  const wf = loadWorkflow(WORKFLOW);
  const repo = makeRepo(t);
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-e2e-runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true, maxRetries: 5 }));
  const inputs = {};
  for (const [k, def] of Object.entries(wf.inputs || {})) {
    if (def?.default !== undefined && def?.default !== '') continue;
    inputs[k] = /path|dir|repo|folder/i.test(k) ? repo : 'Release v1.0';
  }
  // #760: e2e_command's default is empty since #735, so the loop above fills it too: the E2E command
  // is set after it (a test's own `inputs` still win)
  const run = new WorkflowRun({ file: WORKFLOW, inputs: { task: 'Release v1.0', repo_path: repo, project_path: repo, ...inputs, e2e_command: 'npm run test:e2e', ...extra }, mock: true, runsDir, mockSequences });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') {
      const answer = ev.step_id === 'ship' ? 'hold' : ev.choices?.[0]?.id ?? true;
      setImmediate(() => run.resolveApproval(ev.approval_id, answer, 'user', ''));
    }
  });
  await run.start();
  const started = events.filter((e) => e.type === 'step.started').map((e) => e.step_id);
  const outputs = (stepId) => events.filter((e) => e.type === 'step.finished' && e.step_id === stepId).map((e) => e.output || {});
  const prompts = (stepId) => events.filter((e) => e.type === 'session.message_sent' && e.step_id === stepId).map((e) => String(e.prompt || ''));
  const shipGate = events.find((e) => e.type === 'approval.requested' && e.step_id === 'ship');
  return { started, outputs, prompts, shipGate };
}

const failedFiles = (out) => [...new Set((out.failures || []).map((f) => f.file).filter(Boolean))].sort();
// the step started right after the n-th (1-based) visit of `stepId`
const nextAfter = (started, stepId, n) => {
  let seen = 0;
  for (let i = 0; i < started.length; i++) if (started[i] === stepId && ++seen === n) return started[i + 1];
  return undefined;
};

test('release (mock): round 1 runs the whole E2E suite; after a fix, round 2 runs only the failed files, then the whole suite, then review (#324)', { timeout: 120000 }, async (t) => {
  const { started, outputs } = await runRelease(t, { mockSequences: { suite: { unit: ['pass'], e2e: ['fail', 'pass'] } } });
  const e2e = outputs('e2e');
  assert.equal(e2e.length, 2, `two E2E rounds (steps: ${started.join(', ')})`);
  const [r1, r2] = e2e;
  assert.equal(r1.scope, 'full', 'the first E2E round is whole');
  assert.equal(r1.status, 'fail');
  assert.equal(r1.affected == null, true, 'the first E2E round is never focused');
  const failed = failedFiles(r1);
  assert.ok(failed.length > 0, 'round 1 reported the files that failed');

  assert.equal(r2.status, 'pass');
  assert.equal(r2.scope, 'full', 'the focused run passed: the whole suite ran last in the same visit');
  assert.ok(r2.affected, 'round 2 records its focused run');
  assert.deepEqual([...(r2.affected.files || [])].sort(), failed, 'the focused run ran the files that failed in round 1');
  assert.match(JSON.stringify(r2.selection || {}), /failed in round 1/, 'the selection says why');
  assert.equal(nextAfter(started, 'e2e', 2), 'review', `a green whole run leads to review (steps: ${started.join(', ')})`);
});

test('release (mock): after a focused-then-whole E2E round, the Ship gate reports the whole E2E suite green (#324)', { timeout: 120000 }, async (t) => {
  const { started, shipGate } = await runRelease(t, { mockSequences: { suite: { unit: ['pass'], e2e: ['fail', 'pass'] } } });
  assert.ok(shipGate, `the ship gate opened (steps: ${started.join(', ')})`);
  const message = String(shipGate.message || '');
  assert.match(message, /the whole E2E suite pass/);
  const e2eLine = message.split('\n').find((l) => l.startsWith('E2E:')) || '';
  assert.match(e2eLine, /The suite passed in round 2/, `the E2E line is the whole run's result: ${e2eLine}`);
  assert.doesNotMatch(e2eLine, /selected tests/i);
});

test('release (mock): a focused E2E round that fails goes to fix without the whole run, and counts as a round (#324)', { timeout: 180000 }, async (t) => {
  const { started, outputs } = await runRelease(t, { mockSequences: { suite: { unit: ['pass'], e2e: ['fail', 'fail', 'pass'] } } });
  const e2e = outputs('e2e');
  assert.ok(e2e.length >= 2, `at least two E2E rounds (steps: ${started.join(', ')})`);
  const [r1, r2] = e2e;
  assert.equal(r2.status, 'fail');
  assert.equal(r2.scope, 'files', 'the failing round is the focused run: no whole run after it');
  assert.deepEqual([...(r2.selection?.files || [])].sort(), failedFiles(r1));
  assert.match(JSON.stringify(r2.selection || {}), /failed in round 1/);
  assert.equal(nextAfter(started, 'e2e', 2), 'fix', `the red focused round goes to fix (steps: ${started.join(', ')})`);
  assert.equal(started.filter((s) => s === 'fix').length >= 2, true, 'each red E2E round called fix');
});

test('release (mock): an E2E command that cannot be filtered runs the whole suite in round 2 and says so (#324)', { timeout: 120000 }, async (t) => {
  const { started, outputs } = await runRelease(t, { inputs: { e2e_command: 'make e2e' }, mockSequences: { suite: { unit: ['pass'], e2e: ['fail', 'pass'] } } });
  const e2e = outputs('e2e');
  assert.equal(e2e.length, 2, `two E2E rounds (steps: ${started.join(', ')})`);
  const r2 = e2e[1];
  assert.equal(r2.scope, 'full', 'the whole suite ran');
  assert.equal(r2.status, 'pass');
  assert.match(String(r2.command || ''), /^make e2e$/, 'the command ran unfiltered');
  assert.match(JSON.stringify(r2), /cannot/i, 'the output says the command could not be filtered');
  assert.equal(nextAfter(started, 'e2e', 2), 'review');
});

test('release (mock): an empty E2E command runs npm run test:e2e, focused on the failed files in round 2 (#735, #760)', { timeout: 120000 }, async (t) => {
  const { started, outputs } = await runRelease(t, { inputs: { e2e_command: '' }, mockSequences: { suite: { unit: ['pass'], e2e: ['fail', 'pass'] } } });
  const e2e = outputs('e2e');
  assert.equal(e2e.length, 2, `two E2E rounds (steps: ${started.join(', ')})`);
  assert.equal(e2e[0].command, 'npm run test:e2e', 'round 1 runs the default E2E command');
  assert.ok(e2e[1].affected, 'round 2 records its focused run');
  assert.match(String(e2e[1].affected.command || ''), /^npm run test:e2e -- /, 'the focused run passes the failed files to the default command');
});

test('release (mock): the first E2E round is whole even after a unit fix, and the unit step stays whole every round (#324)', { timeout: 120000 }, async (t) => {
  const { started, outputs } = await runRelease(t, { mockSequences: { suite: { unit: ['fail', 'pass'], e2e: ['pass'] } } });
  const e2e = outputs('e2e');
  assert.equal(e2e.length, 1, `one E2E round (steps: ${started.join(', ')})`);
  assert.equal(e2e[0].scope, 'full');
  assert.equal(e2e[0].affected == null, true, 'not focused');
  const unit = outputs('unit');
  assert.equal(unit.length, 2);
  assert.deepEqual(unit.map((o) => o.scope), ['full', 'full'], 'the unit suite runs whole each round');
});

test('release (mock): after an E2E fix, the unit step still runs the whole unit suite (#324)', { timeout: 120000 }, async (t) => {
  const { outputs } = await runRelease(t, { mockSequences: { suite: { unit: ['pass'], e2e: ['fail', 'pass'] } } });
  const unit = outputs('unit');
  assert.equal(unit.length, 2);
  assert.deepEqual(unit.map((o) => o.scope), ['full', 'full']);
  assert.equal(unit[1].affected == null, true, 'no focused unit round');
});

test('release (mock): the release summary prompt tells the focused E2E round from the whole one (#324)', { timeout: 120000 }, async (t) => {
  const { started, prompts } = await runRelease(t, { mockSequences: { suite: { unit: ['pass'], e2e: ['fail', 'pass'] } } });
  const prompt = prompts('review').join('\n');
  assert.ok(prompt, `review ran (steps: ${started.join(', ')})`);
  const lines = prompt.split('\n').filter((l) => /e2e/i.test(l));
  assert.ok(lines.some((l) => /round 1\b|#1\b/.test(l) && /whole/i.test(l)), `an E2E round 1 line says whole:\n${lines.join('\n')}`);
  assert.ok(lines.some((l) => /round 2\b|#2\b/.test(l) && /focused/i.test(l)), `an E2E round 2 line says focused:\n${lines.join('\n')}`);
});
