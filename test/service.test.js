const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { setupWorkspace } = require('../src/workspace');
const { createService } = require('../src/service');
const backlog = require('../src/backlog');

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

// A mock run that opens a PR (output_schema with pr_url/pr_number), then waits at a gate so it is
// still active once the PR is known: #84.
const PR_WORKFLOW = `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: fixture-pr
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: ci
    agent: a
    prompt: "report the PR"
    output_schema:
      type: object
      required: [pr_url, pr_number]
      properties:
        pr_url:    { type: string }
        pr_number: { type: integer }
  - id: review
    type: human_approval
    message: "Merge the PR?"
`;

// The engine service with a temporary workspace and a host that records what it was asked to do.
// Cleanup order matters: a run left open at a gate (e.g. by openGateFixture below) is still
// writing to the workspace, so this single hook stops every run still active first, then shuts
// the service down and only then removes the workspace directory. node:test runs t.after hooks
// in the order they were added, so registering this before any test-specific hook (which may
// also try to stop the same run, harmlessly, once it is already gone) keeps rmSync last.
function makeService(t, hostExtra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'service-ws-'));
  process.env.MULTIAGENT_SIMULATION_ONLY = '1'; // tests never call real models
  const trashed = [];
  const service = createService({ host: { trashItem: async (p) => { trashed.push(p); }, appVersion: '9.9.9', isPackaged: false, ...hostExtra } });
  t.after(async () => {
    for (const run of service.api['runs:active']()) {
      try { service.api['run:stop']({ runId: run.runId }); } catch { /* already ended */ }
    }
    await untilTrue(() => service.api['runs:active']().length === 0);
    service.shutdown();
  });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
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
  const ids = api['agents:list']().map((a) => a.id);
  assert.deepEqual(ids.slice(0, 2), ['supervisor', 'product-owner']);
  const a = api['agents:create']({ name: 'Tester', prompt: 'You write tests.', skills: ['unit-test-writer-js'] });
  assert.equal(api['agents:save']({ id: a.id, data: { ...a, description: 'Writes tests' } }).description, 'Writes tests');
  await api['agents:remove'](a.id);
  assert.deepEqual(trashed, [path.join(service.workspace().agents, 'tester.json')]);
  await assert.rejects(async () => api['agents:remove']('supervisor'), /can't be removed/);
  await assert.rejects(async () => api['agents:remove']('product-owner'), /can't be removed/);
});

// #68: the workspace's workflows (the bundled ones plus the fixture written by makeService) list
// their own agents too, read-only, after the user's.
test('agents: the workflows\' own agents are listed too, read-only', async (t) => {
  const { api } = makeService(t);
  const ids = api['agents:list']().map((a) => a.id);
  assert.ok(ids.includes('workflow:fixture-service.yaml:a'));
  const fixtureAgent = api['agents:list']().find((a) => a.id === 'workflow:fixture-service.yaml:a');
  assert.equal(fixtureAgent.readOnly, true);
  await assert.rejects(async () => api['agents:remove']('workflow:fixture-service.yaml:a'), /belongs to its workflow/);
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

// #84: the run lists show each run's PR (state icon, #n link) without opening GitHub for each one.
test('runs:list and runs:active expose the PR a mock run opened; a simulated run\'s state is "unknown" (never really read)', async (t) => {
  const { api, service } = makeService(t);
  fs.writeFileSync(path.join(service.workspace().workflows, 'fixture-pr.yaml'), PR_WORKFLOW);
  const until = async (fn) => { for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => setTimeout(r, 20)); assert.ok(fn()); };
  const { runId } = await api['run:start']({ file: 'fixture-pr.yaml', inputs: {}, mock: true });
  await until(() => api['runs:active']().some((r) => r.runId === runId && r.waiting > 0));
  const active = api['runs:active']().find((r) => r.runId === runId);
  assert.deepEqual(active.pr, { number: 42, url: 'https://github.com/acme/app/pull/42', state: 'unknown', detail: 'simulated run: its PR is not real, so it is not read', checkedAt: null });
  const [gate] = active.gates;
  api['approval:resolve']({ runId, id: gate.approval_id, answer: true });
  await untilTrue(() => !service.isRunning());
  const run = api['runs:list']().runs.find((r) => r.runId === runId);
  assert.equal(run.pr.number, 42);
  assert.equal(run.pr.url, 'https://github.com/acme/app/pull/42');
  assert.equal(run.pr.state, 'unknown');
});

test('runs:prState reads a run\'s PR with host.readPrJson (also for a mock run, when the host provides it)', async (t) => {
  const reads = [];
  const readPrJson = async (cmd, args) => { reads.push([cmd, ...args]); return { state: 'MERGED' }; };
  const { api, service } = makeService(t, { readPrJson });
  fs.writeFileSync(path.join(service.workspace().workflows, 'fixture-pr.yaml'), PR_WORKFLOW);
  const until = async (fn) => { for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => setTimeout(r, 20)); assert.ok(fn()); };
  const { runId } = await api['run:start']({ file: 'fixture-pr.yaml', inputs: {}, mock: true });
  await until(() => api['runs:active']().some((r) => r.runId === runId && r.waiting > 0));
  const [gate] = api['runs:active']().find((r) => r.runId === runId).gates;
  api['approval:resolve']({ runId, id: gate.approval_id, answer: true });
  await untilTrue(() => !service.isRunning());
  const pr = await api['runs:prState']({ runId });
  assert.equal(pr.state, 'merged');
  assert.equal(reads[0][0], 'gh');
});

