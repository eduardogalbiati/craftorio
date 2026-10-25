// #445 a failed run pauses the Backlog queue only when the queue started it, with a reason the screen
// translates, and a stale pause does not stay. Acceptance tests written before the code.
//
// The service side: packages/engine/service/areas/runs.js's afterRunFinished (what follows a run's
// workflow.finished) with the real packages/engine/domains/backlog/backlog.js on a scratch workspace (packages/engine/domains/workspace/workspace.js
// setupWorkspace). Real runs are refused in simulation and afterRunFinished is private, so the area
// is compiled from its own source with afterRunFinished added to what its factory returns, and called
// with a run object and its workflow.finished event; every ctx hook it calls besides `ws` is a no-op.
//   The run object's contract (the developer marks the queue's runs): a run the queue started carries
//   `fromQueue: true` (packages/engine/service/areas/backlog.js dispatchQueue passes it to startWorkflowRun); a
//   roadmap item's run does not, and its item names it (runId) in the roadmap file.
//   Like today, the queued item has left the queue when its run started (dispatchQueue unqueues it).
// The queue is read through its public read, backlog.readQueue(dir, projectId).
// The pause's reason: stored as `{ key, values: { issues: [n] } }` (an i18n key with the issue
// numbers), in `queue.reason` or `queue.error`, never the English sentence "#n failed: resume to
// start the next issues.".
//
// The renderer side: the whole page in the app harness (test/renderer-app-harness.js, as
// test/renderer-backlog-queue-alert-422.test.js), the interface language set as
// test/i18n-every-screen-330.test.js sets it; the Backlog's data carries the queue exactly as the
// service stored it above (so the test does not depend on the stored shape). The queue bar is the
// #bl-queue element (data-testid="queue-bar").
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { EventEmitter } = require('events');
const H = require('@multiagent/front-build/test/roadmap-status-helpers');
const { setupWorkspace } = require('@multiagent/engine/domains/workspace/workspace');
const backlog = require('@multiagent/engine/domains/backlog/backlog');
const roadmaps = require('@multiagent/engine/domains/roadmap/roadmap');

const PROJECT = 'p1';
const RUNS_AREA = path.join(__dirname, '..', '..', '..', '..', 'packages', 'engine', 'service', 'areas', 'runs.js');

// packages/engine/service/areas/runs.js compiled from its source, its factory also returning afterRunFinished
function loadRunsArea() {
  const src = fs.readFileSync(RUNS_AREA, 'utf8');
  const marker = '\n  return {';
  const at = src.lastIndexOf(marker);
  assert.ok(at > 0, 'the runs area\'s factory return was not found: the source moved');
  const patched = `${src.slice(0, at)}\n  return { afterRunFinished,${src.slice(at + marker.length)}`;
  const m = new Module(RUNS_AREA, module);
  m.filename = RUNS_AREA;
  m.paths = Module._nodeModulePaths(path.dirname(RUNS_AREA));
  m._compile(patched, RUNS_AREA);
  return m.exports;
}

