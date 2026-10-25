const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const backlogModule = require('../../src/domains/backlog/backlog');
const roadmapModule = require('../../src/domains/roadmap/roadmap');
const {
  ISSUE_WORKFLOW, makeService, makeResumeService, roadmapProject, until, watchRuns,
} = require('./helpers');

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

// #130: images pasted into the resume instruction pass through resumeRun to the engine (src/engine/workflow.js).
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

test('runs:resume: an image pasted into the instruction reaches the first resumed agent step, copied into <run_dir>/attachments/<step>-instruction/', async (t) => {
  const { service, api } = makeResumeService(t);
  const first = await runToEnd(service, api, 'run:start', { file: 'fixture-resume.yaml', inputs: {}, mock: true });
  assert.equal(first.end.status, 'success');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-img-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const png = path.join(dir, 'shot.png');
  fs.writeFileSync(png, PNG_1PX);

  const resumed = await runToEnd(service, api, 'runs:resume', { runId: first.runId, step: 'plan', images: [png] });
  assert.equal(resumed.end.status, 'success');
  const sent = resumed.events.find((e) => e.type === 'session.message_sent' && e.step_id === 'plan');
  assert.equal(sent.attachments?.length, 1);
  assert.ok(fs.existsSync(sent.attachments[0].path));
  assert.ok(sent.attachments[0].path.startsWith(path.join(resumed.runDir, 'attachments', 'plan-instruction')), sent.attachments[0].path);
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

// A repo whose checked-out branch ('feature') is `own` commits ahead of the local `base` branch
// ('main'): what a run's worktree looks like when it ended without merging (kept so a resume can
// continue it). `refs/remotes/origin/<base>` is set to the first commit, so it can lag behind the
// local base by `localOnly` commits (merges not yet pushed, #170) without affecting the result: the
// run's own commits are counted against the local base, never origin's. `baseAfter` commits land on
// `base` after `feature` branches off it (so its base moved on since); each touches `file` (the
// same file `own` commits touch) when `touch` is true, a different file otherwise.
function keptWorkRepo(t, { base = 'main', own = 1, localOnly = 0, baseAfter = 0, touch = true, file = 'a.txt' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-kept-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  git('init', '-q');
  fs.writeFileSync(path.join(dir, file), 'one\n');
  git('add', '.');
  git('commit', '-q', '-m', 'first');
  const originSha = git('rev-parse', 'HEAD');
  git('update-ref', `refs/remotes/origin/${base}`, originSha);
  for (let i = 0; i < localOnly; i++) {
    fs.writeFileSync(path.join(dir, `local${i}.txt`), String(i));
    git('add', '.');
    git('commit', '-q', '-m', `local merge ${i} (not pushed)`);
  }
  git('checkout', '-q', '-b', 'feature');
  for (let i = 0; i < own; i++) {
    fs.writeFileSync(path.join(dir, file), `one\nown${i}\n`);
    git('add', '.');
    git('commit', '-q', '-m', `own ${i}`);
  }
  if (baseAfter) {
    git('checkout', '-q', base);
    for (let i = 0; i < baseAfter; i++) {
      fs.writeFileSync(path.join(dir, touch ? file : `base${i}.txt`), touch ? `one\nbase${i}\n` : String(i));
      git('add', '.');
      git('commit', '-q', '-m', `base ${i}`);
    }
    git('checkout', '-q', 'feature');
  }
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
  assert.match(asked.confirm, /1 commit of its own on its branch \(run 20260930-100000-keptstart1/);
  assert.equal(asked.confirm, asked.kept.text);
  assert.equal(asked.kept.commits, 1);
  assert.equal(asked.kept.runId, '20260930-100000-keptstart1');
  // #288: the title says where it stopped, the message why; the base did not move
  assert.equal(asked.kept.title, '#21: a run stopped at its first step');
  assert.match(asked.kept.message, /^Cancelled by the owner/);
  assert.doesNotMatch(asked.kept.message, /moved/);
  assert.equal(asked.kept.recommended, 'resume');
  assert.deepEqual(asked.kept.choices.map((c) => c.id), ['scratch', 'resume']);
  assert.deepEqual(asked.kept.choices.map((c) => c.label), ['Start over', 'Resume']);
  assert.deepEqual(asked.kept.choices.map((c) => c.primary), [false, true]);
  assert.deepEqual((await api['runs:list']()).runs.map((r) => r.runId), ['20260930-100000-keptstart1'], 'no duplicate run was started');

  const started = await api['run:start']({
    file: 'fixture-issue.yaml', inputs: { task: 't', repo_path: folder }, mock: true, projectId: p.id, issues: [issue], confirmed: true,
  });
  assert.ok(started.runId && started.runId !== '20260930-100000-keptstart1');
  api['run:stop']({ runId: started.runId });
});

// ---- Own commits only, excluding local merges not yet pushed (#170) -----------------------------

test('run:start: the kept-work count is the old run\'s own commits, excluding merges the local base has that it never made (and origin never saw)', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  // origin/main stays at the first commit; local main gains 2 unpushed merges before `feature` (the
  // run's own worktree) branches off it and makes 3 commits of its own
  const repo = keptWorkRepo(t, { own: 3, localOnly: 2 });
  const issue = { number: 25, url: 'https://github.com/o/r/issues/25', title: 'Issue 25' };
  fabricateKeptRun(ws, '20260930-100000-keptown0001', { issue, worktreeDir: repo });

  const asked = await api['run:start']({ file: 'fixture-issue.yaml', inputs: { task: 't', repo_path: '.' }, mock: true, issues: [issue] });
  assert.equal(asked.kept.commits, 3, 'the old code gave 3 + 2 = 5: the 2 local merges are not the run\'s own');
});

test('run:start: no resolvable base ref for the kept worktree (its base branch no longer exists locally or on origin) asks no question', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const repo = keptWorkRepo(t); // only 'main' and 'feature' exist in this repo
  const issue = { number: 26, url: 'https://github.com/o/r/issues/26', title: 'Issue 26' };
  fabricateKeptRun(ws, '20260930-100000-keptnobase1', { issue, worktreeDir: repo, base: 'gone' });

  const started = await api['run:start']({ file: 'fixture-issue.yaml', inputs: { task: 't', repo_path: '.' }, mock: true, issues: [issue] });
  assert.equal(started.confirm, undefined, 'no base to compare against: no kept-work question, the run starts');
  assert.ok(started.runId && started.runId !== '20260930-100000-keptnobase1');
  api['run:stop']({ runId: started.runId });
});

// ---- How old the work is: stale (behind + its files changed since) vs. still fresh (#170) -------

test('run:start: the kept-work message says the base moved (the run merges it at the end); the files changed on both sides are named in the details; Resume stays recommended (#288)', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const repo = keptWorkRepo(t, { baseAfter: 2, touch: true }); // base moved on and touched the same file
  const issue = { number: 27, url: 'https://github.com/o/r/issues/27', title: 'Issue 27' };
  fabricateKeptRun(ws, '20260930-100000-keptstale01', { issue, worktreeDir: repo });

  const asked = await api['run:start']({ file: 'fixture-issue.yaml', inputs: { task: 't', repo_path: '.' }, mock: true, issues: [issue] });
  assert.match(asked.kept.message, /main moved 2 commits since: the run merges it at the end\./);
  assert.ok(asked.kept.details.some((d) => /2 commits behind today's main/.test(d)), asked.kept.details.join(' | '));
  assert.ok(asked.kept.details.some((d) => /^1 of them changed on main too \(a\.txt\)/.test(d)), asked.kept.details.join(' | '));
  assert.equal(asked.kept.recommended, 'resume');
  assert.deepEqual(asked.kept.choices.map((c) => c.primary), [false, true]);
});

test('run:start: behind today\'s base, but on files the old run never touched: no conflict warning, Resume is still recommended', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const repo = keptWorkRepo(t, { baseAfter: 1, touch: false }); // base moved on, but a different file
  const issue = { number: 28, url: 'https://github.com/o/r/issues/28', title: 'Issue 28' };
  fabricateKeptRun(ws, '20260930-100000-keptfresh01', { issue, worktreeDir: repo });

  const asked = await api['run:start']({ file: 'fixture-issue.yaml', inputs: { task: 't', repo_path: '.' }, mock: true, issues: [issue] });
  assert.match(asked.kept.message, /main moved 1 commit since: the run merges it at the end\./);
  assert.equal(asked.kept.details.some((d) => /changed on main too/.test(d)), false, asked.kept.details.join(' | '));
  assert.equal(asked.kept.recommended, 'resume');
});

// ---- Fewer issues than the item/request asks about (#170) ---------------------------------------

test('run:start: the old run covering fewer issues than asked says so, names the "ha(s|ve)" and "a/an <status>" wording correctly', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const repo = keptWorkRepo(t);
  const issue113 = { number: 113, url: 'https://github.com/o/r/issues/113', title: 'Issue 113' };
  const issue142 = { number: 142, url: 'https://github.com/o/r/issues/142', title: 'Issue 142' };
  fabricateKeptRun(ws, '20260930-100000-keptpart001', { issue: issue113, worktreeDir: repo });

  const asked = await api['run:start']({ file: 'fixture-issue.yaml', inputs: { task: 't', repo_path: '.' }, mock: true, issues: [issue113, issue142] });
  assert.equal(asked.kept.title, '#113 + #142: a run stopped at its first step');
  assert.match(asked.kept.message, /The old run only covers #113: resuming it leaves #142 out\./);

  const repo2 = keptWorkRepo(t);
  const issue99 = { number: 99, url: 'https://github.com/o/r/issues/99', title: 'Issue 99' };
  fabricateKeptRun(ws, '20260930-100000-keptvowel01', { issue: issue99, worktreeDir: repo2, status: 'interrupted' });
  const askedVowel = await api['run:start']({ file: 'fixture-issue.yaml', inputs: { task: 't', repo_path: '.' }, mock: true, issues: [issue99] });
  assert.equal(askedVowel.kept.title, '#99: a run stopped at its first step');
  assert.match(askedVowel.kept.message, /^The app closed while it ran its first step\./);
});

test('backlog:assign: an ended run\'s kept work asks first (confirm/kept/runId) without queuing anything; confirmed, it queues and starts, redoing that run\'s own work', async (t) => {
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

  const asked = await api['backlog:assign']({ projectId: p.id, numbers: [22], workflow: 'fixture-issue.yaml', mock: true });
  assert.equal(asked.kept.runId, '20260930-100000-keptqueue1');
  assert.equal(asked.confirm, asked.kept.text);
  assert.equal(service.isRunning(), false, 'no duplicate run was started');
  assert.deepEqual(api['backlog:get']({ projectId: p.id }).queue.items, [], 'nothing was queued before the owner answers');
  assert.deepEqual((await api['runs:list']()).runs.map((r) => r.runId), ['20260930-100000-keptqueue1']);

  const started = await api['backlog:assign']({ projectId: p.id, numbers: [22], workflow: 'fixture-issue.yaml', mock: true, confirmed: true });
  assert.equal(started.kept, undefined);
  await until(() => api['runs:active']().length === 1);
  const active = api['runs:active']()[0];
  assert.notEqual(active.runId, '20260930-100000-keptqueue1');
  api['run:stop']({ runId: active.runId });
});

test('backlog:pause: resuming a queue whose next item would redo an ended run\'s kept work asks first; the queue stays paused until confirmed', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'service-kept-pause-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const p = await api['projects:create']({ name: 'demo', folder });
  const issue = { number: 29, title: 'Issue 29', state: 'open', url: 'https://github.com/o/r/issues/29', body: 'Do it', labels: [], assignees: [], tasks: { done: 0, total: 0 } };
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({ projectId: p.id, platform: 'github', repo: 'https://github.com/o/r', issues: [issue] }));
  const repo = keptWorkRepo(t);
  fabricateKeptRun(ws, '20260930-100000-keptpause01', { issue: { number: 29, url: issue.url, title: issue.title }, worktreeDir: repo });
  backlogModule.enqueue(ws.backlog, p.id, { issues: [issue], workflow: 'fixture-issue.yaml', inputs: { task: 't', repo_path: folder }, mock: true });
  backlogModule.setPaused(ws.backlog, p.id, true, 'paused earlier');

  const asked = await api['backlog:pause']({ projectId: p.id, paused: false });
  assert.equal(asked.kept.runId, '20260930-100000-keptpause01');
  assert.equal(asked.queue.paused, true, 'stays paused: the owner has not answered yet');
  assert.equal(service.isRunning(), false);

  const resumed = await api['backlog:pause']({ projectId: p.id, paused: false, confirmed: true });
  assert.equal(resumed.kept, undefined);
  assert.equal(resumed.queue.paused, false);
  await until(() => api['runs:active']().length === 1);
  api['run:stop']({ runId: api['runs:active']()[0].runId });
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
  assert.match(roadmap.error, /#23: a run stopped at [^.]+\. .*1 commit of its own on its branch/);
  assert.match(roadmap.error, /Choose with Retry on the roadmap item, Resume on the queue or Start on the issue\./);
  assert.equal(service.isRunning(), false);
  const itemId = roadmap.pausedBy;

  const unconfirmed = await api['roadmap:item']({ projectId: p.id, itemId, action: 'retry' });
  assert.match(unconfirmed.confirm, /1 commit of its own on its branch \(run 20260930-100000-keptroad01/);
  assert.equal(unconfirmed.runId, '20260930-100000-keptroad01');
  assert.equal(unconfirmed.kept.runId, '20260930-100000-keptroad01');
  assert.deepEqual(unconfirmed.kept.choices.map((c) => c.id), ['scratch', 'resume']);
  assert.equal(api['roadmap:get']({ projectId: p.id }).stages[0].items[0].status, 'failed', 'an unconfirmed retry changes nothing');

  await api['roadmap:item']({ projectId: p.id, itemId, action: 'retry', confirmed: true });
  await until(() => api['runs:active']().length === 1);
  roadmap = api['roadmap:get']({ projectId: p.id });
  assert.equal(roadmap.state, 'running');
  assert.notEqual(roadmap.stages[0].items[0].runId, '20260930-100000-keptroad01');
  api['run:stop']({ runId: api['runs:active']()[0].runId });
});

test('roadmap:item retry: the kept-work question prefers the item\'s own run (keptWorkOfRun) over another ended run of the same issue (keptWorkForIssues)', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [60], 'roadmap-prefer');
  await api['roadmap:save']({ projectId: p.id, stages: [{ items: [{ workflow: 'fixture-issue.yaml', number: 60, mock: true }] }] });
  const itemId = api['roadmap:get']({ projectId: p.id }).stages[0].items[0].id;

  const issue = { number: 60, url: 'https://github.com/o/r/issues/60', title: 'Issue 60' };
  const ownRunId = '20260930-090000-keptownrun01';
  fabricateKeptRun(ws, ownRunId, { issue, worktreeDir: keptWorkRepo(t), status: 'failed' });
  roadmapModule.markStarted(ws.backlog, p.id, itemId, { runId: ownRunId });

  // a newer ended run of the same issue also kept commits, but the item's own run (ownRunId) wins
  const otherRunId = '20260930-110000-keptotherun1';
  fabricateKeptRun(ws, otherRunId, { issue, worktreeDir: keptWorkRepo(t) });

  const out = await api['roadmap:item']({ projectId: p.id, itemId, action: 'retry' });
  assert.equal(out.kept.runId, ownRunId);
});

