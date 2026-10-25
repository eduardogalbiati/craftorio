const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseTarget, ghPrState, ghRunState, glMrState, glPipelineState, withQuota, runProbe } = require('../engine/probes');
const { WorkflowRun, loadWorkflow } = require('../engine/workflow');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = process.env.MULTIAGENT_MOCK_DELAY_SCALE || '0.05';

test('parseTarget reads GitHub and GitLab PR/MR and run URLs', () => {
  assert.deepEqual(parseTarget('https://github.com/acme/app/pull/42'), { platform: 'gh', host: 'github.com', repo: 'acme/app', kind: 'pr', id: 42 });
  assert.deepEqual(parseTarget('https://github.com/acme/app/pull/42/files'), { platform: 'gh', host: 'github.com', repo: 'acme/app', kind: 'pr', id: 42 });
  assert.deepEqual(parseTarget('https://github.com/acme/app/actions/runs/123/job/9'), { platform: 'gh', host: 'github.com', repo: 'acme/app', kind: 'run', id: 123 });
  assert.deepEqual(parseTarget('https://gitlab.example.com/group/sub/app/-/merge_requests/7'), { platform: 'gl', host: 'gitlab.example.com', repo: 'group/sub/app', kind: 'pr', id: 7 });
  assert.deepEqual(parseTarget('https://gitlab.com/group/app/-/pipelines/99'), { platform: 'gl', host: 'gitlab.com', repo: 'group/app', kind: 'run', id: 99 });
  for (const bad of ['', '(simulated) run_url', 'https://github.com/acme/app', 'http://github.com/acme/app/pull/1', 'https://github.com/acme/app/pull/1; rm -rf /']) {
    assert.equal(parseTarget(bad), null, bad);
  }
});