test('runs:setTitle persists the owner\'s title in meta.json (never touching events.jsonl), across a service restart, and emits run:meta', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'service-ws-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  process.env.MULTIAGENT_SIMULATION_ONLY = '1';
  const host = { trashItem: async () => {}, appVersion: '9.9.9', isPackaged: false };
  let service = createService({ host });
  service.setWorkspace(setupWorkspace(dir, { persist: false }));
  fs.writeFileSync(path.join(service.workspace().workflows, 'fixture-service.yaml'), WORKFLOW);
  service.events.on('run:event', (ev) => { if (ev.type === 'approval.requested') setImmediate(() => service.api['approval:resolve']({ id: ev.approval_id, answer: true })); });
  const metaEvents = [];
  service.events.on('run:meta', (m) => metaEvents.push(m));
  const { runId } = await service.api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true });
  await untilTrue(() => !service.isRunning());

  const eventsPath = path.join(dir, 'runs', runId, 'events.jsonl');
  const before = fs.readFileSync(eventsPath, 'utf8');
  const out = service.api['runs:setTitle']({ runId, title: 'Notifications, 2nd try' });
  assert.equal(out.title, 'Notifications, 2nd try');
  assert.equal(fs.readFileSync(eventsPath, 'utf8'), before);
  assert.ok(metaEvents.some((m) => m.runId === runId && m.title === 'Notifications, 2nd try'));
  service.shutdown();

  service = createService({ host });
  service.setWorkspace(setupWorkspace(dir, { persist: false }));
  const run = service.api['runs:list']().runs.find((r) => r.runId === runId);
  assert.equal(run.title, 'Notifications, 2nd try');
  assert.equal(run.customTitle, 'Notifications, 2nd try');
  service.shutdown();
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
  host.setWorkspace(service.workspace());
  await assert.rejects(host.api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: false }), /Simulation only .*refusing to start a real run/);
  assert.throws(() => host.api['term:open']({ kind: 'cli-new', provider: 'claude' }), /Simulation only .*claude CLI/);
  assert.deepEqual(asked, []); // refused before the account check: nothing real was attempted
  assert.equal(host.isRunning(), false);
  assert.deepEqual(api['runs:list']().runs, []);
  assert.equal(api['app:info']().simulationOnly, true);
  // shares the index with `service`'s workspace: close it here, before makeService's own
  // teardown (registered earlier) removes the workspace folder.
  host.shutdown();
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
  // shares the index with `service`'s workspace: close it here, before makeService's own
  // teardown (registered earlier) removes the workspace folder.
  blocked.shutdown();
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
  // a push that succeeds is never a conflict notice
  assert.deepEqual(api['notifications:list']({}).items.filter((n) => n.type === 'run.conflict'), []);

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
  const changed = [];
  service.events.on('notifications:changed', (n) => changed.push(n));
  const u = await api['backlog:update-push']({ projectId: p.id });
  assert.deepEqual([u.conflict, u.files], [true, ['a.txt']]);
  assert.equal(git(folder, 'rev-parse', 'main'), mine);
  // the conflict (#69) is also a row of the notification center, whoever asked for the push
  assert.equal(changed.length, 1);
  const [conflict] = api['notifications:list']({}).items;
  assert.equal(conflict.type, 'run.conflict');
  assert.equal(conflict.projectId, p.id);
  assert.deepEqual(conflict.target, { view: 'backlog', projectId: p.id });
  assert.match(conflict.title, /Merge conflict: local/);
  assert.match(conflict.body, /Local main conflicts with origin in a\.txt/);

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
  await until(() => by()[53].runs[0]?.waiting === true);
  // simulated: waiting at a gate shows in the history but never moves the column
  assert.deepEqual([65, 53, 77].map((n) => [by()[n].column, by()[n].runs[0].runId, by()[n].runs[0].waiting]), [65, 53, 77].map(() => ['todo', run.runId, true]));
  assert.deepEqual(by()[53].runs[0].groupedWith, [65, 77]);

  api['approval:resolve']({ runId: run.runId, id: gates.get(run.runId), answer: true });
  await until(() => !service.isRunning());
  assert.deepEqual([65, 53, 77].map((n) => by()[n].column), ['todo', 'todo', 'todo']); // simulated: succeeded, but still just todo
  const recorded = api['runs:list']().runs.find((r) => r.runId === run.runId);
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

test('artifacts:evidence (runEvidence) resolves the manifest\'s relative paths to absolute files under the run folder, pair included (#146)', (t) => {
  const { api, service } = makeService(t);
  const run = path.join(service.workspace().runs, '20260101-000000-abcd1235');
  fs.mkdirSync(path.join(run, 'evidence', 'evidence', 'round-1'), { recursive: true });
  fs.writeFileSync(path.join(run, 'events.jsonl'), `${JSON.stringify({ seq: 1, type: 'workflow.started', run_id: '20260101-000000-abcd1235', workflow: 'software-development' })}\n`);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  fs.writeFileSync(path.join(run, 'evidence', 'evidence', 'round-1', '146-x-default.original.png'), png);
  fs.writeFileSync(path.join(run, 'evidence', 'evidence', 'round-1', '146-x-default.modified.png'), png);

  const m = api['artifacts:evidence']({ runId: '20260101-000000-abcd1235' });

  assert.equal(m.images.length, 2);
  const modified = m.images.find((x) => x.side === 'modified');
  const original = m.images.find((x) => x.side === 'original');
  assert.equal(modified.file, path.join(run, 'evidence', 'evidence', 'round-1', '146-x-default.modified.png'));
  assert.equal(modified.pair_file, original.file);
  assert.equal(original.pair_file, modified.file);
});

test('artifacts:evidence returns null for a run with no evidence and no legacy screenshots', (t) => {
  const { api, service } = makeService(t);
  const run = path.join(service.workspace().runs, '20260101-000000-abcd1236');
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, 'events.jsonl'), `${JSON.stringify({ seq: 1, type: 'workflow.started', run_id: '20260101-000000-abcd1236', workflow: 'software-development' })}\n`);
  assert.equal(api['artifacts:evidence']({ runId: '20260101-000000-abcd1236' }), null);
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

// #83: the restart banner and the safe-restart refusals.
test('app:codeVersion reports this process\'s own version, unchanged right after start', async (t) => {
  const { api } = makeService(t);
  const v = api['app:codeVersion']();
  assert.deepEqual(Object.keys(v).sort(), ['changed', 'disk', 'loaded', 'running'].sort());
  assert.equal(v.changed, false);
  assert.equal(v.disk, v.running);
});

async function untilTrue(fn) { for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => setTimeout(r, 20)); assert.ok(fn()); }

// Resolves the fixture workflow's human gate and waits for the run to leave runs:active, so no
// mock step keeps writing to the workspace after the test (and its t.after cleanup) is done.
async function finishPendingRun(api, runId) {
  await untilTrue(() => (api['runs:active']().find((r) => r.runId === runId)?.gates || []).length > 0);
  const [gate] = api['runs:active']().find((r) => r.runId === runId).gates;
  api['approval:resolve']({ runId, id: gate.approval_id, answer: true });
  await untilTrue(() => !api['runs:active']().some((r) => r.runId === runId));
}

test('prepareRestart refuses while a run start is still reserved (e.g. cloning its repository)', async (t) => {
  const { service: base } = makeService(t);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const service = createService({ host: { trashItem: async () => {}, appVersion: '0', isPackaged: false, assertCanRun: async () => { await gate; } } });
  service.setWorkspace(base.workspace());
  const starting = service.api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true });
  assert.throws(() => service.prepareRestart({ interruptRuns: true }), /starting/);
  release();
  const { runId } = await starting;
  await finishPendingRun(service.api, runId);
  // shares the index with `base`'s workspace: close it here, before makeService's own teardown
  // (registered earlier) removes the workspace folder.
  service.shutdown();
});

test('prepareRestart refuses with active runs unless confirmed; once confirmed it pauses the Backlog queues', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'service-restart-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const p = await api['projects:create']({ name: 'demo', folder });
  backlog.enqueue(ws.backlog, p.id, { issues: [{ number: 1, url: 'u1', title: 'T1', body: 'B1' }], workflow: 'fixture-service.yaml' });

  const { runId } = await api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true });
  assert.throws(() => service.prepareRestart(), /1 run is in progress.*confirm the restart/s);
  assert.equal(backlog.readQueue(ws.backlog, p.id).paused, false, 'refused: nothing paused yet');

  const result = service.prepareRestart({ interruptRuns: true });
  assert.deepEqual(result, { interrupted: [{ runId, workflow: 'fixture-service' }] });
  assert.equal(backlog.readQueue(ws.backlog, p.id).paused, true);
  await finishPendingRun(api, runId);
});

test('prepareRestart with no runs in progress needs no confirmation and still pauses queued Backlog work', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'service-restart-idle-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const p = await api['projects:create']({ name: 'demo', folder });
  backlog.enqueue(ws.backlog, p.id, { issues: [{ number: 1, url: 'u1', title: 'T1', body: 'B1' }], workflow: 'fixture-service.yaml' });

  assert.deepEqual(service.prepareRestart(), { interrupted: [] });
  assert.equal(backlog.readQueue(ws.backlog, p.id).paused, true);
});

