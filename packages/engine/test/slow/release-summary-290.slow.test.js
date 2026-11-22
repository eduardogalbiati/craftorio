// Release summary (#290): workflows/release.yaml gets a read-only `review` step ("Release summary")
// between the last green suite (`unit` with e2e_suite: skip, else `e2e`) and the `ship` gate. A cheap
// agent (claude-sonnet-5, ephemeral session, 5-minute timeout, no edit/write tools, no web, no
// subagents) reads the round-by-round trail, every fix round's output, the suites' results, the fix
// branch's `git log --stat`, the release version, the project's version file and its last tags,
// and writes a summary (verdict; Timeline; The fixes; Before you ship; Follow-ups) that leads the Ship
// gate's message and is saved as release-summary.md in the run folder (Reports artifact). It is
// skipped when both suites were green on their first round with no fix; a review that fails does
// not block: the gate opens with a line saying the summary is missing.
// Observed only through public surface: the workflow YAML (loadWorkflow), a mock WorkflowRun's
// events (step.started, session.message_sent's rendered prompt, approval.requested's message and
// choices) and its run folder (run.runDir). Harness copied from test/release-workflow-260.test.js.
// Mock limits: the mock provider answers a string field with a fixed text per field name (not per
// visit), so the fix rounds' outputs cannot differ; the prompt is checked to carry every round's
// output by counting occurrences. The mock developer commits nothing, so the fix branch's diff is
// checked loosely (its branch name or a `git log` mention).
// Split by #306 (whole mock runs of a bundled workflow live in test/slow/, docs/agents/testing.md):
// the rest of this file's tests are in test/release-summary-290.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { WorkflowRun, loadWorkflow } = require('../../engine/workflow');
process.env.CRAFTORIO_MOCK_DELAY_SCALE = '0.02';

const WORKFLOW = path.join(__dirname, '..', '..', '..', '..', 'workflows', 'release.yaml');
const load = () => loadWorkflow(WORKFLOW);

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

const PROJECT_VERSION = '0.3.0';
const PROJECT_TAG = 'v0.3.0-build.7';

function makeRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-sum-repo-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  git(dir, 'init', '-q');
  fs.writeFileSync(path.join(dir, 'package.json'), `{ "name": "x", "version": "${PROJECT_VERSION}", "scripts": { "test": "node --test" } }\n`);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'tag', PROJECT_TAG);
  return dir;
}

// A mock run of the release workflow. Every gate but `ship` takes its first choice (an Approve /
// Reject gate: approve); `ship` takes `shipAnswer` (default hold: a test never asks for a push).
async function runRelease(t, { mockSequences = {}, shipAnswer = 'hold', inputs: extra = {}, resume } = {}) {
  const wf = load();
  const repo = makeRepo(t);
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-sum-runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true, maxRetries: 5 }));
  const inputs = {};
  for (const [k, def] of Object.entries(wf.inputs || {})) {
    if (def?.default !== undefined && def?.default !== '') continue;
    inputs[k] = /path|dir|repo|folder/i.test(k) ? repo : 'Release v1.0';
  }
  const run = new WorkflowRun({ file: WORKFLOW, inputs: { task: 'Release v1.0', repo_path: repo, project_path: repo, ...inputs, e2e_command: 'npm run test:e2e', ...extra }, mock: true, runsDir, mockSequences, ...(resume ? { resume } : {}) });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') {
      const answer = ev.step_id === 'ship' ? shipAnswer : ev.choices?.[0]?.id ?? true;
      setImmediate(() => run.resolveApproval(ev.approval_id, answer, 'user', ''));
    }
  });
  await run.start();
  const started = events.filter((e) => e.type === 'step.started').map((e) => e.step_id);
  const gates = events.filter((e) => e.type === 'approval.requested').map((e) => e.step_id);
  const shipGate = events.find((e) => e.type === 'approval.requested' && e.step_id === 'ship');
  const prompts = (stepId) => events.filter((e) => e.type === 'session.message_sent' && e.step_id === stepId).map((e) => String(e.prompt || ''));
  return { wf, run, repo, events, started, gates, shipGate, prompts };
}

const count = (text, needle) => text.split(needle).length - 1;

// ---- mock runs ---------------------------------------------------------------------------------

test('release run (mock): after a fix, review runs after the last E2E round and before the ship gate (#290)', { timeout: 120000 }, async (t) => {
  const { started, gates } = await runRelease(t, { mockSequences: { suite: { unit: ['fail', 'pass'], e2e: ['pass'] } } });
  const review = started.indexOf('review');
  assert.ok(review >= 0, `review ran (steps: ${started.join(', ')})`);
  assert.ok(review > started.lastIndexOf('e2e'), `review comes after the last e2e (steps: ${started.join(', ')})`);
  assert.ok(started.lastIndexOf('ship') > review, `ship comes after review (steps: ${started.join(', ')})`);
  assert.ok(gates.includes('ship'), 'the ship gate opened');
});

