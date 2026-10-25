// Night watch metrics (#172, packages/engine/domains/night/night-watch.js): nightMetrics is a pure function of the night
// window, the Oracle's night log and the runs' facts, so these fixtures build the log/runs by hand
// (no fs, no service) and check the numbers against worked-out values, not against the formula
// itself. Focused on the autonomy and TTR fix of this round (autonomy counts autonomous actions,
// not incidents-with-an-action; TTR covers every incident that resumed, escalated or not).
const test = require('node:test');
const assert = require('node:assert/strict');
const { nightMetrics } = require('../../domains/night/night-watch');

const W0 = Date.parse('2026-10-01T22:00:00.000Z');
const minute = (m) => W0 + m * 60e3;
const iso = (m) => new Date(minute(m)).toISOString();
const night = { startedAt: iso(0), until: iso(540) }; // a 9 h window
const NOW = minute(540);

test('autonomy: two autonomous actions on the same incident count twice, not once', () => {
  const log = [
    { ts: iso(100), type: 'oracle.detected', id: 'i1', kind: 'failed', target: 'p1/i3', runId: 'r1', projectId: 'p1', since: iso(95) },
    { ts: iso(101), type: 'oracle.action', actionId: 'a1', kind: 'roadmap.item', target: 'p1/i3', runId: 'r1', projectId: 'p1', permission: 'retry', auto: true, ok: true },
    { ts: iso(105), type: 'oracle.action', actionId: 'a2', kind: 'roadmap.item', target: 'p1/i3', runId: 'r1', projectId: 'p1', permission: 'retry', auto: true, ok: true },
  ];
  const m = nightMetrics({ night, log, runs: [], now: NOW });
  assert.equal(m.incidents.count, 1);
  assert.equal(m.actions.auto, 2);
  assert.equal(m.autonomy, 2); // 2 autonomous actions / 1 incident: can go over 1
});

test('autonomy: null when the window had no incidents', () => {
  const m = nightMetrics({ night, log: [], runs: [], now: NOW });
  assert.equal(m.incidents.count, 0);
  assert.equal(m.autonomy, null);
});

test('autonomy: an action the owner clicked (auto: false) is not counted', () => {
  const log = [
    { ts: iso(100), type: 'oracle.detected', id: 'i1', kind: 'failed', target: 'p1/i3', runId: 'r1', projectId: 'p1', since: iso(95) },
    { ts: iso(101), type: 'oracle.action', actionId: 'a1', kind: 'roadmap.item', target: 'p1/i3', runId: 'r1', projectId: 'p1', permission: 'retry', auto: false, ok: true },
  ];
  const m = nightMetrics({ night, log, runs: [], now: NOW });
  assert.equal(m.actions.auto, 0);
  assert.equal(m.autonomy, 0);
});

test('TTR: an incident that is escalated and whose run resumes with no auto action is in ttr and blockedTime, not in resolved', () => {
  const events = (startM, resumeM, endM) => [
    { ts: iso(startM), type: 'workflow.started', project_id: 'p1', issues: [] },
    { ts: iso(startM + 1), type: 'step.started', step_id: 'implement' },
    { ts: iso(startM + 2), type: 'step.finished', step_id: 'implement' },
    { ts: iso(resumeM), type: 'step.started', step_id: 'implement' },
    { ts: iso(resumeM + 1), type: 'step.finished', step_id: 'implement' },
    { ts: iso(endM), type: 'workflow.finished', status: 'success', summary: { cost_usd: 1 } },
  ];
  const log = [
    { ts: iso(100), type: 'oracle.detected', id: 'iA', kind: 'failed', target: 'rA', runId: 'rA', projectId: 'p1', since: iso(95) },
    { ts: iso(101), type: 'oracle.escalated', target: 'rA', runId: 'rA', projectId: 'p1', reason: 'failed', recommendation: 'Retry issue #3 yourself.' },
  ];
  const runs = [{ runId: 'rA', events: events(80, 120, 400) }];
  const m = nightMetrics({ night, log, runs, now: NOW });

  assert.equal(m.incidents.count, 1);
  const [incident] = m.incidents.list;
  assert.equal(incident.resumedAt, minute(120));
  assert.equal(incident.resolved, false); // no oracle.action fixed it
  assert.equal(incident.escalated, true);

  assert.equal(m.resolved, 0);
  assert.equal(m.resolution, 0);
  assert.equal(m.ttr.count, 1);
  assert.equal(m.ttr.median, 20 * 60e3); // resumedAt (120) - detectedAt (100)
  assert.equal(m.blockedTime.count, 1);
  assert.equal(m.blockedTime.median, 25 * 60e3); // resumedAt (120) - since (95)
});

