const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const backlog = require('../../domains/backlog/backlog');
const { ISSUE_WORKFLOW, allowRealRuns, gitRepo, makeService, until, untilTrue, watchRuns } = require('./helpers');

// #446: Assign plans its issues in the roadmap (a new last stage); the plain queue is gone. The
// acceptance tests (backlog-assign-roadmap-446.test.js) cover the planned stage and Run now; these
// keep the Assign's own checks: simulation only, open issues, a task input and the group's size.
const queueFile = (ws, projectId) => path.join(ws.backlog, `${projectId}.queue.json`);
const issueNumbers = (item) => (item.issues || [item]).map((i) => i.number);

test('backlog: with simulation only, a real Run now is refused and nothing is planned or queued', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'service-backlog-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const p = await api['projects:create']({ name: 'demo', folder });
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({ projectId: p.id, platform: 'github', repo: 'https://github.com/o/r', issues: [{ number: 1, title: 'Issue 1', state: 'open', url: 'https://github.com/o/r/issues/1', body: '', labels: [], assignees: [], tasks: { done: 0, total: 0 } }] }));
  await assert.rejects(api['backlog:assign']({ projectId: p.id, numbers: [1], workflow: 'fixture-issue.yaml', mock: false, runNow: true }), /Simulation only .*real runs from the Backlog/);
  assert.equal(fs.existsSync(queueFile(ws, p.id)), false);
  assert.deepEqual(api['roadmap:get']({ projectId: p.id }).stages, []);
  assert.deepEqual((await api['runs:list']()).runs, []);
});

test('backlog: Assign takes only open issues and a workflow with a task input; it plans, never starts', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'service-backlog-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const p = await api['projects:create']({ name: 'demo', folder });
  const issue = (number, state = 'open') => ({ number, title: `Issue ${number}`, state, url: `https://github.com/o/r/issues/${number}`, body: 'Do it', labels: [], assignees: [], tasks: { done: 0, total: 0 } });
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({ projectId: p.id, platform: 'github', repo: 'https://github.com/o/r', issues: [issue(1), issue(2), issue(3, 'closed')] }));

  await assert.rejects(api['backlog:assign']({ projectId: p.id, numbers: [3], workflow: 'fixture-issue.yaml', mock: true }), /at least one open issue/);
  await assert.rejects(api['backlog:assign']({ projectId: p.id, numbers: [1], workflow: 'fixture-service.yaml', mock: true }), /no task input/);

  await api['backlog:assign']({ projectId: p.id, numbers: [2, 1, 3], workflow: 'fixture-issue.yaml', inputs: { language: 'go' }, mock: true });
  const { stages } = api['roadmap:get']({ projectId: p.id });
  assert.equal(stages.length, 1);
  assert.deepEqual(stages[0].items.map(issueNumbers), [[2], [1]], 'one item per open issue, in the order selected');
  assert.deepEqual(stages[0].items.map((x) => x.inputs), [{ language: 'go' }, { language: 'go' }]);
  assert.equal(service.isRunning(), false);
  assert.equal(fs.existsSync(queueFile(ws, p.id)), false);
});

test('backlog: a group over the Backlog\'s max size is refused; exactly the max is one planned item', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'service-group-max-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const p = await api['projects:create']({ name: 'demo', folder });
  const issue = (number) => ({ number, title: `Issue ${number}`, state: 'open', url: `https://github.com/o/r/issues/${number}`, body: `Body ${number}`, labels: [], assignees: [], tasks: { done: 0, total: 0 } });
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({ projectId: p.id, platform: 'github', repo: 'https://github.com/o/r', issues: [1, 2, 3, 4].map(issue) }));

  api['settings:set']({ backlogMaxGroup: 3 });
  await assert.rejects(api['backlog:assign']({ projectId: p.id, numbers: [1, 2, 3, 4], workflow: 'fixture-issue.yaml', mock: true, group: true }), /at most 3 issues/);
  assert.deepEqual(api['roadmap:get']({ projectId: p.id }).stages, []);

  await api['backlog:assign']({ projectId: p.id, numbers: [3, 1, 2], workflow: 'fixture-issue.yaml', mock: true, group: true });
  const { stages } = api['roadmap:get']({ projectId: p.id });
  assert.deepEqual(stages.map((s) => s.items.map(issueNumbers)), [[[3, 1, 2]]]);
  assert.equal(service.isRunning(), false);
});

