const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ISSUE_WORKFLOW, makeService, makeResumeService, roadmapProject, until } = require('./helpers');

// Starts a run through the given channel, auto-approves every gate it meets, and resolves with
// its start info ({ runId, runDir }) plus every event and the workflow.finished event.
function runToEnd(service, api, channel, opts) {
  const events = [];
  const finished = new Promise((resolve) => {
    const onEvent = (ev) => {
      events.push(ev);
      if (ev.type === 'approval.requested') setImmediate(() => api['approval:resolve']({ id: ev.approval_id, answer: true }));
      if (ev.type === 'workflow.finished') { service.events.off('run:event', onEvent); resolve(ev); }
    };
    service.events.on('run:event', onEvent);
  });
  return api[channel](opts).then(async (started) => ({ ...started, events, end: await finished }));
}

test('runs:resume restarts a run from a step with no supervisor call; supervisor:resume is the same channel', async (t) => {
  const { service, api } = makeResumeService(t);
  const first = await runToEnd(service, api, 'run:start', { file: 'fixture-resume.yaml', inputs: {}, mock: true });
  assert.equal(first.end.status, 'success');

  const resumed = await runToEnd(service, api, 'runs:resume', { runId: first.runId, step: 'plan' });
  assert.equal(resumed.end.status, 'success');
  assert.deepEqual(resumed.events.find((e) => e.type === 'workflow.started').resumed_from, { run_id: first.runId, step: 'plan' });
  assert.ok(!resumed.events.some((e) => e.type === 'session.opened' && e.session.agent === 'supervisor'), 'no supervisor session: no LLM call, no cost');

  const alias = await runToEnd(service, api, 'supervisor:resume', { runId: first.runId, step: 'plan' });
  assert.equal(alias.end.status, 'success');
  assert.deepEqual(alias.events.find((e) => e.type === 'workflow.started').resumed_from, { run_id: first.runId, step: 'plan' });
});

test('runs:resume refuses to go past a human gate the previous run already decided', async (t) => {
  const { service, api } = makeResumeService(t);
  const first = await runToEnd(service, api, 'run:start', { file: 'fixture-resume.yaml', inputs: {}, mock: true });
  assert.throws(() => api['runs:resume']({ runId: first.runId, step: 'work' }), /go past the human gate "approve"/);
});

test('runs:resume from the gate itself asks it again, never auto-approved', async (t) => {
  const { service, api } = makeResumeService(t);
  const first = await runToEnd(service, api, 'run:start', { file: 'fixture-resume.yaml', inputs: {}, mock: true });
  const resumed = await runToEnd(service, api, 'runs:resume', { runId: first.runId, step: 'approve' });
  assert.equal(resumed.events.find((e) => e.type === 'approval.requested').step_id, 'approve', 'the gate is asked again, not skipped as already approved');
  assert.equal(resumed.end.status, 'success');
});

test('runs:resume refuses a step that does not exist in the current version of the workflow', async (t) => {
  const { service, api } = makeResumeService(t);
  const first = await runToEnd(service, api, 'run:start', { file: 'fixture-resume.yaml', inputs: {}, mock: true });
  assert.throws(() => api['runs:resume']({ runId: first.runId, step: 'nope' }), /does not exist in the current version/);
});

test('runs:resume refuses to resume a run that is still active', async (t) => {
  const { service, api } = makeResumeService(t);
  const finished = new Promise((resolve) => {
    const onEvent = (ev) => {
      if (ev.type === 'approval.requested') assert.throws(() => api['runs:resume']({ runId: ev.run_id, step: 'plan' }), /still active/);
      if (ev.type === 'approval.requested') setImmediate(() => api['approval:resolve']({ runId: ev.run_id, id: ev.approval_id, answer: true }));
      if (ev.type === 'workflow.finished') { service.events.off('run:event', onEvent); resolve(); }
    };
    service.events.on('run:event', onEvent);
  });
  await api['run:start']({ file: 'fixture-resume.yaml', inputs: {}, mock: true });
  await finished;
});