test('TTR: an incident whose item never resumes in the window is in neither ttr nor blockedTime', () => {
  const events = [
    { ts: iso(280), type: 'workflow.started', project_id: 'p2', issues: [] },
    { ts: iso(281), type: 'step.started', step_id: 'implement' },
    { ts: iso(282), type: 'step.finished', step_id: 'implement' },
    { ts: iso(301), type: 'workflow.finished', status: 'failed', summary: { cost_usd: 1 } },
  ];
  const log = [
    { ts: iso(300), type: 'oracle.detected', id: 'iB', kind: 'failed', target: 'rB', runId: 'rB', projectId: 'p2', since: iso(295) },
    { ts: iso(301), type: 'oracle.escalated', target: 'rB', runId: 'rB', projectId: 'p2', reason: 'failed', recommendation: 'Retry issue #9 yourself.' },
  ];
  const runs = [{ runId: 'rB', events }];
  const m = nightMetrics({ night, log, runs, now: NOW });

  const [incident] = m.incidents.list;
  assert.equal(incident.resumedAt, null);
  assert.equal(m.ttr.count, 0);
  assert.equal(m.blockedTime.count, 0);
});

test('TTR: median and p90 over a mixed set of resumed incidents, one of which never resumes', () => {
  const resumed = (startM, resumeM, endM) => [
    { ts: iso(startM), type: 'workflow.started', project_id: 'p1', issues: [] },
    { ts: iso(startM + 1), type: 'step.started', step_id: 'implement' },
    { ts: iso(startM + 2), type: 'step.finished', step_id: 'implement' },
    { ts: iso(resumeM), type: 'step.started', step_id: 'implement' },
    { ts: iso(resumeM + 1), type: 'step.finished', step_id: 'implement' },
    { ts: iso(endM), type: 'workflow.finished', status: 'success', summary: { cost_usd: 1 } },
  ];
  const neverResumes = [
    { ts: iso(280), type: 'workflow.started', project_id: 'p1', issues: [] },
    { ts: iso(281), type: 'step.started', step_id: 'implement' },
    { ts: iso(282), type: 'step.finished', step_id: 'implement' },
    { ts: iso(301), type: 'workflow.finished', status: 'failed', summary: { cost_usd: 1 } },
  ];
  const log = [
    { ts: iso(100), type: 'oracle.detected', id: 'iA', kind: 'failed', target: 'rA', runId: 'rA', projectId: 'p1', since: iso(95) }, // ttr 20 min
    { ts: iso(101), type: 'oracle.escalated', target: 'rA', runId: 'rA', projectId: 'p1', reason: 'failed', recommendation: '-' },
    { ts: iso(150), type: 'oracle.detected', id: 'iC', kind: 'failed', target: 'rC', runId: 'rC', projectId: 'p1', since: iso(145) }, // ttr 10 min
    { ts: iso(151), type: 'oracle.escalated', target: 'rC', runId: 'rC', projectId: 'p1', reason: 'failed', recommendation: '-' },
    { ts: iso(200), type: 'oracle.detected', id: 'iD', kind: 'failed', target: 'rD', runId: 'rD', projectId: 'p1', since: iso(190) }, // ttr 30 min
    { ts: iso(201), type: 'oracle.escalated', target: 'rD', runId: 'rD', projectId: 'p1', reason: 'failed', recommendation: '-' },
    { ts: iso(300), type: 'oracle.detected', id: 'iB', kind: 'failed', target: 'rB', runId: 'rB', projectId: 'p1', since: iso(295) }, // never resumes
    { ts: iso(301), type: 'oracle.escalated', target: 'rB', runId: 'rB', projectId: 'p1', reason: 'failed', recommendation: '-' },
  ];
  const runs = [
    { runId: 'rA', events: resumed(80, 120, 400) },
    { runId: 'rC', events: resumed(140, 160, 400) },
    { runId: 'rD', events: resumed(185, 230, 400) },
    { runId: 'rB', events: neverResumes },
  ];
  const m = nightMetrics({ night, log, runs, now: NOW });

  assert.equal(m.incidents.count, 4);
  assert.equal(m.ttr.count, 3); // rB never resumes: excluded
  assert.equal(m.ttr.median, 20 * 60e3);
  assert.equal(m.ttr.p90, 28 * 60e3); // quantile([10,20,30], 0.9) minutes
  assert.equal(m.blockedTime.count, 3);
  assert.equal(m.blockedTime.median, 25 * 60e3);
  assert.equal(m.blockedTime.p90, 37 * 60e3); // quantile([15,25,40], 0.9) minutes
});