test('ghPrState: conflicts, failures, running and passed checks, no checks', () => {
  const run = (status, conclusion, name = 'test') => ({ __typename: 'CheckRun', name, status, conclusion });
  const pr = (extra) => ({ state: 'OPEN', mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', headRefOid: 'abc', statusCheckRollup: [], ...extra });

  assert.equal(ghPrState(pr({})).state, 'none');
  assert.equal(ghPrState(pr({ statusCheckRollup: [run('IN_PROGRESS', ''), run('COMPLETED', 'SUCCESS', 'lint')] })).state, 'pending');
  assert.match(ghPrState(pr({ statusCheckRollup: [run('IN_PROGRESS', ''), run('COMPLETED', 'SUCCESS', 'lint')] })).detail, /1 of 2 checks still running/);
  const failed = ghPrState(pr({ statusCheckRollup: [run('IN_PROGRESS', ''), run('COMPLETED', 'FAILURE', 'test (windows-latest)')] }));
  assert.equal(failed.state, 'failed', 'a failure is news even while other checks run');
  assert.match(failed.detail, /test \(windows-latest\)/);
  assert.equal(ghPrState(pr({ statusCheckRollup: [run('COMPLETED', 'SUCCESS'), run('COMPLETED', 'SKIPPED', 'b')] })).state, 'passed');
  // commit statuses (StatusContext) have a state instead of status + conclusion
  assert.equal(ghPrState(pr({ statusCheckRollup: [{ __typename: 'StatusContext', context: 'ci/x', state: 'PENDING' }] })).state, 'pending');
  assert.equal(ghPrState(pr({ statusCheckRollup: [{ __typename: 'StatusContext', context: 'ci/x', state: 'ERROR' }] })).state, 'failed');
  assert.equal(ghPrState(pr({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' })).state, 'conflict');
  assert.equal(ghPrState(pr({ state: 'MERGED' })).state, 'merged');
  assert.equal(ghPrState(pr({ state: 'CLOSED' })).state, 'closed');
});

test('ghPrState fingerprint changes with what the babysitter reacts to, not with order', () => {
  const base = { state: 'OPEN', mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED', headRefOid: 'abc', reviewDecision: 'REVIEW_REQUIRED', comments: [{}], reviews: [],
    statusCheckRollup: [{ name: 'a', status: 'COMPLETED', conclusion: 'SUCCESS' }, { name: 'b', status: 'COMPLETED', conclusion: 'SUCCESS' }] };
  const fp = (x) => ghPrState({ ...base, ...x }).fingerprint;
  assert.equal(fp({}), fp({ statusCheckRollup: [...base.statusCheckRollup].reverse() }));
  for (const change of [{ headRefOid: 'def' }, { comments: [{}, {}] }, { reviews: [{}] }, { reviewDecision: 'APPROVED' }, { mergeStateStatus: 'CLEAN' },
    { statusCheckRollup: [{ name: 'a', status: 'COMPLETED', conclusion: 'FAILURE' }, base.statusCheckRollup[1]] }]) {
    assert.notEqual(fp(change), fp({}), JSON.stringify(change));
  }
});

test('ghRunState, glMrState and glPipelineState', () => {
  assert.equal(ghRunState({ status: 'in_progress' }).state, 'pending');
  assert.equal(ghRunState({ status: 'completed', conclusion: 'success' }).state, 'passed');
  assert.equal(ghRunState({ status: 'completed', conclusion: 'failure' }).state, 'failed');

  const mr = (extra) => ({ state: 'opened', sha: 'abc', has_conflicts: false, detailed_merge_status: 'mergeable', head_pipeline: { status: 'running' }, ...extra });
  assert.equal(glMrState(mr({})).state, 'pending');
  assert.equal(glMrState(mr({ head_pipeline: { status: 'success' } })).state, 'passed');
  assert.equal(glMrState(mr({ head_pipeline: { status: 'failed' } })).state, 'failed');
  assert.equal(glMrState(mr({ head_pipeline: null })).state, 'none');
  assert.equal(glMrState(mr({ has_conflicts: true })).state, 'conflict');
  assert.equal(glMrState(mr({ head_pipeline: { status: 'manual' } })).state, 'unknown');
  assert.equal(glMrState(mr({ state: 'merged' })).state, 'merged');
  assert.notEqual(glMrState(mr({})).fingerprint, glMrState(mr({ user_notes_count: 3 })).fingerprint);

  assert.equal(glPipelineState({ status: 'pending' }).state, 'pending');
  assert.equal(glPipelineState({ status: 'success' }).state, 'passed');
  assert.equal(glPipelineState({ status: 'canceled' }).state, 'failed');
});

test('runProbe refuses a target that is not a URL of the right kind (no CLI is started)', async () => {
  await assert.rejects(runProbe({ probe: 'pr_checks', target: '(simulated) pr_url' }), /is not a pull\/merge request URL/);
  await assert.rejects(runProbe({ probe: 'pr_checks', target: 'https://github.com/acme/app/actions/runs/1' }), /is not a pull\/merge request URL/);
  await assert.rejects(runProbe({ probe: 'workflow_run', target: 'https://github.com/acme/app/pull/1' }), /is not a CI run or pipeline URL/);
  await assert.rejects(runProbe({ probe: 'nope', target: 'https://github.com/acme/app/pull/1' }), /unknown probe/);
});

test('withQuota: a GitHub PR with no check started, or failed checks, reports an exhausted Actions quota', async () => {
  const gh = parseTarget('https://github.com/acme/app/pull/42');
  const owners = [];
  const exhausted = async (owner) => { owners.push(owner); return 'GitHub Actions quota exhausted until 2026-10-01'; };
  for (const state of ['none', 'failed']) {
    assert.deepEqual(await withQuota({ state, detail: 'x', head: 'abc' }, gh, exhausted),
      { state: 'quota_exhausted', detail: 'GitHub Actions quota exhausted until 2026-10-01', head: 'abc' }, state);
  }
  assert.deepEqual(owners, ['acme', 'acme']);
});

test('withQuota: running or green checks, other hosts and an unknown quota change nothing', async () => {
  const gh = parseTarget('https://github.com/acme/app/pull/42');
  const exhausted = async () => 'GitHub Actions quota exhausted until 2026-10-01';
  for (const state of ['pending', 'passed', 'conflict', 'merged']) {
    assert.equal((await withQuota({ state, detail: 'x' }, gh, exhausted)).state, state);
  }
  assert.equal((await withQuota({ state: 'none' }, parseTarget('https://ghe.example.com/acme/app/pull/1'), exhausted)).state, 'none');
  assert.equal((await withQuota({ state: 'none' }, parseTarget('https://gitlab.com/acme/app/-/merge_requests/1'), exhausted)).state, 'none');
  assert.equal((await withQuota({ state: 'none' }, gh, async () => null)).state, 'none');
  assert.equal((await withQuota({ state: 'none' }, gh, async () => { throw new Error('no scope'); })).state, 'none');
  assert.equal((await withQuota({ state: 'none' }, gh, undefined)).state, 'none');
});

test('loadWorkflow validates wait:', () => {
  const tmp = path.join(os.tmpdir(), `wf-wait-${process.pid}.yaml`);
  const write = (wait, loop = 'loop: { interval: 1s }') => fs.writeFileSync(tmp, `agents: { a: { provider: claude, model: m } }\nsteps:\n  - id: s1\n    agent: a\n    ${loop}\n    wait: ${wait}\n`);
  try {
    write('{ probe: pr_checks, target: "x" }', '');
    assert.throws(() => loadWorkflow(tmp), /only valid on a single-agent step with a loop/);
    write('{ probe: nope, target: "x" }');
    assert.throws(() => loadWorkflow(tmp), /wait.probe must be one of pr_checks, pr_changes, workflow_run/);
    write('{ probe: pr_checks }');
    assert.throws(() => loadWorkflow(tmp), /requires "target"/);
    write('{ probe: pr_changes, target: "x", output: { a: 1 } }');
    assert.throws(() => loadWorkflow(tmp), /wait.output must be a map/);
    write('{ probe: pr_changes, target: "x", infra_output: { a: 1 } }');
    assert.throws(() => loadWorkflow(tmp), /wait.infra_output must be a map/);
    write('{ probe: pr_checks, target: "x", grace: soon }');
    assert.throws(() => loadWorkflow(tmp), /wait.grace must be a duration/);
    write('{ probe: pr_checks, target: "x", output: { ci_status: success }, grace: 10m }');
    assert.doesNotThrow(() => loadWorkflow(tmp));
  } finally {
    fs.unlinkSync(tmp);
  }
});

// Runs test/fixtures/wait.yaml with mock agents and the given probe answers.
// `grace` replaces the fixture's wait.grace of the ci step.
async function runWait(t, { probe, mockSequences, grace }) {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  let file = path.join(__dirname, 'fixtures', 'wait.yaml');
  if (grace) {
    const copy = path.join(runsDir, 'wait.yaml');
    fs.writeFileSync(copy, fs.readFileSync(file, 'utf8').replace('grace: 1h', `grace: ${grace}`));
    file = copy;
  }
  const calls = [];
  const run = new WorkflowRun({
    file, inputs: {}, mock: true, runsDir, mockSequences,
    probe: async (args) => { calls.push(args); return probe(args); },
  });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, false));
  });
  await run.start();
  const turns = (step) => events.filter((e) => e.type === 'session.message_sent' && e.step_id === step);
  return { run, events, calls, turns, finished: events.find((e) => e.type === 'workflow.finished') };
}

const sequence = (states) => {
  let i = 0;
  return () => states[Math.min(i++, states.length - 1)];
};

test('wait: the engine polls CI between agent turns and only calls the agent on news', { timeout: 60000 }, async (t) => {
  const ci = sequence([
    { state: 'none', detail: 'no check registered on the head commit yet' },
    { state: 'pending', detail: '2 of 3 checks still running' },
    { state: 'failed', detail: 'checks failed: test (windows-latest)' },
    { state: 'pending', detail: '1 of 3 checks still running' },
    { state: 'passed', detail: 'all 3 checks passed' },
  ]);
  const pr = sequence(['A', 'A', 'A', 'B']);
  const { run, events, calls, turns, finished } = await runWait(t, {
    mockSequences: { ci_status: ['pending', 'failed', 'pending'], state: ['waiting', 'ready'] },
    probe: (a) => (a.probe === 'pr_checks' ? ci() : { state: 'pending', detail: 'open', fingerprint: pr() }),
  });
  assert.equal(finished.status, 'success', finished.error);

  // ci: 3 agent turns (push, the failure, after the fix) instead of 3 + 4 polls; the green checks
  // finish the step without an agent turn
  assert.equal(turns('ci').length, 3);
  const probes = events.filter((e) => e.type === 'step.probe' && e.step_id === 'ci');
  assert.deepEqual(probes.map((e) => `${e.state}:${e.action}`), ['none:poll', 'pending:poll', 'failed:agent', 'pending:poll', 'passed:output']);
  assert.ok(calls.every((c) => c.target === 'https://github.com/acme/app/pull/42'));
  assert.match(turns('ci')[1].prompt, /checked 3 time\(s\) without you\. It calls you now because: checks failed: test \(windows-latest\)/);
  assert.match(turns('ci')[1].prompt, /Between your turns the orchestrator checks the PR\/MR checks/);
  assert.doesNotMatch(turns('ci')[2].prompt, /It calls you now because/, 'after a delegation the agent is called for the new commit');
  const done = events.find((e) => e.type === 'step.finished' && e.step_id === 'ci' && e.probe);
  assert.equal(done.output.ci_status, 'success');
  assert.equal(done.output.pr_url, 'https://github.com/acme/app/pull/42', 'keeps the agent\'s last output');
  assert.ok(events.some((e) => e.type === 'step.goal' && e.step_id === 'ci' && e.met));
  assert.ok(events.some((e) => e.type === 'step.transition' && e.from === 'ci' && e.to === 'watch'));

  // watch: the fingerprint taken after the agent's turn (A) does not call it; the change (B) does
  const watch = events.filter((e) => e.type === 'step.probe' && e.step_id === 'watch');
  assert.deepEqual(watch.map((e) => `${e.state}:${e.action}`), ['unchanged:poll', 'unchanged:poll', 'changed:agent']);
  assert.equal(calls.filter((c) => c.baseline).length, 2, 'one baseline per watch agent turn');
  assert.equal(turns('watch').length, 2);

  assert.deepEqual(finished.summary.probes, {
    ci: { polls: 3, agent_calls: 1, completed: 1, errors: 0 },
    watch: { polls: 2, agent_calls: 1, completed: 0, errors: 0 },
  });
  const rows = fs.readFileSync(path.join(run.runDir, 'decisions.tsv'), 'utf8').trim().split('\n').slice(1).map((l) => l.split('\t'));
  assert.deepEqual(rows.map((r) => r.slice(1, 5)), [['orchestrator', 'ci', 'wait', 'finished ci without an agent turn']]);
  // the probe polls are not "blocked" /loop iterations (no tool call ran in them)
  assert.ok(!events.some((e) => e.kind === 'loop_blocked'));
});

test('wait: a check that cannot run, or no check after the grace period, calls the agent', { timeout: 60000 }, async (t) => {
  let n = 0;
  const { events, turns, finished } = await runWait(t, {
    grace: '0s',
    mockSequences: { ci_status: ['pending', 'pending', 'success'], state: ['ready'] },
    probe: () => (++n === 1 ? Promise.reject(new Error('gh: not logged in')) : { state: 'none', detail: 'no check registered on the head commit yet' }),
  });
  assert.equal(finished.status, 'success', finished.error);
  const probes = events.filter((e) => e.type === 'step.probe');
  assert.deepEqual(probes.map((e) => `${e.state}:${e.action}`), ['error:agent', 'none:agent']);
  assert.ok(events.some((e) => e.type === 'log' && e.kind === 'probe_error' && /gh: not logged in/.test(e.message)));
  assert.match(turns('ci')[1].prompt, /the check could not run \(gh: not logged in\)/);
  assert.match(turns('ci')[2].prompt, /no check registered on the head commit yet, 0s after your last turn/);
  assert.equal(turns('ci').length, 3);
  assert.equal(finished.summary.probes.ci.errors, 1);
});

test('wait: an exhausted Actions quota finishes CI as an infra failure and goes to the gate', { timeout: 60000 }, async (t) => {
  const detail = 'GitHub Actions quota exhausted until 2026-10-01 (2,010 of 2,000 minutes used): no check will start before then';
  const ci = sequence([{ state: 'none', detail: 'no check registered on the head commit yet' }, { state: 'quota_exhausted', detail }]);
  const { events, turns, finished } = await runWait(t, {
    mockSequences: { ci_status: ['pending'] },
    probe: (a) => (a.probe === 'pr_checks' ? ci() : { state: 'pending' }),
  });
  // the gate was rejected by the test: the run ends failed there, after one agent turn and no fix round
  assert.equal(finished.status, 'failed');
  assert.equal(turns('ci').length, 1);
  assert.equal(turns('dev').length, 0);
  const probes = events.filter((e) => e.type === 'step.probe');
  assert.deepEqual(probes.map((e) => `${e.state}:${e.action}`), ['none:poll', 'quota_exhausted:output']);
  const done = events.find((e) => e.type === 'step.finished' && e.step_id === 'ci' && e.probe);
  assert.equal(done.output.ci_status, 'failed');
  assert.equal(done.output.failure_class, 'infra');
  assert.equal(done.output.failure_log, detail);
  assert.equal(done.output.pr_url, 'https://github.com/acme/app/pull/42');
  assert.ok(events.some((e) => e.type === 'step.transition' && e.from === 'ci' && e.to === 'stuck'));
});

test('wait: the Actions quota check reaches the probe', { timeout: 60000 }, async (t) => {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const actionsQuota = async () => null;
  const seen = [];
  const run = new WorkflowRun({
    file: path.join(__dirname, 'fixtures', 'wait.yaml'), inputs: {}, mock: true, runsDir, actionsQuota,
    mockSequences: { ci_status: ['pending'], state: ['ready'] },
    probe: async (a) => {
      if (a.probe !== 'pr_checks') return { state: 'pending' };
      seen.push(a.quota);
      return { state: 'passed', detail: 'ok' };
    },
  });
  await run.start();
  assert.ok(seen.length && seen.every((q) => q === actionsQuota));
});
