// #280 acceptance tests (written before the code): the channel analytics:agents, the earlier usage lines
// it still reads, the Supervisor chat's spend in Usage and in the monthly budget check, and the
// simulated data of `npm run screenshot -- --view analytics --tab agents`.
// Seam: the engine service on a scratch workspace (test/service/helpers.js), its channels called as the
// renderer does; the usage files are written into the workspace by hand (a fixed dataset).
//
// The payload assumed for analytics:agents({ from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }) (days in UTC):
//   { agents: {
//       oracle | 'product-owner' | supervisor: {
//         totals: { costUsd, tokens: { input, output, cache_read, cache_write }, turns, sessions,
//                   projects (Product Owner only: distinct projectIds) },
//         days: [{ day: 'YYYY-MM-DD', costUsd, tokens: { input, output, cache_read, cache_write } }],
//         sessions: [{ agent, sessionId, start, startReason, turns, contextAtEnd, costUsd, tokens, end, endReason }],
//       } } }
// startReason: first | compaction | model-change | idle | reset | cleared | one-shot, null for a line
// written before #280; endReason: the next session's startReason, 'answered' for a one-shot call,
// 'open' for the agent's last session. A Supervisor chat turn from before #280 (its cost only on the
// message in supervisor/chat.jsonl) has tokens null ("not recorded").
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeService } = require('../service/helpers');

const near = (actual, expected, msg) => assert.ok(Math.abs(Number(actual) - expected) < 1e-9, `${msg || 'value'}: expected ${expected}, got ${actual}`);
const jsonl = (file, lines) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
};
const tok = (input, output, cache_read, cache_write) => ({ input, output, cache_read, cache_write });
const M = 'claude-opus-5-5';
const RANGE = { from: '2026-09-01', to: '2026-09-30' };