test('a simulated run always resumes as one; simulation-only refuses to resume a real run as real', async (t) => {
  const { service, api } = makeResumeService(t);
  const ws = service.workspace();

  // a real run this environment never actually started (simulation-only forbids it): fabricated
  // the way a run folder from a previous session would look, to resume it in this test.
  const fakeId = '20260101-000000-fakereal1';
  const dir = path.join(ws.runs, fakeId);
  fs.mkdirSync(dir, { recursive: true });
  const ev = (o) => `${JSON.stringify({ ts: '2026-01-01T00:00:00Z', ...o })}\n`;
  fs.writeFileSync(path.join(dir, 'events.jsonl'),
    ev({ type: 'workflow.started', workflow: 'fixture-resume', file: 'fixture-resume.yaml', inputs: {}, mock: false })
    + ev({ type: 'step.finished', step_id: 'plan', visit: 1, output: {} }));
  await assert.rejects(api['runs:resume']({ runId: fakeId, step: 'plan', mock: false }), /Simulation only/);

  const first = await runToEnd(service, api, 'run:start', { file: 'fixture-resume.yaml', inputs: {}, mock: true });
  const resumed = await runToEnd(service, api, 'runs:resume', { runId: first.runId, step: 'plan', mock: false });
  assert.equal(resumed.events.find((e) => e.type === 'workflow.started').mock, true, 'a mock run stays mock however it is resumed');
});

test('runs:resumeOptions lists the workflow steps in order, the gate, what is blocked, and a suggested step', async (t) => {
  const { service, api } = makeResumeService(t);
  const first = await runToEnd(service, api, 'run:start', { file: 'fixture-resume.yaml', inputs: {}, mock: true });
  const o = await api['runs:resumeOptions']({ runId: first.runId });

  assert.equal(o.runId, first.runId);
  assert.equal(o.status, 'success');
  assert.equal(o.active, false);
  assert.equal(o.mock, true);
  assert.deepEqual(o.steps.map((s) => s.id), ['plan', 'approve', 'work']);
  assert.deepEqual(o.steps.map((s) => s.gate), [false, true, false]);
  assert.ok(o.steps.every((s) => s.visits === 1), 'every step of this linear workflow ran once');
  assert.equal(o.steps.find((s) => s.id === 'plan').blockedBy, null);
  assert.equal(o.steps.find((s) => s.id === 'approve').blockedBy, null, 'the gate itself is never blocked: it asks again');
  assert.equal(o.steps.find((s) => s.id === 'work').blockedBy, 'approve');
  assert.equal(o.stoppedAt, 'work');
  assert.equal(o.failedStep, null);
  // 'work', where the run stopped, is blocked by the decided gate, but the gate was an approval
  // (#112) and nothing changed since: confirming it again is allowed, so 'work' itself is suggested
  // (never the first step, 'plan', while the run reached further than that)
  assert.equal(o.steps.find((s) => s.id === 'work').confirm.ok, true);
  assert.equal(o.suggested, 'work');
  assert.equal(o.worktree, null, 'a mock run never touches git');
});

// ---- Resume past a human gate: only confirming an approval (#112) -------------------------------

// Like fixture-resume.yaml, but its gate has choices: only 'approve' (the first one, no feedback
// required) counts as an approval; 'changes' and 'stop' never do, whatever transitions do with them.
const RESUME_CHOICE_WORKFLOW = `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: fixture-resume-choice
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: plan
    agent: a
    prompt: "plan the work"
  - id: developer_check
    type: human_approval
    message: "Proceed?"
    choices:
      - { id: approve, label: Approve }
      - { id: changes, label: Request changes }
      - { id: stop, label: Stop }
  - id: work
    agent: a
    prompt: "do the work"
`;

// Starts the given workflow, answers its one gate with `answer`, and resolves once it finishes.
function runToGateDecision(service, api, file, answer) {
  const events = [];
  const finished = new Promise((resolve) => {
    const onEvent = (ev) => {
      events.push(ev);
      if (ev.type === 'approval.requested') setImmediate(() => api['approval:resolve']({ id: ev.approval_id, answer }));
      if (ev.type === 'workflow.finished') { service.events.off('run:event', onEvent); resolve(ev); }
    };
    service.events.on('run:event', onEvent);
  });
  return api['run:start']({ file, inputs: {}, mock: true }).then(async (started) => ({ ...started, events, end: await finished }));
}

