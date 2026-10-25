// #280, internal details the acceptance tests leave out: the shared record's writer and reader
// (packages/engine/domains/agents/agents-usage.js), sessions across lines from before #280, the Oracle's wake-ups against
// questions, the range's last session staying open, the Supervisor chat's earlier turns
// (packages/engine/domains/supervisor/supervisor-chat.js usageTurns) and the demo data's `today: false` (packages/engine/domains/analytics/analytics-demo.js).
// No model call: the provider CLI is faked at engine/providers' runTurn, as in
// test/agents-usage-record-280.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const agentsUsage = require('../../domains/agents/agents-usage');
const oracle = require('../../domains/oracle/oracle');
const supervisorChat = require('../../domains/supervisor/supervisor-chat');
const { writeDemoAgents } = require('../../domains/analytics/analytics-demo');

const M = 'claude-opus-5-5';
const tok = (input, output, cache_read, cache_write) => ({ input, output, cache_read, cache_write });
function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-internals-280-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const jsonl = (file, lines) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n')}\n`);
};

test('#280 appendTurn: creates the folder; a resumed turn has no startReason key, a turn without a project no projectId key', (t) => {
  const file = path.join(tmpDir(t), 'nested', 'usage.jsonl');
  const fresh = agentsUsage.appendTurn(file, { agent: 'supervisor', model: M, tokens: tok(1, 2, 3, 4), costUsd: 0.5, sessionId: 's', startReason: 'first', contextTokens: 8 });
  const resumed = agentsUsage.appendTurn(file, { agent: 'supervisor', model: M, tokens: null, costUsd: undefined, sessionId: 's' });
  assert.deepEqual(agentsUsage.readLines(file), [fresh, resumed]);
  assert.equal(fresh.session, 'fresh');
  assert.equal(fresh.contextTokens, 8);
  assert.equal(resumed.session, 'resumed');
  assert.ok(!('startReason' in resumed));
  assert.ok(!('projectId' in resumed));
  assert.ok(!('contextTokens' in resumed));
  assert.deepEqual(resumed.tokens, {});
  assert.equal(resumed.costUsd, 0);
});

test('#280 readLines: a missing file has no lines; a line that is not JSON is skipped', (t) => {
  const dir = tmpDir(t);
  assert.deepEqual(agentsUsage.readLines(path.join(dir, 'none.jsonl')), []);
  jsonl(path.join(dir, 'u.jsonl'), [{ a: 1 }, '{ cut', '', { a: 2 }]);
  assert.deepEqual(agentsUsage.readLines(path.join(dir, 'u.jsonl')), [{ a: 1 }, { a: 2 }]);
});

test('#280 readLines: a file that cannot be read has no lines, and throws when strict (a missing one never does)', (t) => {
  const dir = tmpDir(t);
  // a folder in the file's place: reading it fails with something else than ENOENT
  assert.deepEqual(agentsUsage.readLines(dir), []);
  assert.throws(() => agentsUsage.readLines(dir, { strict: true }));
  assert.deepEqual(agentsUsage.readLines(path.join(dir, 'none.jsonl'), { strict: true }), []);
});

// the Supervisor chat on a faked CLI: `results[n]` is merged into the n-th turn's result
function fakeChat(t, results = []) {
  const dir = tmpDir(t);
  const providers = require('../../engine/providers');
  const real = { runTurn: providers.runTurn, seedClaudeTotal: providers.seedClaudeTotal };
  const seeded = [];
  let n = 0;
  providers.seedClaudeTotal = (...args) => { seeded.push(args); };
  providers.runTurn = async (opts) => ({ text: 'Fake answer: no model was called.', usage: tok(10, 5, 0, 0), costUsd: 0.1, providerSessionId: opts.providerSessionId || 'sess-1', exitCode: 0, ...results[n++] });
  t.after(() => Object.assign(providers, real));
  const chat = supervisorChat.createSupervisorChat({
    dir: () => dir, tools: () => [], bridge: { start: async () => ({ url: 'http://127.0.0.1:1', token: 'test' }) },
    mcpCommand: () => ({ command: 'node', args: [], env: {} }), skillsDirs: () => [], resolveCommand: () => 'claude', refuseReal: () => {},
  });
  return { chat, dir, seeded, lines: () => agentsUsage.readLines(path.join(dir, 'usage.jsonl')) };
}

