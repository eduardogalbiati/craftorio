const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { setupWorkspace } = require('../src/workspace');
const { createService } = require('../src/service');

// A mock run with one agent turn and a human gate, written into the workspace's workflows.
const WORKFLOW = `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: fixture-service
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: work
    agent: a
    prompt: "do the work"
  - id: review
    type: human_approval
    message: "Accept the work?"
`;

// The engine service with a temporary workspace and a host that records what it was asked to do.
function makeService(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'service-ws-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  process.env.MULTIAGENT_SIMULATION_ONLY = '1'; // tests never call real models
  const trashed = [];
  const service = createService({ host: { trashItem: async (p) => { trashed.push(p); }, appVersion: '9.9.9', isPackaged: false } });
  t.after(() => service.shutdown());
  service.setWorkspace(setupWorkspace(dir, { persist: false }));
  fs.writeFileSync(path.join(service.workspace().workflows, 'fixture-service.yaml'), WORKFLOW);
  return { service, api: service.api, trashed };
}

test('the service needs no Electron and refuses calls before a workspace is open', async () => {
  const service = createService({ host: { trashItem: async () => {}, appVersion: '0', isPackaged: false } });
  assert.throws(() => service.api['projects:list'](), /No workspace is open/);
  assert.ok(!Object.keys(require.cache).some((k) => /[\\/]node_modules[\\/]electron[\\/]/.test(k)));
});

test('seeds the bundled workflows and answers the UI channels', async (t) => {
  const { api } = makeService(t);
  const files = api['workflows:list']().map((w) => w.file);
  assert.ok(files.includes('software-development.yaml'));
  assert.ok(files.includes('fixture-service.yaml'));
  assert.equal(api['app:info']().version, '9.9.9');

  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'service-project-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const p = await api['projects:create']({ name: 'demo', folder });
  assert.deepEqual(api['projects:list']().map((x) => x.id), [p.id]);
  assert.deepEqual(api['projects:runs']({ id: p.id }).runs, []);
});

test('agents: the supervisor comes built in; removing an agent goes through the host trash', async (t) => {
  const { api, trashed, service } = makeService(t);
  assert.deepEqual(api['agents:list']().map((a) => a.id), ['supervisor']);
  const a = api['agents:create']({ name: 'Tester', prompt: 'You write tests.', skills: ['unit-test-writer-js'] });
  assert.equal(api['agents:save']({ id: a.id, data: { ...a, description: 'Writes tests' } }).description, 'Writes tests');
  await api['agents:remove'](a.id);
  assert.deepEqual(trashed, [path.join(service.workspace().agents, 'tester.json')]);
  await assert.rejects(async () => api['agents:remove']('supervisor'), /can't be removed/);
});

test('deleting a skill goes through the host trash', async (t) => {
  const { api, trashed, service } = makeService(t);
  await api['skills:remove']('../../somewhere/my-skill');
  assert.deepEqual(trashed, [path.join(service.workspace().skills, 'my-skill')]);
});

test('runs a mock workflow, pushes its events and resolves the human gate', async (t) => {
  const { service, api } = makeService(t);
  const events = [];
  const finished = new Promise((resolve) => {
    service.events.on('run:event', (ev) => {
      events.push(ev.type);
      // the engine registers the approval right after emitting the request
      if (ev.type === 'approval.requested') setImmediate(() => api['approval:resolve']({ id: ev.approval_id, answer: true }));
      if (ev.type === 'workflow.finished') resolve(ev);
    });
  });
  const { runId, runDir } = await api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true });
  assert.ok(service.isRunning());
  assert.equal(service.runDir(), runDir);
  assert.deepEqual(api['runs:active']().map((r) => r.runId), [runId]);
  await assert.rejects(api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true }), /already running/);

  const end = await finished;
  assert.equal(end.status, 'success');
  assert.ok(events.includes('step.finished') && events.includes('approval.resolved'));
  assert.ok(fs.existsSync(path.join(runDir, 'events.jsonl')));
  assert.equal(api['runs:list']().runs[0].runId, runId);
});

