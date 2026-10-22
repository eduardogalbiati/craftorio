// #250: splitting WorkflowRun by area keeps its behaviour: a mock run of ai-development-local-hero
// emits the same events, by type (and step id when the event has one), as before the split.
// #323: the order is checked where it is defined, so the test no longer depends on timing:
// code_review runs reviewer and ui_reviewer at the same time and the mock waits a random time
// before each item. test/run-event-lanes.js keeps the steps' step.* / workflow.* sequence in order
// and each lane (a step visit and who emitted the event: a session's agent or the engine) in
// order; an event that disappears, appears twice or moves to another step still fails.
// The baseline test/fixtures/events-ai-development-local-hero-250.json was recorded on the base
// commit (a4dd9ab) with this same run (two runs, identical; 182 events), then follows one intended
// move from #387 (3732ed2): the developer of this workflow loads design-system, so its "skill
// loaded" log comes in develop instead of code_review; #465 adds the machine steps' step.log
// events (red_check, suite). Its _comment says the same.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { WorkflowRun } = require('../../src/engine/workflow');
const { eventLanes } = require('../run-event-lanes');
process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';

const root = path.join(__dirname, '..', '..');
const BASELINE = path.join(root, 'test', 'fixtures', 'events-ai-development-local-hero-250.json');
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

test('#250 a mock run of ai-development-local-hero emits the same events, in the same order, as before the split', { timeout: 120000 }, async (t) => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'split-250-repo-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true, maxRetries: 5 }));
  git(repo, 'init', '-q');
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src', 'app.js'), 'module.exports = 1;\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
  git(repo, 'switch', '-q', '-c', 'feat');
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'split-250-runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const run = new WorkflowRun({
    file: path.join(root, 'workflows', 'ai-development-local-hero.yaml'),
    inputs: { task: 'Add the feature', repo_path: repo, unit_tests: 'run_existing', e2e_tests: 'off' },
    mock: true, runsDir, mockSequences: { verdict: ['approved'] },
  });
  const events = [];
  let status = null;
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'workflow.finished') status = ev.status;
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, ev.choices ? ev.choices[0].id : true));
  });
  await run.start();
  assert.equal(status, 'success');
  const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  const got = eventLanes(events);
  assert.deepEqual(got.steps, baseline.steps, 'the steps run in the same order');
  assert.deepEqual(Object.keys(got.lanes).sort(), Object.keys(baseline.lanes).sort(), 'the same lanes (step visit, emitter)');
  for (const lane of Object.keys(baseline.lanes)) assert.deepEqual(got.lanes[lane], baseline.lanes[lane], `events of ${lane}`);
  assert.equal(got.count, baseline.count, 'the same number of events');
});
