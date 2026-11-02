const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const backlog = require('../../domains/backlog/backlog');
const { ISSUE_WORKFLOW, allowRealRuns, gitRepo, makeService, until, untilTrue, watchRuns } = require('./helpers');

test('backlog: with simulation only, a real assignment is refused and nothing is queued', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'service-backlog-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const p = await api['projects:create']({ name: 'demo', folder });
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({ projectId: p.id, platform: 'github', repo: 'https://github.com/o/r', issues: [{ number: 1, title: 'Issue 1', state: 'open', url: 'https://github.com/o/r/issues/1', body: '', labels: [], assignees: [], tasks: { done: 0, total: 0 } }] }));
  await assert.rejects(api['backlog:assign']({ projectId: p.id, numbers: [1], workflow: 'fixture-issue.yaml', mock: false }), /Simulation only .*real runs from the Backlog/);
  assert.equal(fs.existsSync(path.join(ws.backlog, `${p.id}.queue.json`)), false);
  assert.deepEqual((await api['runs:list']()).runs, []);
});

test('backlog: assigned issues run one at a time, each run records its issue', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'service-backlog-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const p = await api['projects:create']({ name: 'demo', folder });
  api['projects:update']({ id: p.id, patch: { repo: 'https://github.com/o/r' } });
  const issue = (number, state = 'open') => ({ number, title: `Issue ${number}`, state, url: `https://github.com/o/r/issues/${number}`, body: 'Do it', labels: [], assignees: [], tasks: { done: 0, total: 0 } });
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({ projectId: p.id, platform: 'github', repo: 'https://github.com/o/r', issues: [issue(1), issue(2), issue(3, 'closed')] }));

  const gates = [];
  const finished = [];
  service.events.on('run:event', (ev) => {
    if (ev.type === 'approval.requested') gates.push(ev.approval_id);
    if (ev.type === 'workflow.finished') finished.push(ev);
  });

  await assert.rejects(api['backlog:assign']({ projectId: p.id, numbers: [3], workflow: 'fixture-issue.yaml', mock: true }), /at least one open issue/);
  await assert.rejects(api['backlog:assign']({ projectId: p.id, numbers: [1], workflow: 'fixture-service.yaml', mock: true }), /no task input/);

  let data = await api['backlog:assign']({ projectId: p.id, numbers: [2, 1], workflow: 'fixture-issue.yaml', inputs: { language: 'go' }, mock: true });
  assert.ok(service.isRunning());
  assert.deepEqual(data.queue.items.map((x) => x.number), [1]); // #2, selected first, started right away
  assert.deepEqual(data.queue.inputs, { 'fixture-issue.yaml': { language: 'go' } });

  await until(() => gates.length === 1);
  data = api['backlog:get']({ projectId: p.id });
  const by = () => Object.fromEntries(data.issues.map((i) => [i.number, i]));
  assert.equal(by()[2].column, 'todo'); // simulated: waiting at a gate, but never moves the column
  assert.equal(by()[1].column, 'todo'); // simulated: queued, but never moves the column
  assert.equal(by()[1].queued.position, 1);
  assert.equal(by()[3].column, 'done');

  api['approval:resolve']({ id: gates[0], answer: true });
  await until(() => gates.length === 2); // the dispatcher started #1 after #2 finished
  api['approval:resolve']({ id: gates[1], answer: true });
  await until(() => finished.length === 2 && !service.isRunning());

  data = api['backlog:get']({ projectId: p.id });
  assert.deepEqual(data.queue.items, []);
  assert.deepEqual([by()[1].column, by()[2].column], ['todo', 'todo']); // simulated: succeeded, but still just todo
  const list = (await api['runs:list']()).runs;
  const run2 = list.find((r) => r.issues?.[0].number === 2);
  // #168: a run records the version of each issue it starts from (here none, the cache has no updatedAt)
  assert.deepEqual(run2.issues, [{ number: 2, url: 'https://github.com/o/r/issues/2', title: 'Issue 2', updatedAt: null }]);
  const started = JSON.parse(fs.readFileSync(path.join(run2.runDir, 'events.jsonl'), 'utf8').split('\n')[0]);
  assert.equal(started.inputs.issue, 'https://github.com/o/r/issues/2');
  assert.equal(started.inputs.language, 'go');
  assert.equal(started.inputs.repo_path, folder);
  assert.match(started.inputs.task, /^Issue 2\n\nIssue: https:\/\/github\.com\/o\/r\/issues\/2/);
});