// #75: a run parked at a human gate is never only known from the events a client happened to see
// live; runs:active is the source of truth, so a reloaded window (or one that opened after the gate
// was requested) rebuilds it from a fresh read.
test('runs:active lists the gates a run waits at, for a client that saw none of the events live', async (t) => {
  const { api } = makeService(t);
  const until = async (fn) => { for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => setTimeout(r, 20)); assert.ok(fn()); };

  const { runId } = await api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true });
  await until(() => api['runs:active']().some((r) => r.runId === runId && r.waiting > 0));

  // a fresh client (e.g. a reloaded window): everything it knows about the gate comes from this call
  const active = api['runs:active']().find((r) => r.runId === runId);
  assert.equal(active.waiting, 1);
  assert.equal(active.gates.length, 1);
  const [gate] = active.gates;
  assert.equal(gate.step_id, 'review');
  assert.equal(gate.message, 'Accept the work?');
  assert.equal(gate.choices, null);
  assert.ok(gate.approval_id);
  assert.ok(gate.requested_at);

  assert.equal(api['approval:resolve']({ runId, id: gate.approval_id, answer: true }), true);
  await until(() => !api['runs:active']().some((r) => r.runId === runId));
});

test('the workspace cannot change while a run is in progress', async (t) => {
  const { service, api } = makeService(t);
  // lets the run finish before the temporary workspace is removed
  const finished = new Promise((resolve) => service.events.on('run:event', (ev) => {
    if (ev.type === 'approval.requested') setImmediate(() => api['approval:resolve']({ id: ev.approval_id, answer: true }));
    if (ev.type === 'workflow.finished') resolve();
  }));
  await api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true });
  assert.throws(() => service.setWorkspace(service.workspace()), /while workflows are running/);
  await finished;
});

test('with simulation only, real runs and CLI terminals are refused', async (t) => {
  const { service, api } = makeService(t);
  const asked = [];
  const host = createService({ host: { trashItem: async () => {}, appVersion: '0', isPackaged: false, assertCanRun: async (o) => { asked.push(o); } } });
  t.after(() => host.shutdown());
  host.setWorkspace(service.workspace());
  await assert.rejects(host.api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: false }), /Simulation only .*refusing to start a real run/);
  assert.throws(() => host.api['term:open']({ kind: 'cli-new', provider: 'claude' }), /Simulation only .*claude CLI/);
  assert.deepEqual(asked, []); // refused before the account check: nothing real was attempted
  assert.equal(host.isRunning(), false);
  assert.deepEqual(api['runs:list']().runs, []);
  assert.equal(api['app:info']().simulationOnly, true);
});

test('analytics: computes a snapshot of the (empty) workspace and refuses a real supervisor call without mock', async (t) => {
  const { api } = makeService(t);
  const snapshot = api['analytics:get']({ scope: 'orchestrator' });
  assert.equal(snapshot.scope, 'orchestrator');
  assert.equal(snapshot.totals.sessions, 0);
  await assert.rejects(api['analytics:analyze']({ scope: 'orchestrator', mock: false }), /Simulation only .*supervisor's CLI/);
});

test('a run starts only if the host allows it (account / free trial)', async (t) => {
  const { service, api } = makeService(t);
  // the account check comes after the simulation-only guard: lift it for this real-run request
  delete process.env.MULTIAGENT_SIMULATION_ONLY;
  t.after(() => { process.env.MULTIAGENT_SIMULATION_ONLY = '1'; });
  const asked = [];
  const blocked = createService({ host: { trashItem: async () => {}, appVersion: '0', isPackaged: false, assertCanRun: async (o) => { asked.push(o); throw new Error('Your 7-day free trial has ended.'); } } });
  blocked.setWorkspace(service.workspace());
  await assert.rejects(blocked.api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: false }), /trial has ended/);
  assert.deepEqual(asked, [{ mock: false }]);
  assert.equal(blocked.isRunning(), false);
  assert.deepEqual(api['runs:list']().runs, []);
});