// ---- #104 / #70: Show the diff and Run locally at a human_approval gate (developer_check) -------

// A human_approval gate with local_preview and diff_base, its work_dir taken straight from
// inputs.repo_path (no orchestrator.worktree needed for these tests).
const GATE_WORKFLOW = `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: gate-fixture
inputs:
  repo_path: { type: string, required: true }
  base_ref: { type: string, default: "" }
orchestrator:
  local_preview: { command: "git --version" }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: gate
    type: human_approval
    local_preview: true
    diff_base: "{{ inputs.base_ref }}"
    message: "Try it?"
    choices:
      - { id: approve, label: Approve }
      - { id: stop, label: Stop }
`;

// A throwaway repository with two commits: `base` is the first one, HEAD (a.txt gains a line) is the second.
function gitRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-git-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-gitcfg-'));
  t.after(() => fs.rmSync(cfgDir, { recursive: true, force: true }));
  const cfg = path.join(cfgDir, 'config');
  fs.writeFileSync(cfg, '');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  git('init', '-q');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  git('add', '.');
  git('commit', '-q', '-m', 'first');
  const base = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\ntwo\n');
  git('add', '.');
  git('commit', '-q', '-m', 'second');
  return { dir, base };
}

// Runs GATE_WORKFLOW in mock mode and resolves with its `approval.requested` event. Whatever the
// test does with it, the run is stopped and awaited before the next test's workspace is removed
// (the recorder would otherwise still be writing to it, see #37 process cleanup).
async function openGateFixture(t, service, api, repo) {
  const gateP = new Promise((resolve) => {
    const onEv = (ev) => { if (ev.type === 'approval.requested') { service.events.off('run:event', onEv); resolve(ev); } };
    service.events.on('run:event', onEv);
  });
  const { runId } = await api['run:start']({ file: 'gate-fixture.yaml', inputs: { repo_path: repo.dir, base_ref: repo.base }, mock: true });
  t.after(async () => {
    try { api['run:stop']({ runId }); } catch { /* already ended */ }
    await untilTrue(() => !api['runs:active']().some((r) => r.runId === runId));
  });
  return gateP;
}

// Resolves a still-open gate and waits for the run to leave runs:active (see finishPendingRun below).
async function resolveAndWait(api, runId, approvalId, answer) {
  api['approval:resolve']({ runId, id: approvalId, answer });
  await untilTrue(() => !api['runs:active']().some((r) => r.runId === runId));
}

test('term:open kind diff: refuses without an open gate, and one that does not offer a diff', async (t) => {
  const { service, api } = makeService(t);
  assert.throws(() => api['term:open']({ kind: 'diff', runId: 'nope', approvalId: 'a1' }), /The gate is no longer open\./);

  const gateP = new Promise((resolve) => service.events.on('run:event', (ev) => { if (ev.type === 'approval.requested') resolve(ev); }));
  const { runId } = await api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true }); // its "review" gate has no diff_base
  const gate = await gateP;
  assert.throws(() => api['term:open']({ kind: 'diff', runId, approvalId: gate.approval_id }), /This gate does not offer a diff\./);

  assert.equal(api['approval:resolve']({ runId, id: gate.approval_id, answer: true }), true);
  assert.throws(() => api['term:open']({ kind: 'diff', runId, approvalId: gate.approval_id }), /The gate is no longer open\./);
  await untilTrue(() => !api['runs:active']().some((r) => r.runId === runId));
});

test('term:open kind diff: streams the branch\'s changes since diff_base, read-only, in the gate\'s work_dir', async (t) => {
  const { service, api } = makeService(t);
  fs.writeFileSync(path.join(service.workspace().workflows, 'gate-fixture.yaml'), GATE_WORKFLOW);
  const repo = gitRepo(t);
  const gate = await openGateFixture(t, service, api, repo);
  assert.equal(gate.diff_base, repo.base);
  assert.equal(gate.work_dir, repo.dir);

  const out = [];
  service.events.on('term:data', (p) => out.push(p));
  const opened = api['term:open']({ kind: 'diff', runId: gate.run_id, approvalId: gate.approval_id });
  assert.equal(opened.cwd, repo.dir);
  await untilTrue(() => out.some((p) => p.id === opened.id && /two/.test(p.data)));
  const data = out.filter((p) => p.id === opened.id).map((p) => p.data).join('');
  assert.match(data, /a\.txt/);
  // a diff, never a rejected answer: Show the diff must not resolve the gate
  assert.equal(api['runs:active']().find((r) => r.runId === gate.run_id)?.gates.length, 1);
});

test('term:open kind diff: refuses a diff_base starting with "-" (git would read it as an option, not a ref)', async (t) => {
  const { service, api } = makeService(t);
  fs.writeFileSync(path.join(service.workspace().workflows, 'gate-fixture.yaml'), GATE_WORKFLOW);
  const repo = gitRepo(t);
  const gate = await openGateFixture(t, service, api, { dir: repo.dir, base: '--upload-pack=evil' });
  assert.equal(gate.diff_base, '--upload-pack=evil');
  assert.throws(() => api['term:open']({ kind: 'diff', runId: gate.run_id, approvalId: gate.approval_id }), /Not a ref: --upload-pack=evil/);
});

test('localPreview:start: offered only when the gate sets local_preview, runs in its work_dir, and never answers the gate', async (t) => {
  const { service, api } = makeService(t);
  fs.writeFileSync(path.join(service.workspace().workflows, 'gate-fixture.yaml'), GATE_WORKFLOW);
  const repo = gitRepo(t);

  // fixture-service.yaml's "review" gate has no local_preview
  const plainGateP = new Promise((resolve) => service.events.on('run:event', (ev) => { if (ev.type === 'approval.requested') resolve(ev); }));
  const { runId: plainRunId } = await api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true });
  const plainGate = await plainGateP;
  await assert.rejects(api['localPreview:start']({ runId: plainRunId, approvalId: plainGate.approval_id }), /This gate does not offer Run locally/);
  await resolveAndWait(api, plainRunId, plainGate.approval_id, true); // only one run at a time by default

  const gate = await openGateFixture(t, service, api, repo);
  assert.deepEqual(gate.local_preview, { command: 'git --version' });

  const events = [];
  service.events.on('run:event', (ev) => events.push(ev));
  // #115: the first run of a declared command (here the workflow's) still needs the owner's one-click confirmation
  await assert.rejects(api['localPreview:start']({ runId: gate.run_id, approvalId: gate.approval_id }), /Confirm the command first: git --version/);
  const preview = await api['localPreview:start']({ runId: gate.run_id, approvalId: gate.approval_id, confirm: true });
  assert.equal(preview.cwd, repo.dir);
  assert.deepEqual(api['localPreview:list']().map((p) => p.runId), [gate.run_id]);
  assert.ok(events.some((e) => e.type === 'local_preview.started' && e.dir === repo.dir), 'recorded in the run');
  // never answers the gate
  assert.equal(api['runs:active']().find((r) => r.runId === gate.run_id)?.gates.length, 1);

  // stopped when the gate is answered
  await resolveAndWait(api, gate.run_id, gate.approval_id, 'approve');
  assert.deepEqual(api['localPreview:list'](), []);
});