// ---- the fixed dataset ----------------------------------------------------------------------------
// Oracle: o-x (out of range), o-0 (a line from before #280: no agent/session/startReason), o-1 (first,
// 2 turns), o-2 (idle, 1 turn, still open). In range: 0.2 + 0.5 + 0.3 + 0.7 = US$ 1.7, 4 turns, 3 sessions.
const ORACLE = [
  { ts: '2026-08-31T12:00:00.000Z', agent: 'oracle', provider: 'claude', model: M, tokens: tok(9, 9, 9, 9), costUsd: 9, cumulativeUsd: 9, sessionId: 'o-x', session: 'fresh', startReason: 'first' },
  { ts: '2026-09-09T08:00:00.000Z', provider: 'claude', model: M, tokens: tok(50, 20, 0, 0), costUsd: 0.2, cumulativeUsd: 0.2, sessionId: 'o-0' },
  { ts: '2026-09-10T09:00:00.000Z', agent: 'oracle', provider: 'claude', model: M, tokens: tok(100, 50, 1000, 200), costUsd: 0.5, cumulativeUsd: 0.5, sessionId: 'o-1', session: 'fresh', startReason: 'first', contextTokens: 1300 },
  { ts: '2026-09-10T09:20:00.000Z', agent: 'oracle', provider: 'claude', model: M, tokens: tok(10, 40, 1500, 100), costUsd: 0.3, cumulativeUsd: 0.8, sessionId: 'o-1', session: 'resumed', contextTokens: 1610 },
  { ts: '2026-09-11T10:00:00.000Z', agent: 'oracle', provider: 'claude', model: M, tokens: tok(200, 100, 0, 3000), costUsd: 0.7, cumulativeUsd: 0.7, sessionId: 'o-2', session: 'fresh', startReason: 'idle', contextTokens: 3200 },
];
// Product Owner: one line from before #280 (no sessionId, no session fields) and two one-shot calls on two
// projects. US$ 1.1, 3 turns, 3 sessions, 2 projects.
const PO = [
  { ts: '2026-09-05T12:00:00.000Z', projectId: 'p-a', provider: 'claude', model: M, tokens: tok(100, 100, 0, 0), costUsd: 0.1 },
  { ts: '2026-09-10T12:00:00.000Z', agent: 'product-owner', projectId: 'p-a', provider: 'claude', model: M, tokens: tok(300, 200, 400, 100), costUsd: 0.4, sessionId: 'po-1', session: 'fresh', startReason: 'one-shot' },
  { ts: '2026-09-12T12:00:00.000Z', agent: 'product-owner', projectId: 'p-b', provider: 'claude', model: M, tokens: tok(1000, 500, 0, 0), costUsd: 0.6, sessionId: 'po-2', session: 'fresh', startReason: 'one-shot' },
];
// Supervisor chat: usage.jsonl from #280 on (s-1: first, 2 turns; s-2: cleared, open; one line out of
// range), and chat.jsonl, whose answers carry costUsd: the one before usage.jsonl existed (US$ 0.35)
// is an earlier turn; the later ones are the same turns as usage.jsonl's and count once.
// In range: 0.35 + 0.9 + 0.2 + 0.6 = US$ 2.05, 4 turns, 3 sessions.
const SUPERVISOR_USAGE = [
  { ts: '2026-09-15T10:00:05.000Z', agent: 'supervisor', provider: 'claude', model: M, tokens: tok(500, 100, 0, 2000), costUsd: 0.9, sessionId: 's-1', session: 'fresh', startReason: 'first' },
  { ts: '2026-09-15T10:10:05.000Z', agent: 'supervisor', provider: 'claude', model: M, tokens: tok(50, 60, 2000, 100), costUsd: 0.2, sessionId: 's-1', session: 'resumed' },
  { ts: '2026-09-16T10:00:05.000Z', agent: 'supervisor', provider: 'claude', model: M, tokens: tok(400, 80, 0, 1500), costUsd: 0.6, sessionId: 's-2', session: 'fresh', startReason: 'cleared' },
  { ts: '2026-10-01T10:00:05.000Z', agent: 'supervisor', provider: 'claude', model: M, tokens: tok(1, 1, 1, 1), costUsd: 5, sessionId: 's-3', session: 'fresh', startReason: 'model-change' },
];
const SUPERVISOR_CHAT = [
  { ts: '2026-09-02T10:00:00.000Z', role: 'user', text: 'An old question', screen: null },
  { ts: '2026-09-02T10:01:00.000Z', role: 'supervisor', text: 'An old answer', model: M, costUsd: 0.35 },
  { ts: '2026-09-16T09:59:50.000Z', role: 'user', text: 'A new question', screen: null },
  { ts: '2026-09-16T10:00:05.000Z', role: 'supervisor', text: 'A new answer', model: M, costUsd: 0.6 },
];

function seed(service) {
  const ws = service.workspace();
  const files = {
    oracle: path.join(ws.oracle, 'usage.jsonl'),
    po: path.join(ws.backlog, 'product-owner.usage.jsonl'),
    supervisor: path.join(ws.supervisor, 'usage.jsonl'),
    chat: path.join(ws.supervisor, 'chat.jsonl'),
  };
  jsonl(files.oracle, ORACLE);
  jsonl(files.po, PO);
  jsonl(files.supervisor, SUPERVISOR_USAGE);
  jsonl(files.chat, SUPERVISOR_CHAT);
  return files;
}

async function agentsFor(t, range = RANGE) {
  const { service, api } = makeService(t);
  const files = seed(service);
  const out = await api['analytics:agents'](range);
  return { out, files, service, api };
}

const sessionOf = (agent, id) => {
  const s = agent.sessions.find((x) => x.sessionId === id);
  assert.ok(s, `session ${id} in ${JSON.stringify(agent.sessions.map((x) => x.sessionId))}`);
  return s;
};
const dayOf = (agent, day) => agent.days.find((d) => d.day === day);

// ---- totals (criterion 4) --------------------------------------------------------------------------

test('#280 analytics:agents: the Oracle\'s totals in the range (cost, the four token kinds, turns, sessions)', async (t) => {
  const { out } = await agentsFor(t);
  const o = out.agents.oracle.totals;
  near(o.costUsd, 1.7, 'cost');
  assert.deepEqual(o.tokens, { input: 360, output: 210, cache_read: 2500, cache_write: 3300 });
  assert.equal(o.turns, 4);
  assert.equal(o.sessions, 3);
});