test('#280 Supervisor chat: a resumed turn seeds the CLI session\'s last recorded total (an app restart forgets it), and records the new one', async (t) => {
  const { chat, seeded, lines } = fakeChat(t, [{ cliTotalCostUsd: 0.4 }, { cliTotalCostUsd: 0.7 }]);
  await chat.ask({ question: 'turn 1', mock: false });
  assert.deepEqual(seeded, [], 'a fresh session has no total to seed');
  await chat.ask({ question: 'turn 2', mock: false });
  assert.deepEqual(seeded, [['sess-1', 0.4]]);
  assert.deepEqual(lines().map((u) => u.cumulativeUsd), [0.4, 0.7]);
});

test('#280 Supervisor chat: a turn whose CLI gave no session id is followed by a "first" session, not a "cleared" one', async (t) => {
  const { chat, lines } = fakeChat(t, [{ providerSessionId: null }]);
  await chat.ask({ question: 'turn 1', mock: false });
  await chat.ask({ question: 'turn 2', mock: false });
  assert.deepEqual(lines().map((u) => u.startReason), ['first', 'first']);
});

test('#280 agentsAnalytics: lines from before #280 with one session id are one session, continued by a resumed line', () => {
  const out = agentsUsage.agentsAnalytics({
    oracle: [
      { ts: '2026-09-01T10:00:00.000Z', model: M, tokens: tok(1, 1, 0, 0), costUsd: 0.1, cumulativeUsd: 0.1, sessionId: 'old' },
      { ts: '2026-09-01T10:10:00.000Z', model: M, tokens: tok(1, 1, 0, 0), costUsd: 0.1, cumulativeUsd: 0.2, sessionId: 'old' },
      { ts: '2026-09-01T10:20:00.000Z', agent: 'oracle', model: M, tokens: tok(1, 1, 0, 0), costUsd: 0.1, cumulativeUsd: 0.3, sessionId: 'old', session: 'resumed', wake: true, contextTokens: 900 },
    ],
    from: '2026-09-01', to: '2026-09-30',
  });
  const { sessions, totals } = out.agents.oracle;
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].turns, 3);
  assert.equal(sessions[0].startReason, null);
  assert.equal(sessions[0].contextAtEnd, 900);
  assert.equal(sessions[0].endReason, 'open');
  // the two earlier lines do not say what they answered
  assert.equal(totals.wakeUps, 1);
  assert.equal(totals.questions, 0);
});

test('#280 agentsAnalytics: the Oracle\'s wake-ups and questions; the turn\'s own cost (turnUsd) is the one counted', () => {
  const line = (min, extra) => ({ ts: `2026-09-02T10:${min}:00.000Z`, agent: 'oracle', model: M, tokens: tok(10, 0, 0, 0), sessionId: 'a', session: 'resumed', ...extra });
  const out = agentsUsage.agentsAnalytics({
    oracle: [line('00', { costUsd: 9, turnUsd: 1, wake: false, session: 'fresh', startReason: 'first' }), line('05', { costUsd: 9, turnUsd: 2, wake: true }), line('10', { costUsd: 9, turnUsd: 3, wake: true })],
    from: '2026-09-01', to: '2026-09-30',
  });
  const { totals, days } = out.agents.oracle;
  assert.equal(totals.costUsd, 6);
  assert.equal(totals.wakeUps, 2);
  assert.equal(totals.questions, 1);
  assert.deepEqual(days, [{ day: '2026-09-02', costUsd: 6, tokens: tok(30, 0, 0, 0) }]);
});

test('#280 agentsAnalytics: a session cut by the range starts at its first turn in it; lines in any order are read oldest first', () => {
  const out = agentsUsage.agentsAnalytics({
    supervisor: [
      { ts: '2026-09-02T09:00:00.000Z', agent: 'supervisor', model: M, tokens: tok(1, 0, 0, 0), costUsd: 0.2, sessionId: 's', session: 'resumed' },
      { ts: '2026-08-31T23:00:00.000Z', agent: 'supervisor', model: M, tokens: tok(1, 0, 0, 0), costUsd: 0.1, sessionId: 's', session: 'fresh', startReason: 'first' },
      { ts: '2026-09-01T09:00:00.000Z', agent: 'supervisor', model: M, tokens: tok(1, 0, 0, 0), costUsd: 0.2, sessionId: 's', session: 'resumed' },
    ],
    from: '2026-09-01', to: '2026-09-30',
  });
  const [s] = out.agents.supervisor.sessions;
  assert.equal(out.agents.supervisor.sessions.length, 1);
  assert.equal(s.start, '2026-09-01T09:00:00.000Z');
  assert.equal(s.end, '2026-09-02T09:00:00.000Z');
  assert.equal(s.startReason, null);
  assert.equal(s.turns, 2);
  assert.equal(out.agents['product-owner'].totals.projects, 0);
});