test('resumeOptions: a gate decided with a non-approval choice blocks confirmation, naming the choice; the gate\'s first choice confirms', async (t) => {
  const { service, api } = makeResumeService(t);
  fs.writeFileSync(path.join(service.workspace().workflows, 'fixture-resume-choice.yaml'), RESUME_CHOICE_WORKFLOW);

  const changed = await runToGateDecision(service, api, 'fixture-resume-choice.yaml', 'changes');
  const blocked = await api['runs:resumeOptions']({ runId: changed.runId });
  const work = blocked.steps.find((s) => s.id === 'work');
  assert.equal(work.blockedBy, 'developer_check');
  assert.equal(work.confirm.ok, false);
  assert.match(work.confirm.reason, /developer_check was changes, not an approval/);

  const approved = await runToGateDecision(service, api, 'fixture-resume-choice.yaml', 'approve');
  const unblocked = await api['runs:resumeOptions']({ runId: approved.runId });
  const work2 = unblocked.steps.find((s) => s.id === 'work');
  assert.equal(work2.blockedBy, 'developer_check');
  assert.equal(work2.confirm.ok, true);
});

test('resumeRun: cannot confirm a gate decided with "changes" or "stop"; confirming "approve" resumes past it, recorded as the owner\'s decision', async (t) => {
  const { service, api } = makeResumeService(t);
  fs.writeFileSync(path.join(service.workspace().workflows, 'fixture-resume-choice.yaml'), RESUME_CHOICE_WORKFLOW);

  const changed = await runToGateDecision(service, api, 'fixture-resume-choice.yaml', 'changes');
  assert.throws(
    () => api['runs:resume']({ runId: changed.runId, step: 'work', confirmGate: 'developer_check' }),
    /Cannot confirm developer_check again: the decision at developer_check was changes, not an approval/,
  );

  const stopped = await runToGateDecision(service, api, 'fixture-resume-choice.yaml', 'stop');
  assert.throws(
    () => api['runs:resume']({ runId: stopped.runId, step: 'work', confirmGate: 'developer_check' }),
    /Cannot confirm developer_check again/,
  );

  const approved = await runToGateDecision(service, api, 'fixture-resume-choice.yaml', 'approve');
  const resumed = await runToEnd(service, api, 'runs:resume', { runId: approved.runId, step: 'work', confirmGate: 'developer_check' });
  assert.equal(resumed.end.status, 'success');
  assert.ok(
    !resumed.events.some((e) => e.type === 'approval.requested' && e.step_id === 'developer_check'),
    'confirmed, not asked again: the run goes straight to "work"',
  );
  const confirmedEvent = resumed.events.find((e) => e.type === 'approval.resolved' && e.step_id === 'developer_check');
  assert.equal(confirmedEvent.by, 'owner');
  assert.equal(confirmedEvent.confirmed_at_resume, true);
  assert.equal(confirmedEvent.choice, 'approve');
});

test('resumeOptions/resumeRun: a plain gate (no choices) needs approved:true; approved:false is never confirmable', async (t) => {
  const { service, api } = makeResumeService(t);
  const rejected = await runToGateDecision(service, api, 'fixture-resume.yaml', false);
  const blocked = await api['runs:resumeOptions']({ runId: rejected.runId });
  const work = blocked.steps.find((s) => s.id === 'work');
  assert.equal(work.confirm.ok, false);
  assert.match(work.confirm.reason, /the decision at approve was a rejection, not an approval/);
  // 'work' cannot be confirmed: the nearest allowed step before it is suggested (the gate itself,
  // 'approve', always asks again), never the first step by default (#112)
  assert.equal(blocked.suggested, 'approve');
  assert.throws(
    () => api['runs:resume']({ runId: rejected.runId, step: 'work', confirmGate: 'approve' }),
    /Cannot confirm approve again: the decision at approve was a rejection, not an approval/,
  );

  const approved = await runToGateDecision(service, api, 'fixture-resume.yaml', true);
  const unblocked = await api['runs:resumeOptions']({ runId: approved.runId });
  assert.equal(unblocked.steps.find((s) => s.id === 'work').confirm.ok, true);
  const resumed = await runToEnd(service, api, 'runs:resume', { runId: approved.runId, step: 'work', confirmGate: 'approve' });
  assert.equal(resumed.end.status, 'success');
});

