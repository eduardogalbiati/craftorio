// workflows/ai-development-local-hero.yaml, #380: a merge conflict in test files that needs new test
// lines. resolve_merge answers `test_conflict`, the test writer gets the conflict (delegate), then
// resolve_merge runs again to finish the rebase and the run goes on to the scoped re-check and merges.
// A whole mock run (a new transition): the local merge fails once (action_errors), the
// developer's resolve_merge answers are pinned (the mock fills every optional string).
// #418: the merge-conflict-resolver skill reaches resolve_merge on each visit, not the develop prompt.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { WorkflowRun } = require('../../engine/workflow');
process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';

const WORKFLOW = path.join(__dirname, '..', '..', '..', '..', 'workflows', 'ai-development-local-hero.yaml');
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

function makeRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dev-380-repo-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  git(dir, 'init', '-q');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'module.exports = 1;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'switch', '-q', '-c', 'feat');
  return dir;
}

const CONFLICT = 'fronts/analyser/features/architecture.feature: both sides edited the step "the plan is shown" (simulated)';

test('ai-development-local-hero (#380): a test conflict needing new lines goes to the test writer, then back to resolve_merge, and the run merges', { timeout: 180000 }, async (t) => {
  const repo = makeRepo(t);
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dev-380-runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const run = new WorkflowRun({
    file: WORKFLOW,
    inputs: { task: 'Add the feature', repo_path: repo, unit_tests: 'run_existing', e2e_tests: 'off' },
    mock: true,
    runsDir,
    mockSequences: { verdict: ['approved'], suite: { red_check: ['fail'], suite: ['pass'] }, action_errors: { verify_change: 1 } },
  });
  // every turn in order: who, in which step, with which prompt
  const turns = [];
  let resolveVisits = 0;
  const original = run.sendToAgent.bind(run);
  run.sendToAgent = (agentName, prompt, opts = {}) => {
    turns.push({ agent: agentName, step: opts.stepId || null, prompt: String(prompt) });
    if (opts.stepId !== 'resolve_merge' || agentName !== 'developer') return original(agentName, prompt, opts);
    resolveVisits++;
    const out = resolveVisits === 1
      ? { resolved: false, blocked: false, summary: 'A test file needs new lines: handed to the test writer.', test_conflict: CONFLICT }
      : { resolved: true, blocked: false, summary: 'Finished the rebase.', files_changed: ['fronts/analyser/features/architecture.feature'], behaviour_changed: false, previous_head: 'abc0001', head: 'def0002' };
    return Promise.resolve({ text: `\`\`\`json\n${JSON.stringify(out)}\n\`\`\`` });
  };
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, ev.choices ? ev.choices[0].id : true));
  });
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);

  const resolveTurns = turns.map((x, i) => [x, i]).filter(([x]) => x.agent === 'developer' && x.step === 'resolve_merge');
  assert.equal(resolveTurns.length, 2, 'resolve_merge runs again after the test writer');
  const [[, first], [second, secondAt]] = resolveTurns;
  const handoff = turns.slice(first + 1, secondAt).filter((x) => x.agent === 'test_writer');
  assert.equal(handoff.length >= 1, true, 'the test writer gets a turn between the two resolve_merge visits');
  assert.ok(handoff.some((x) => x.prompt.includes(CONFLICT)), 'the test writer gets the conflict the developer reported');
  assert.ok(handoff.some((x) => /:2:/.test(x.prompt) && /:3:/.test(x.prompt)), 'the test writer is told where both sides are');
  assert.match(second.prompt, /The test writer resolved the test conflict/);
  // the developer never got a turn to write the test lines itself in between
  assert.equal(turns.slice(first + 1, secondAt).some((x) => x.agent === 'developer'), false);

  // #418: merge-conflict-resolver is a step skill of resolve_merge, on each visit, and no longer in the
  // developer's system part (the develop prompt's 40K budget)
  const SKILL = '<skill name="merge-conflict-resolver"';
  assert.equal(turns[first].prompt.includes(SKILL), true, 'the first resolve_merge visit gets the merge-conflict-resolver skill');
  assert.equal(second.prompt.includes(SKILL), true, 'the return visit after the test writer gets it again');
  const agentOf = {};
  for (const e of events) if (e.type === 'session.opened') agentOf[e.session.id] = e.session.agent;
  const develop = events.find((e) => e.type === 'session.message_sent' && e.step_id === 'develop' && agentOf[e.session_id] === 'developer');
  assert.ok(develop, 'the developer had a develop turn');
  assert.equal(develop.prompt.includes(SKILL), false, 'the develop prompt does not carry the merge-conflict-resolver skill');

  const transitions = events.filter((e) => e.type === 'step.transition').map((e) => `${e.from}>${e.to}`);
  assert.ok(transitions.includes('resolve_merge>code_review'), transitions.join(', '));
  assert.equal(transitions.includes('resolve_merge>merge_blocked'), false, 'the test conflict does not stop the run');
});