test('release run (mock): with e2e_suite skip, review runs after the last unit round, then ship (#290)', { timeout: 120000 }, async (t) => {
  const { started, gates } = await runRelease(t, { inputs: { e2e_suite: 'skip' }, mockSequences: { suite: { unit: ['fail', 'pass'], e2e: ['pass'] } } });
  assert.equal(started.includes('e2e'), false, `no e2e round (steps: ${started.join(', ')})`);
  const review = started.indexOf('review');
  assert.ok(review >= 0, `review ran (steps: ${started.join(', ')})`);
  assert.ok(review > started.lastIndexOf('unit'), `review comes after the last unit round (steps: ${started.join(', ')})`);
  assert.ok(started.lastIndexOf('ship') > review, `ship comes after review (steps: ${started.join(', ')})`);
  assert.ok(gates.includes('ship'), 'the ship gate opened');
});

test('release run (mock): one green round of each suite and no fix skips review and goes straight to ship (#290)', { timeout: 120000 }, async (t) => {
  const { wf, started, gates } = await runRelease(t, { mockSequences: { suite: { unit: ['pass'], e2e: ['pass'] } } });
  assert.ok(wf.steps.some((s) => s.id === 'review'), 'workflows/release.yaml has a step `review` (skipped here)');
  assert.equal(started.includes('review'), false, `review never started (steps: ${started.join(', ')})`);
  assert.ok(gates.includes('ship'), `the ship gate opened (steps: ${started.join(', ')})`);
});

test('release run (mock): a review that fails does not block: the ship gate opens and says the summary is missing (#290)', { timeout: 180000 }, async (t) => {
  const { started, shipGate } = await runRelease(t, { mockSequences: { suite: { unit: ['fail', 'pass'], e2e: ['pass'] }, timeouts: { review: 20 } } });
  assert.ok(started.includes('review'), `review ran (steps: ${started.join(', ')})`);
  assert.ok(shipGate, `the ship gate opened (steps: ${started.join(', ')})`);
  const lines = String(shipGate.message || '').split('\n');
  const missing = lines.find((l) => /summary/i.test(l) && /missing|not available|could not|unavailable|failed/i.test(l));
  assert.ok(missing, `a line says the summary is missing:\n${shipGate.message}`);
});

test('release run (mock): the review prompt carries every fix round, the release version, the project version and its last tag (#290)', { timeout: 240000 }, async (t) => {
  const { run, started, prompts } = await runRelease(t, {
    inputs: { version: '1.0.0', max_rounds: 3 },
    mockSequences: { suite: { unit: ['fail', 'fail', 'fail', 'pass'], e2e: ['pass'] } },
  });
  assert.equal(started.filter((id) => id === 'fix').length, 3, `three fix rounds (steps: ${started.join(', ')})`);
  const prompt = prompts('review').join('\n');
  assert.ok(prompt, `the review step sent a prompt (steps: ${started.join(', ')})`);
  // the mock gives each round the same text per field: each one appears once per round
  for (const text of ['Simulated implementation of the feature with tests.', '(simulated) test_notes', '(simulated) commit_sha', '(simulated) regression']) {
    assert.ok(count(prompt, text) >= 3, `every fix round's "${text}" is in the prompt (found ${count(prompt, text)})`);
  }
  assert.match(prompt, /\b1\.0\.0\b/, 'the release version');
  assert.ok(prompt.includes(PROJECT_TAG), 'the project\'s last tag');
  assert.ok(prompt.split(PROJECT_TAG).join('').includes(PROJECT_VERSION), 'the package.json version');
  assert.ok(prompt.includes(`release-fix-${run.runId}`) || /git log/i.test(prompt), 'the fix branch\'s log against the base');
  assert.match(prompt, /unit/i, 'the suites\' trail');
  assert.match(prompt, /e2e/i, 'the suites\' trail');
});

test('release run (mock): the summary leads the ship gate message, above "Not on origin yet", and the choices stay ship and hold (#290)', { timeout: 120000 }, async (t) => {
  const { started, shipGate } = await runRelease(t, { mockSequences: { suite: { unit: ['fail', 'pass'], e2e: ['pass'] } } });
  assert.ok(shipGate, `the ship gate opened (steps: ${started.join(', ')})`);
  const message = String(shipGate.message || '');
  const timeline = message.search(/timeline/i);
  const origin = message.indexOf('Not on origin yet');
  assert.ok(timeline >= 0, `the summary's Timeline is in the gate message:\n${message}`);
  assert.ok(origin >= 0, 'the gate message still lists what is not on origin');
  assert.ok(timeline < origin, 'the summary comes before "Not on origin yet"');
  assert.deepEqual((shipGate.choices || []).map((c) => c.id), ['ship', 'hold']);
});

