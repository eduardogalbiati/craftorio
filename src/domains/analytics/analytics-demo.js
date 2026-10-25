// Demo data for Analytics' Run tab (#228) and 24/7 tab (#188), written by scripts/screenshot.js into
// its scratch workspace (like src/domains/night/night-watch-demo.js): real (not simulated) finished runs with
// events.jsonl and summary.json, the app's heartbeat log (src/domains/session/app-sessions.js) and the Product
// Owner's plan answers with a calibration (#189). And for the Agents tab (#280): the usage files of
// the Oracle, the Product Owner and the Supervisor chat (src/domains/agents/agents-usage.js), which the E2E demo
// workspace gets too (features/support/app.js).

const fs = require('fs');
const path = require('path');
const { writeDemoNights } = require('../night/night-watch-demo');

const MIN = 60e3;
const p2 = (n) => String(n).padStart(2, '0');
const stamp = (t) => { const d = new Date(t); return `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}-${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}`; };

function writeRun(ws, runId, events, summary) {
  const dir = path.join(ws.runs, runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${events.map((e, i) => JSON.stringify({ seq: i + 1, run_id: runId, ...e })).join('\n')}\n`);
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({ run_id: runId, ...summary }, null, 2));
}

// One AI Development run: acceptance tests, develop (two visits), the suite twice, a review and the
// approve gate; `scale` multiplies the developer's cost and time.
const TITLES = ['Show the suite rounds in the run chat', 'JSON test results from the suite', 'Per-screen CSS for the Backlog', 'Agent colours in the timeline'];
function aiDevelopmentRun(ws, projectId, t0, { tag, scale = 1, numbers = [215, 216], gateMin = 30, title = null }) {
  const ts = (m) => new Date(t0 + m * MIN).toISOString();
  const issues = numbers.map((number, i) => ({ number, title: TITLES[(number + i) % TITLES.length] }));
  const usage = (input, output, cacheRead, cacheWrite) => ({ input, output, cache_read: cacheRead, cache_write: cacheWrite, reasoning: 0 });
  const turn = (m, sid, n, step, cost, u, active, waiting) => ({ ts: ts(m), type: 'session.message_received', session_id: sid, turn: n, step_id: step, usage: u, cost_usd: cost, active_ms: active * MIN, waiting_ms: waiting * MIN, duration_ms: (active + waiting) * MIN });
  const tool = (m, sid, id, command, d) => [
    { ts: ts(m), type: 'session.stream', session_id: sid, step_id: null, item: { kind: 'tool_call', id, name: 'Bash', input: { command } } },
    { ts: ts(m + d), type: 'session.stream', session_id: sid, item: { kind: 'tool_result', id, output: 'ok', is_error: false } },
  ];
  const d = Math.round(15 * scale);
  const s = { tests: 0, dev1: 6, suite1: 6 + d, dev2: 10 + d, suite2: 16 + d, review: 21 + d };
  const end = s.review + 6;
  const devCost = +(4 * scale).toFixed(2);
  const lowCache = scale > 1.5;
  const events = [
    { ts: ts(0), type: 'workflow.started', workflow: 'AI Development', file: 'ai-development.yaml', project_id: projectId, issues, mock: false },
    { ts: ts(s.tests), type: 'step.started', step_id: 'tests', visit: 1, step_type: 'agent', agent: 'test_writer' },
    ...tool(1, 's1', 'c1', 'npm test -- test/occupancy.test.js', 2),
    turn(6, 's1', 1, 'tests', 1.1, usage(9000, 6000, 240000, 20000), 4, 2),
    { ts: ts(s.dev1), type: 'step.finished', step_id: 'tests', visit: 1, duration_ms: 6 * MIN },
    { ts: ts(s.dev1), type: 'step.started', step_id: 'develop', visit: 1, step_type: 'agent', agent: 'developer' },
    ...tool(s.dev1 + 2, 's2', 'c2', 'npm run build', Math.max(2, Math.round(4 * scale))),
    ...tool(s.dev1 + 7, 's2', 'c3', 'node --test test/run-analysis.test.js', 3),
    turn(s.suite1, 's2', 1, 'develop', devCost * 0.75, lowCache ? usage(2400000, 60000, 3000000, 900000) : usage(300000, 40000, 2600000, 160000), d * 0.7, d * 0.3),
    { ts: ts(s.suite1), type: 'step.finished', step_id: 'develop', visit: 1, duration_ms: d * MIN },
    { ts: ts(s.suite1), type: 'step.started', step_id: 'suite', visit: 1, step_type: 'suite', agent: '' },
    { ts: ts(s.dev2), type: 'step.finished', step_id: 'suite', visit: 1, duration_ms: 4 * MIN, output: { kind: 'suite', status: 'fail', round: 1, duration_ms: 4 * MIN, failures: [{ test: 'chip thresholds' }], preexisting: [{ test: 'old flaky' }] } },
    { ts: ts(s.dev2), type: 'step.started', step_id: 'develop', visit: 2, step_type: 'agent', agent: 'developer' },
    turn(s.suite2, 's2', 2, 'develop', devCost * 0.25, usage(60000, 9000, 700000, 30000), 5, 1),
    { ts: ts(s.suite2), type: 'step.finished', step_id: 'develop', visit: 2, duration_ms: 6 * MIN },
    { ts: ts(s.suite2), type: 'step.started', step_id: 'suite', visit: 2, step_type: 'suite', agent: '' },
    { ts: ts(s.review), type: 'step.finished', step_id: 'suite', visit: 2, duration_ms: 5 * MIN, output: { kind: 'suite', status: 'pass', round: 2, duration_ms: 5 * MIN, failures: [], preexisting: [{ test: 'old flaky' }] } },
    { ts: ts(s.review), type: 'step.started', step_id: 'review', visit: 1, step_type: 'agent', agent: 'reviewer' },
    turn(end, 's3', 1, 'review', 0.9, usage(20000, 8000, 400000, 30000), 5, 1),
    { ts: ts(end), type: 'step.finished', step_id: 'review', visit: 1, duration_ms: 6 * MIN },
    { ts: ts(end), type: 'approval.requested', approval_id: 'a1', step_id: 'approve', message: 'Merge into the local main?' },
    { ts: ts(end + gateMin), type: 'approval.resolved', approval_id: 'a1', step_id: 'approve', approved: true, by: 'user', wait_ms: gateMin * MIN },
    { ts: ts(end + gateMin + 1), type: 'step.started', step_id: 'merge', visit: 1, step_type: 'merge', agent: '' },
    { ts: ts(end + gateMin + 2), type: 'step.finished', step_id: 'merge', visit: 1, duration_ms: MIN },
    { ts: ts(end + gateMin + 2), type: 'workflow.finished', status: 'success', summary: { cost_usd: 1.1 + devCost + 0.9 } },
  ];
  const sessions = [
    { id: 's1', agent: 'test_writer', step_id: 'tests', turns: 1, cost_usd: 1.1, tokens: usage(9000, 6000, 240000, 20000), active_ms: 4 * MIN },
    { id: 's2', agent: 'developer', step_id: 'develop', turns: 2, cost_usd: devCost, tokens: lowCache ? usage(2460000, 69000, 3700000, 930000) : usage(360000, 49000, 3300000, 190000), active_ms: (d * 0.7 + 5) * MIN },
    { id: 's3', agent: 'reviewer', step_id: 'review', turns: 1, cost_usd: 0.9, tokens: usage(20000, 8000, 400000, 30000), active_ms: 5 * MIN },
  ];
  const runId = `${stamp(t0)}-${tag}`;
  writeRun(ws, runId, events, {
    workflow: 'AI Development', project_id: projectId, issues, status: 'success', mock: false, inputs: { task: title || `Implement #${numbers.join(', #')}` },
    started_at: ts(0), finished_at: ts(end + gateMin + 2), duration_ms: (end + gateMin + 2) * MIN, cost_usd: 1.1 + devCost + 0.9,
    timing: { duration_ms: (end + gateMin + 2) * MIN, gate_wait_ms: gateMin * MIN, gates: { approve: { waits: 1, wait_ms: gateMin * MIN } } },
    steps: { tests: { visits: 1 }, develop: { visits: 2 }, suite: { visits: 2 }, review: { visits: 1 }, approve: { visits: 1 }, merge: { visits: 1 } },
    sessions,
  });
  return runId;
}