test('backlog: issues assigned as one run queue one item, start one run for all of them and move together', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'service-group-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const p = await api['projects:create']({ name: 'demo', folder });
  const issue = (number) => ({ number, title: `Issue ${number}`, state: 'open', url: `https://github.com/o/r/issues/${number}`, body: `Body ${number}`, labels: [], assignees: [], tasks: { done: 0, total: 0 } });
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({ projectId: p.id, platform: 'github', repo: 'https://github.com/o/r', issues: [53, 65, 77, 80, 81, 82, 83, 84].map(issue) }));
  const { gates } = watchRuns(service);
  const by = () => Object.fromEntries(api['backlog:get']({ projectId: p.id }).issues.map((i) => [i.number, i]));

  api['settings:set']({ backlogMaxGroup: 3 });
  await assert.rejects(api['backlog:assign']({ projectId: p.id, numbers: [80, 81, 82, 83], workflow: 'fixture-issue.yaml', mock: true, group: true }), /at most 3 issues/);
  assert.equal(service.isRunning(), false);

  // #84 takes the only run slot, so the group waits in the queue
  await api['backlog:assign']({ projectId: p.id, numbers: [84], workflow: 'fixture-issue.yaml', mock: true });
  let data = await api['backlog:assign']({ projectId: p.id, numbers: [65, 53, 77], workflow: 'fixture-issue.yaml', mock: true, group: true });
  assert.equal(data.queue.items.length, 1);
  assert.deepEqual(data.queue.items[0].issues.map((i) => i.number), [65, 53, 77]); // in the order selected
  assert.deepEqual([by()[65].queued, by()[53].queued.groupedWith, by()[77].queued.groupedWith],
    [{ position: 1, workflow: 'fixture-issue', mock: true, groupedWith: [53, 77] }, [65, 77], [65, 53]]);

  await until(() => gates.size === 1);
  const first = [...gates.keys()][0];
  api['approval:resolve']({ runId: first, id: gates.get(first), answer: true });
  await until(() => gates.size === 2); // the group started after #84 finished: one run
  const run = api['runs:active']()[0];
  assert.equal(api['runs:active']().length, 1);
  assert.deepEqual(run.issues.map((i) => i.number), [65, 53, 77]);
  assert.deepEqual(run.inputs.issues, [65, 53, 77].map((n) => `https://github.com/o/r/issues/${n}`));
  assert.equal(run.inputs.issue, 'https://github.com/o/r/issues/65');
  assert.match(run.inputs.task, /^Implement these 3 issues together \(#65, #53, #77\)\./);
  assert.match(run.inputs.task, /## 1\. #65 Issue 65\n\nIssue: https:\/\/github\.com\/o\/r\/issues\/65\n\nBody 65[\s\S]*## 2\. #53 Issue 53[\s\S]*## 3\. #77 Issue 77/);
  assert.deepEqual(api['backlog:get']({ projectId: p.id }).queue.items, []);
  await until(() => by()[53].runs[0]?.waiting === true);
  // simulated: waiting at a gate shows in the history but never moves the column
  assert.deepEqual([65, 53, 77].map((n) => [by()[n].column, by()[n].runs[0].runId, by()[n].runs[0].waiting]), [65, 53, 77].map(() => ['todo', run.runId, true]));
  assert.deepEqual(by()[53].runs[0].groupedWith, [65, 77]);

  api['approval:resolve']({ runId: run.runId, id: gates.get(run.runId), answer: true });
  await until(() => !service.isRunning());
  assert.deepEqual([65, 53, 77].map((n) => by()[n].column), ['todo', 'todo', 'todo']); // simulated: succeeded, but still just todo
  const recorded = (await api['runs:list']()).runs.find((r) => r.runId === run.runId);
  assert.deepEqual(recorded.issues.map((i) => i.number), [65, 53, 77]);
});

test('backlog: a group of exactly the Backlog\'s max size is accepted (only over the limit is refused)', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'service-group-max-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const p = await api['projects:create']({ name: 'demo', folder });
  const issue = (number) => ({ number, title: `Issue ${number}`, state: 'open', url: `https://github.com/o/r/issues/${number}`, body: `Body ${number}`, labels: [], assignees: [], tasks: { done: 0, total: 0 } });
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({ projectId: p.id, platform: 'github', repo: 'https://github.com/o/r', issues: [1, 2, 3].map(issue) }));

  api['settings:set']({ backlogMaxGroup: 3 });
  const data = await api['backlog:assign']({ projectId: p.id, numbers: [1, 2, 3], workflow: 'fixture-issue.yaml', mock: true, group: true });
  assert.deepEqual(data.queue.items, []); // the slot was free: it started right away, one run for all three
  const run = api['runs:active']()[0];
  assert.deepEqual(run.issues.map((i) => i.number), [1, 2, 3]);
});