// A workflow shaped like issue-tracker's filing path (its metadata.name is what the issue tracker's
// chain to the roadmap keys on, #446), trimmed to the fields it reads: analyze (grouping,
// nearby), a decision gate with a create_assign choice, and file (filed).
const TRACKER_WORKFLOW = `apiVersion: craftorio/v1
kind: Workflow
metadata:
  name: issue-tracker
inputs:
  project_path: { type: string, required: true }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: analyze
    agent: a
    prompt: "analyze"
    output_schema:
      type: object
      required: [grouping, nearby]
      properties:
        grouping: { type: string, enum: [alone, group] }
        nearby:
          type: array
          items:
            type: object
            properties:
              number: { type: integer }
              advice: { type: string, enum: [group_with, avoid_together, do_first, do_after] }
              reason: { type: string }
  - id: review
    type: human_approval
    message: "File it?"
    choices:
      - { id: create_assign, label: "Create and plan" }
      - { id: discard, label: "Discard" }
    transitions:
      - when: "choice == 'discard'"
        goto: end
        status: cancelled
      - when: "true"
        goto: file
  - id: file
    agent: a
    prompt: "file"
    output_schema:
      type: object
      required: [filed]
      properties:
        filed:
          type: array
          items:
            type: object
            required: [action, number, url, title]
            properties:
              action: { type: string, enum: [created, commented, edited] }
              number: { type: integer }
              url:    { type: string }
              title:  { type: string }
`;

test('backlog: a simulated issue-tracker run that chooses "create and queue" queues nothing (#81)', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-tracker.yaml'), TRACKER_WORKFLOW);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'service-tracker-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const p = await api['projects:create']({ name: 'demo', folder });

  const gateP = new Promise((resolve) => {
    const onEv = (ev) => { if (ev.type === 'approval.requested') { service.events.off('run:event', onEv); resolve(ev); } };
    service.events.on('run:event', onEv);
  });
  const { runId } = await api['run:start']({ file: 'fixture-tracker.yaml', inputs: { project_path: folder }, mock: true });
  const gate = await gateP;
  api['approval:resolve']({ runId, id: gate.approval_id, answer: 'create_assign' });
  await untilTrue(() => !service.isRunning());

  assert.equal(fs.existsSync(queueFile(ws, p.id)), false, 'no queue file is written (#446)');
  assert.deepEqual(api['roadmap:get']({ projectId: p.id }).stages, [], 'a simulated run plans nothing');
});

// Drives a writer-reviewer mock run to acceptance through the service, resolving its non-boolean
// gate (decide: accept/revise/stop) and any other one with its first choice.
async function acceptedWriterReviewerRun(service, api, inputs, start = {}) {
  const events = [];
  const finished = new Promise((resolve) => {
    const onEvent = (ev) => {
      events.push(ev);
      if (ev.type === 'approval.requested') {
        const answer = ev.step_id === 'decide' ? 'accept' : ev.choices?.[0]?.id ?? true;
        setImmediate(() => api['approval:resolve']({ id: ev.approval_id, answer, runId: ev.run_id }));
      }
      if (ev.type === 'workflow.finished') { service.events.off('run:event', onEvent); resolve(ev); }
    };
    service.events.on('run:event', onEvent);
  });
  const { runId, runDir } = await api['run:start']({
    file: 'writer-reviewer.yaml', inputs: { prompt: 'A one-page PRD', goal: 'Every requirement is testable', ...inputs },
    mock: true, mockSequences: { score: [9] }, ...start,
  });
  const end = await finished;
  return { runId, runDir, end, events };
}

test('backlog:save-doc: preview works for a finished, accepted run started from an issue', async (t) => {
  const { service, api } = makeService(t);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'service-save-preview-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const p = await api['projects:create']({ name: 'demo', folder });
  api['projects:update']({ id: p.id, patch: { repo: 'https://github.com/o/r' } });
  // #648: writer-reviewer.yaml is an alias of write-doc.yaml, which works on a project's work item
  const { runId, end } = await acceptedWriterReviewerRun(service, api, { project_path: folder, item: 'backlog-screen' }, {
    projectId: p.id, issues: [{ number: 29, url: 'https://github.com/o/r/issues/29', title: 'Backlog screen' }],
  });
  assert.equal(end.status, 'success', end.error);

  const out = await api['backlog:save-doc']({ runId, mode: 'replace', preview: true });
  assert.equal(out.preview, true);
  assert.equal(out.issue.number, 29);
  assert.match(out.command, /^gh issue edit 29/);
});

