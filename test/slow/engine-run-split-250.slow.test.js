// #250: splitting WorkflowRun by area keeps its behaviour: a mock run of ai-development-local-hero
// emits the same events, by type (and step id when the event has one) and order, as before the
// split. The baseline test/fixtures/events-ai-development-local-hero-250.json was recorded on the
// base commit (a4dd9ab) with this same run; two runs there gave the same 182 events.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { WorkflowRun } = require('../../src/engine/workflow');
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
  const seq = [];
  let status = null;
  run.on('event', (ev) => {
    seq.push(ev.step_id ? `${ev.type} ${ev.step_id}` : ev.type);
    if (ev.type === 'workflow.finished') status = ev.status;
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, ev.choices ? ev.choices[0].id : true));
  });
  await run.start();
  assert.equal(status, 'success');
  assert.deepEqual(seq, JSON.parse(fs.readFileSync(BASELINE, 'utf8')));
});