/** The Run tab: eight earlier AI Development runs and, newest, one that cost and took more than them. */
function writeDemoRunInDepth(ws, projectId, { now = Date.now() } = {}) {
  for (let i = 0; i < 8; i++) aiDevelopmentRun(ws, projectId, now - (i + 1) * 864e5 - 5 * 36e5, { tag: `demoad${i}`, scale: 0.8 + (i % 4) * 0.15, numbers: [180 + i], gateMin: 5 + i * 3 });
  return aiDevelopmentRun(ws, projectId, now - 3 * 36e5, { tag: 'demoadnow', scale: 2.4, numbers: [219, 220], gateMin: 65, title: '#219 + #220 JSON test results and suite rounds' });
}

/**
 * The 24/7 tab: 30 days of real runs (busy afternoons and nights, idle mornings, a gate wait, a failed
 * run), the app's heartbeat log with the machine asleep some mornings, the Night watch's nights and
 * two Product Owner plan answers with a calibration.
 */
function writeDemoOccupancy(ws, projectId, { now = Date.now() } = {}) {
  const day0 = new Date(now); day0.setHours(0, 0, 0, 0);
  const sessions = [];
  const plans = [];
  let issue = 300;
  for (let k = 29; k >= 0; k--) {
    const d = day0.getTime() - k * 864e5;
    // runs from 11:00 to 06:00 the next morning, with gaps; fewer on weekends
    const slots = [[11, 14.5], [14.2, 18], [18.5, 23], [23.2, 26.5], [26.6, 30]].filter((_, i) => (k % 7 === 2 ? i < 2 : true));
    slots.forEach(([a, b], i) => {
      const start = d + a * 36e5;
      const end = Math.min(d + b * 36e5, now - 10 * MIN);
      if (start >= now - 20 * MIN || end <= start) return;
      const id = `${stamp(start)}-occ${p2(k)}${i}`;
      const failed = (k + i) % 9 === 4;
      const gate = (k + i) % 5 === 1 ? [start + (end - start) * 0.6, start + (end - start) * 0.6 + 50 * MIN] : null;
      const nums = [issue++, issue++];
      const cost = +(3 + ((k * 7 + i * 3) % 11) * 0.8).toFixed(2);
      const ev = [
        { ts: new Date(start).toISOString(), type: 'workflow.started', workflow: 'AI Development', project_id: projectId, issues: nums.map((number) => ({ number, title: TITLES[number % TITLES.length] })), mock: false },
        { ts: new Date(start).toISOString(), type: 'step.started', step_id: 'develop', visit: 1, step_type: 'agent', agent: 'developer' },
      ];
      if (gate) {
        ev.push({ ts: new Date(gate[0]).toISOString(), type: 'approval.requested', approval_id: 'g', step_id: 'approve' });
        ev.push({ ts: new Date(Math.min(gate[1], end)).toISOString(), type: 'approval.resolved', approval_id: 'g', step_id: 'approve', approved: true, by: 'user' });
      }
      ev.push({ ts: new Date(end).toISOString(), type: 'step.finished', step_id: 'develop', visit: 1, duration_ms: end - start });
      ev.push({ ts: new Date(end).toISOString(), type: 'workflow.finished', status: failed ? 'failed' : 'success', summary: { cost_usd: cost } });
      writeRun(ws, id, ev, {
        workflow: 'AI Development', project_id: projectId, issues: nums.map((number) => ({ number, title: TITLES[number % TITLES.length] })), status: failed ? 'failed' : 'success', mock: false,
        started_at: new Date(start).toISOString(), finished_at: new Date(end).toISOString(), duration_ms: end - start, cost_usd: cost,
        steps: { develop: { visits: 1 }, review: { visits: 1 + ((k + i) % 3) } },
        sessions: [{ id: 's1', agent: 'developer', step_id: 'develop', turns: 3, cost_usd: cost, tokens: { input: 1e5, output: 2e4, cache_read: 9e5, cache_write: 5e4 } }],
      });
      if (i === 0) plans.push({ ts: new Date(start - 30 * MIN).toISOString(), role: 'po', text: 'Plan', answer: { summary: 'Plan', calibration: k % 2 ? 2 : 4, groups: [{ name: 'G1', issues: nums, stage: 1 }] } });
      else plans.at(-1)?.answer.groups.push({ name: `G${i + 1}`, issues: nums, stage: 1 + (i % 2) });
    });
    // the app ran all day except some mornings (the machine asleep 06:30-10:30)
    if (k % 3 === 0) {
      sessions.push({ start: new Date(d).toISOString(), end: new Date(d + 6.5 * 36e5).toISOString() });
      sessions.push({ start: new Date(d + 10.5 * 36e5).toISOString(), end: new Date(Math.min(d + 864e5, now)).toISOString() });
    } else sessions.push({ start: new Date(d).toISOString(), end: new Date(Math.min(d + 864e5, now)).toISOString() });
  }
  fs.writeFileSync(path.join(ws.root, 'app-sessions.json'), JSON.stringify({ sessions }, null, 1));
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, `${projectId}.po.jsonl`), `${plans.map((m) => JSON.stringify(m)).join('\n')}\n`);
  writeDemoNights(ws, projectId, { now });
}