test('#280 dayRuns: one summary-like run per UTC day, a session per turn with its own cost', () => {
  const runs = agentsUsage.dayRuns([
    { ts: '2026-09-01T10:00:00.000Z', model: M, tokens: tok(1, 2, 3, 4), costUsd: 0.5, sessionId: 'a' },
    { ts: '2026-09-01T11:00:00.000Z', model: M, tokens: null, costUsd: 0.25 },
    { ts: '2026-09-02T10:00:00.000Z', provider: 'claude', model: M, tokens: tok(1, 0, 0, 0), costUsd: 9, turnUsd: 1, sessionId: 'b' },
    { model: M, costUsd: 3 },
  ], { id: 'supervisor-chat', workflow: 'Supervisor chat' });
  assert.deepEqual(runs.map((r) => [r.run_id, r.workflow, r.sessions.length]), [['supervisor-chat-2026-09-01', 'Supervisor chat', 2], ['supervisor-chat-2026-09-02', 'Supervisor chat', 1]]);
  assert.deepEqual(runs[0].sessions[1], { provider: 'claude', model: M, tokens: {}, cost_usd: 0.25, provider_session_id: null, turns: 1 });
  assert.equal(runs[1].sessions[0].cost_usd, 1);
});

test('#280 Supervisor chat usageTurns: without usage.jsonl every real answer is a turn; simulated answers, requests and questions are not', (t) => {
  const dir = tmpDir(t);
  jsonl(path.join(dir, 'chat.jsonl'), [
    { ts: '2026-09-01T10:00:00.000Z', role: 'user', text: 'q' },
    { ts: '2026-09-01T10:01:00.000Z', role: 'supervisor', text: 'a', model: M, costUsd: 0.4 },
    { ts: '2026-09-01T10:02:00.000Z', role: 'supervisor', text: 'simulated', simulated: true, costUsd: 0 },
    { ts: '2026-09-01T10:03:00.000Z', role: 'supervisor', text: 'a request\'s result', costUsd: 0 },
    { ts: '2026-09-01T10:04:00.000Z', role: 'supervisor', text: 'cost unknown', model: M, costUsd: null },
  ]);
  const turns = supervisorChat.usageTurns(dir);
  assert.deepEqual(turns.map((u) => [u.ts.slice(11, 16), u.costUsd, u.tokens, u.sessionId]), [['10:01', 0.4, null, null], ['10:04', 0, null, null]]);
  assert.deepEqual(supervisorChat.usageRuns(dir).map((r) => r.run_id), ['supervisor-chat-2026-09-01']);
});

test('#280 Oracle: a wake-up\'s turn is recorded with wake true, a question\'s with wake false', async (t) => {
  const dir = tmpDir(t);
  const providers = require('../../engine/providers');
  const real = providers.runTurn;
  providers.runTurn = async (opts) => ({ text: 'Fake answer: no model was called.', usage: tok(10, 5, 0, 0), costUsd: 0.1, providerSessionId: opts.providerSessionId || 'sess-1', exitCode: 0 });
  t.after(() => { providers.runTurn = real; });
  const o = oracle.createOracle({
    dir: () => dir, tools: () => [], bridge: { start: async () => ({ url: 'http://127.0.0.1:1', token: 'test' }) },
    mcpCommand: () => ({ command: 'node', args: [], env: {} }), skillsDirs: () => [], resolveCommand: () => 'claude', refuseReal: () => {},
    agent: () => ({ model: M, effort: 'high' }), settings: () => ({}),
  });
  t.after(() => o.release());
  await o.ask({ question: 'a question', mock: false });
  await o.wake({ lines: ['run r1 failed at review'], runIds: ['r1'], mock: false });
  const lines = agentsUsage.readLines(path.join(dir, 'usage.jsonl'));
  assert.deepEqual(lines.map((u) => [u.wake, u.session]), [[false, 'fresh'], [true, 'resumed']]);
  assert.equal(lines[0].contextTokens, 10);
});