test('release run (mock): release-summary.md in the run folder has a verdict, Timeline, The fixes, Before you ship, Follow-ups in that order (#290)', { timeout: 120000 }, async (t) => {
  const { run, started } = await runRelease(t, { mockSequences: { suite: { unit: ['fail', 'pass'], e2e: ['pass'] } } });
  const file = path.join(run.runDir, 'release-summary.md');
  assert.ok(fs.existsSync(file), `release-summary.md is in the run folder (steps: ${started.join(', ')})`);
  const text = fs.readFileSync(file, 'utf8');
  const lower = text.toLowerCase();
  const at = ['timeline', 'the fixes', 'before you ship', 'follow-ups'].map((h) => lower.indexOf(h));
  assert.ok(at.every((i) => i >= 0), `every section is there (${at.join(', ')}):\n${text}`);
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'the sections are in order');
  assert.ok(text.slice(0, at[0]).trim().length > 0, 'a verdict line comes before the Timeline');
});

// ---- after the change: the cases the review asked for -------------------------------------------

test('release run (mock): one green round of each suite: the ship gate has no report and no "summary is missing" line (#290)', { timeout: 120000 }, async (t) => {
  const { started, shipGate } = await runRelease(t, { mockSequences: { suite: { unit: ['pass'], e2e: ['pass'] } } });
  assert.ok(shipGate, `the ship gate opened (steps: ${started.join(', ')})`);
  assert.equal(shipGate.report === undefined || shipGate.report === '', true, 'no report on the gate event');
  assert.equal(/summary is missing/i.test(String(shipGate.message || '')), false, 'no missing-summary line');
  assert.equal(/timeline/i.test(String(shipGate.message || '')), false, 'no summary in the message');
});

test('release run (mock): with a summary, the ship gate event carries it as `report` and the message starts with it (#290)', { timeout: 120000 }, async (t) => {
  const { shipGate } = await runRelease(t, { mockSequences: { suite: { unit: ['fail', 'pass'], e2e: ['pass'] } } });
  const report = String(shipGate?.report || '');
  assert.match(report, /## Timeline/);
  assert.equal(String(shipGate.message || '').startsWith(report), true, 'the message starts with the report');
  assert.equal(/summary is missing/i.test(String(shipGate.message || '')), false, 'no missing-summary line when there is a summary');
});

test('release run (mock): only the E2E suite red once still reaches review, then ship (#290)', { timeout: 120000 }, async (t) => {
  const { started, gates } = await runRelease(t, { mockSequences: { suite: { unit: ['pass', 'pass'], e2e: ['fail', 'pass'] } } });
  const review = started.indexOf('review');
  assert.ok(review >= 0, `review ran (steps: ${started.join(', ')})`);
  assert.ok(review > started.lastIndexOf('e2e'), 'after the last E2E round');
  assert.ok(gates.includes('ship') && started.lastIndexOf('ship') > review, 'then the ship gate');
});

test('release run (mock): a failing review calls no supervisor (supervise: false), runs once and goes on to ship (#290)', { timeout: 180000 }, async (t) => {
  const { events, started, shipGate } = await runRelease(t, { mockSequences: { suite: { unit: ['fail', 'pass'], e2e: ['pass'] }, timeouts: { review: 20 } } });
  assert.ok(started.includes('review'), `review ran (steps: ${started.join(', ')})`);
  const supervised = events.filter((e) => /^supervisor\./.test(e.type) && e.step_id === 'review').map((e) => e.type);
  assert.deepEqual(supervised, [], 'no supervisor event for the review step');
  assert.equal(started.filter((id) => id === 'review').length, 1, 'one visit of review');
  assert.ok(shipGate, 'the ship gate opened');
});

test('release run (mock): a run resumed at review only has the last fix output, while it counts every fix round (#290)', { timeout: 120000 }, async (t) => {
  const fix = { branch: 'release-fix-x', summary: 'LAST FIX SUMMARY', committed: true, commit_sha: 'abc1234', regression: '#274 broke #234', test_notes: 'add a regression test' };
  const { started, prompts } = await runRelease(t, {
    mockSequences: { suite: { unit: ['pass'], e2e: ['pass'] } },
    resume: {
      fromStep: 'review',
      steps: {
        unit: { output: { status: 'pass', message: 'unit green' }, visits: 4 },
        e2e: { output: { status: 'pass', message: 'e2e green' }, visits: 2 },
        fix: { output: fix, visits: 3 },
      },
    },
  });
  assert.equal(started[0], 'review', `the run resumed at review (steps: ${started.join(', ')})`);
  const prompt = prompts('review').join('\n');
  assert.match(prompt, /The fixes \(3\)/, 'the fix count is the visits');
  assert.equal(count(prompt, 'LAST FIX SUMMARY'), 1, 'only the last fix output survives a resume (documented limit)');
  assert.equal(/Fix 2:/.test(prompt), false, 'no second fix entry');
});