test('localPreview:stop: the Stop button ends the preview without answering the gate', async (t) => {
  const { service, api } = makeService(t);
  fs.writeFileSync(path.join(service.workspace().workflows, 'gate-fixture.yaml'), GATE_WORKFLOW);
  const repo = gitRepo(t);
  const gate = await openGateFixture(t, service, api, repo);
  // #115: the first run of a declared command still needs the owner's one-click confirmation
  await api['localPreview:start']({ runId: gate.run_id, approvalId: gate.approval_id, confirm: true });
  assert.equal(api['localPreview:stop']({ runId: gate.run_id }), true);
  assert.deepEqual(api['localPreview:list'](), []);
  assert.equal(api['localPreview:stop']({ runId: gate.run_id }), false, 'nothing left to stop');
  assert.equal(api['runs:active']().find((r) => r.runId === gate.run_id)?.gates.length, 1, 'the gate is still open');
  await resolveAndWait(api, gate.run_id, gate.approval_id, 'approve');
});

// ---- #108: Run App at a gate without a configured preview (localPreview:info / :start, gate:changes) ----

// local_preview: true on the gate, but no orchestrator.local_preview default: Run App is offered
// (run_app) with nothing to run until a project (or a one-off config) supplies a command.
const GATE_RUN_APP_WORKFLOW = `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: gate-run-app
inputs:
  repo_path: { type: string, required: true }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: gate
    type: human_approval
    local_preview: true
    message: "Try it?"
    choices:
      - { id: approve, label: Approve }
      - { id: stop, label: Stop }
`;

test('localPreview:info: without a project config it returns a suggestion read from the worktree; after projects:update it returns the project\'s, re-read without restarting the run', async (t) => {
  const { service, api } = makeService(t);
  fs.writeFileSync(path.join(service.workspace().workflows, 'gate-run-app.yaml'), GATE_RUN_APP_WORKFLOW);
  const repo = gitRepo(t);
  fs.writeFileSync(path.join(repo.dir, 'package.json'), JSON.stringify({ scripts: { start: 'node server.js' } }));
  const project = await api['projects:create']({ name: 'demo', folder: repo.dir });

  const gateP = new Promise((resolve) => service.events.on('run:event', (ev) => { if (ev.type === 'approval.requested') resolve(ev); }));
  const { runId } = await api['run:start']({ file: 'gate-run-app.yaml', inputs: { repo_path: repo.dir }, mock: true });
  const gate = await gateP;
  assert.equal(gate.run_app, true);
  assert.equal('local_preview' in gate, false);

  const before = await api['localPreview:info']({ runId, approvalId: gate.approval_id });
  assert.equal(before.config, null);
  assert.equal(before.source, null);
  assert.deepEqual(before.suggestion, { install: 'npm install', command: 'npm start', url: null, from: 'package.json (scripts.start)' });
  assert.equal(before.project.id, project.id);

  api['projects:update']({ id: project.id, patch: { localPreview: { install: null, command: 'git --version', url: null } } });
  const after = await api['localPreview:info']({ runId, approvalId: gate.approval_id });
  assert.deepEqual(after.config, { install: null, command: 'git --version', url: null });
  assert.equal(after.source, 'project');

  await resolveAndWait(api, runId, gate.approval_id, 'approve');
});

test('localPreview:start: refuses without a command; a one-off config arg runs on a project-less run', async (t) => {
  const { service, api } = makeService(t);
  fs.writeFileSync(path.join(service.workspace().workflows, 'gate-run-app.yaml'), GATE_RUN_APP_WORKFLOW);
  const repo = gitRepo(t); // no project matches this folder: the run has no project

  const gateP = new Promise((resolve) => service.events.on('run:event', (ev) => { if (ev.type === 'approval.requested') resolve(ev); }));
  const { runId } = await api['run:start']({ file: 'gate-run-app.yaml', inputs: { repo_path: repo.dir }, mock: true });
  const gate = await gateP;

  await assert.rejects(api['localPreview:start']({ runId, approvalId: gate.approval_id }), /No command to run/);

  const events = [];
  service.events.on('run:event', (ev) => events.push(ev));
  const preview = await api['localPreview:start']({ runId, approvalId: gate.approval_id, config: { command: 'git --version' } });
  assert.equal(preview.cwd, repo.dir);
  assert.ok(events.some((e) => e.type === 'local_preview.started' && e.command === 'git --version'));
  assert.equal(api['runs:active']().find((r) => r.runId === runId)?.gates.length, 1, 'starting it never answers the gate');

  await resolveAndWait(api, runId, gate.approval_id, 'approve');
});

// ---- #119: localPreview:info's install state, and the terminal's first line agreeing with it ------

test('localPreview:info: install.state is "none" for a config with no install command, "will-run" with no node_modules, "skipped" once installed, and follows the suggestion without any config at all', async (t) => {
  const { service, api } = makeService(t);
  fs.writeFileSync(path.join(service.workspace().workflows, 'gate-run-app.yaml'), GATE_RUN_APP_WORKFLOW);
  const repo = gitRepo(t);
  fs.writeFileSync(path.join(repo.dir, 'package.json'), JSON.stringify({ scripts: { start: 'node server.js' } }));
  const project = await api['projects:create']({ name: 'demo', folder: repo.dir });

  const gateP = new Promise((resolve) => service.events.on('run:event', (ev) => { if (ev.type === 'approval.requested') resolve(ev); }));
  const { runId } = await api['run:start']({ file: 'gate-run-app.yaml', inputs: { repo_path: repo.dir }, mock: true });
  const gate = await gateP;

  // no config at all: the install state follows the prefilled suggestion (a package.json with no lockfile: npm install)
  const noConfig = await api['localPreview:info']({ runId, approvalId: gate.approval_id });
  assert.equal(noConfig.suggestion.install, 'npm install');
  assert.equal(noConfig.install.state, 'will-run', 'no node_modules yet: the suggested install would run');

  // a config with a command but no install: 'none', never "will run"
  api['projects:update']({ id: project.id, patch: { localPreview: { command: 'git --version' } } });
  const noInstall = await api['localPreview:info']({ runId, approvalId: gate.approval_id });
  assert.equal(noInstall.install.state, 'none');

  // a config with an install command, but no node_modules yet: 'will-run'
  api['projects:update']({ id: project.id, patch: { localPreview: { install: 'npm ci', command: 'git --version' } } });
  const willRun = await api['localPreview:info']({ runId, approvalId: gate.approval_id });
  assert.equal(willRun.install.state, 'will-run');
  assert.match(willRun.install.text, /missing/);

  // node_modules already there, lockfile unchanged: 'skipped'
  fs.mkdirSync(path.join(repo.dir, 'node_modules'));
  fs.writeFileSync(path.join(repo.dir, 'package-lock.json'), '{}');
  const skipped = await api['localPreview:info']({ runId, approvalId: gate.approval_id });
  assert.equal(skipped.install.state, 'skipped');

  await resolveAndWait(api, runId, gate.approval_id, 'approve');
});

