// Shared scratch workspace, fake host and fixtures for test/service/<area>.test.js (#156). Not a
// test file itself (no *.test.js suffix): scripts/test.js never runs it directly.

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { setupWorkspace } = require('../../src/domains/workspace/workspace');
const { createService } = require('../../src/service');

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

// ---- Resume from step… (#100) fixture, shared with the Sessions screen's token tests -----------
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

// The engine service with a temporary workspace and a host that records what it was asked to do.
// Cleanup order matters: a run left open at a gate (e.g. by openGateFixture below) is still
// writing to the workspace, so this single hook stops every run still active first, then shuts
// the service down and only then removes the workspace directory. node:test runs t.after hooks
// in the order they were added, so registering this before any test-specific hook (which may
// also try to stop the same run, harmlessly, once it is already gone) keeps rmSync last.
// #408: the CLIs' transcripts are read from an empty home of the test (host.cliHome), never from the
// machine's ~/.claude, ~/.codex and ~/.grok (slow, and different on every machine).
function makeService(t, hostExtra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'service-ws-'));
  const cliHome = fs.mkdtempSync(path.join(os.tmpdir(), 'service-cli-home-'));
  process.env.MULTIAGENT_SIMULATION_ONLY = '1'; // tests never call real models
  process.env.MULTIAGENT_MOCK_DELAY_SCALE ??= '0.05';
  const trashed = [];
  const service = createService({ host: { trashItem: async (p) => { trashed.push(p); }, appVersion: '9.9.9', isPackaged: false, cliHome, ...hostExtra } });
  t.after(async () => {
    for (const run of service.api['runs:active']()) {
      try { service.api['run:stop']({ runId: run.runId }); } catch { /* already ended */ }
    }
    await untilIdle(service);
    service.shutdown();
  });
  t.after(() => removeHeldDir(dir));
  t.after(() => fs.rmSync(cliHome, { recursive: true, force: true }));
  service.setWorkspace(setupWorkspace(dir, { persist: false }));
  fs.writeFileSync(path.join(service.workspace().workflows, 'fixture-service.yaml'), WORKFLOW);
  return { service, api: service.api, trashed };
}

function makeResumeService(t) {
  const { service, api } = makeService(t);
  fs.writeFileSync(path.join(service.workspace().workflows, 'fixture-resume.yaml'), RESUME_WORKFLOW);
  return { service, api };
}

// #452: a local preview runs in the repository (and its scratch workspace); a killed cmd.exe can hold
// the folder for seconds on Windows (EPERM), longer than rmSync's own maxRetries waited under coverage.
// Retries up to ~10 s, then throws the last error.
async function removeHeldDir(dir) {
  for (let i = 0; ; i++) {
    try { fs.rmSync(dir, { recursive: true, force: true }); return; } catch (e) {
      if (i >= 100 || !['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(e.code)) throw e;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

async function until(fn) { for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => setTimeout(r, 50)); assert.ok(fn()); }
async function untilTrue(fn) { for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => setTimeout(r, 20)); assert.ok(fn()); }

// Waits for the service's active runs to end, woken by its run events (a run that ends pushes one),
// not by a fixed poll: a run that is still going when the workspace is removed fails the file (#186).
// A deadline makes a run that never ends fail here, with its name, instead of hanging the file.
function untilIdle(service, timeoutMs = 60000) {
  const idle = () => service.api['runs:active']().length === 0;
  if (idle()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const check = () => { if (idle()) done(); };
    const onEv = () => setImmediate(check); // the run leaves runs:active right after its last event
    const timer = setTimeout(() => {
      service.events.off('run:event', onEv);
      reject(new Error(`runs still active after ${timeoutMs} ms: ${service.api['runs:active']().map((r) => r.runId).join(', ')}`));
    }, timeoutMs);
    function done() { clearTimeout(timer); service.events.off('run:event', onEv); resolve(); }
    service.events.on('run:event', onEv);
  });
}

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

// A throwaway repository with two commits: `base` is the first one, HEAD (a.txt gains a line) is the second.
function gitRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-git-'));
  t.after(() => removeHeldDir(dir));
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

// ---- Backlog roadmap (#106) fixtures, shared with the kept-work tests of resume.test.js ---------
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

module.exports = {
  WORKFLOW,
  ISSUE_WORKFLOW,
  RESUME_WORKFLOW,
  GATE_WORKFLOW,
  GATE_RUN_APP_WORKFLOW,
  makeService,
  makeResumeService,
  until,
  untilTrue,
  watchRuns,
  gitRepo,
  openGateFixture,
  resolveAndWait,
  roadmapIssue,
  roadmapProject,
};