test('roadmap:item retry: when the item\'s own run kept no commits of its own, the question falls back to another ended run of the same issue', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [61], 'roadmap-fallback');
  await api['roadmap:save']({ projectId: p.id, stages: [{ items: [{ workflow: 'fixture-issue.yaml', number: 61, mock: true }] }] });
  const itemId = api['roadmap:get']({ projectId: p.id }).stages[0].items[0].id;

  const issue = { number: 61, url: 'https://github.com/o/r/issues/61', title: 'Issue 61' };
  // the item's own run's worktree has no divergence from 'main' (0 own commits): keptWorkOfRun(ownRunId) is null
  const ownRunId = '20260930-090000-keptemptyr1';
  fabricateKeptRun(ws, ownRunId, { issue, worktreeDir: keptWorkRepo(t, { own: 0 }), status: 'failed' });
  roadmapModule.markStarted(ws.backlog, p.id, itemId, { runId: ownRunId });

  const otherRunId = '20260930-100000-keptotherun2';
  fabricateKeptRun(ws, otherRunId, { issue, worktreeDir: keptWorkRepo(t) });

  const out = await api['roadmap:item']({ projectId: p.id, itemId, action: 'retry' });
  assert.equal(out.kept.runId, otherRunId);
});

// #202: an ended run keeps its branch, not its worktree folder. The kept-work question counts the
// run's own commits on that branch, so it still asks once the folder is gone.
test('run:start: the kept-work question counts an ended run\'s own commits on its branch when its worktree folder was removed', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'service-kept-branch-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const p = await api['projects:create']({ name: 'demo', folder });
  // the run's branch `feature` has 1 commit of its own on top of main; the repository is back on
  // main and the run's worktree folder no longer exists
  const repo = keptWorkRepo(t);
  execFileSync('git', ['checkout', '-q', 'main'], { cwd: repo, stdio: 'ignore' });
  const gone = path.join(path.dirname(repo), `${path.basename(repo)}-worktree-removed`);
  const issue = { number: 25, url: 'https://github.com/o/r/issues/25', title: 'Issue 25' };
  const runId = '20260930-100000-keptbranch1';
  const dir = path.join(ws.runs, runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'events.jsonl'), [
    JSON.stringify({ ts: '2026-09-30T10:00:00Z', type: 'workflow.started', workflow: 'fixture-issue', file: 'fixture-issue.yaml', inputs: {}, mock: false, issues: [issue] }),
    JSON.stringify({ ts: '2026-09-30T10:00:01Z', type: 'worktree.ready', dir: gone, work_dir: gone, repo, base: 'main', ref: 'feature' }),
    JSON.stringify({ ts: '2026-09-30T10:05:00Z', type: 'worktree.removed', dir: gone, removed: true, branch: 'feature', branch_deleted: false, wip_commit: null }),
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
    run_id: runId, workflow: 'fixture-issue', status: 'cancelled', started_at: '2026-09-30T10:00:00Z', finished_at: '2026-09-30T10:05:00Z',
    issues: [issue], inputs: {}, sessions: [], worktree: { dir: gone, repo, base: 'main', branch: 'feature', removed: true },
  }));

  const asked = await api['run:start']({
    file: 'fixture-issue.yaml', inputs: { task: 't', repo_path: folder }, mock: true, projectId: p.id, issues: [issue],
  });
  assert.equal(asked.runId, runId);
  assert.equal(asked.kept?.commits, 1);
  assert.match(asked.confirm, /1 commit of its own on its branch/);
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