test('startLocalPreview: the terminal\'s first line announces the same install state localPreview:info reports for the same config', async (t) => {
  const { service, api } = makeService(t);
  fs.writeFileSync(path.join(service.workspace().workflows, 'gate-run-app.yaml'), GATE_RUN_APP_WORKFLOW);
  const repo = gitRepo(t);
  fs.writeFileSync(path.join(repo.dir, 'package.json'), JSON.stringify({ scripts: { start: 'node server.js' } }));
  // a harmless, fast "install": no real npm call in a test
  const project = await api['projects:create']({ name: 'demo', folder: repo.dir });
  api['projects:update']({ id: project.id, patch: { localPreview: { install: 'node -e "0"', command: 'git --version' } } });

  const gateP = new Promise((resolve) => service.events.on('run:event', (ev) => { if (ev.type === 'approval.requested') resolve(ev); }));
  const { runId } = await api['run:start']({ file: 'gate-run-app.yaml', inputs: { repo_path: repo.dir }, mock: true });
  const gate = await gateP;

  const info = await api['localPreview:info']({ runId, approvalId: gate.approval_id });
  assert.equal(info.install.state, 'will-run');

  const out = [];
  service.events.on('term:data', (p) => out.push(p));
  const opened = await api['localPreview:start']({ runId, approvalId: gate.approval_id });
  await untilTrue(() => out.some((p) => p.id === opened.id && p.data.includes('Run App:')));
  const data = out.filter((p) => p.id === opened.id).map((p) => p.data).join('');
  assert.ok(data.includes(`Run App: ${info.install.text}`), `the terminal's first line does not match localPreview:info's install text:\n${data}`);

  await resolveAndWait(api, runId, gate.approval_id, 'approve');
});

// ---- #114: clipboard copy only accepts a run's own artifacts, inside the workspace or its project's folder ----

test('existingArtifact: accepts a file inside the run\'s own folder; refuses anything that is not a recorded artifact', async (t) => {
  const { service, api } = makeService(t);
  const gateP = new Promise((resolve) => service.events.on('run:event', (ev) => { if (ev.type === 'approval.requested') resolve(ev); }));
  const { runId } = await api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true });
  const gate = await gateP;

  // the recorder's events.jsonl is opened asynchronously: the run folder itself exists synchronously
  const runDir = path.join(service.workspace().runs, runId);
  const inside = path.join(runDir, 'documents', 'report.md');
  fs.mkdirSync(path.dirname(inside), { recursive: true });
  fs.writeFileSync(inside, '# report');
  assert.equal(service.existingArtifact(inside).path, inside);

  assert.throws(() => service.existingArtifact(path.join(os.tmpdir(), 'never-recorded.txt')), /Not an artifact of any run/);

  await resolveAndWait(api, runId, gate.approval_id, true);
});

test('existingArtifact: also accepts a file recorded outside the run folder when it is inside the run\'s project folder (a project copy); refuses anywhere else', async (t) => {
  const { service, api } = makeService(t);
  fs.writeFileSync(path.join(service.workspace().workflows, 'gate-run-app.yaml'), GATE_RUN_APP_WORKFLOW);
  const repo = gitRepo(t);
  await api['projects:create']({ name: 'demo', folder: repo.dir });

  const gateP = new Promise((resolve) => service.events.on('run:event', (ev) => { if (ev.type === 'approval.requested') resolve(ev); }));
  const { runId } = await api['run:start']({ file: 'gate-run-app.yaml', inputs: { repo_path: repo.dir }, mock: true });
  const gate = await gateP;
  const runDir = path.join(service.workspace().runs, runId);
  // the recorder's events.jsonl is opened asynchronously: wait for its first line before appending
  const eventsFile = path.join(runDir, 'events.jsonl');
  await untilTrue(() => { try { return fs.readFileSync(eventsFile, 'utf8').trim().length > 0; } catch { return false; } });

  const projectCopy = path.join(repo.dir, 'prd.md');
  fs.writeFileSync(projectCopy, '# PRD');
  fs.appendFileSync(path.join(runDir, 'events.jsonl'), `${JSON.stringify({ type: 'file.saved', path: projectCopy, step_id: 'gate' })}\n`);
  assert.equal(service.existingArtifact(projectCopy).path, projectCopy, 'inside the project\'s own folder: accepted');

  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-outside-'));
  t.after(() => fs.rmSync(outsideDir, { recursive: true, force: true }));
  const bad = path.join(outsideDir, 'secret.txt');
  fs.writeFileSync(bad, 'nope');
  fs.appendFileSync(path.join(runDir, 'events.jsonl'), `${JSON.stringify({ type: 'file.saved', path: bad, step_id: 'gate' })}\n`);
  assert.throws(() => service.existingArtifact(bad), /Outside the workspace and the project's folder/);

  await resolveAndWait(api, runId, gate.approval_id, 'approve');
});

// ---- #115: the owner confirms a declared/detected run command once; an edited one asks again -------

test('Run App: a command the repository declares needs the owner\'s confirmation once; editing it asks again; the project\'s own override needs no confirmation', async (t) => {
  const { service, api } = makeService(t);
  fs.writeFileSync(path.join(service.workspace().workflows, 'gate-run-app.yaml'), GATE_RUN_APP_WORKFLOW);
  const repo = gitRepo(t);
  fs.mkdirSync(path.join(repo.dir, '.multiagent'));
  fs.writeFileSync(path.join(repo.dir, '.multiagent', 'local-preview.yaml'), 'command: git --version\n');
  const project = await api['projects:create']({ name: 'demo', folder: repo.dir });

  const gateP = new Promise((resolve) => service.events.on('run:event', (ev) => { if (ev.type === 'approval.requested') resolve(ev); }));
  const { runId } = await api['run:start']({ file: 'gate-run-app.yaml', inputs: { repo_path: repo.dir }, mock: true });
  const gate = await gateP;

  const info = await api['localPreview:info']({ runId, approvalId: gate.approval_id });
  assert.equal(info.source, 'repo');
  assert.equal(info.confirmed, false, 'a declared command not yet confirmed for this project');
  assert.equal(info.changed, false, 'never confirmed before: it is new, not "changed"');

  await assert.rejects(api['localPreview:start']({ runId, approvalId: gate.approval_id }), /Confirm the command first: git --version/);
  const events = [];
  service.events.on('run:event', (ev) => events.push(ev));
  await api['localPreview:start']({ runId, approvalId: gate.approval_id, confirm: true });
  assert.ok(events.some((e) => e.type === 'local_preview.started' && e.command === 'git --version'));
  assert.equal(api['projects:list']().find((p) => p.id === project.id)?.localPreviewConfirmed, info.fingerprint);
  assert.equal(api['localPreview:stop']({ runId }), true);

  const confirmedInfo = await api['localPreview:info']({ runId, approvalId: gate.approval_id });
  assert.equal(confirmedInfo.confirmed, true, 'confirmed for this exact command now');

  // the owner edits the repository's declared command (a new commit): it asks again
  fs.writeFileSync(path.join(repo.dir, '.multiagent', 'local-preview.yaml'), 'command: git status\n');
  const changedInfo = await api['localPreview:info']({ runId, approvalId: gate.approval_id });
  assert.equal(changedInfo.confirmed, false);
  assert.equal(changedInfo.changed, true, 'the declared command changed since it was confirmed');
  await assert.rejects(api['localPreview:start']({ runId, approvalId: gate.approval_id }), /Confirm the command first: git status/);

  // the project's own override always wins, and needs no confirmation of its own
  api['projects:update']({ id: project.id, patch: { localPreview: { command: 'git log -1' } } });
  const overrideInfo = await api['localPreview:info']({ runId, approvalId: gate.approval_id });
  assert.equal(overrideInfo.source, 'project');
  assert.equal(overrideInfo.confirmed, true);

  await resolveAndWait(api, runId, gate.approval_id, 'approve');
});

test('gate:changes: the files changed since the gate\'s diff_base, added/deleted per file; refuses on a non-git folder', async (t) => {
  const { service, api } = makeService(t);
  fs.writeFileSync(path.join(service.workspace().workflows, 'gate-fixture.yaml'), GATE_WORKFLOW);
  const repo = gitRepo(t);
  const gate = await openGateFixture(t, service, api, repo);
  const changes = await api['gate:changes']({ runId: gate.run_id, approvalId: gate.approval_id });
  assert.deepEqual(changes, [{ file: 'a.txt', added: 1, deleted: 0 }]);
  await resolveAndWait(api, gate.run_id, gate.approval_id, 'approve');

  const plainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-notgit-'));
  t.after(() => fs.rmSync(plainDir, { recursive: true, force: true }));
  const notGitGate = await openGateFixture(t, service, api, { dir: plainDir, base: 'HEAD' });
  await assert.rejects(api['gate:changes']({ runId: notGitGate.run_id, approvalId: notGitGate.approval_id }), /not a git repository/);
  await resolveAndWait(api, notGitGate.run_id, notGitGate.approval_id, 'approve');
});

test('term:open kind diff: a `file` opens that file\'s diff only (git diff ... -- <file>)', async (t) => {
  const { service, api } = makeService(t);
  fs.writeFileSync(path.join(service.workspace().workflows, 'gate-fixture.yaml'), GATE_WORKFLOW);
  const repo = gitRepo(t);
  // a second, untouched file: its diff must not show up when the gate's tool asks for a.txt only
  fs.writeFileSync(path.join(repo.dir, 'b.txt'), 'other\n');
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '.'], { cwd: repo.dir });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'third'], { cwd: repo.dir });
  const gate = await openGateFixture(t, service, api, repo);

  const out = [];
  service.events.on('term:data', (p) => out.push(p));
  const opened = api['term:open']({ kind: 'diff', runId: gate.run_id, approvalId: gate.approval_id, file: 'a.txt' });
  await untilTrue(() => out.some((p) => p.id === opened.id && /two/.test(p.data)));
  const data = out.filter((p) => p.id === opened.id).map((p) => p.data).join('');
  assert.match(data, /a\.txt/);
  assert.doesNotMatch(data, /b\.txt/);
  await resolveAndWait(api, gate.run_id, gate.approval_id, 'approve');
});

