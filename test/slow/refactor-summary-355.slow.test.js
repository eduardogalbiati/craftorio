// workflows/refactor.yaml (#355): the run's summary.json, as the app, the CLI and the service write it
// (a Recorder on the run's events), records the target's before/after figures and the run's cost.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { WorkflowRun } = require('../../src/engine/workflow');
const { Recorder } = require('../../src/engine/recorder');
process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';

const WORKFLOW = path.join(__dirname, '..', '..', 'workflows', 'refactor.yaml');
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

test('refactor workflow: the recorded summary.json has the before/after figures and the cost', { timeout: 120000 }, async (t) => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'refactor-summary-repo-'));
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'refactor-summary-runs-'));
  t.after(() => {
    fs.rmSync(repo, { recursive: true, force: true, maxRetries: 5 });
    fs.rmSync(runsDir, { recursive: true, force: true });
  });
  git(repo, 'init', '-q');
  fs.writeFileSync(path.join(repo, 'app.js'), 'module.exports = 1;\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
  const run = new WorkflowRun({ file: WORKFLOW, inputs: { task: 'Split the handler', target: 'app.js', repo_path: repo }, mock: true, runsDir, mockSequences: { verdict: ['approved'] } });
  const rec = new Recorder(run.runDir, run.wf.observability?.capture?.redact);
  run.on('event', (ev) => {
    rec.write(ev);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, ev.choices[0].id, 'user'));
  });
  await run.start();
  const summary = JSON.parse(fs.readFileSync(path.join(run.runDir, 'summary.json'), 'utf8'));
  assert.equal(summary.status, 'success');
  assert.equal(summary.workflow, 'refactor');
  for (const side of ['before', 'after']) {
    assert.equal(typeof summary.outputs[side], 'object', side);
    assert.equal(typeof summary.outputs[side].lines, 'number', `${side}.lines`);
    assert.equal(typeof summary.outputs[side].files_touched, 'number', `${side}.files_touched`);
  }
  assert.equal(typeof summary.cost_usd, 'number');
});