// #175: resuming a parent whose `type: workflow` step had two children, one that already succeeded
// and one that was still waiting at its own gate when the parent was stopped, reuses the first
// (never restarted) and resumes the second from where it stopped (its own gate, asked again).
test('a resumed parent reuses the child that succeeded and resumes the one that was cancelled, from where it stopped', async (t) => {
  const { service, api } = makeService(t);
  fs.writeFileSync(path.join(service.workspace().workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  fs.writeFileSync(path.join(service.workspace().workflows, 'fixture-parent-resume.yaml'), `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: fixture-parent-resume
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: children
    type: workflow
    workflow: fixture-issue.yaml
    inputs: { task: "do {{ item }}", repo_path: "/tmp/r" }
    foreach: [1, 2]
    max_parallel: 2
`);
  const allEvents = [];
  const gates = new Map(); // run_id -> approval_id, only while not auto-approving
  let autoApprove = false;
  service.events.on('run:event', (ev) => {
    allEvents.push(ev);
    if (ev.type === 'approval.requested') {
      if (autoApprove) setImmediate(() => api['approval:resolve']({ runId: ev.run_id, id: ev.approval_id, answer: true }));
      else gates.set(ev.run_id, ev.approval_id);
    }
  });

  const { runId: parentId } = await api['run:start']({ file: 'fixture-parent-resume.yaml', inputs: {}, mock: true });
  // the default concurrency (one run at a time) holds the second child back until the first is done
  await until(() => gates.size === 1);
  const [finishNow] = [...gates.keys()];
  api['approval:resolve']({ runId: finishNow, id: gates.get(finishNow), answer: true });
  await until(() => allEvents.some((e) => e.type === 'workflow.child_finished' && e.child_run_id === finishNow && e.status === 'success'));

  // its slot freed, the second child now reaches its own gate
  await until(() => gates.size === 2);
  const keepRunning = [...gates.keys()].find((id) => id !== finishNow);

  // it is still waiting there: stopping the parent stops it too
  api['run:stop']({ runId: parentId });
  await until(() => allEvents.some((e) => e.type === 'workflow.finished' && e.run_id === parentId));
  await until(() => allEvents.some((e) => e.type === 'workflow.child_finished' && e.child_run_id === keepRunning));
  assert.equal(allEvents.find((e) => e.type === 'workflow.child_finished' && e.child_run_id === keepRunning).status, 'cancelled');

  autoApprove = true; // the resumed child reaches a fresh gate: approve it, and anything else from here
  const resumed = await api['runs:resume']({ runId: parentId, step: 'children' });
  await until(() => allEvents.some((e) => e.type === 'workflow.finished' && e.run_id === resumed.runId));
  const resumedFinished = allEvents.find((e) => e.type === 'workflow.finished' && e.run_id === resumed.runId);
  assert.equal(resumedFinished.status, 'success', resumedFinished.error);

  const starts = allEvents.filter((e) => e.type === 'workflow.child_started' && e.run_id === resumed.runId);
  assert.equal(starts.length, 2);
  const reused = starts.find((e) => e.reused);
  const resumedOne = starts.find((e) => e.resumed_from);
  assert.ok(reused, 'the succeeded child is reused, not restarted');
  assert.equal(reused.child_run_id, finishNow);
  assert.ok(resumedOne, 'the cancelled child resumes from where it stopped');
  assert.equal(resumedOne.resumed_from, keepRunning);
});