// ---- Backlog roadmap (#106): ordered stages of runs, each after the previous one merged -------
const roadmapModel = require('../src/roadmap');
const roadmapIssue = (number) => ({ number, title: `Issue ${number}`, state: 'open', url: `https://github.com/o/r/issues/${number}`, body: 'Do it', labels: [], assignees: [], tasks: { done: 0, total: 0 } });

function roadmapProject(api, ws, t, numbers, name) {
  return (async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), `service-${name}-`));
    t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
    const p = await api['projects:create']({ name: 'demo', folder });
    fs.mkdirSync(ws.backlog, { recursive: true });
    fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({ projectId: p.id, platform: 'github', repo: 'https://github.com/o/r', issues: numbers.map(roadmapIssue) }));
    return p;
  })();
}

test('roadmap: stage 2 starts only after every stage-1 item succeeds and merges', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1, 2, 3], 'roadmap-order');
  api['settings:set']({ concurrentRuns: { enabled: true, max: 2, perProject: null, countSimulations: true } });
  const { gates, finished } = watchRuns(service);

  await api['roadmap:save']({
    projectId: p.id,
    stages: [
      { name: 'Stage one', items: [{ workflow: 'fixture-issue.yaml', number: 1, mock: true }, { workflow: 'fixture-issue.yaml', number: 2, mock: true }] },
      { name: 'Stage two', items: [{ workflow: 'fixture-issue.yaml', number: 3, mock: true }] },
    ],
  });
  await api['roadmap:start']({ projectId: p.id, simulated: true });

  await until(() => api['runs:active']().length === 2);
  assert.deepEqual(api['runs:active']().flatMap((r) => r.issues.map((i) => i.number)).sort(), [1, 2]);
  assert.equal(api['roadmap:get']({ projectId: p.id }).stages[1].items[0].status, 'planned'); // stage 2 has not started

  await until(() => gates.size === 2);
  for (const [runId, id] of gates) api['approval:resolve']({ runId, id, answer: true });
  await until(() => finished.size === 2);

  await until(() => api['runs:active']().some((r) => r.issues.some((i) => i.number === 3)));
  let roadmap = api['roadmap:get']({ projectId: p.id });
  assert.ok(roadmap.stages[0].items.every((x) => x.status === 'done'));
  assert.equal(roadmap.stages[1].items[0].status, 'running');

  const runId3 = api['runs:active']()[0].runId;
  await until(() => gates.has(runId3));
  api['approval:resolve']({ runId: runId3, id: gates.get(runId3), answer: true });
  await until(() => api['roadmap:get']({ projectId: p.id }).state === 'done');
});

test('roadmap: starting for real (not simulated) is refused in simulation-only mode', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1], 'roadmap-real');

  await api['roadmap:save']({ projectId: p.id, stages: [{ items: [{ workflow: 'fixture-issue.yaml', number: 1 }] }] });
  await assert.rejects(api['roadmap:start']({ projectId: p.id, simulated: false }), /Simulation only/);
  assert.equal(api['roadmap:get']({ projectId: p.id }).state, 'planned');
  assert.equal(service.isRunning(), false);
});

test('roadmap: a stopped run pauses the roadmap; roadmap:item retry restarts it', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1, 2], 'roadmap-fail');
  const { gates } = watchRuns(service);

  await api['roadmap:save']({
    projectId: p.id,
    stages: [{ items: [{ workflow: 'fixture-issue.yaml', number: 1, mock: true }] }, { items: [{ workflow: 'fixture-issue.yaml', number: 2, mock: true }] }],
  });
  await api['roadmap:start']({ projectId: p.id, simulated: true });
  await until(() => api['runs:active']().length === 1);
  api['run:stop']({ runId: api['runs:active']()[0].runId });
  await until(() => api['roadmap:get']({ projectId: p.id }).state === 'paused');

  let roadmap = api['roadmap:get']({ projectId: p.id });
  assert.match(roadmap.error, /#1/);
  const failedId = roadmap.pausedBy;
  assert.ok(failedId);
  assert.equal(roadmap.stages[0].items[0].status, 'failed');

  await api['roadmap:item']({ projectId: p.id, itemId: failedId, action: 'retry' });
  await until(() => api['runs:active']().length === 1);
  roadmap = api['roadmap:get']({ projectId: p.id });
  assert.equal(roadmap.state, 'running');
  assert.equal(roadmap.stages[0].items[0].status, 'running');

  const active = api['runs:active']()[0];
  await until(() => gates.has(active.runId));
  api['approval:resolve']({ runId: active.runId, id: gates.get(active.runId), answer: true });
});