// A workflow that takes an issue: one agent turn, then a human gate.
const ISSUE_WORKFLOW = `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: fixture-issue
inputs:
  task: { type: string, required: true }
  repo_path: { type: string, required: true }
  language: { type: string, enum: [js, go], default: js }
  issue: { type: string, default: "" }
  issues: { type: array, default: [] }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: work
    agent: a
    prompt: "{{ inputs.task }}"
  - id: review
    type: human_approval
    message: "Accept the work?"
`;

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
  assert.deepEqual(api['runs:list']().runs, []);
});

test('backlog: work merged locally shows as not pushed until the Backlog pushes it', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const { execFileSync } = require('child_process');
  const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'service-push-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 }));
  const origin = path.join(tmp, 'origin.git');
  const folder = path.join(tmp, 'repo');
  git(tmp, 'init', '-q', '--bare', origin);
  git(tmp, 'clone', '-q', origin, folder);
  git(folder, 'checkout', '-q', '-b', 'main');
  git(folder, 'commit', '-q', '--allow-empty', '-m', 'init');
  git(folder, 'push', '-q', '-u', 'origin', 'main');
  git(folder, 'commit', '-q', '--allow-empty', '-m', 'Add the feature\n\nCloses #1');
  const merged = git(folder, 'rev-parse', 'HEAD');

  const p = await api['projects:create']({ name: 'local', folder });
  // a local-hero run that merged #1 into the local main, and the last sync (Bitbucket: the sync
  // after the push stops before calling any CLI, the cache stays)
  const runDir = path.join(ws.runs, 'run-local');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify({
    run_id: 'run-local', workflow: 'software-development-local-hero', project_id: p.id, status: 'success', started_at: '2026-09-29T10:00:00Z',
    issues: [{ number: 1, url: 'https://bitbucket.org/o/r/issues/1' }], inputs: {}, sessions: [], worktree: { repo: folder },
    local_merge: { branch: 'feat/one', base: 'main', commit: merged },
  }));
  fs.mkdirSync(ws.backlog, { recursive: true });
  const issue = { number: 1, title: 'One', state: 'open', url: 'https://bitbucket.org/o/r/issues/1', body: '', labels: [], assignees: [], tasks: { done: 0, total: 0 } };
  fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({ projectId: p.id, platform: 'bitbucket', repo: 'https://bitbucket.org/o/r', issues: [issue] }));

  // never checked yet: assumed not pushed
  assert.equal(api['backlog:get']({ projectId: p.id }).issues[0].column, 'local');
  const checked = await api['backlog:local']({ projectId: p.id });
  assert.deepEqual([checked.local.ahead, checked.local.base, checked.local.issues], [1, 'main', [1]]);
  assert.equal(checked.backlog.issues[0].column, 'local');
  assert.deepEqual(api['backlog:unpushed'](), [{ projectId: p.id, name: 'local', base: 'main', ahead: 1, issues: [1] }]);
  assert.equal(api['projects:runs']({ id: p.id }).local.ahead, 1);

  const pushed = await api['backlog:push']({ projectId: p.id });
  assert.deepEqual([pushed.pushed, pushed.issues, pushed.local.ahead], [true, [1], 0]);
  assert.equal(git(origin, 'rev-parse', 'main'), merged);
  // pushed: no longer "local"; Done only when a sync reports #1 closed on the platform
  assert.equal(pushed.backlog.issues[0].column, 'in_progress');
  assert.deepEqual(api['backlog:unpushed'](), []);

  // auto-push is a project setting, off by default
  assert.equal(api['backlog:get']({ projectId: p.id }).autoPush, false);
  api['backlog:auto-push']({ projectId: p.id, on: true });
  assert.equal(api['backlog:get']({ projectId: p.id }).autoPush, true);
});