// A workflow shaped like issue-tracker's filing path (its metadata.name is what backlog.filedToQueue
// and the service's queueFiledIssues key on), trimmed to the fields they read: analyze (grouping,
// nearby), a decision gate with a create_assign choice, and file (filed).
const TRACKER_WORKFLOW = `apiVersion: multiagent/v1
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
      - { id: create_assign, label: "Create and queue" }
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

  assert.deepEqual(backlog.readQueue(ws.backlog, p.id).items, []);
});

test('backlog: queues are paused when the workspace opens; a start that fails pauses the queue', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  backlog.enqueue(ws.backlog, 'demo', { issues: [{ number: 1, url: 'u', title: 't' }], workflow: 'missing.yaml' });
  service.setWorkspace(ws);
  assert.equal(backlog.readQueue(ws.backlog, 'demo').paused, true);

  await api['backlog:pause']({ projectId: 'demo', paused: false }).catch(() => {}); // no synced backlog: returns null
  const q = backlog.readQueue(ws.backlog, 'demo');
  assert.equal(q.paused, true); // the project does not exist: the start failed
  assert.match(q.error, /Could not start #1/);
  assert.equal(q.items.length, 1);
  assert.ok(!service.isRunning());
});

test('backlog: the dispatcher re-checks for an open PR right before starting a queued issue and skips it', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'service-backlog-recheck-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const p = await api['projects:create']({ name: 'demo', folder });
  api['projects:update']({ id: p.id, patch: { repo: 'https://github.com/o/r' } });
  const issue = { number: 1, title: 'Issue 1', state: 'open', url: 'https://github.com/o/r/issues/1', body: 'Do it', labels: [], assignees: [], tasks: { done: 0, total: 0 } };
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({ projectId: p.id, platform: 'github', repo: 'https://github.com/o/r', issues: [issue] }));

  // only real queue items are re-checked: lift the simulation-only guard for the Backlog's check
  // and restore it before the dispatcher could start anything, so a regression can't call a model
  allowRealRuns(t, api);
  const seen = [];
  t.mock.method(backlog, 'newPullRequests', async (args) => {
    process.env.MULTIAGENT_SIMULATION_ONLY = '1';
    seen.push(args.item.number);
    return [{ number: 9, title: 'Fix (#1)', url: 'https://github.com/o/r/pull/9', draft: false }];
  });
  const data = await api['backlog:assign']({ projectId: p.id, numbers: [1], workflow: 'fixture-issue.yaml', mock: false });

  assert.deepEqual(seen, [1]);
  assert.deepEqual(data.queue.items, []); // taken out instead of started
  assert.deepEqual(data.queue.skipped.map((s) => [s.number, s.reason]), [[1, 'open PR #9 since it was queued']]);
  assert.ok(!service.isRunning());
  assert.deepEqual((await api['runs:list']()).runs, []);
});

// A real-capable fixture (no agent steps, so `mock: false` never calls a model): used to prove the
// dispatcher reads the platform right before a real start (#168) without any cost or CLI dependency.
const REAL_QUEUE_WORKFLOW = `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: fixture-real-queue
inputs:
  task: { type: string, required: true }
  repo_path: { type: string, required: true }
  issue: { type: string, default: "" }
