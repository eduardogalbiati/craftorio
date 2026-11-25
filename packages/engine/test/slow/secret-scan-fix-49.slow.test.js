// #49, mock runs of workflows/fix.yaml with a fake gitleaks (the scan is real, local and free in a simulation, as
// the rule check): a clean run reaches its end; without gitleaks the run, its gate and its report say "secrets not
// scanned"; a secret that stays goes back to the developer twice, then to a gate, and nothing lands. Acceptance
// tests written before the code. The routes are in ../secret-scan-workflows-49.test.js, the step in
// ../secret-scan.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { WorkflowRun, loadWorkflow } = require('../../engine/workflow');
const { FILES, ROOT, commit, git, installGitleaks, plainGit, planted, removeGitleaks, scanStep, textIn, tmp } = require('../helpers/fake-gitleaks');
process.env.CRAFTORIO_MOCK_DELAY_SCALE = '0.02';

plainGit();
const LIMIT = { timeout: 120000 };
const WORKFLOW = path.join(ROOT, ...FILES.fix.split('/'));

function makeRepo(t) {
  const dir = tmp(t, 'repo');
  git(dir, 'init', '-q', '-b', 'main');
  commit(dir, 'base', { 'src/app.txt': 'the app\n' });
  git(dir, 'switch', '-q', '-c', 'fix-49');
  return dir;
}

// → { events, transitions, gates, finished, runDir }; every gate takes its Stop, else its first choice
async function runFix(t, { inputs = {}, onDevelop = () => {} } = {}) {
  const scan = scanStep(loadWorkflow(WORKFLOW), 'fix').id;
  const repo = makeRepo(t);
  const run = new WorkflowRun({
    file: WORKFLOW, inputs: { task: 'Fix the widgets', repo_path: repo, ...inputs }, mock: true, runsDir: tmp(t, 'runs'),
    mockSequences: { verdict: ['approved'], suite: { suite: ['pass'] } },
  });
  const events = [];
  let turn = 0;
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') {
      const choice = ev.choices?.find((c) => /stop/.test(c.id))?.id ?? ev.choices?.[0]?.id ?? true;
      setImmediate(() => run.resolveApproval(ev.approval_id, choice, 'user'));
    }
    if (ev.type === 'session.message_sent' && ev.step_id === 'develop') onDevelop(repo, ++turn);
  });
  await run.start();
  return {
    scan, events, runDir: run.runDir,
    transitions: events.filter((e) => e.type === 'step.transition').map((e) => `${e.from}>${e.to}`),
    gates: events.filter((e) => e.type === 'approval.requested'),
    finished: events.find((e) => e.type === 'workflow.finished'),
  };
}

test('#49 fix run: a clean scan goes on to the review and the run reaches its end', LIMIT, async (t) => {
  const { calls } = installGitleaks(t);
  const { scan, transitions, events, finished, runDir } = await runFix(t, { onDevelop: (repo) => commit(repo, 'the fix', { 'src/fix.txt': 'fixed\n' }) });
  assert.equal(finished?.status, 'success', finished?.error);
  const at = transitions.findIndex((x) => x.startsWith(`${scan}>`));
  assert.equal(at >= 0 && at < transitions.findIndex((x) => x.startsWith('code_review>')), true, transitions.join(', '));
  assert.equal(calls().length > 0, true, 'gitleaks was called');
  assert.equal(events.filter((e) => e.type === 'session.message_sent' && e.step_id === scan).length, 0, 'the scan makes no model call');
  assert.doesNotMatch(fs.readFileSync(path.join(runDir, 'result.md'), 'utf8'), /secrets not scanned/i);
});

test('#49 fix run: without gitleaks the run goes on, and the run, its gate and its report say "secrets not scanned"', LIMIT, async (t) => {
  removeGitleaks(t);
  const { events, gates, finished, runDir } = await runFix(t, { inputs: { approve_before_merge: true } });
  assert.equal(finished?.status, 'success', finished?.error);
  assert.match(events.filter((e) => e.type === 'log').map((e) => e.message).join('\n'), /secrets not scanned/i);
  const validate = gates.find((g) => g.step_id === 'validate');
  assert.equal(!!validate, true, 'the run asked at its validate gate');
  assert.match(JSON.stringify(validate), /secrets not scanned/i);
  assert.match(fs.readFileSync(path.join(runDir, 'result.md'), 'utf8'), /secrets not scanned/i);
});

test('#49 fix run: a secret that stays goes back to the developer twice, then to a gate; nothing lands and no value is shown', LIMIT, async (t) => {
  installGitleaks(t);
  const value = planted();
  const onDevelop = (repo, n) => commit(repo, `turn ${n}`, { 'src/config.txt': n === 1 ? `token ${value}\n` : `clean ${n}\n` });
  const { scan, transitions, events, gates, finished, runDir } = await runFix(t, { onDevelop });
  assert.equal(transitions.filter((x) => x === `${scan}>develop`).length, 2, transitions.join(', '));
  assert.equal(gates.length, 1);
  assert.equal(transitions.includes(`${scan}>${gates[0].step_id}`), true, transitions.join(', '));
  assert.equal(finished?.status, 'failed');
  assert.equal(transitions.some((x) => /^code_review>|>(code_review|push_main|ci)$/.test(x)), false, transitions.join(', '));
  assert.equal(events.some((e) => e.type === 'worktree.merged'), false, 'nothing merged');
  assert.equal(JSON.stringify(events).includes(value), false, 'an event (a prompt, a gate, a log) holds the value');
  assert.equal(textIn(runDir).includes(value), false, 'a file of the run holds the value');
});