test('backlog: a push conflict is handed to a run of the local workflow that merged there last', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const { execFileSync } = require('child_process');
  const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'service-resolve-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 }));
  const origin = path.join(tmp, 'origin.git');
  const folder = path.join(tmp, 'repo');
  const other = path.join(tmp, 'other');
  const change = (cwd, text, msg) => { fs.writeFileSync(path.join(cwd, 'a.txt'), text); git(cwd, 'commit', '-q', '-am', msg); };
  git(tmp, 'init', '-q', '--bare', origin);
  git(tmp, 'clone', '-q', origin, folder);
  git(folder, 'checkout', '-q', '-b', 'main');
  fs.writeFileSync(path.join(folder, 'a.txt'), 'a\n');
  git(folder, 'add', 'a.txt');
  git(folder, 'commit', '-q', '-m', 'init');
  git(folder, 'push', '-q', '-u', 'origin', 'main');
  git(tmp, 'clone', '-q', '-b', 'main', origin, other);
  change(folder, 'mine\n', 'Change a\n\nCloses #1');
  const mine = git(folder, 'rev-parse', 'HEAD');
  change(other, 'theirs\n', 'their a');
  git(other, 'push', '-q', 'origin', 'main');

  fs.writeFileSync(path.join(ws.workflows, 'fixture-local.yaml'), `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: fixture-local
inputs:
  task: { type: string, required: true }
  repo_path: { type: string, required: true }
  language: { type: string, default: js }
  base_branch: { type: string, default: main }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: work
    agent: a
    prompt: "{{ inputs.task }}"
`);
  const p = await api['projects:create']({ name: 'local', folder });
  // the local run that merged #1 (its workflow and language are reused)
  const runDir = path.join(ws.runs, 'run-local');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), `${JSON.stringify({ type: 'workflow.started', file: path.join(ws.workflows, 'fixture-local.yaml'), inputs: { language: 'go' } })}\n`);
  fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify({
    run_id: 'run-local', workflow: 'fixture-local', project_id: p.id, status: 'success', started_at: '2026-09-29T10:00:00Z',
    inputs: { language: 'go' }, sessions: [], worktree: { repo: folder }, local_merge: { branch: 'feat/one', base: 'main', commit: mine },
  }));

  // nothing to resolve before the update found origin moved
  await assert.rejects(api['backlog:resolve-push']({ projectId: p.id, files: ['a.txt'], mock: true }), /already has every commit of origin\/main/);
  const u = await api['backlog:update-push']({ projectId: p.id });
  assert.deepEqual([u.conflict, u.files], [true, ['a.txt']]);
  assert.equal(git(folder, 'rev-parse', 'main'), mine);

  const finished = [];
  service.events.on('run:event', (ev) => { if (ev.type === 'workflow.finished') finished.push(ev); });
  const started = await api['backlog:resolve-push']({ projectId: p.id, files: ['a.txt'], mock: true });
  for (let i = 0; i < 200 && !finished.length; i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal(finished.length, 1);
  const first = JSON.parse(fs.readFileSync(path.join(started.runDir, 'events.jsonl'), 'utf8').split('\n')[0]);
  assert.equal(path.basename(first.file), 'fixture-local.yaml');
  assert.deepEqual([first.inputs.repo_path, first.inputs.base_branch, first.inputs.language], [folder, 'main', 'go']);
  assert.match(first.inputs.task, /git merge origin\/main/);
  assert.match(first.inputs.task, /conflicted in: a\.txt/);
  assert.equal(api['runs:list']().runs.find((r) => r.runId === started.runId).projectId, p.id);
  assert.equal(git(folder, 'rev-parse', 'main'), mine); // a simulated run touches no git
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
  const until = async (fn) => { for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => setTimeout(r, 50)); assert.ok(fn()); };

  await assert.rejects(api['backlog:assign']({ projectId: p.id, numbers: [3], workflow: 'fixture-issue.yaml', mock: true }), /at least one open issue/);
  await assert.rejects(api['backlog:assign']({ projectId: p.id, numbers: [1], workflow: 'fixture-service.yaml', mock: true }), /no task input/);

  let data = await api['backlog:assign']({ projectId: p.id, numbers: [2, 1], workflow: 'fixture-issue.yaml', inputs: { language: 'go' }, mock: true });
  assert.ok(service.isRunning());
  assert.deepEqual(data.queue.items.map((x) => x.number), [1]); // #2, selected first, started right away
  assert.deepEqual(data.queue.inputs, { 'fixture-issue.yaml': { language: 'go' } });

  await until(() => gates.length === 1);
  data = api['backlog:get']({ projectId: p.id });
  const by = () => Object.fromEntries(data.issues.map((i) => [i.number, i]));
  assert.equal(by()[2].column, 'waiting');
  assert.equal(by()[1].column, 'in_progress');
  assert.equal(by()[1].queued.position, 1);
  assert.equal(by()[3].column, 'done');

  api['approval:resolve']({ id: gates[0], answer: true });
  await until(() => gates.length === 2); // the dispatcher started #1 after #2 finished
  api['approval:resolve']({ id: gates[1], answer: true });
  await until(() => finished.length === 2 && !service.isRunning());

  data = api['backlog:get']({ projectId: p.id });
  assert.deepEqual(data.queue.items, []);
  assert.deepEqual([by()[1].column, by()[2].column], ['in_progress', 'in_progress']); // succeeded, still open
  const list = api['runs:list']().runs;
  const run2 = list.find((r) => r.issues?.[0].number === 2);
  assert.deepEqual(run2.issues, [{ number: 2, url: 'https://github.com/o/r/issues/2', title: 'Issue 2' }]);
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
  await until(() => by()[53].column === 'waiting');
  assert.deepEqual([65, 53, 77].map((n) => [by()[n].column, by()[n].runs[0].runId]), [65, 53, 77].map(() => ['waiting', run.runId]));
  assert.deepEqual(by()[53].runs[0].groupedWith, [65, 77]);

  api['approval:resolve']({ runId: run.runId, id: gates.get(run.runId), answer: true });
  await until(() => !service.isRunning());
  assert.deepEqual([65, 53, 77].map((n) => by()[n].column), ['in_progress', 'in_progress', 'in_progress']); // succeeded, still open
  const recorded = api['runs:list']().runs.find((r) => r.runId === run.runId);
  assert.deepEqual(recorded.issues.map((i) => i.number), [65, 53, 77]);
});

