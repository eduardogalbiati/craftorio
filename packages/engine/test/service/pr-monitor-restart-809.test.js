// #809 the PR monitor across a restart and on another app's Roadmap (review findings): the runs the app died
// in while they waited in their PR monitor all continue at start-up, even with the run limit at 1
// (areas/recover.js recoverLiveRuns → areas/runs.js startWorkflowRun, `recover.prMonitor` needs no slot), and a
// run another app runs, read from disk (its index row: runs.js prMonitor, the last pr.monitor event), shows its
// roadmap item waiting for the merge with the monitor's card (areas/roadmap.js mergeGateOf).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const roadmaps = require('../../domains/roadmap/roadmap');
const { ISSUE_WORKFLOW, makeService, roadmapIssue, roadmapProject } = require('./helpers');

const PR_URL = 'https://github.com/o/r/pull/9';
const TS = '2026-11-07T09:45:00.000Z';
const CARD = {
  state: 'failing', detail: 'failing',
  ci: { status: 'failed', failed: ['lint'] }, review: { status: 'changes_requested', by: ['alice'] },
  conflicts: { status: 'none' }, comments: { unanswered: 2 }, result: { ready: false, blockers: ['CI failed (lint)', 'changes requested by alice'] },
};

// the events of a run that waits in its PR monitor (`monitor`), or is at work in develop
function runEvents(runId, projectId, { monitor = true, card = null } = {}) {
  const lines = [{ ts: TS, run_id: runId, type: 'workflow.started', workflow: 'fixture-issue', file: 'fixture-issue.yaml', project_id: projectId, inputs: { mode: 'remote' }, mock: true }];
  if (monitor) {
    lines.push(
      { ts: TS, run_id: runId, type: 'step.started', step_id: 'develop', step_type: 'agent' },
      { ts: TS, run_id: runId, type: 'step.finished', step_id: 'develop', output: { branch: 'feat/1-x' } },
      { ts: TS, run_id: runId, type: 'step.started', step_id: 'ci', step_type: 'agent' },
      { ts: TS, run_id: runId, type: 'step.finished', step_id: 'ci', output: { pr_url: PR_URL, pr_number: 9, ci_status: 'success' } },
      { ts: TS, run_id: runId, type: 'step.started', step_id: 'pr_monitor', step_type: 'pr_monitor' },
    );
    if (card) lines.push({ ts: TS, run_id: runId, type: 'pr.monitor', step_id: 'pr_monitor', url: PR_URL, number: 9, checked_at: TS, ...card });
  } else {
    lines.push({ ts: TS, run_id: runId, type: 'step.started', step_id: 'develop', step_type: 'agent' });
  }
  return lines;
}

function writeRun(ws, runId, projectId, options) {
  const dir = path.join(ws.runs, runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${runEvents(runId, projectId, options).map((e) => JSON.stringify(e)).join('\n')}\n`);
  return dir;
}

async function setup(t, max = 1) {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  api['settings:set']({ concurrentRuns: { enabled: true, max, perProject: null, countSimulations: true } });
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1, 2], 'pr-monitor-restart-809');
  const ctx = {
    ws,
    events: new EventEmitter(),
    withPrState: (pr) => ({ ...pr, state: 'open', checkedAt: TS }),
    refreshPr: async (pr) => ({ ...pr, state: 'open' }),
    keepInterruptedMarks: () => {},
  };
  Object.assign(ctx, require('../../service/areas/runs')(ctx));
  Object.assign(ctx, require('../../service/areas/roadmap')(ctx));
  Object.assign(ctx, require('../../service/areas/recover')(ctx));
  // a live run at work holds the only slot
  const busy = () => ctx.active.set('run-at-work', {
    runId: 'run-at-work', projectId: p.id, mock: true, status: 'running', approvals: new Map(), prMonitor: null, stackHold: null,
    pendingGates: () => [], displayNames: () => ({ steps: {} }), stop: () => {},
  });
  return { ctx, ws, projectId: p.id, busy };
}

test('#809 restart: every run the app died in while in its PR monitor continues without a slot, a run at work does not', async (t) => {
  const s = await setup(t, 1);
  const started = [];
  const reported = [];
  // the service's startWorkflowRun is the seam recovery hands each run to: record what it is told
  s.ctx.startWorkflowRun = async (spec) => { started.push([spec.recover.runId, !!spec.recover.prMonitor]); };
  s.ctx.reportInterruptedRun = (mark) => reported.push(mark.runId);
  const claim = (runId, monitor) => ({
    runId, mark: { runId }, owner: { release: () => {} }, events: runEvents(runId, s.projectId, { monitor }),
    spec: { file: 'fixture-issue.yaml', inputs: { mode: 'remote' }, mock: true, projectId: s.projectId }, started: { then: null, from: null },
  });
  await s.ctx.recoverLiveRuns([claim('run-a', true), claim('run-b', true), claim('run-c', false)]);
  assert.deepEqual([started, reported], [[['run-a', true], ['run-b', true], ['run-c', false]], []]);
});

test('#809 restart: a run recovered in its PR monitor is not refused by a full run limit, a run at work is', async (t) => {
  const s = await setup(t, 1);
  s.busy();
  const attempt = (prMonitor) => s.ctx.startWorkflowRun({
    file: 'missing-809.yaml', inputs: { mode: 'remote' }, mock: true, projectId: s.projectId,
    recover: { runId: `run-${prMonitor}`, events: [], owner: { release: () => {} }, prMonitor },
  }).then(() => 'started', (e) => e.message);
  const [monitor, atWork] = [await attempt(true), await attempt(false)];
  for (const r of s.ctx.active.values()) if (r.runId !== 'run-at-work') r.stop?.();
  assert.deepEqual([/runs in progress/.test(monitor), /1 of 1 runs in progress/.test(atWork)], [false, true], `${monitor} | ${atWork}`);
});

test("#809 roadmap: another app's run waiting in its PR monitor (read from disk) shows its item waiting for the merge, with the monitor's card", async (t) => {
  const s = await setup(t, 2);
  const runId = '20261107-094500-other809';
  roadmaps.saveStages(s.ws.backlog, s.projectId, [
    { items: [{ workflow: 'fixture-issue.yaml', number: 1, mock: false, inputs: { mode: 'remote' } }] },
  ], { issues: [roadmapIssue(1), roadmapIssue(2)] });
  const itemId = roadmaps.readRoadmap(s.ws.backlog, s.projectId).stages[0].items[0].id;
  roadmaps.markStarted(s.ws.backlog, s.projectId, itemId, { runId });
  const dir = writeRun(s.ws, runId, s.projectId, { card: CARD });
  // another live process owns it (the parent of this test process), so it is running, not interrupted
  fs.writeFileSync(path.join(dir, 'owner.json'), JSON.stringify({ pid: process.ppid, host: os.hostname(), started_at: new Date().toISOString(), heartbeat_at: new Date().toISOString() }));
  const item = roadmaps.withStatus(roadmaps.readRoadmap(s.ws.backlog, s.projectId), (id) => s.ctx.gateRun(id)).stages[0].items[0];
  assert.deepEqual(
    [s.ctx.active.has(runId), item.status, item.pr?.url, item.pr?.ci?.status, (item.pr?.ci?.failed || []).join(), item.pr?.review?.status, item.pr?.comments?.unanswered, item.pr?.checkedAt],
    [false, 'waiting_merge', PR_URL, 'failed', 'lint', 'changes_requested', 2, TS],
  );
});
