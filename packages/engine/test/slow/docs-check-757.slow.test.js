// #757, mock runs of workflows/feature.yaml: after develop, the docs_check step (no agent) reads
// `## Expected files` of the run's issue (in the task) and compares its docs with the run's diff. A
// diff that touches none of them goes back to develop with the missing paths, before the code
// review; once the doc is written the run goes on. The step shows its counts in the timeline
// ("docs expected: 1, touched: 0") and makes no model call. The repository has no check script,
// so rule_check does not run: the docs check must not depend on it.
// The definitions are tested in test/docs-check-workflow-757.test.js, the parser in
// test/expected-files-757.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { WorkflowRun } = require('../../engine/workflow');
process.env.CRAFTORIO_MOCK_DELAY_SCALE = '0.02';

const WORKFLOW = path.join(__dirname, '..', '..', '..', '..', 'workflows', 'feature.yaml');
const STEP = 'docs_check';
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const write = (dir, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};
const commit = (repo, rel, text, msg) => {
  write(repo, rel, text);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', msg);
};

const TASK = [
  'Add the greeting',
  '',
  'Issue: https://github.com/o/r/issues/757',
  '',
  'The app greets the user.',
  '',
  '## Expected files',
  '',
  '- `src/app.js`: the greeting',
  '- `docs/guide-757.md` (new): how the greeting works',
  '',
  '## Tasks',
  '',
  '- [ ] greet the user',
  '',
].join('\n');

function makeRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-check-repo-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  git(dir, 'init', '-q');
  write(dir, 'src/app.js', 'module.exports = 1;\n');
  write(dir, 'package.json', `${JSON.stringify({ name: 'docs-check-fixture', version: '1.0.0', private: true, scripts: {} }, null, 2)}\n`);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'switch', '-q', '-c', 'feat');
  return dir;
}

const ownText = (prompt) => String(prompt || '').replace(/<skill name="[^"]*"[\s\S]*?<\/skill>/g, '');

async function run(t, { onTurn }) {
  const repo = makeRepo(t);
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-check-runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const wr = new WorkflowRun({
    file: WORKFLOW,
    inputs: { task: TASK, repo_path: repo, unit_tests: 'run_existing', e2e_tests: 'off' },
    mock: true,
    runsDir,
    mockSequences: { verdict: ['approved'], suite: { red_check: ['fail'], suite: ['pass'] } },
  });
  const events = [];
  let turn = 0;
  wr.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') setImmediate(() => wr.resolveApproval(ev.approval_id, ev.choices[0].id, 'user', undefined));
    // the developer's commits, in the repository the run works on (as in check-step-404.slow.test.js)
    if (ev.type === 'session.message_sent' && ev.step_id === 'develop') onTurn(repo, ++turn);
  });
  await wr.start();
  const transitions = events.filter((e) => e.type === 'step.transition').map((e) => `${e.from}>${e.to}`);
  const prompts = events.filter((e) => e.type === 'session.message_sent' && e.step_id === 'develop').map((e) => ownText(e.prompt));
  return { events, transitions, prompts, finished: events.find((e) => e.type === 'workflow.finished') };
}

test('#757 run: a diff without the expected doc goes back to develop with its path, then on to the review once written', { timeout: 180000 }, async (t) => {
  const onTurn = (dir, n) => {
    if (n === 1) commit(dir, 'src/app.js', 'module.exports = "hello";\n', 'develop: greet');
    if (n === 2) commit(dir, 'docs/guide-757.md', '# Greeting\n', 'develop: the guide');
  };
  const { events, transitions, prompts, finished } = await run(t, { onTurn });
  assert.equal(finished.status, 'success', finished.error);
  const back = transitions.indexOf(`${STEP}>develop`);
  const review = transitions.findIndex((x) => x.endsWith('>code_review'));
  assert.ok(back >= 0, `the docs check returns to develop (got ${transitions.join(', ')})`);
  assert.ok(review > back, 'the return happens before the code review');
  assert.equal(transitions.filter((x) => x === `${STEP}>develop`).length, 1, `once: the second check passes (got ${transitions.join(', ')})`);
  assert.ok(prompts.length >= 2);
  assert.match(prompts[1], /docs\/guide-757\.md/, 'the developer is given the missing doc');
  const first = events.find((e) => e.type === 'step.finished' && e.step_id === STEP);
  assert.match(JSON.stringify(first.output || {}), /docs expected: 1, touched: 0/, 'the timeline shows what the check found');
  assert.equal(events.filter((e) => e.type === 'session.message_sent' && e.step_id === STEP).length, 0, 'the check makes no model call');
});

test('#757 run: a diff that touches the expected doc goes on to the review without returning', { timeout: 180000 }, async (t) => {
  const onTurn = (dir, n) => {
    if (n === 1) {
      write(dir, 'src/app.js', 'module.exports = "hello";\n');
      commit(dir, 'docs/guide-757.md', '# Greeting\n', 'develop: greet, with the guide');
    }
  };
  const { events, transitions, finished } = await run(t, { onTurn });
  assert.equal(finished.status, 'success', finished.error);
  assert.ok(!transitions.includes(`${STEP}>develop`), `no return to develop (got ${transitions.join(', ')})`);
  assert.ok(transitions.some((x) => x.endsWith('>code_review')), 'the run reaches the review');
  const done = events.find((e) => e.type === 'step.finished' && e.step_id === STEP);
  assert.ok(done, `${STEP} runs after develop`);
  assert.match(JSON.stringify(done.output || {}), /docs expected: 1, touched: 1/);
});