test('backlog: queues are paused when the workspace opens; a start that fails pauses the queue', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const backlog = require('../src/backlog');
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

test('builder: bundled workflows open read-only and clone into an editable copy', async (t) => {
  const { api, service } = makeService(t);
  const ro = api['builder:load']('writer-reviewer.yaml');
  assert.equal(ro.mode, 'readonly');
  assert.ok(ro.spec.fixed && ro.problems.length);
  assert.throws(() => api['builder:save']({ file: 'writer-reviewer.yaml', spec: ro.spec }), /bundled with the app: clone it/);

  const { file } = api['builder:clone']('writer-reviewer.yaml');
  assert.equal(file, 'writer-reviewer-copy.yaml');
  assert.equal(api['builder:clone']('writer-reviewer.yaml').file, 'writer-reviewer-copy-2.yaml');
  const copy = api['builder:load'](file);
  assert.equal(copy.mode, 'fixed');
  assert.equal(copy.spec.name, 'writer-reviewer-copy');
  copy.spec.agents.signoff.effort = 'low';
  api['builder:save']({ file, spec: copy.spec });
  const listed = api['workflows:list']().find((w) => w.file === file);
  assert.equal(listed.origin, 'custom');
  assert.match(fs.readFileSync(path.join(service.workspace().workflows, file), 'utf8'), /^# =+/); // comments kept

  // a hand-written workflow the builder can't draw keeps its steps; one it made is fully editable
  assert.equal(api['builder:load']('fixture-service.yaml').mode, 'fixed');
  const desk = { id: 'a', kind: 'agent', brief: 'Do it.', context: true, access: 'read', agent: { source: 'custom', provider: 'claude', model: 'claude-opus-5-5', effort: 'default', system_prompt: 'You do it.', skills: [] } };
  const made = api['builder:save']({ file: null, spec: { name: 'Made here', description: '', category: 'build', steps: [desk] } });
  assert.equal(made.file, 'made-here.yaml');
  assert.equal(api['builder:load'](made.file).mode, 'full');
});

test('backlog: the dispatcher re-checks for an open PR right before starting a queued issue and skips it', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const backlog = require('../src/backlog');
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
  delete process.env.MULTIAGENT_SIMULATION_ONLY;
  t.after(() => { process.env.MULTIAGENT_SIMULATION_ONLY = '1'; });
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
  assert.deepEqual(api['runs:list']().runs, []);
});

// ---- concurrent runs (Settings › Execution › Concurrent runs) --------------------------------
const until = async (fn) => { for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => setTimeout(r, 50)); assert.ok(fn()); };