test('#280 Oracle: "New session" after a compaction whose turn failed starts the next session by "reset"', async (t) => {
  const dir = tmpDir(t);
  const providers = require('../../engine/providers');
  const real = providers.runTurn;
  let n = 0;
  providers.runTurn = async (opts) => {
    n += 1;
    if (n === 2) throw new Error('the CLI failed (test)');
    // the first answer leaves a context over the default 150,000 tokens: the next turn compacts
    return { text: 'Fake answer: no model was called.', usage: n === 1 ? tok(160000, 5, 0, 0) : tok(10, 5, 0, 0), costUsd: 0.1, providerSessionId: opts.providerSessionId || `sess-${n}`, exitCode: 0 };
  };
  t.after(() => { providers.runTurn = real; });
  const o = oracle.createOracle({
    dir: () => dir, tools: () => [], bridge: { start: async () => ({ url: 'http://127.0.0.1:1', token: 'test' }) },
    mcpCommand: () => ({ command: 'node', args: [], env: {} }), skillsDirs: () => [], resolveCommand: () => 'claude', refuseReal: () => {},
    agent: () => ({ model: M, effort: 'high' }), settings: () => ({}),
  });
  t.after(() => o.release());
  await o.ask({ question: 'turn 1', mock: false });
  await o.ask({ question: 'turn 2: the CLI fails after the compaction', mock: false }).catch(() => {});
  await o.reset();
  await o.ask({ question: 'turn 3', mock: false });
  assert.deepEqual(agentsUsage.readLines(path.join(dir, 'usage.jsonl')).map((u) => u.startReason), ['first', 'reset']);
});

test('#280 Oracle: a compaction whose turn failed is still the reason of the session the next answer starts', async (t) => {
  const dir = tmpDir(t);
  const providers = require('../../engine/providers');
  const real = providers.runTurn;
  let n = 0;
  providers.runTurn = async (opts) => {
    n += 1;
    if (n === 2) throw new Error('the CLI failed (test)');
    return { text: 'Fake answer: no model was called.', usage: n === 1 ? tok(160000, 5, 0, 0) : tok(10, 5, 0, 0), costUsd: 0.1, providerSessionId: opts.providerSessionId || `sess-${n}`, exitCode: 0 };
  };
  t.after(() => { providers.runTurn = real; });
  const o = oracle.createOracle({
    dir: () => dir, tools: () => [], bridge: { start: async () => ({ url: 'http://127.0.0.1:1', token: 'test' }) },
    mcpCommand: () => ({ command: 'node', args: [], env: {} }), skillsDirs: () => [], resolveCommand: () => 'claude', refuseReal: () => {},
    agent: () => ({ model: M, effort: 'high' }), settings: () => ({}),
  });
  t.after(() => o.release());
  await o.ask({ question: 'turn 1', mock: false });
  await o.ask({ question: 'turn 2: the CLI fails after the compaction', mock: false }).catch(() => {});
  await o.ask({ question: 'turn 3', mock: false });
  const lines = agentsUsage.readLines(path.join(dir, 'usage.jsonl'));
  assert.deepEqual(lines.map((u) => [u.session, u.startReason ?? null]), [['fresh', 'first'], ['fresh', 'compaction']]);
});

test('#280 writeDemoAgents: `today: false` leaves the Oracle without a turn today (UTC); by default it has one, before now', (t) => {
  const now = Date.parse('2026-10-05T01:30:00Z'); // 01:30 UTC: "three hours ago" is yesterday
  const today = '2026-10-05';
  const linesOf = (opts) => {
    const root = tmpDir(t);
    const ws = { oracle: path.join(root, 'oracle'), backlog: path.join(root, 'backlog'), supervisor: path.join(root, 'supervisor') };
    writeDemoAgents(ws, 'demo-app', { now, ...opts });
    return agentsUsage.readLines(path.join(ws.oracle, 'usage.jsonl'));
  };
  assert.equal(linesOf({ today: false }).filter((u) => u.ts.slice(0, 10) === today).length, 0);
  const withToday = linesOf({}).filter((u) => u.ts.slice(0, 10) === today);
  assert.ok(withToday.length > 0, 'a session today');
  assert.ok(withToday.every((u) => Date.parse(u.ts) <= now), 'no turn in the future');
});