test('backlog:save-doc: a real save (preview:false) on a non-mock run is refused by simulation-only', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const runDir = path.join(ws.runs, '20260101-000000-enrich0001');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'document.md'), '# Enriched issue');
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), `${JSON.stringify({
    ts: '2026-01-01T00:00:00Z', type: 'workflow.started', workflow: 'writer-reviewer',
    issues: [{ number: 29, url: 'https://github.com/o/r/issues/29', title: 'T' }], mock: false,
  })}\n${JSON.stringify({ ts: '2026-01-01T00:01:00Z', type: 'workflow.finished', status: 'success' })}\n`);
  await assert.rejects(api['backlog:save-doc']({ runId: '20260101-000000-enrich0001', mode: 'replace', preview: false }), /Simulation only/);
});

test('backlog:save-doc: a run still in progress is refused', async (t) => {
  const { service, api } = makeService(t);
  const { runId } = await api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true });
  await until(() => api['runs:active']().some((r) => r.runId === runId && r.waiting > 0));
  await assert.rejects(api['backlog:save-doc']({ runId, mode: 'replace', preview: true }), /still in progress/);
  api['run:stop']({ runId });
});

// ---- Backlog Refresh banner and badge (#161) ---------------------------------------------------

// A hand-built run folder for backlog-refresh.yaml, the shape packages/engine/domains/run/runs.js reads (events.jsonl's
// first line for `file`, summary.json for status/timing), plus the skill's own applied-safe.json.
function writeRefreshRun(ws, { runId, projectId, startedAt, finishedAt, results = [] }) {
  const runDir = path.join(ws.runs, runId);
  fs.mkdirSync(runDir, { recursive: true });
  const summary = { run_id: runId, workflow: 'backlog-refresh', project_id: projectId, status: 'success', mock: false, started_at: startedAt, finished_at: finishedAt, inputs: {}, sessions: [] };
  const events = [
    { seq: 1, ts: startedAt, run_id: runId, type: 'workflow.started', workflow: 'backlog-refresh', file: 'backlog-refresh.yaml', project_id: projectId, inputs: {}, mock: false, run_dir: runDir },
    { seq: 2, ts: finishedAt, run_id: runId, type: 'workflow.finished', status: 'success', summary },
  ];
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), `${events.map((e) => JSON.stringify(e)).join('\n')}\n`);
  fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(summary));
  fs.writeFileSync(path.join(runDir, 'applied-safe.json'), JSON.stringify({ repo: 'o/r', platform: 'gh', mode: 'safe', at: finishedAt, results }));
  return runDir;
}

test('backlog: withIssueRuns marks only the open issues the last refresh updated as "refreshed", for a day', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'service-refresh-badge-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const p = await api['projects:create']({ name: 'demo', folder });
  api['settings:set']({ backlogRefreshHours: 0 }); // off: the banner never calls git for this test
  const issue = (number, state) => ({ number, title: `Issue ${number}`, state, url: `https://github.com/o/r/issues/${number}`, body: '', labels: [], assignees: [], tasks: { done: 0, total: 0 } });
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({ projectId: p.id, platform: 'github', repo: 'https://github.com/o/r', issues: [issue(2, 'open'), issue(5, 'closed')] }));
  writeRefreshRun(ws, {
    runId: '20260101-000000-refresh0001', projectId: p.id,
    startedAt: '2026-01-01T00:00:00Z', finishedAt: new Date(Date.now() - 2 * 3600e3).toISOString(),
    results: [{ number: 2, result: 'updated', changes: ['body (1 edit)'] }, { number: 5, result: 'updated', changes: ['body (1 edit)'] }],
  });

  const data = api['backlog:get']({ projectId: p.id });
  const by = Object.fromEntries(data.issues.map((i) => [i.number, i]));
  assert.equal(by[2].refreshed, true); // open: badge shown
  assert.equal(by[5].refreshed, undefined); // closed: no badge, although the run also updated it
  assert.deepEqual(data.refresh.refreshed.slice().sort(), [2, 5]); // the banner's own list has both
});