// ---- No duplicate work: an ended run's kept worktree commits refuse a start (#112) --------------

// A repo whose checked-out branch ('feature') is one commit ahead of 'main': what a run's worktree
// looks like when it ended without merging (kept so a resume can continue it).
function keptWorkRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-kept-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  git('init', '-q');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  git('add', '.');
  git('commit', '-q', '-m', 'first');
  git('checkout', '-q', '-b', 'feature');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\ntwo\n');
  git('add', '.');
  git('commit', '-q', '-m', 'work');
  return dir;
}

// An ended run folder (no summary status 'running', no owner): a `worktree.ready` naming a kept
// worktree with commits still on top of `base`, for `issue`. Never run through the real engine
// (the test skill: fabricated the way a run folder from a previous session would look, see #83's
// resume test above) — keptWorkForIssues only reads events.jsonl/summary.json and runs git itself.
function fabricateKeptRun(ws, runId, { issue, worktreeDir, base = 'main', status = 'cancelled' }) {
  const dir = path.join(ws.runs, runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'events.jsonl'), [
    JSON.stringify({ ts: '2026-09-30T10:00:00Z', type: 'workflow.started', workflow: 'fixture-issue', file: 'fixture-issue.yaml', inputs: {}, mock: false, issues: [issue] }),
    JSON.stringify({ ts: '2026-09-30T10:00:01Z', type: 'worktree.ready', dir: worktreeDir, base }),
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
    run_id: runId, workflow: 'fixture-issue', status, started_at: '2026-09-30T10:00:00Z', finished_at: '2026-09-30T10:05:00Z',
    issues: [issue], inputs: {}, sessions: [],
  }));
}

test('run:start: an ended run\'s kept worktree commits for the same issue ask first, naming that run; confirmed it starts anyway', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'service-kept-start-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const p = await api['projects:create']({ name: 'demo', folder });
  const repo = keptWorkRepo(t);
  const issue = { number: 21, url: 'https://github.com/o/r/issues/21', title: 'Issue 21' };
  fabricateKeptRun(ws, '20260930-100000-keptstart1', { issue, worktreeDir: repo });

  const asked = await api['run:start']({
    file: 'fixture-issue.yaml', inputs: { task: 't', repo_path: folder }, mock: true, projectId: p.id, issues: [issue],
  });
  assert.equal(asked.runId, '20260930-100000-keptstart1');
  assert.match(asked.confirm, /still has 1 commit\(s\) in its worktree for #21/);
  assert.deepEqual(api['runs:list']().runs.map((r) => r.runId), ['20260930-100000-keptstart1'], 'no duplicate run was started');

  const started = await api['run:start']({
    file: 'fixture-issue.yaml', inputs: { task: 't', repo_path: folder }, mock: true, projectId: p.id, issues: [issue], confirmed: true,
  });
  assert.ok(started.runId && started.runId !== '20260930-100000-keptstart1');
  api['run:stop']({ runId: started.runId });
});