test('#280 analytics:agents: the Product Owner\'s totals count each call as a session, and its projects', async (t) => {
  const { out } = await agentsFor(t);
  const p = out.agents['product-owner'].totals;
  near(p.costUsd, 1.1, 'cost');
  assert.deepEqual(p.tokens, { input: 1400, output: 800, cache_read: 400, cache_write: 100 });
  assert.equal(p.turns, 3);
  assert.equal(p.sessions, 3);
  assert.equal(p.projects, 2);
});

test('#280 analytics:agents: the Supervisor chat\'s totals add its earlier turns\' cost from chat.jsonl once, its tokens from usage.jsonl only', async (t) => {
  const { out } = await agentsFor(t);
  const s = out.agents.supervisor.totals;
  near(s.costUsd, 2.05, 'cost (the turns in usage.jsonl are not counted again from their messages)');
  assert.deepEqual(s.tokens, { input: 950, output: 240, cache_read: 2000, cache_write: 3600 });
  assert.equal(s.turns, 4);
  assert.equal(s.sessions, 3);
});

// ---- per-day series (criterion 4) ------------------------------------------------------------------

test('#280 analytics:agents: per-day series hold each day\'s cost and tokens; days outside the range are left out', async (t) => {
  const { out } = await agentsFor(t);
  const o = out.agents.oracle;
  near(dayOf(o, '2026-09-09').costUsd, 0.2, 'Sep 9');
  near(dayOf(o, '2026-09-10').costUsd, 0.8, 'Sep 10');
  near(dayOf(o, '2026-09-11').costUsd, 0.7, 'Sep 11');
  assert.deepEqual(dayOf(o, '2026-09-10').tokens, { input: 110, output: 90, cache_read: 2500, cache_write: 300 });
  assert.ok(!dayOf(o, '2026-08-31'), 'Aug 31 is outside the range');
  near(o.days.reduce((s, d) => s + (Number(d.costUsd) || 0), 0), 1.7, 'the days add up to the total');
  near(dayOf(out.agents.supervisor, '2026-09-02').costUsd, 0.35, 'the Supervisor\'s earlier turn counts on its day');
  assert.ok(!dayOf(out.agents.supervisor, '2026-10-01'), 'Oct 1 is outside the range');
});

// ---- sessions (criterion 4) ------------------------------------------------------------------------

test('#280 analytics:agents: a session has its start, start reason, turns, context at end, cost, tokens, end and end reason (the next session\'s start reason)', async (t) => {
  const { out } = await agentsFor(t);
  const s = sessionOf(out.agents.oracle, 'o-1');
  assert.equal(s.agent, 'oracle');
  assert.equal(new Date(s.start).toISOString(), '2026-09-10T09:00:00.000Z');
  assert.equal(s.startReason, 'first');
  assert.equal(s.turns, 2);
  assert.equal(s.contextAtEnd, 1610);
  near(s.costUsd, 0.8, 'cost');
  assert.deepEqual(s.tokens, { input: 110, output: 90, cache_read: 2500, cache_write: 300 });
  assert.equal(new Date(s.end).toISOString(), '2026-09-10T09:20:00.000Z');
  assert.equal(s.endReason, 'idle');
});

test('#280 analytics:agents: the agent\'s last session is open; a one-shot Product Owner call ends "answered"', async (t) => {
  const { out } = await agentsFor(t);
  assert.equal(sessionOf(out.agents.oracle, 'o-2').endReason, 'open');
  assert.equal(sessionOf(out.agents.supervisor, 's-2').endReason, 'open');
  assert.equal(sessionOf(out.agents.supervisor, 's-1').endReason, 'cleared');
  const po = sessionOf(out.agents['product-owner'], 'po-1');
  assert.equal(po.startReason, 'one-shot');
  assert.equal(po.endReason, 'answered');
  assert.equal(po.turns, 1);
});

// ---- earlier lines (criterion 2) -------------------------------------------------------------------