test('roadmap: Retry on an item whose run is still alive is refused, naming the run; Skip is refused too', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1], 'roadmap-live-retry');

  await api['roadmap:save']({ projectId: p.id, stages: [{ items: [{ workflow: 'fixture-issue.yaml', number: 1, mock: true }] }] });
  const itemId = api['roadmap:get']({ projectId: p.id }).stages[0].items[0].id;
  await api['roadmap:start']({ projectId: p.id, simulated: true });
  await until(() => api['runs:active']().length === 1);
  const runId = api['runs:active']()[0].runId;
  assert.equal(api['roadmap:get']({ projectId: p.id }).stages[0].items[0].status, 'running');

  await assert.rejects(api['roadmap:item']({ projectId: p.id, itemId, action: 'retry' }), new RegExp(`Run ${runId} is still running\\.`));
  await assert.rejects(api['roadmap:item']({ projectId: p.id, itemId, action: 'skip' }), /in progress/);
  // refusing it changed nothing: still the same run, still running
  assert.equal(api['roadmap:get']({ projectId: p.id }).stages[0].items[0].runId, runId);
  assert.equal(api['runs:active']().length, 1);

  api['run:stop']({ runId });
});

test('roadmap: Run this stage (scope) starts only that stage\'s items; once it is done the roadmap pauses as "Stage N done" leaving the others planned, and Start afterwards resumes from stage 1', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1, 2, 3], 'roadmap-scope');
  const { gates, finished } = watchRuns(service);
  const notified = [];
  service.events.on('notify', (n) => notified.push(n));

  await api['roadmap:save']({
    projectId: p.id,
    stages: [
      { name: 'Stage one', items: [{ workflow: 'fixture-issue.yaml', number: 1, mock: true }] },
      { name: 'Stage two', items: [{ workflow: 'fixture-issue.yaml', number: 2, mock: true }] },
      { name: 'Stage three', items: [{ workflow: 'fixture-issue.yaml', number: 3, mock: true }] },
    ],
  });
  const stage2 = api['roadmap:get']({ projectId: p.id }).stages[1].id;
  await api['roadmap:start']({ projectId: p.id, simulated: true, stage: stage2 });

  await until(() => api['runs:active']().length === 1);
  assert.deepEqual(api['runs:active']()[0].issues.map((i) => i.number), [2]); // only stage 2 started
  let roadmap = api['roadmap:get']({ projectId: p.id });
  assert.deepEqual(roadmap.scope, { stage: stage2 });
  assert.equal(roadmap.stages[0].items[0].status, 'planned');
  assert.equal(roadmap.stages[2].items[0].status, 'planned');

  const runId2 = api['runs:active']()[0].runId;
  await until(() => gates.has(runId2));
  api['approval:resolve']({ runId: runId2, id: gates.get(runId2), answer: true });
  await until(() => finished.has(runId2));

  await until(() => api['roadmap:get']({ projectId: p.id }).state === 'paused');
  roadmap = api['roadmap:get']({ projectId: p.id });
  assert.equal(roadmap.scope, null);
  assert.equal(roadmap.pausedBy, null);
  assert.match(roadmap.error, /Stage two done/);
  assert.equal(roadmap.stages[0].items[0].status, 'planned'); // stage 1: still planned
  assert.equal(roadmap.stages[1].items[0].status, 'done');
  assert.equal(roadmap.stages[2].items[0].status, 'planned'); // stage 3: still planned
  assert.ok(notified.some((n) => n.title === 'Roadmap stage done'), 'notified the stage-only pause, not a failure');
  assert.ok(!notified.some((n) => n.title === 'Roadmap paused'));

  // Start (no stage) afterwards runs the whole roadmap, from its first unfinished stage
  await api['roadmap:start']({ projectId: p.id, simulated: true });
  await until(() => api['runs:active']().length === 1);
  assert.deepEqual(api['runs:active']()[0].issues.map((i) => i.number), [1]);
  const runId1 = api['runs:active']()[0].runId;
  await until(() => gates.has(runId1));
  api['approval:resolve']({ runId: runId1, id: gates.get(runId1), answer: true });
});

test('roadmap: a restart continues where it was, from a stage already finished on disk', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1, 2], 'roadmap-restart');

  roadmapModel.saveStages(ws.backlog, p.id, [
    { items: [{ workflow: 'fixture-issue.yaml', number: 1, mock: true }] },
    { items: [{ workflow: 'fixture-issue.yaml', number: 2, mock: true }] },
  ], { issues: [roadmapIssue(1), roadmapIssue(2)] });
  roadmapModel.setState(ws.backlog, p.id, 'running', { simulated: true });
  const item1 = roadmapModel.readRoadmap(ws.backlog, p.id).stages[0].items[0];
  roadmapModel.markStarted(ws.backlog, p.id, item1.id, { runId: 'run-old' });
  const runDir = path.join(ws.runs, 'run-old');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify({
    run_id: 'run-old', workflow: 'fixture-issue', project_id: p.id, status: 'success', mock: true,
    started_at: '2026-09-30T00:00:00Z', finished_at: '2026-09-30T00:05:00Z',
    issues: [{ number: 1, url: roadmapIssue(1).url, title: roadmapIssue(1).title }], inputs: {}, sessions: [],
  }));

  const service2 = createService({ host: { trashItem: async () => {}, appVersion: '9.9.9', isPackaged: false } });
  service2.setWorkspace(ws);
  // status is derived from the runs when read (withStatus, #112), not stored: read it the way the
  // UI does (roadmap:get), never raw off roadmapModel.readRoadmap
  await untilTrue(() => api['roadmap:get']({ projectId: p.id }).stages[1].items[0].status === 'running');
  const roadmap = api['roadmap:get']({ projectId: p.id });
  assert.equal(roadmap.stages[0].items[0].status, 'done');
  assert.equal(roadmap.stages[1].items[0].status, 'running');

  // whichever of the two live services (the original, still open, or this fresh one) reacted first
  // to the roadmap now on disk owns the resulting live run: stop it on both to leave nothing behind,
  // then close service2 here (it shares the index with `service`'s workspace) before makeService's
  // own teardown (registered earlier) removes the workspace folder.
  for (const s of [service, service2]) for (const run of s.api['runs:active']()) { try { s.api['run:stop']({ runId: run.runId }); } catch { /* already ended */ } }
  await untilTrue(() => service.api['runs:active']().length === 0 && service2.api['runs:active']().length === 0);
  service2.shutdown();
});

test('roadmap: a Product Owner proposal is added as planned and does not start by itself', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const p = await roadmapProject(api, ws, t, [1], 'roadmap-propose');

  const data = await api['roadmap:propose']({ projectId: p.id, proposal: { stages: [{ name: 'From the PO', items: [{ workflow: 'fixture-issue.yaml', number: 1 }] }] } });
  assert.deepEqual(data.dropped, []);
  assert.equal(data.roadmap.state, 'planned');
  assert.equal(data.roadmap.stages[0].items[0].status, 'planned');
  assert.equal(service.isRunning(), false);
  assert.deepEqual(api['runs:list']().runs, []);
});