// Gates and finished runs by run id, from the pushed events.
function watchRuns(service) {
  const gates = new Map();
  const finished = new Map();
  service.events.on('run:event', (ev) => {
    if (ev.type === 'approval.requested') gates.set(ev.run_id, ev.approval_id);
    if (ev.type === 'workflow.finished') finished.set(ev.run_id, ev.status);
  });
  return { gates, finished };
}

test('concurrent runs: each run resolves its own gates, stop affects only its run, the limit refuses one more', async (t) => {
  const { service, api } = makeService(t);
  const { gates, finished } = watchRuns(service);
  const start = () => api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true });

  // off by default: one run at a time
  const first = await start();
  await assert.rejects(start(), /already running/);
  api['settings:set']({ concurrentRuns: { enabled: true, max: 2, perProject: null, countSimulations: true } });
  const second = await start();
  await assert.rejects(start(), /2 of 2 runs in progress/);
  assert.deepEqual(api['runs:active']().map((r) => r.runId).sort(), [first.runId, second.runId].sort());
  assert.throws(() => service.setWorkspace(service.workspace()), /while workflows are running/);

  await until(() => gates.size === 2);
  // both runs wait on a gate with the same id: without the run it is ambiguous
  assert.equal(gates.get(first.runId), gates.get(second.runId));
  assert.equal(api['approval:resolve']({ id: gates.get(first.runId), answer: true }), false);
  assert.throws(() => api['run:stop']({}), /say which one/);

  assert.equal(api['approval:resolve']({ runId: first.runId, id: gates.get(first.runId), answer: true }), true);
  await until(() => finished.has(first.runId));
  assert.equal(finished.get(first.runId), 'success');
  assert.ok(!finished.has(second.runId));
  assert.equal(api['runs:list']().runs.find((r) => r.runId === second.runId).status, 'running');

  // a slot is free again
  const third = await start();
  assert.equal(api['run:stop']({ runId: second.runId }), true);
  await until(() => finished.has(second.runId));
  assert.equal(finished.get(second.runId), 'cancelled');
  assert.ok(!finished.has(third.runId));
  assert.deepEqual(api['runs:active']().map((r) => r.runId), [third.runId]);
  api['run:stop']({ runId: third.runId });
  await until(() => !service.isRunning());
});

test('concurrent runs: simulations do not count unless the setting says so', async (t) => {
  const { service, api } = makeService(t);
  api['settings:set']({ concurrentRuns: { enabled: true, max: 1, perProject: null, countSimulations: false } });
  const a = await api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true });
  const b = await api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true });
  assert.equal(api['runs:active']().length, 2);
  api['run:stop']({ runId: a.runId });
  api['run:stop']({ runId: b.runId });
  await until(() => !service.isRunning());
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

test('artifacts: a run screenshot is read as an image data URL, a text file as text', (t) => {
  const { api, service } = makeService(t);
  const run = path.join(service.workspace().runs, '20260101-000000-abcd1234');
  fs.mkdirSync(path.join(run, 'screenshots'), { recursive: true });
  fs.writeFileSync(path.join(run, 'events.jsonl'), `${JSON.stringify({ seq: 1, type: 'workflow.started', run_id: '20260101-000000-abcd1234', workflow: 'software-development' })}\n`);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  fs.writeFileSync(path.join(run, 'screenshots', 'settings-after.png'), png);
  fs.writeFileSync(path.join(run, 'screenshots', 'screenshots.json'), '[]');

  const image = api['artifacts:read']({ path: path.join(run, 'screenshots', 'settings-after.png') });
  assert.equal(image.kind, 'image');
  assert.equal(image.image, 'data:image/png;base64,iVBORw0KGgoAAAAA');
  const text = api['artifacts:read']({ path: path.join(run, 'screenshots', 'screenshots.json') });
  assert.equal(text.image, null);
  assert.equal(text.text, '[]');
});