test('#280 analytics:agents: a line written before #280 is read, its session with no start reason', async (t) => {
  const { out } = await agentsFor(t);
  const old = sessionOf(out.agents.oracle, 'o-0');
  assert.ok(old.startReason == null, `no start reason (got ${old.startReason})`);
  assert.equal(old.turns, 1);
  near(old.costUsd, 0.2, 'cost');
  const po = out.agents['product-owner'].sessions.find((x) => new Date(x.start).toISOString() === '2026-09-05T12:00:00.000Z');
  assert.ok(po, 'the Product Owner\'s line without a session id is a session too');
  assert.ok(po.startReason == null, `no start reason (got ${po.startReason})`);
  near(po.costUsd, 0.1, 'cost');
});

test('#280 analytics:agents: a Supervisor chat turn from before usage.jsonl is a session with its message\'s cost and tokens not recorded', async (t) => {
  const { out } = await agentsFor(t);
  const old = out.agents.supervisor.sessions.find((x) => new Date(x.start).toISOString().startsWith('2026-09-02'));
  assert.ok(old, `a session on Sep 2 in ${JSON.stringify(out.agents.supervisor.sessions.map((x) => x.start))}`);
  near(old.costUsd, 0.35, 'cost from the message');
  assert.equal(old.turns, 1);
  assert.ok(old.startReason == null, `no start reason (got ${old.startReason})`);
  assert.ok(old.tokens == null, `tokens not recorded (got ${JSON.stringify(old.tokens)})`);
});

test('#280 analytics:agents: reading never rewrites the usage files or the Supervisor\'s chat', async (t) => {
  const { service, api } = makeService(t);
  const files = seed(service);
  const before = Object.fromEntries(Object.entries(files).map(([k, f]) => [k, fs.readFileSync(f, 'utf8')]));
  await api['analytics:agents'](RANGE);
  for (const [k, f] of Object.entries(files)) assert.equal(fs.readFileSync(f, 'utf8'), before[k], `${k} is unchanged`);
});

test('#280 analytics:agents: an empty workspace gives the three agents with no turns', async (t) => {
  const { api } = makeService(t);
  const out = await api['analytics:agents'](RANGE);
  for (const id of ['oracle', 'product-owner', 'supervisor']) {
    assert.ok(out.agents[id], `${id} is in the payload`);
    assert.equal(out.agents[id].totals.turns, 0, `${id} has no turns`);
    assert.deepEqual(out.agents[id].sessions, []);
  }
});

// ---- the Supervisor chat counted (criterion 3) -----------------------------------------------------

test('#280 budget: the Supervisor chat\'s spend this month counts toward a blocking monthly budget (the Oracle\'s check refuses a question)', async (t) => {
  const { service, api } = makeService(t);
  await api['settings:set']({ budgets: { claude: { monthlyUsd: 5, blockOnLimit: true } } });
  jsonl(path.join(service.workspace().supervisor, 'usage.jsonl'), [
    { ts: new Date().toISOString(), agent: 'supervisor', provider: 'claude', model: M, tokens: tok(100, 100, 0, 0), costUsd: 6, sessionId: 's-1', session: 'fresh', startReason: 'first' },
  ]);
  const out = await api['oracle:ask']({ question: 'Hi', mock: true });
  assert.equal(out.message, null);
  assert.equal(out.refused?.reason, 'monthly-budget');
});

test('#280 Usage: the Supervisor chat\'s spend this month joins the Usage totals', async (t) => {
  const { service, api } = makeService(t);
  jsonl(path.join(service.workspace().supervisor, 'usage.jsonl'), [
    { ts: new Date().toISOString(), agent: 'supervisor', provider: 'claude', model: M, tokens: tok(100, 100, 0, 0), costUsd: 6, sessionId: 's-1', session: 'fresh', startReason: 'first' },
  ]);
  const snap = await api['usage:get']({ scope: 'orchestrator' });
  near(snap.totals.month.costUsd, 6, 'the month\'s total');
  near(snap.providers.find((p) => p.id === 'claude').month.costUsd, 6, 'Claude Code\'s month');
});

