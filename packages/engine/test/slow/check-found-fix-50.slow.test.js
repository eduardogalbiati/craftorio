// #50, one mock run of workflows/fix.yaml: the rule check after the developer's commit sends a failure back to
// develop, then lets the fixed commit through to the review. The check is a real, local and free script of the
// temporary repository (as slow/check-step-404.slow.test.js). The routes of the other outcomes (and of
// refactor.yaml) are in test/workflow-check-found-50.test.js, what the step finds in test/check-step-found.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { WorkflowRun, loadWorkflow } = require('../../engine/workflow');
process.env.CRAFTORIO_MOCK_DELAY_SCALE = '0.02';

const WORKFLOW = path.join(__dirname, '..', '..', '..', '..', 'workflows', 'fix.yaml');
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

function tmp(t, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `check-found-${name}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  return dir;
}

// one finding until the developer adds fixed.txt
function makeRepo(t) {
  const dir = tmp(t, 'repo');
  git(dir, 'init', '-q');
  fs.writeFileSync(path.join(dir, 'check.js'), "if (require('fs').existsSync('fixed.txt')) process.exit(0);\nconsole.log('zz-rule-50: add fixed.txt');\nprocess.exit(1);\n");
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'found-50', version: '1.0.0', private: true, scripts: { check: 'node check.js' } }));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'switch', '-q', '-c', 'fix-50');
  return dir;
}

test('#50 fix: a rule check that fails sends the developer back once with the findings, then goes to the review', { timeout: 120000 }, async (t) => {
  const check = loadWorkflow(WORKFLOW).steps.find((s) => s.type === 'check')?.id;
  assert.equal(typeof check, 'string', 'fix.yaml has no type: check step');
  const repo = makeRepo(t);
  const run = new WorkflowRun({
    file: WORKFLOW, inputs: { task: 'Fix the widgets', repo_path: repo }, mock: true, runsDir: tmp(t, 'runs'),
    mockSequences: { verdict: ['approved'], suite: { suite: ['pass'] } },
  });
  const events = [];
  let turn = 0;
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, ev.choices?.length ? ev.choices[0].id : true, 'user'));
    if (ev.type === 'session.message_sent' && ev.step_id === 'develop' && ++turn === 2) {
      fs.writeFileSync(path.join(repo, 'fixed.txt'), 'fixed\n');
      git(repo, 'add', '-A');
      git(repo, 'commit', '-q', '-m', 'develop: fix the planted rule');
    }
  });
  await run.start();
  const transitions = events.filter((e) => e.type === 'step.transition').map((e) => `${e.from}>${e.to}`);
  const prompts = events.filter((e) => e.type === 'session.message_sent' && e.step_id === 'develop').map((e) => String(e.prompt || ''));
  assert.equal(transitions.includes(`${check}>develop`), true, transitions.join(', '));
  // #49: the secret scan (no agent) may run before or after the check
  const scan = loadWorkflow(WORKFLOW).steps.find((s) => s.type === 'secret_scan')?.id;
  const started = events.filter((e) => e.type === 'step.started' && e.step_id !== scan).map((e) => e.step_id);
  assert.deepEqual(started.slice(1, 6), ['develop', check, 'develop', check, 'code_review']);
  assert.equal(prompts[1]?.includes('zz-rule-50'), true, 'the second develop turn has the finding');
  assert.equal(events.find((e) => e.type === 'workflow.finished')?.status, 'success');
});