test('roadmap: assigning a planned issue elsewhere removes it from the roadmap', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1, 2], 'roadmap-conflict');

  await api['roadmap:save']({ projectId: p.id, stages: [{ items: [{ workflow: 'fixture-issue.yaml', number: 1 }, { workflow: 'fixture-issue.yaml', number: 2 }] }] });
  await api['backlog:assign']({ projectId: p.id, numbers: [1], workflow: 'fixture-issue.yaml', mock: true });
  const roadmap = api['roadmap:get']({ projectId: p.id });
  assert.deepEqual(roadmap.stages[0].items.map((i) => i.number), [2]);
});

test('roadmap: backlog:get issues carry their roadmap stage and status', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const p = await roadmapProject(api, ws, t, [1, 2], 'roadmap-badge');

  await api['roadmap:save']({ projectId: p.id, stages: [{ items: [{ workflow: 'fixture-issue.yaml', number: 1 }] }, { items: [{ workflow: 'fixture-issue.yaml', number: 2 }] }] });
  const data = api['backlog:get']({ projectId: p.id });
  const by = Object.fromEntries(data.issues.map((i) => [i.number, i]));
  assert.deepEqual([by[1].roadmap.stage, by[1].roadmap.status], [1, 'planned']);
  assert.deepEqual([by[2].roadmap.stage, by[2].roadmap.status], [2, 'planned']);
});

test('roadmap: reordering stages on save persists the new order', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const p = await roadmapProject(api, ws, t, [1, 2, 3], 'roadmap-reorder');

  const saved = await api['roadmap:save']({
    projectId: p.id,
    stages: [
      { items: [{ workflow: 'fixture-issue.yaml', number: 1 }] },
      { items: [{ workflow: 'fixture-issue.yaml', number: 2 }] },
      { items: [{ workflow: 'fixture-issue.yaml', number: 3 }] },
    ],
  });
  const [s1, s2, s3] = saved.roadmap.stages;
  const reordered = await api['roadmap:save']({
    projectId: p.id,
    stages: [{ id: s3.id, items: s3.items }, { id: s1.id, items: s1.items }, { id: s2.id, items: s2.items }],
  });
  assert.deepEqual(reordered.roadmap.stages.map((s) => s.items[0].number), [3, 1, 2]);
  assert.deepEqual(api['roadmap:get']({ projectId: p.id }).stages.map((s) => s.items[0].number), [3, 1, 2]);
});

// ---- Backlog issue enrichment: run:start records the issue, backlog:save-doc saves to it (#103) --

test('run:start forwards projectId and issues (sanitized), recorded in the run and shown by runs:list', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'service-enrich-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const p = await api['projects:create']({ name: 'demo', folder });
  const { runId } = await api['run:start']({
    file: 'writer-reviewer.yaml', inputs: { prompt: 'Enrich #29', goal: 'g' }, mock: true, projectId: p.id,
    issues: [{ number: 29, url: 'https://github.com/o/r/issues/29', title: 'Backlog screen', extra: 'dropped' }],
  });
  const run = api['runs:active']().find((r) => r.runId === runId);
  assert.equal(run.projectId, p.id);
  assert.deepEqual(run.issues, [{ number: 29, url: 'https://github.com/o/r/issues/29', title: 'Backlog screen' }]);
  api['run:stop']({ runId });
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
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), JSON.stringify({
    ts: '2026-01-01T00:00:00Z', type: 'workflow.started', workflow: 'writer-reviewer',
    issues: [{ number: 29, url: 'https://github.com/o/r/issues/29', title: 'T' }], mock: false,
  }) + '\n' + JSON.stringify({ ts: '2026-01-01T00:01:00Z', type: 'workflow.finished', status: 'success' }) + '\n');
  await assert.rejects(api['backlog:save-doc']({ runId: '20260101-000000-enrich0001', mode: 'replace', preview: false }), /Simulation only/);
});

test('backlog:save-doc: a run still in progress is refused', async (t) => {
  const { service, api } = makeService(t);
  const { runId } = await api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true });
  await until(() => api['runs:active']().some((r) => r.runId === runId && r.waiting > 0));
  await assert.rejects(api['backlog:save-doc']({ runId, mode: 'replace', preview: true }), /still in progress/);
  api['run:stop']({ runId });
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

// ---- One app per workspace: a second process never judges or duplicates the first's runs (#112) --

test('two services on one workspace: the second sees the first\'s active run as "running" (never interrupted); its roadmap advance leaves that item alone', async (t) => {
  // hooks run in the order they are added (see makeService above): both services' shutdown must be
  // registered before the dir removal, or the SQLite index they still hold open fails to unlink.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'service-twoapp-'));
  const a = createService({ host: { trashItem: async () => {}, appVersion: '9.9.9', isPackaged: false } });
  a.setWorkspace(setupWorkspace(dir, { persist: false }));
  const wsA = a.workspace();
  fs.writeFileSync(path.join(wsA.workflows, 'fixture-service.yaml'), WORKFLOW);
  t.after(async () => {
    for (const run of a.api['runs:active']()) { try { a.api['run:stop']({ runId: run.runId }); } catch { /* already ended */ } }
    await untilTrue(() => a.api['runs:active']().length === 0);
    a.shutdown();
  });

  const gateP = new Promise((resolve) => a.events.on('run:event', (ev) => { if (ev.type === 'approval.requested') resolve(ev); }));
  const { runId } = await a.api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true });
  await gateP; // a's run is now stuck at a gate, still active, owner.json held by this OS process

  // a second app process on the same host writes its own, different (but genuinely alive) pid there
  const ownerFile = path.join(wsA.runs, runId, 'owner.json');
  const owner = JSON.parse(fs.readFileSync(ownerFile, 'utf8'));
  fs.writeFileSync(ownerFile, JSON.stringify({ ...owner, pid: process.ppid }));

  const b = createService({ host: { trashItem: async () => {}, appVersion: '9.9.9', isPackaged: false } });
  t.after(() => b.shutdown());
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  b.setWorkspace(setupWorkspace(dir, { persist: false }));

  const seenByB = b.api['runs:list']().runs.find((r) => r.runId === runId);
  assert.equal(seenByB.status, 'running');
  assert.deepEqual(seenByB.runningElsewhere, { pid: process.ppid, host: owner.host });
  assert.deepEqual(b.api['runs:active'](), [], 'b never started or tracks this run itself');

  // a roadmap item that names a's live run: b's advance must never fail it as "interrupted", or start a twin
  const roadmapModel = require('../src/roadmap');
  roadmapModel.writeRoadmap(wsA.backlog, 'proj-twoapp', {
    state: 'running', simulated: false, error: null, pausedBy: null, updatedAt: null,
    stages: [{
      id: 's1',
      items: [{
        id: 'i1', workflow: 'fixture-service.yaml', workflowName: 'w', inputs: {}, mock: true,
        number: 1, url: 'https://github.com/o/r/issues/1', title: '#1', body: '', knownPullRequests: [],
        status: 'planned', runId, runs: [runId], error: null,
      }],
    }],
  });
  await until(() => b.api['roadmap:get']({ projectId: 'proj-twoapp' }).stages[0].items[0].status === 'running');
  const roadmap = b.api['roadmap:get']({ projectId: 'proj-twoapp' });
  assert.equal(roadmap.state, 'running');
  assert.equal(roadmap.pausedBy, null);
  assert.deepEqual(b.api['runs:active'](), [], 'advancing the roadmap in b never started a duplicate run');
});