agents: {}
steps:
  - id: review
    type: human_approval
    message: "Accept?"
`;

function realQueueProject(api, ws, t, name) {
  return (async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), `service-${name}-`));
    fs.writeFileSync(path.join(folder, 'README.md'), 'x'); // preflight needs a non-empty folder for a real run
    t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
    const p = await api['projects:create']({ name: 'demo', folder });
    api['projects:update']({ id: p.id, patch: { repo: 'https://github.com/o/r' } });
    return p;
  })();
}

test('backlog: #168 the dispatcher reads a queued issue again from the platform right before its real start; the task and the recorded issue use what was read, not the stale cache', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-real-queue.yaml'), REAL_QUEUE_WORKFLOW);
  const p = await realQueueProject(api, ws, t, 'fresh-queue');
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({
    projectId: p.id, platform: 'github', repo: 'https://github.com/o/r',
    issues: [{ number: 1, title: 'Cached title', state: 'open', url: 'https://github.com/o/r/issues/1', body: 'Cached body', labels: [], assignees: [], tasks: { done: 0, total: 0 }, updatedAt: '2026-09-01T00:00:00Z' }],
  }));
  t.mock.method(backlog, 'freshIssues', async ({ item }) => ({
    issues: [{ number: item.number, url: item.url, title: 'Fresh title', body: 'Fresh body', labels: [], state: 'open', updatedAt: '2026-10-01T12:00:00Z' }],
    warnings: [],
  }));

  allowRealRuns(t, api);
  await api['backlog:assign']({ projectId: p.id, numbers: [1], workflow: 'fixture-real-queue.yaml', mock: false });

  const run = api['runs:active']()[0];
  assert.ok(run, 'the real run started');
  assert.match(run.inputs.task, /^Fresh title\n\nIssue: https:\/\/github\.com\/o\/r\/issues\/1\n\nFresh body$/);
  assert.deepEqual(run.issues, [{ number: 1, url: 'https://github.com/o/r/issues/1', title: 'Fresh title', updatedAt: '2026-10-01T12:00:00Z' }]);
});

test('backlog: #168 an issue closed on the platform since it was queued is skipped at its start, although the cache and the queue still show it open; the slot frees for the next one', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-real-queue.yaml'), REAL_QUEUE_WORKFLOW);
  const p = await realQueueProject(api, ws, t, 'closed-queue');
  const issue = (number) => ({ number, title: `Issue ${number}`, state: 'open', url: `https://github.com/o/r/issues/${number}`, body: `Body ${number}`, labels: [], assignees: [], tasks: { done: 0, total: 0 } });
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({ projectId: p.id, platform: 'github', repo: 'https://github.com/o/r', issues: [issue(1), issue(2)] }));
  t.mock.method(backlog, 'freshIssues', async ({ item }) => (item.number === 1
    ? { issues: [{ number: 1, url: item.url, title: item.title, body: item.body, labels: [], state: 'closed', updatedAt: '2026-10-01T00:00:00Z' }], warnings: [] }
    : { issues: [{ number: item.number, url: item.url, title: 'Fresh 2', body: 'Fresh body 2', labels: [], state: 'open', updatedAt: '2026-10-01T00:00:00Z' }], warnings: [] }));

  allowRealRuns(t, api);
  const data = await api['backlog:assign']({ projectId: p.id, numbers: [1, 2], workflow: 'fixture-real-queue.yaml', mock: false });

  assert.deepEqual(data.queue.skipped.map((s) => [s.number, s.reason]), [[1, 'closed on the platform']]);
  const run = api['runs:active']()[0];
  assert.ok(run, 'the next item started right away, in the same dispatch');
  assert.deepEqual(run.issues.map((i) => i.number), [2]);
  assert.match(run.inputs.task, /^Fresh 2/);
});

