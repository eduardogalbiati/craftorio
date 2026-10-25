// A replayed Night watch (#172), for simulated mode and screenshots (`npm run screenshot -- --view
// nightwatch`): two past nights written into a workspace as the app would have written them: the
// runs' events.jsonl and summary.json, the Oracle's night-log.jsonl, its usage.jsonl lines, the
// owner's permissions and the switch (off). Last night has an incident of every kind, a resolved
// retry, a false alarm, a gate left open, an action the owner undid in the morning, and actions
// the watch refused (outside the permissions, asked by content). Never used on real data: the
// service refuses it outside simulation (packages/engine/service/channels/nightwatch.js).

const fs = require('fs');
const path = require('path');

const PERMITTED = ['refresh', 'restore', 'retry'];

function stamp(t) {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

// One run: { id, start, end?, status?, cost, issues, steps: [minute], gate?: [requested, resolved?], logs: [{ at, kind }], limitAt?, interruptedAt?, contextRead? } (minutes from the night's start)
function writeRun(ws, w0, projectId, r) {
  const at = (m) => new Date(w0 + m * 60e3).toISOString();
  const runId = `${stamp(w0 + r.start * 60e3)}-nw${r.id}`;
  const ev = [];
  const push = (m, type, data = {}) => ev.push({ seq: ev.length + 1, ts: at(m), run_id: runId, type, ...data });
  push(r.start, 'workflow.started', { workflow: r.workflow || 'software-development', project_id: projectId, issues: r.issues.map((number) => ({ number })), inputs: {}, mock: false });
  for (const m of r.steps) { push(m, 'step.started', { step_id: 'implement', visit: 1 }); push(m + 1, 'step.finished', { step_id: 'implement', visit: 1, duration_ms: 60e3 }); }
  for (const l of r.logs || []) push(l.at, 'log', { kind: l.kind, message: `Simulated ${l.kind}` });
  if (r.limitAt != null) push(r.limitAt, 'limit.exceeded', { limit: 'max_cost_usd', value: 5, current: 5.2, paused: true });
  // #337: limits expanded ×2 tonight, and the context its turns read (past the day limit of 40M)
  if (r.contextRead) {
    push(r.start, 'limits.expanded', { day: { context: 40e6, cost: 120, duration: 8 * 3600e3 }, limits: { context: 80e6, cost: 240, duration: 16 * 3600e3, turns: 2 } });
    push(r.end ?? r.start, 'session.message_received', { step_id: 'implement', usage: { input: 0, output: 0, cache_read: r.contextRead, cache_write: 0 }, cost_usd: r.cost });
  }
  if (r.gate) {
    push(r.gate[0], 'approval.requested', { approval_id: 'review', step_id: 'review', message: 'Accept the change?', choices: ['approve', 'reject'] });
    if (r.gate[1] != null) push(r.gate[1], 'approval.resolved', { approval_id: 'review', step_id: 'review', approved: true, by: 'owner', wait_ms: (r.gate[1] - r.gate[0]) * 60e3 });
  }
  if (r.end != null) push(r.end, 'workflow.finished', { status: r.status, error: r.status === 'failed' ? 'Output of step "test_writer" failed validation' : null, summary: { cost_usd: r.cost } });
  ev.sort((a, b) => a.ts.localeCompare(b.ts));
  const dir = path.join(ws.runs, runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${ev.map((e) => JSON.stringify(e)).join('\n')}\n`);
  if (r.end != null) {
    fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
      run_id: runId, workflow: r.workflow || 'software-development', project_id: projectId, issues: r.issues.map((number) => ({ number })), status: r.status, mock: false,
      started_at: at(r.start), finished_at: at(r.end), duration_ms: (r.end - r.start) * 60e3, cost_usd: r.cost, inputs: {}, sessions: r.sessions || [],
      ...(r.progress ? { progress: r.progress } : {}),
    }, null, 2));
  }
  return runId;
}

/**
 * Writes the two demo nights into `ws` (setupWorkspace's layout) for `projectId`; last night ends
 * `endedMinAgo` minutes ago. `selfHealing` (#278): also the standing watch, on for 30 hours (its
 * log entry and self-healing.json; the caller turns settings.oracle.selfHealing on), with a finding
 * of each detector, a repair taken alone and an action left for the owner. `regressions` (#335): also
 * a test step's history whose last 3 runs cost 42% more (Home's morning summary flags it).
 * → { lastNight: { startedAt, until } }
 */
function writeDemoNights(ws, projectId, { now = Date.now(), endedMinAgo = 60, selfHealing = false, regressions = false } = {}) {
  const dir = ws.oracle || path.join(ws.root, 'oracle');
  fs.mkdirSync(dir, { recursive: true });
  const log = [];
  const usage = [];
  const entry = (w0, m, type, data) => log.push({ ts: new Date(w0 + m * 60e3).toISOString(), type, ...data });
  const by = 'owner (the Night watch screen)';

  // the night before: quiet, the roadmap ended early
  const n0 = now - (endedMinAgo + 24 * 60 + 9 * 60) * 60e3;
  const n0end = n0 + 9 * 60 * 60e3;
  writeRun(ws, n0, projectId, { id: '0001', start: 5, end: 140, status: 'success', cost: 4.1, issues: [11], steps: [10, 60, 120] });
  entry(n0, 0, 'oracle.watch', { on: true, until: new Date(n0end).toISOString(), startedAt: new Date(n0).toISOString(), by });
  entry(n0, 150, 'oracle.detected', { id: 'demo-n0-1', kind: 'roadmap-empty', target: 'all', runId: null, projectId: null, since: new Date(n0 + 141 * 60e3).toISOString() });
  entry(n0, 151, 'oracle.escalated', { target: 'all', runId: null, projectId: null, reason: 'roadmap-empty', recommendation: 'The roadmap ended at 02:21: plan more items before the next night.' });
  entry(n0, 540, 'oracle.watch', { on: false, until: new Date(n0end).toISOString(), startedAt: new Date(n0).toISOString(), by });
  usage.push({ ts: new Date(n0 + 151 * 60e3).toISOString(), provider: 'claude', model: 'claude-opus-5-5', tokens: { input: 900, output: 300, cache_read: 40000 }, costUsd: 0.09, sessionId: 'demo-night' });

  // last night: 9 hours, every kind of incident
  const w0 = now - (endedMinAgo + 9 * 60) * 60e3;
  const w1 = w0 + 9 * 60 * 60e3;
  const iso = (m) => new Date(w0 + m * 60e3).toISOString();
  const rFailed = writeRun(ws, w0, projectId, { id: '0002', start: 10, end: 104, status: 'failed', cost: 5.63, issues: [14], steps: [12, 40, 70] });
  const rInterrupted = writeRun(ws, w0, projectId, { id: '0003', start: 15, end: 25, status: 'interrupted', cost: 0.4, issues: [16], steps: [16] });
  const rLimit = writeRun(ws, w0, projectId, { id: '0004', start: 30, end: 60, status: 'cancelled', cost: 5.2, issues: [17], steps: [31, 45], limitAt: 55 });
  writeRun(ws, w0, projectId, { id: '0005', start: 5, end: 80, status: 'success', cost: 3.2, issues: [12], steps: [6, 30, 60] });
  const rRetried = writeRun(ws, w0, projectId, { id: '0006', start: 108, end: 190, status: 'success', cost: 4.75, issues: [14], steps: [109, 140, 170], contextRead: 58e6 });
  const rSlow = writeRun(ws, w0, projectId, { id: '0007', start: 200, end: 262, status: 'success', cost: 2.9, issues: [15], steps: [201, 215, 236, 250], logs: [{ at: 230, kind: 'stall' }] });
  const rGate = writeRun(ws, w0, projectId, { id: '0008', start: 380, cost: 1.8, issues: [18], steps: [381, 392], gate: [400, null] });

  entry(w0, 0, 'oracle.watch', { on: true, until: new Date(w1).toISOString(), startedAt: new Date(w0).toISOString(), by });
  entry(w0, 0.5, 'oracle.limits', { multiplier: 2, values: null, by: 'the owner', at: iso(0.5) });
  entry(w0, 26, 'oracle.detected', { id: 'demo-1', kind: 'interrupted', target: rInterrupted, runId: rInterrupted, projectId, since: iso(25) });
  entry(w0, 27, 'oracle.escalated', { target: rInterrupted, runId: rInterrupted, projectId, reason: 'interrupted', recommendation: 'Resume the run from its last step (a second app process held the workspace, #112).' });
  entry(w0, 56, 'oracle.detected', { id: 'demo-2', kind: 'limit', target: rLimit, runId: rLimit, projectId, since: iso(55) });
  entry(w0, 57, 'oracle.escalated', { target: rLimit, runId: rLimit, projectId, reason: 'limit', recommendation: 'Raise the run\'s cost limit or split issue #17: it reached US$ 5.20.' });
  entry(w0, 105, 'oracle.detected', { id: 'demo-3', kind: 'failed', target: rFailed, runId: rFailed, projectId, since: iso(104) });
  entry(w0, 105.5, 'oracle.detected', { id: 'demo-4', kind: 'roadmap-paused', target: projectId, runId: null, projectId, since: iso(104) });
  entry(w0, 106, 'oracle.action', {
    actionId: 'demo-a1', kind: 'roadmap.item', title: 'Retry roadmap item i3 (#14 Report export)', target: `${projectId}/i3`, runId: null, projectId,
    permission: 'retry', auto: true, backup: 'A copy of the roadmap was taken first.', undoable: true, result: 'Roadmap item i3: planned again.', ok: true,
  });
  entry(w0, 120, 'oracle.blocked', { actionId: 'demo-a2', kind: 'issue.update', target: projectId, runId: null, projectId, permission: null, reason: 'content' });
  entry(w0, 120, 'oracle.escalated', { actionId: 'demo-a2', target: projectId, runId: null, projectId, reason: 'content', recommendation: 'Comment on issue #14 (waits for your click: content the Oracle read asked for it)' });
  entry(w0, 150, 'oracle.action', {
    actionId: 'demo-a3', kind: 'workflow.restore', title: 'Restore workflow software-development.yaml to its default', target: 'software-development.yaml', runId: null, projectId: null,
    permission: 'restore', auto: true, backup: 'A copy of the edited workflow was kept.', undoable: true, result: 'Workflow software-development.yaml is the bundled default again.', ok: true,
  });
  entry(w0, 196, 'oracle.detected', { id: 'demo-5', kind: 'dispatch-idle', target: projectId, runId: null, projectId, since: iso(191) });
  entry(w0, 197, 'oracle.blocked', { actionId: 'demo-a4', kind: 'dispatch.restart', target: 'all', runId: null, projectId: null, permission: 'dispatch', reason: 'permission' });
  entry(w0, 197, 'oracle.escalated', { actionId: 'demo-a4', target: projectId, runId: null, projectId, reason: 'permission', recommendation: 'Restart the roadmap and queue dispatch (waits for your click: its permission is not allowed at night)' });
  entry(w0, 232, 'oracle.detected', { id: 'demo-6', kind: 'stalled', target: rSlow, runId: rSlow, projectId, since: iso(216) });
  entry(w0, 270, 'oracle.detected', { id: 'demo-7', kind: 'roadmap-empty', target: 'all', runId: null, projectId: null, since: iso(263) });
  entry(w0, 271, 'oracle.escalated', { target: 'all', runId: null, projectId: null, reason: 'roadmap-empty', recommendation: 'The roadmap is empty: append the low-complexity issues #19 and #21 (allow "Append" to let the watch do it).' });
  entry(w0, 401, 'oracle.escalated', { target: rGate, runId: rGate, projectId, reason: 'gate', recommendation: `Run ${rGate} waits at the human gate review: answer it when you are back.` });
  // the owner undid the restore in the morning
  log.push({ ts: new Date(now - 20 * 60e3).toISOString(), type: 'oracle.undone', action_id: 'demo-a3', kind: 'workflow.restore' });
  entry(w0, 540, 'oracle.watch', { on: false, until: new Date(w1).toISOString(), startedAt: new Date(w0).toISOString(), by });
  for (const [m, usd] of [[27, 0.11], [57, 0.08], [106, 0.21], [150, 0.14], [197, 0.09], [232, 0.07], [271, 0.12], [401, 0.06]]) {
    usage.push({ ts: iso(m), provider: 'claude', model: 'claude-opus-5-5', tokens: { input: 1200, output: 420, cache_read: 52000 }, costUsd: usd, sessionId: 'demo-night' });
  }

  // #278: Self-healing on since yesterday: a finding of each detector with its evidence, one repair
  // taken alone by day, one action left for the owner, and the Oracle's turns for them
  if (selfHealing) {
    const since = new Date(now - 30 * 3600e3).toISOString();
    const ago = (h) => new Date(now - h * 3600e3).toISOString();
    const at = (h, type, data) => log.push({ ts: ago(h), type, ...data });
    at(30, 'oracle.watch', { on: true, until: null, startedAt: since, by: 'Self-healing', selfHealing: true });
    at(5, 'oracle.detected', { id: 'demo-sh-1', kind: 'memory', target: rSlow, runId: rSlow, projectId, since: ago(5), evidence: { event: 'process.killed', command: 'node --test test/report-export.test.js', step: 'test', bytes: 9.1 * 1024 ** 3, limitBytes: 8 * 1024 ** 3 } });
    at(4, 'oracle.detected', { id: 'demo-sh-2', kind: 'cost-gap', target: rRetried, runId: rRetried, projectId, since: ago(4.1), evidence: { step: 'implement', session: 'developer', turn: 3, recordedUsd: 0, usageUsd: 3.2, tokens: 7997382, turns: 8 } });
    at(3, 'oracle.detected', { id: 'demo-sh-3', kind: 'environment', target: rFailed, runId: rFailed, projectId, since: ago(3.2), evidence: { files: ['test/server.test.js'], runs: [rInterrupted], issues: [14] } });
    at(2, 'oracle.detected', { id: 'demo-sh-4', kind: 'repeat', target: rGate, runId: rGate, projectId, since: ago(2.3), evidence: { command: 'npm run lint', step: 'implement', times: 3, lastOutput: 'Error: exit 1' } });
    at(3.9, 'oracle.action', {
      actionId: 'demo-sh-a1', kind: 'roadmap.item', title: 'Retry roadmap item i5 (#15 Usage chart)', target: `${projectId}/i5`, runId: null, projectId,
      permission: 'retry', auto: true, backup: 'A copy of the roadmap was taken first.', undoable: true, result: 'Roadmap item i5: planned again.', ok: true,
    });
    at(2.9, 'oracle.blocked', { actionId: 'demo-sh-a2', kind: 'issue.file', target: projectId, runId: null, projectId, permission: 'file-issue', reason: 'permission', owner: 'product-owner', requestedBy: 'oracle' });
    for (const [h, usd] of [[3.9, 0.18], [2.9, 0.22], [1.9, 0.12]]) usage.push({ ts: ago(h), provider: 'claude', model: 'claude-opus-5-5', tokens: { input: 1500, output: 520, cache_read: 61000 }, costUsd: usd, sessionId: 'demo-self-healing' });
    fs.writeFileSync(path.join(dir, 'self-healing.json'), JSON.stringify({ since }, null, 2));
  }

  // #335: the test step's history: 6 runs at US$ 1.00 before last night, then 3 at US$ 1.42 (a
  // regression of +42% on its cost, the morning summary's line with its 3 runs)
  if (regressions) {
    for (let n = 1; n <= 9; n += 1) {
      const recent = n > 6;
      const start = recent ? w0 + (n - 7) * 60 * 60e3 + 300 * 60e3 : n0 - (7 - n) * 24 * 3600e3;
      const cost = recent ? 1.42 : 1;
      writeRun(ws, start, projectId, {
        id: `-rg${n}`, start: 0, end: 10, status: 'success', cost, issues: [], steps: [0],
        sessions: [{ id: `s-rg${n}`, agent: 'test_writer', provider: 'claude', model: 'claude-opus-5-5', effort: 'high', step_id: 'test', turns: 1, cost_usd: cost }],
        progress: [{ step: 'test', type: 'agent', durationMs: 10 * 60e3 }],
      });
    }
  }

  log.sort((a, b) => a.ts.localeCompare(b.ts));
  fs.writeFileSync(path.join(dir, 'night-log.jsonl'), `${log.map((e) => JSON.stringify(e)).join('\n')}\n`);
  fs.appendFileSync(path.join(dir, 'usage.jsonl'), `${usage.map((e) => JSON.stringify(e)).join('\n')}\n`);
  fs.writeFileSync(path.join(dir, 'night-permissions.json'), JSON.stringify({ allowed: PERMITTED, updatedAt: new Date(w0 - 5 * 60e3).toISOString() }, null, 2));
  fs.writeFileSync(path.join(dir, 'night-watch.json'), JSON.stringify({ on: false, until: null, startedAt: new Date(w0).toISOString(), by }, null, 2));
  return { lastNight: { startedAt: new Date(w0).toISOString(), until: new Date(w1).toISOString() }, runs: { failed: rFailed, retried: rRetried, gate: rGate } };
}

module.exports = {
  writeDemoNights,
};