// ---- Resume from step… (#100): runs:resume, no supervisor call, gates never skipped --------
const RESUME_WORKFLOW = `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: fixture-resume
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: plan
    agent: a
    prompt: "plan the work"
  - id: approve
    type: human_approval
    message: "Proceed?"
  - id: work
    agent: a
    prompt: "do the work"
`;

function makeResumeService(t) {
  const { service, api } = makeService(t);
  fs.writeFileSync(path.join(service.workspace().workflows, 'fixture-resume.yaml'), RESUME_WORKFLOW);
  return { service, api };
}

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
  // 'work' is reached but blocked by the decided gate: the earliest unblocked step is suggested
  assert.equal(o.suggested, 'plan');
  assert.equal(o.worktree, null, 'a mock run never touches git');
});

// ---- Tokens per session (#93): sessionView carries tokens for a live run and a recorded one -----
test('the agents table carries each session\'s tokens, live while the run goes and from disk once recorded', async (t) => {
  const { service, api } = makeResumeService(t);
  let live;
  const finished = new Promise((resolve) => {
    service.events.on('run:event', (ev) => {
      if (ev.type === 'session.message_received' && ev.session.agent === 'a' && !live) {
        live = api['runs:list']().runs.find((r) => r.status === 'running')?.sessions.find((s) => s.agent === 'a');
      }
      if (ev.type === 'approval.requested') setImmediate(() => api['approval:resolve']({ id: ev.approval_id, answer: true }));
      if (ev.type === 'workflow.finished') resolve();
    });
  });
  const { runId } = await api['run:start']({ file: 'fixture-resume.yaml', inputs: {}, mock: true });
  await finished;

  assert.ok(live?.tokens, 'a live session already carries its tokens');
  assert.equal(live.tokens.total, live.tokens.input + live.tokens.output + live.tokens.cache_read + live.tokens.cache_write, 'reasoning is not counted twice');

  const recorded = api['runs:list']().runs.find((r) => r.runId === runId).sessions.find((s) => s.agent === 'a');
  assert.ok(recorded.tokens.total > 0, 'the finished run still carries the tokens, read back from disk');
  assert.deepEqual(Object.keys(recorded.tokens).sort(), ['cache_read', 'cache_write', 'input', 'output', 'reasoning', 'total'].sort());
});

test('a session with no tokens shows null; non-numeric token values never become NaN', async (t) => {
  const { api, service } = makeResumeService(t);
  const ws = service.workspace();
  const runId = '20260101-000000-tokens0001';
  const dir = path.join(ws.runs, runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'events.jsonl'), '');
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
    run_id: runId, workflow: 'fixture-resume', file: 'fixture-resume.yaml', status: 'success', mock: true,
    started_at: '2026-01-01T00:00:00Z', finished_at: '2026-01-01T00:05:00Z', inputs: {},
    sessions: [
      { id: 's1', agent: 'orchestrator', provider: 'mock', model: 'm', status: 'closed', turns: 0, cost_usd: 0 }, // no tokens field
      { id: 's2', agent: 'a', provider: 'mock', model: 'm', status: 'closed', turns: 1, cost_usd: 0,
        tokens: { input: '12', output: null, cache_read: undefined, cache_write: NaN, reasoning: 5 } },
    ],
  }));

  const sessions = api['runs:list']().runs.find((r) => r.runId === runId).sessions;
  assert.equal(sessions.find((s) => s.agent === 'orchestrator').tokens, null);
  assert.deepEqual(sessions.find((s) => s.agent === 'a').tokens, { input: 12, output: 0, cache_read: 0, cache_write: 0, reasoning: 5, total: 12 });
});