test('backlog: #168 a platform read that fails when a queued issue starts falls back to the synced cache; the run records it with a warning', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-real-queue.yaml'), REAL_QUEUE_WORKFLOW);
  const p = await realQueueProject(api, ws, t, 'fallback-queue');
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({
    projectId: p.id, platform: 'github', repo: 'https://github.com/o/r',
    issues: [{ number: 1, title: 'Cached title', state: 'open', url: 'https://github.com/o/r/issues/1', body: 'Cached body', labels: [], assignees: [], tasks: { done: 0, total: 0 }, updatedAt: '2026-09-01T00:00:00Z' }],
  }));
  t.mock.method(backlog, 'freshIssues', async () => ({
    issues: [{
      number: 1, url: 'https://github.com/o/r/issues/1', title: 'Cached title', body: 'Cached body', labels: [],
      state: 'open', updatedAt: '2026-09-01T00:00:00Z', fallback: 'cache', cachedAt: '2026-09-20T08:00:00Z',
    }],
    warnings: ['Issue #1 read from the cache of 08:00: gh: not authenticated'],
  }));
  const logs = [];
  service.events.on('run:event', (ev) => { if (ev.type === 'log') logs.push(ev); });

  allowRealRuns(t, api);
  await api['backlog:assign']({ projectId: p.id, numbers: [1], workflow: 'fixture-real-queue.yaml', mock: false });

  const run = api['runs:active']()[0];
  assert.ok(run, 'the cache let the run start instead of a silent failure');
  assert.deepEqual(run.issues, [{
    number: 1, url: 'https://github.com/o/r/issues/1', title: 'Cached title', updatedAt: '2026-09-01T00:00:00Z', fallback: 'cache', cachedAt: '2026-09-20T08:00:00Z',
  }]);
  const warn = logs.find((e) => e.level === 'warn');
  assert.ok(warn, 'a warn log was recorded in the run');
  assert.match(warn.message, /^Issue #1 read from the cache of 08:00: gh: not authenticated$/);
});

test('backlog: the dispatcher fills free slots from the queues, oldest first, within the limit per project', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  api['settings:set']({ concurrentRuns: { enabled: true, max: 2, perProject: 1, countSimulations: true } });
  const issue = (number) => ({ number, title: `Issue ${number}`, state: 'open', url: `https://github.com/o/r/issues/${number}`, body: 'Do it', labels: [], assignees: [], tasks: { done: 0, total: 0 } });
  const project = async (name, numbers) => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'service-slots-'));
    t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
    const p = await api['projects:create']({ name, folder });
    fs.mkdirSync(ws.backlog, { recursive: true });
    fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({ projectId: p.id, platform: 'github', repo: 'https://github.com/o/r', issues: numbers.map(issue) }));
    return p;
  };
  const p1 = await project('one', [1, 2]);
  const p2 = await project('two', [7]);
  const { gates } = watchRuns(service);
  const running = () => api['runs:active']().map((r) => `${r.projectId}#${r.issues[0].number}`).sort();

  let data = await api['backlog:assign']({ projectId: p1.id, numbers: [1, 2], workflow: 'fixture-issue.yaml', mock: true });
  assert.deepEqual(running(), [`${p1.id}#1`]); // one run per project
  assert.deepEqual(data.queue.items.map((x) => x.number), [2]);
  await api['backlog:assign']({ projectId: p2.id, numbers: [7], workflow: 'fixture-issue.yaml', mock: true });
  assert.deepEqual(running(), [`${p1.id}#1`, `${p2.id}#7`]); // the other project takes the free slot

  await until(() => gates.size === 2);
  const run1 = api['runs:active']().find((r) => r.issues[0].number === 1).runId;
  api['approval:resolve']({ runId: run1, id: gates.get(run1), answer: true });
  await until(() => running().includes(`${p1.id}#2`)); // p1's next issue once its run is over
  assert.deepEqual(running(), [`${p1.id}#2`, `${p2.id}#7`]);
  data = api['backlog:get']({ projectId: p1.id });
  assert.deepEqual(data.queue.items, []);

  for (const r of api['runs:active']()) api['run:stop']({ runId: r.runId });
  await until(() => !service.isRunning());
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
  const { runId, end } = await acceptedWriterReviewerRun(service, api, {}, {
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
  fs.writeFileSync(path.join(ws.workflows, 'backlog-refresh.yaml'), `apiVersion: multiagent/v1
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