test('#280 budget: the Supervisor chat\'s spend this month counts toward the Product Owner\'s blocking monthly budget', async (t) => {
  // a "real" po:ask without a model: simulation-only is lifted for this call and the provider CLI is
  // faked (were the budget not to block, the fake answer comes back instead of the refusal)
  const simulation = require('../../src/engine/simulation');
  const providers = require('../../src/engine/providers');
  const { roadmapProject } = require('../service/helpers');
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const p = await roadmapProject(api, ws, t, [1, 2], 'po-budget-280');
  await api['settings:set']({ budgets: { claude: { monthlyUsd: 5, blockOnLimit: true } } });
  jsonl(path.join(ws.supervisor, 'usage.jsonl'), [
    { ts: new Date().toISOString(), agent: 'supervisor', provider: 'claude', model: M, tokens: tok(100, 100, 0, 0), costUsd: 6, sessionId: 's-1', session: 'fresh', startReason: 'first' },
  ]);
  const realSimOnly = simulation.simulationOnly;
  const realRunTurn = providers.runTurn;
  t.after(() => { simulation.simulationOnly = realSimOnly; providers.runTurn = realRunTurn; });
  simulation.simulationOnly = () => false;
  let called = 0;
  providers.runTurn = async () => { called += 1; return { text: 'Fake answer: no model was called.', usage: tok(1, 1, 0, 0), costUsd: 0.01, exitCode: 0 }; };
  const out = await api['po:ask']({ projectId: p.id, question: 'Analyze the backlog', mock: false, mode: 'plan', attachments: [], issues: [] });
  assert.equal(called, 0, 'no provider turn once the budget is reached');
  assert.equal(out.message?.error, true);
  assert.match(String(out.message?.text), /monthly budget/i);
});

// ---- totals of turns whose tokens were not recorded, and read errors --------------------------------

test('#280 analytics:agents: the Supervisor chat counts its earlier turn as one whose tokens were not recorded', async (t) => {
  const { out } = await agentsFor(t);
  assert.equal(out.agents.supervisor.totals.turnsWithoutTokens, 1);
  assert.ok(!out.agents.oracle.totals.turnsWithoutTokens, 'every Oracle line has its tokens');
});

test('#280 analytics:agents: a Supervisor usage file that cannot be read is an error, not an agent without turns', async (t) => {
  const { service, api } = makeService(t);
  fs.mkdirSync(path.join(service.workspace().supervisor, 'usage.jsonl'), { recursive: true });
  await assert.rejects(async () => api['analytics:agents'](RANGE));
});

test('#280 analytics:agents: an Oracle usage file that cannot be read is an error, not an agent without turns', async (t) => {
  const { service, api } = makeService(t);
  fs.mkdirSync(path.join(service.workspace().oracle, 'usage.jsonl'), { recursive: true });
  await assert.rejects(async () => api['analytics:agents'](RANGE));
});

// ---- simulated data for the screenshot (criterion 9) -----------------------------------------------

test('#280 screenshot: --view analytics offers the agents tab', () => {
  const { VIEWS } = require('../../scripts/screenshot');
  assert.ok(VIEWS.analytics.tabs.includes('agents'), `analytics tabs: ${VIEWS.analytics.tabs}`);
});

test('#280 screenshot: the simulated Agents data (src/domains/analytics/analytics-demo.js writeDemoAgents) has turns of the three agents and a session of every start reason', async (t) => {
  const { service, api } = makeService(t);
  const demo = require('../../src/domains/analytics/analytics-demo');
  assert.equal(typeof demo.writeDemoAgents, 'function', 'analytics-demo exports writeDemoAgents(ws, projectId, { now })');
  const now = Date.parse('2026-10-04T12:00:00Z');
  demo.writeDemoAgents(service.workspace(), 'demo-project', { now });
  const out = await api['analytics:agents']({ from: '2026-09-05', to: '2026-10-04' });
  for (const id of ['oracle', 'product-owner', 'supervisor']) assert.ok(out.agents[id].totals.turns > 0, `${id} has turns`);
  const reasons = new Set(Object.values(out.agents).flatMap((a) => a.sessions.map((s) => s.startReason)));
  for (const r of ['first', 'compaction', 'model-change', 'idle', 'reset', 'cleared', 'one-shot']) assert.ok(reasons.has(r), `a session that started by ${r}; got ${[...reasons]}`);
});