/**
 * The Agents tab (#280): four weeks of turns in the three usage files. The Oracle: a session a day
 * (two every third day), questions and wake-ups, restarted by idle time, twice by a compaction after a
 * long session, once by a reset and twice by a model change. The Product Owner: a call per question
 * on two projects, its two oldest lines from before #280 (no session id, no start reason). The
 * Supervisor chat: its first session, two Clears and two model changes.
 * `today: false` leaves the Oracle without a turn today (its daily budget starts from zero).
 */
function writeDemoAgents(ws, projectId, { now = Date.now(), today = true } = {}) {
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  const opus = 'claude-opus-5-5';
  const sonnet = 'claude-sonnet-5-5';
  const iso = (t) => new Date(t).toISOString();
  const tokens = (input, output, cacheRead, cacheWrite) => ({ input, output, cache_read: cacheRead, cache_write: cacheWrite });
  const write = (file, lines) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
  };
  // a session's turns, `gapMin` apart: the first starts it (`reason`), the others resume it while the
  // context grows by 14k tokens a turn
  const session = (agent, id, t0, { reason, turns, model, gapMin }) => Array.from({ length: turns }, (_, j) => {
    const context = 30000 + 14000 * j;
    return {
      ts: iso(t0 + j * gapMin * MIN), agent, provider: 'claude', model,
      tokens: j ? tokens(300 + 40 * j, 700 + 60 * j, context - 14000, 14000) : tokens(1200, 900, 0, context),
      costUsd: j ? +(0.09 + 0.012 * j).toFixed(2) : 0.34,
      sessionId: id, session: j ? 'resumed' : 'fresh', ...(j ? {} : { startReason: reason }), contextTokens: context,
    };
  });

  // the Oracle's line also holds the session's cumulative cost and whether the turn was a wake-up
  const oracleSession = (...args) => {
    let sum = 0;
    return session('oracle', ...args).map((l, j) => ({ ...l, cumulativeUsd: +(sum += l.costUsd).toFixed(2), wake: j % 3 !== 0 }));
  };
  const RESTARTS = { 5: 'compaction', 10: 'reset', 15: 'model-change', 21: 'model-change', 26: 'compaction' };
  const utcMidnight = new Date(now).setUTCHours(0, 0, 0, 0);
  const oracle = [];
  let n = 0;
  let model = opus;
  for (let k = 27; k >= (today ? 0 : 1); k--) {
    for (const hoursAgo of k % 3 === 0 ? [9, 3] : [3]) {
      const reason = n === 0 ? 'first' : RESTARTS[n] || 'idle';
      if (reason === 'model-change') model = model === opus ? sonnet : opus;
      // ten turns pass the 150,000-token context: the next session starts by compaction
      const turns = RESTARTS[n + 1] === 'compaction' ? 10 : 2 + (n % 5);
      // the newest session is today's (UTC, like the daily budget), whatever the hour: its turns fit before `now`
      const newest = k === 0 && hoursAgo === 3;
      const t0 = newest ? Math.max(now - hoursAgo * HOUR, utcMidnight) : now - k * DAY - hoursAgo * HOUR;
      oracle.push(...oracleSession(`demo-oracle-${n}`, t0, { reason, turns, model, gapMin: newest ? Math.min(15, (now - t0) / MIN / (turns + 1)) : 15 }));
      n += 1;
    }
  }
  write(path.join(ws.oracle, 'usage.jsonl'), oracle);

  const po = Array.from({ length: 26 }, (_, i) => {
    const old = i < 2;
    return {
      ts: iso(now - (27 - i) * DAY - 7 * HOUR), ...(old ? {} : { agent: 'product-owner' }), projectId: i % 4 === 3 ? 'demo-api' : projectId, provider: 'claude', model: opus,
      tokens: tokens(42000 + 1500 * (i % 7), 2600 + 200 * (i % 5), 9000, 12000), costUsd: +(0.22 + 0.03 * (i % 6)).toFixed(2),
      ...(old ? {} : { sessionId: `demo-po-${i}`, session: 'fresh', startReason: 'one-shot' }),
    };
  });
  write(path.join(ws.backlog, 'product-owner.usage.jsonl'), po);

  const supervisor = [[25, 'first', 3, opus], [18, 'cleared', 2, opus], [11, 'model-change', 4, sonnet], [6, 'cleared', 3, sonnet], [1, 'model-change', 2, opus]]
    .flatMap(([k, reason, turns, m], i) => session('supervisor', `demo-supervisor-${i}`, now - k * DAY - 5 * HOUR, { reason, turns, model: m, gapMin: 6 }));
  write(path.join(ws.supervisor, 'usage.jsonl'), supervisor);
}

module.exports = {
  writeDemoAgents,
  writeDemoOccupancy,
  writeDemoRunInDepth,
};