test('backlog: the refresh banner counts merges since the last refresh only once it is stale, and "Dismiss for today" turns it off', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const repo = gitRepo(t); // a throwaway git repo with 2 commits already on main
  const p = await api['projects:create']({ name: 'demo', folder: repo.dir });
  api['settings:set']({ backlogRefreshHours: 1 });
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({ projectId: p.id, platform: 'github', repo: 'https://github.com/o/r', issues: [] }));
  writeRefreshRun(ws, {
    runId: '20260101-000000-refresh0002', projectId: p.id,
    startedAt: new Date(Date.now() - 2 * 3600e3).toISOString(), // 2h ago: stale at a 1h interval
    finishedAt: new Date(Date.now() - 1.9 * 3600e3).toISOString(),
  });

  // #389: the merges are counted by an async git call: a read never waits for it, a later one has it
  let data = api['backlog:get']({ projectId: p.id });
  assert.equal(data.refresh.hoursAgo, 2);
  for (const deadline = Date.now() + 10000; data.refresh.merges == null && Date.now() < deadline;) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    data = api['backlog:get']({ projectId: p.id });
  }
  assert.equal(data.refresh.merges, 2); // both of the repo's commits were made after the last refresh started
  assert.equal(data.refresh.due, true);

  data = api['backlog:dismiss-refresh']({ projectId: p.id });
  assert.equal(data.refresh.dismissed, true);
  assert.equal(data.refresh.due, false);
});

test('backlog: the async merge count pushes backlog:changed for the banner, and the next read has the count (#389)', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const repo = gitRepo(t);
  const p = await api['projects:create']({ name: 'demo', folder: repo.dir });
  api['settings:set']({ backlogRefreshHours: 1 });
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({ projectId: p.id, platform: 'github', repo: 'https://github.com/o/r', issues: [] }));
  writeRefreshRun(ws, {
    runId: '20260101-000000-refresh0003', projectId: p.id,
    startedAt: new Date(Date.now() - 2 * 3600e3).toISOString(),
    finishedAt: new Date(Date.now() - 1.9 * 3600e3).toISOString(),
  });
  const events = [];
  service.events.on('backlog:changed', (e) => events.push(e));

  assert.equal(api['backlog:get']({ projectId: p.id }).refresh.merges ?? null, null); // not counted yet
  await until(() => events.some((e) => e.file === 'refresh'));
  const pushed = events.filter((e) => e.file === 'refresh');
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].projectId, p.id);
  assert.equal(typeof pushed[0].watching, 'boolean');
  assert.equal(api['backlog:get']({ projectId: p.id }).refresh.merges, 2); // no poll needed after the push
});

test('backlog: afterBacklogRefresh syncs the project only for a real (non-mock) finished run of backlog-refresh.yaml with a projectId', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'backlog-refresh.yaml'), `apiVersion: craftorio/v1
kind: Workflow
metadata:
  name: fixture-backlog-refresh
agents: {}
steps:
  - id: review
    type: human_approval
    message: "Accept?"
`);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'service-refresh-sync-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const p = await api['projects:create']({ name: 'demo', folder });
  const calls = [];
  t.mock.method(backlog, 'syncBacklog', async (args) => { calls.push(args); return null; });
  const { gates, finished } = watchRuns(service);

  allowRealRuns(t, api);

  // a real run with a projectId: syncs
  const real = await api['run:start']({ file: 'backlog-refresh.yaml', inputs: {}, mock: false, projectId: p.id });
  await until(() => gates.has(real.runId));
  api['approval:resolve']({ runId: real.runId, id: gates.get(real.runId), answer: true });
  await until(() => finished.has(real.runId));
  await until(() => calls.length === 1);
  assert.equal(calls[0].project.id, p.id);
  assert.equal(calls[0].platform, 'github');

  // a mock run: no sync
  const mockRun = await api['run:start']({ file: 'backlog-refresh.yaml', inputs: {}, mock: true, projectId: p.id });
  await until(() => gates.has(mockRun.runId));
  api['approval:resolve']({ runId: mockRun.runId, id: gates.get(mockRun.runId), answer: true });
  await until(() => finished.has(mockRun.runId));
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(calls.length, 1); // still just the one, from the real run

  // a real run without a projectId: no sync
  const noProject = await api['run:start']({ file: 'backlog-refresh.yaml', inputs: {}, mock: false });
  await until(() => gates.has(noProject.runId));
  api['approval:resolve']({ runId: noProject.runId, id: gates.get(noProject.runId), answer: true });
  await until(() => finished.has(noProject.runId));
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(calls.length, 1);
});