test('backlog:assign: an ended run\'s kept worktree commits pause the queue instead of starting a duplicate; the item stays queued', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'service-kept-queue-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const p = await api['projects:create']({ name: 'demo', folder });
  api['projects:update']({ id: p.id, patch: { repo: 'https://github.com/o/r' } });
  const issue = { number: 22, title: 'Issue 22', state: 'open', url: 'https://github.com/o/r/issues/22', body: 'Do it', labels: [], assignees: [], tasks: { done: 0, total: 0 } };
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({ projectId: p.id, platform: 'github', repo: 'https://github.com/o/r', issues: [issue] }));
  const repo = keptWorkRepo(t);
  fabricateKeptRun(ws, '20260930-100000-keptqueue1', { issue: { number: 22, url: issue.url, title: issue.title }, worktreeDir: repo });

  const data = await api['backlog:assign']({ projectId: p.id, numbers: [22], workflow: 'fixture-issue.yaml', mock: true });
  assert.equal(service.isRunning(), false, 'no duplicate run was started');
  assert.equal(data.queue.paused, true);
  assert.match(data.queue.error, /Could not start #22.*still has 1 commit\(s\)/);
  assert.deepEqual(data.queue.items.map((x) => x.number), [22], 'the item stays queued, not dropped');
  assert.deepEqual(api['runs:list']().runs.map((r) => r.runId), ['20260930-100000-keptqueue1']);
});

test('roadmap: an ended run\'s kept worktree commits fail the item and pause the roadmap; a confirmed Retry starts it anyway', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [23], 'roadmap-kept');
  const repo = keptWorkRepo(t);
  const issue = { number: 23, url: 'https://github.com/o/r/issues/23', title: 'Issue 23' };
  fabricateKeptRun(ws, '20260930-100000-keptroad01', { issue, worktreeDir: repo });

  await api['roadmap:save']({ projectId: p.id, stages: [{ items: [{ workflow: 'fixture-issue.yaml', number: 23, mock: true }] }] });
  await api['roadmap:start']({ projectId: p.id, simulated: true });
  await until(() => api['roadmap:get']({ projectId: p.id }).state === 'paused');

  let roadmap = api['roadmap:get']({ projectId: p.id });
  assert.equal(roadmap.stages[0].items[0].status, 'failed');
  assert.match(roadmap.error, /still has 1 commit\(s\)/);
  assert.equal(service.isRunning(), false);
  const itemId = roadmap.pausedBy;

  const unconfirmed = await api['roadmap:item']({ projectId: p.id, itemId, action: 'retry' });
  assert.match(unconfirmed.confirm, /still has 1 commit\(s\) in its worktree for #23/);
  assert.equal(unconfirmed.runId, '20260930-100000-keptroad01');
  assert.equal(api['roadmap:get']({ projectId: p.id }).stages[0].items[0].status, 'failed', 'an unconfirmed retry changes nothing');

  await api['roadmap:item']({ projectId: p.id, itemId, action: 'retry', confirmed: true });
  await until(() => api['runs:active']().length === 1);
  roadmap = api['roadmap:get']({ projectId: p.id });
  assert.equal(roadmap.state, 'running');
  assert.notEqual(roadmap.stages[0].items[0].runId, '20260930-100000-keptroad01');
  api['run:stop']({ runId: api['runs:active']()[0].runId });
});

test('runs:resume is never refused for kept work, even for a run of its own issue', async (t) => {
  const { service, api } = makeResumeService(t);
  const repo = keptWorkRepo(t);
  const ws = service.workspace();
  const runId = '20260930-100000-keptresume';
  const issue = { number: 24, url: 'https://github.com/o/r/issues/24', title: 'Issue 24' };
  const dir = path.join(ws.runs, runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'events.jsonl'), [
    JSON.stringify({ ts: '2026-09-30T10:00:00Z', type: 'workflow.started', workflow: 'fixture-resume', file: 'fixture-resume.yaml', inputs: {}, mock: true, issues: [issue] }),
    JSON.stringify({ ts: '2026-09-30T10:00:01Z', type: 'worktree.ready', dir: repo, base: 'main' }),
    JSON.stringify({ ts: '2026-09-30T10:00:02Z', type: 'step.finished', step_id: 'plan', visit: 1, output: {} }),
  ].join('\n') + '\n');

  // sanity: this very run is what a fresh start for #24 would be refused over
  const asked = await api['run:start']({ file: 'fixture-resume.yaml', inputs: {}, mock: true, issues: [issue] });
  assert.equal(asked.runId, runId);

  const resumed = await runToEnd(service, api, 'runs:resume', { runId, step: 'plan' });
  assert.equal(resumed.end.status, 'success');
});