// a scratch workspace and the runs area on it: { ws, area, finish(run, status) }
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-pause-445-'));
  const ws = setupWorkspace(dir, { persist: false });
  fs.mkdirSync(ws.backlog, { recursive: true });
  const base = { ws, events: new EventEmitter(), store: null };
  const ctx = new Proxy(base, {
    get(target, key) {
      if (key in target) return target[key];
      if (typeof key !== 'string' || key === 'then') return undefined;
      return () => Promise.resolve(); // every other hook: a no-op
    },
  });
  const area = loadRunsArea()(ctx);
  assert.equal(typeof area.afterRunFinished, 'function', 'afterRunFinished in packages/engine/service/areas/runs.js');
  t.after(() => {
    area.stopDispatchTimers?.();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const finish = (run, status) => area.afterRunFinished(run, { type: 'workflow.finished', run_id: run.runId, status, error: status === 'failed' ? 'step work failed' : null });
  return { ws, area, finish };
}

const ref = (number) => ({ number, title: `Issue ${number}`, url: `https://github.com/o/r/issues/${number}` });
const run = (runId, numbers, extra = {}) => ({
  runId, projectId: PROJECT, issues: numbers.map(ref), mock: false, inputs: {}, file: 'w.yaml',
  wf: { metadata: { name: 'fixture' } }, ctx: { steps: {} }, ...extra,
});
const queueRun = (runId, numbers) => run(runId, numbers, { fromQueue: true });
// the queue with other issues waiting (the failed one left it when its run started)
const enqueue = (ws, numbers) => backlog.enqueue(ws.backlog, PROJECT, { issues: numbers.map((n) => ({ ...ref(n), body: '' })), workflow: 'w.yaml' });
const read = (ws) => backlog.readQueue(ws.backlog, PROJECT);
// the synced Backlog (packages/engine/domains/backlog/backlog.js's <id>.json) with these issues and states
const syncedBacklog = (ws, issues) => fs.writeFileSync(path.join(ws.backlog, `${PROJECT}.json`), JSON.stringify({
  projectId: PROJECT, platform: 'github', repo: 'https://github.com/o/r',
  issues: issues.map(([number, state]) => ({ ...ref(number), state, body: '', labels: [], assignees: [], tasks: { done: 0, total: 0 } })),
}));

// ---- 1, 2. which failure pauses the queue ---------------------------------------------------------------

test('#445 a failed roadmap item run (not started from the queue) leaves the queue unpaused, with no error', (t) => {
  const { ws, finish } = setup(t);
  enqueue(ws, [331]);
  roadmaps.writeRoadmap(ws.backlog, PROJECT, {
    state: 'running', simulated: false, error: null, pausedBy: null, updatedAt: null,
    stages: [{ id: 's1', items: [{ id: 'i1', workflow: 'w.yaml', workflowName: 'w', inputs: {}, mock: false, ...ref(330), body: '', knownPullRequests: [], status: 'failed', runId: 'run-rm', runs: ['run-rm'], error: 'step work failed' }] }],
  });
  finish(run('run-rm', [330]), 'failed');
  const q = read(ws);
  assert.equal(q.paused, false, 'the queue keeps going');
  assert.equal(q.error ?? null, null, 'and has no error');
  assert.equal(q.items.length, 1, 'its item is still waiting');
});

test('#445 guard (already so today): a failed run the queue started pauses the queue', (t) => {
  const { ws, finish } = setup(t);
  enqueue(ws, [331]);
  finish(queueRun('run-q', [330]), 'failed');
  assert.equal(read(ws).paused, true);
});

// ---- 3. the reason is a key with its issue numbers --------------------------------------------------------

test('#445 the pause\'s reason is stored as a key with the issue numbers, not an English sentence', (t) => {
  const { ws, finish } = setup(t);
  enqueue(ws, [331]);
  finish(queueRun('run-q', [330]), 'failed');
  const q = read(ws);
  assert.equal(q.paused, true, 'paused (fixture check)');
  assert.ok(!(typeof q.error === 'string' && /resume to start/i.test(q.error)), `not the English sentence: ${JSON.stringify(q.error)}`);
  const reason = q.reason && typeof q.reason === 'object' ? q.reason : q.error;
  assert.equal(typeof reason, 'object', `a structured reason in queue.reason or queue.error: ${JSON.stringify({ reason: q.reason, error: q.error })}`);
  assert.notEqual(reason, null);
  assert.equal(typeof reason.key, 'string', 'an i18n key');
  assert.doesNotMatch(reason.key, /\s/, `a key, not a sentence: ${reason.key}`);
  assert.equal(JSON.stringify((reason.values?.issues || []).map(Number)), JSON.stringify([330]), `values.issues names #330: ${JSON.stringify(reason.values)}`);
});

// ---- 4. a stale pause does not stay -------------------------------------------------------------------------

test('#445 a failure never leaves an empty queue paused', (t) => {
  const { ws, finish } = setup(t);
  finish(queueRun('run-q', [330]), 'failed'); // nothing else waits
  const q = read(ws);
  assert.equal(q.items.length, 0, 'empty (fixture check)');
  assert.equal(q.paused, false, 'an empty queue is not paused by a failure');
});

test('#445 a queue paused by #330\'s failure is no longer paused once #330 is done', (t) => {
  const { ws, finish } = setup(t);
  enqueue(ws, [331]);
  finish(queueRun('run-q', [330]), 'failed');
  assert.equal(read(ws).paused, true, 'paused by the failure (fixture check)');
  // #330 done: its later run succeeded and the issue is closed on the platform (the synced Backlog)
  syncedBacklog(ws, [[330, 'closed'], [331, 'open']]);
  finish(run('run-again', [330]), 'success');
  const q = read(ws);
  assert.equal(q.paused, false, 'the pause named an issue that is done: it no longer holds the queue');
  assert.equal(q.items.length, 1, '#331 still waits');
});

test('#445 a queue paused by a failure is no longer paused once its last waiting item is taken out', (t) => {
  const { ws, finish } = setup(t);
  enqueue(ws, [331]);
  finish(queueRun('run-q', [330]), 'failed');
  assert.equal(read(ws).paused, true, 'paused by the failure (fixture check)');
  backlog.unqueue(ws.backlog, PROJECT, 331);
  const q = read(ws);
  assert.equal(q.items.length, 0);
  assert.equal(q.paused, false, 'an empty queue is never left paused by a failure');
});

// ---- 5. the Backlog screen ------------------------------------------------------------------------------------

// the queue as the service stores it after #330, started from the queue, failed (#331 waiting)
function failedQueue(t) {
  const { ws, finish } = setup(t);
  enqueue(ws, [331]);
  finish(queueRun('run-q', [330]), 'failed');
  return JSON.parse(JSON.stringify(read(ws)));
}

const issueCard = (number) => ({
  number, title: `Issue ${number}`, state: 'open', column: 'todo', labels: [], assignees: [], author: 'eduardo', body: '',
  url: `https://github.com/o/r/issues/${number}`, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-10T00:00:00Z',
  tasks: { total: 0, done: 0 }, runs: [], pullRequests: [],
});
const backlogData = (queue) => ({
  platform: 'github', syncedAt: '2026-10-04T00:00:00Z', issues: [issueCard(330), issueCard(331)], epics: [],
  local: { ahead: 0, behind: 0, base: 'main', issues: [], commits: [] }, queue,
});

async function backlogPage(lang, data) {
  const { loadApp } = require('@multiagent/ui-kit/test/renderer-app-harness');
  const app = loadApp({
    storage: { interfaceLanguage: lang, 'multiagent.backlogProject': PROJECT, 'multiagent.currentProject': PROJECT },
    api: {
      getSettings: async () => ({ lastProject: PROJECT, language: { interface: lang } }),
      listProjects: async () => [{ id: PROJECT, name: 'Project One', repo: 'https://github.com/o/r', folder: 'C:/repo' }],
      getBacklog: async () => data,
      syncBacklog: async () => data,
    },
  });
  await app.boot();
  app.run("showView('backlog')");
  await app.settle(30);
  await app.click('#bl-mode', { dataset: { mode: 'kanban' } });
  await app.settle(10);
  return app;
}
// the text of the page alert that names #330 ('' when none)
const alertText = (app) => {
  const el = H.findEl(String(app.el('#bl-alerts').innerHTML), (e) => e.attrs['data-testid'] === 'page-alert' && /#330\b/.test(H.visibleText(e.inner)));
  return el ? H.visibleText(el.inner) : '';
};

test('#445 in pt-BR the Backlog alert of a queue paused by #330\'s failure is in Portuguese and names #330', async (t) => {
  const queue = failedQueue(t);
  const en = alertText(await backlogPage('en', backlogData(queue)));
  const pt = alertText(await backlogPage('pt-BR', backlogData(queue)));
  assert.ok(en, 'in English the alert names #330 (fixture check)');
  assert.ok(pt, 'in pt-BR an alert names #330');
  assert.doesNotMatch(pt, /resume to start the next issues/i, `no English sentence: ${pt}`);
  assert.doesNotMatch(pt, /\bfailed\b/i, `no English word: ${pt}`);
  assert.notEqual(pt, en, 'the pt-BR text is not the English one');
});

test('#445 guard (already so today): an empty, not paused queue shows no queue bar', async () => {
  const app = await backlogPage('en', backlogData({ paused: false, error: null, inputs: {}, items: [], skipped: [] }));
  const bar = app.el('#bl-queue');
  assert.ok(bar.classList.contains('hidden') || !String(bar.innerHTML).trim(), 'the queue bar (#bl-queue) is hidden or empty');
  const shown = [...app.elements.values(), ...app.created].map((el) => String(el.innerHTML || '')).join('\n');
  const drawn = H.findAll(shown, (e) => e.attrs['data-testid'] === 'queue-bar').filter((e) => H.visibleText(e.inner));
  assert.equal(drawn.length, 0, 'no queue bar with content (data-testid="queue-bar")');
  assert.doesNotMatch(H.visibleText(String(bar.innerHTML)), /Queue paused|Paused/i);
});
